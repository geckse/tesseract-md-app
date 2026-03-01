# PRD: Ingest & Watcher Management

## Overview

Manual ingest button, ingest preview mode, progress feedback, and file watcher lifecycle management. The app can trigger `mdvdb ingest` for one-time indexing and start/stop `mdvdb watch` as a persistent background process that auto-re-indexes on file changes. This phase is independent of Phases 6 and 8.

## Problem Statement

Collections need to be indexed before search works. The CLI's `ingest` command creates the vector index, and `watch` keeps it current. The app needs UI controls for these operations: a way to trigger ingest, see progress, preview what would happen, and manage the long-running watcher process — including clean shutdown on app quit.

## Goals

- "Ingest" button to trigger `mdvdb ingest --json` for the active collection
- Preview mode: `mdvdb ingest --preview --json` shows what would happen without doing it
- Full reindex: `mdvdb ingest --reindex --json` option
- Progress/result display: files indexed, skipped, failed, duration, errors
- Cancel button to abort in-progress ingest
- Start/stop watcher toggle (`mdvdb watch`)
- Watcher status indicator in the status bar
- Watcher events forwarded to the UI (file change notifications)
- Auto-refresh file tree and status after watcher events
- Clean shutdown: kill watcher on app quit, no zombie processes

## Non-Goals

- Single-file ingest (`--file` flag — deferred)
- Watcher auto-start on collection open (manual toggle for now)
- Background ingest across multiple collections simultaneously
- Real-time progress streaming (ingest runs to completion, then reports)
- Custom ingest scheduling or cron-like automation

## Technical Design

### Data Model Changes

No persistent data. New stores:

```typescript
ingestState: Writable<'idle' | 'previewing' | 'ingesting' | 'done' | 'error'>
ingestResult: Writable<IngestResult | IngestPreview | null>
ingestErrors: Writable<IngestError[]>
watcherState: Writable<'stopped' | 'starting' | 'running' | 'error'>
watcherEvents: Writable<WatchEventReport[]>     // Ring buffer, last 50 events
```

### Interface Changes

**New module: `app/src/main/watcher.ts`**

```typescript
class WatcherManager {
  start(root: string): void              // Spawn `mdvdb watch --root <path>`
  stop(): Promise<void>                  // Send SIGTERM, await exit
  isRunning(): boolean                   // Check process state
  onEvent(callback: (event: WatchEventReport) => void): void
  onError(callback: (error: string) => void): void
  destroy(): Promise<void>               // Force kill + cleanup
}
```

**New IPC channels:**
- `'watcher:start'` → starts watcher for given root
- `'watcher:stop'` → stops current watcher
- `'watcher:status'` → returns current state
- `'watcher:events'` → IPC push channel (main → renderer) for live events

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  startWatcher(root: string): Promise<void>
  stopWatcher(): Promise<void>
  getWatcherStatus(): Promise<'stopped' | 'running' | 'error'>
  onWatcherEvent(callback: (event: WatchEventReport) => void): void
  removeWatcherEventListener(): void
}
```

### New Commands / API / UI

**Ingest UI** — accessible via sidebar or header:

- "Ingest" button: prominent action button in the sidebar (below the file tree area) or header.
- Dropdown: "Ingest", "Preview", "Full Reindex" options.
- Preview panel: table/list showing files that would be processed, their status (new/changed/unchanged), estimated API calls, estimated tokens.
- Progress panel (during ingest): animated progress indicator, live counts (files processed / total), elapsed time.
- Result panel (after ingest): summary card with files_indexed, files_skipped, chunks_created, duration_secs. Error list if any files failed.
- Cancel button: visible during ingest, kills the CLI process.

**Watcher controls:**

- Toggle button in the status bar: "Start Watching" / "Watching" with green pulse indicator.
- When running: green dot with `animate-pulse`, text "Watching" in emerald.
- When stopped: dim dot, text "Stopped".
- When error: red dot, text "Error" with tooltip showing the error message.
- Toast/notification on watcher events: "2 files re-indexed" (batch summarized, not per-file).

**Status bar integration:**
- Right side: watcher status indicator (replaces the "Synced" placeholder from Phase 1).
- Green pulsing dot when watcher is active (matching mockup's `animate-pulse` on the "Synced" indicator).

### Migration Strategy

N/A — new components and modules.

## Implementation Steps

1. **Build WatcherManager** — `app/src/main/watcher.ts`:
   - `start(root)`: spawn `child_process.spawn('mdvdb', ['watch', '--root', root])`.
   - Attach `stdout` line reader: each line is a JSON `WatchEventReport`. Parse and emit via callback.
   - Attach `stderr` reader: log errors, emit via error callback.
   - Handle `close` event: if unexpected (non-zero exit), set error state, implement auto-restart with exponential backoff (1s, 2s, 4s, max 30s). Stop retrying after 5 failures.
   - `stop()`: send `SIGTERM` (or `taskkill` on Windows), await `close` event, set state to stopped.
   - `destroy()`: force `SIGKILL` if `stop()` times out after 5s.
   - Track the child process PID for cleanup.

2. **Register watcher IPC handlers** — In `app/src/main/ipc-handlers.ts`:
   - `'watcher:start'`: instantiate WatcherManager, call `start(root)`.
   - `'watcher:stop'`: call `stop()`.
   - `'watcher:status'`: return current state.
   - Forward watcher events to renderer: `mainWindow.webContents.send('watcher:event', event)`.

3. **Update preload for watcher** — Add `startWatcher`, `stopWatcher`, `getWatcherStatus`, `onWatcherEvent` (uses `ipcRenderer.on`), `removeWatcherEventListener`.

4. **Clean shutdown** — In `app/src/main/index.ts`:
   - `app.on('before-quit', async () => { await watcherManager?.destroy() })`.
   - `app.on('window-all-closed', async () => { await watcherManager?.destroy() })`.
   - Ensures no zombie `mdvdb watch` processes survive the app closing.

5. **Create ingest/watcher stores** — `app/src/renderer/stores/ingest.ts`:
   - `ingestState`, `ingestResult`, `ingestErrors`, `watcherState`, `watcherEvents` as writable stores.
   - `runIngest(root, options)`: set state to `'ingesting'`, call `window.api.ingest(root, options)`, set state to `'done'` with result.
   - `runPreview(root)`: set state to `'previewing'`, call `window.api.ingestPreview(root)`, display result.
   - `toggleWatcher(root)`: start or stop based on current state.
   - Listen for watcher events: push to `watcherEvents` ring buffer (max 50), trigger file tree refresh.

6. **Build IngestPanel component** — `app/src/renderer/components/IngestPanel.svelte`:
   - Dropdown button: "Ingest" (default action) with chevron → dropdown menu: "Preview", "Full Reindex".
   - Preview view: table of files (path, status badge, chunks, tokens).
   - Progress view: animated spinner, "Indexing... N files processed" counter, cancel button.
   - Result view: summary card — `files_indexed`, `files_skipped`, `chunks_created`, `duration_secs`. Error list below if `files_failed > 0`.
   - Cancel: kills the ingest child process via a new IPC channel `'cli:cancel'`.

7. **Build WatcherToggle component** — `app/src/renderer/components/WatcherToggle.svelte`:
   - Small toggle button for the status bar.
   - States: stopped (dim), starting (spinning), running (green pulse), error (red).
   - Click: toggles watcher on/off.
   - Tooltip: shows current state description.

8. **Wire watcher events to UI** — In the App or a global event handler:
   - When watcher event arrives: add to `watcherEvents`, call `fetchFileTree()` to refresh, call `status()` to refresh index stats.
   - Show brief toast notification: "filename.md re-indexed" or "N files updated".
   - Batch multiple rapid events into a single notification.

9. **Update StatusBar** — Replace the "Synced" placeholder with the real `WatcherToggle` component.

10. **Write unit tests** — `tests/unit/WatcherManager.test.ts`:
    - Mock `child_process.spawn`.
    - Test start: spawns correct command.
    - Test stop: sends SIGTERM.
    - Test auto-restart: after unexpected exit, restarts with backoff.
    - Test destroy: force kills after timeout.
    - `tests/unit/IngestPanel.test.ts`: render with mock states, verify UI transitions.
    - `tests/unit/ingest-store.test.ts`: verify state transitions.

11. **Write integration tests** — `tests/integration/ingest.test.ts`:
    - Create temp dir with markdown files, init collection (with mock provider).
    - Run ingest through IPC, verify result shape.
    - Run preview, verify file list.
    - Start watcher, create a new file, wait for event, verify event shape.
    - Stop watcher, verify process exits.

12. **Write E2E tests** — `tests/e2e/ingest.test.ts`:
    - Open a collection.
    - Click "Preview", verify preview table appears.
    - Click "Ingest", verify progress then result.
    - Toggle watcher on, verify status bar shows "Watching".
    - Toggle watcher off, verify status bar shows "Stopped".

## Validation Criteria

- [ ] Clicking "Ingest" runs `mdvdb ingest --json` and shows results (files indexed, chunks, duration)
- [ ] Preview mode shows what would happen without actually indexing
- [ ] Full reindex option runs with `--reindex` flag
- [ ] Cancel button kills the ingest process mid-execution
- [ ] Watcher can be started and stopped via the status bar toggle
- [ ] Watcher status indicator: green pulse when running, dim when stopped, red on error
- [ ] Watcher events refresh the file tree and collection status
- [ ] Watcher auto-restarts with backoff on unexpected crash
- [ ] Watcher is killed cleanly on app quit (no zombie processes)
- [ ] Toast notifications appear for watcher events
- [ ] Ingest errors are displayed with file path and error message
- [ ] All unit, integration, and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT use `child_process.exec()` for the watcher** — Use `spawn()` for long-running processes. `exec()` buffers all output and has a maxBuffer limit.
- **Do NOT poll the watcher process** — Use event-driven callbacks on stdout/stderr/close. No `setInterval` checks.
- **Do NOT leave zombie processes** — Always track the child PID and ensure it's killed on app quit, even in error scenarios. Register cleanup in `before-quit` AND `window-all-closed`.
- **Do NOT restart the watcher infinitely** — Cap retries at 5 with exponential backoff. After max retries, set error state and wait for user to manually retry.
- **Do NOT parse watcher output as a single JSON blob** — The watcher outputs one JSON line per event (NDJSON). Parse line-by-line using readline or similar.
- **Do NOT run multiple watchers** — Only one watcher process at a time. Starting a new one must stop the existing one first.

## Patterns to Follow

- **Line-by-line JSON parsing** — Use Node's `readline.createInterface({ input: process.stdout })` to parse watcher output line by line. Each line is a complete JSON object.
- **Ring buffer for events** — Keep last 50 events in an array. When pushing, if `length > 50`, shift the oldest. This prevents unbounded memory growth.
- **Graceful → forceful shutdown** — Try SIGTERM first, wait 5s, then SIGKILL. This gives the CLI time to flush any pending writes.
- **Status bar mockup reference** — The watcher status indicator replaces the "Synced" element in `app-mockup-code.html` lines 335-337 (green pulsing dot + text).
