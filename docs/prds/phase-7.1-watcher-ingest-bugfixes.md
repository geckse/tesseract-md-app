# PRD: Watcher & Ingest Bugfixes

## Overview

Fixes two bugs in the watcher/ingest integration from Phase 7: (1) the Tantivy FTS lock conflict when running ingest while the watcher is active, and (2) the file tree not auto-updating after watcher events due to a missing event envelope.

## Problem Statement

### Bug 1: Tantivy Lock Conflict

When the file watcher (`mdvdb watch`) is running, it holds a Tantivy `IndexWriter` lock on the FTS index directory. Any ingest operation — full ingest, single-file reindex, or reindex-all — spawns a separate `mdvdb ingest` CLI process that tries to acquire the same lock. This fails with:

```
Failed to acquire Lockfile: LockBusy. "Failed to acquire index lock..."
```

Affected operations:
- "Ingest" button (`cli:ingest`)
- "Full Reindex" button (`cli:ingest` with `--reindex`)
- Right-click "Reindex File" on a single file (`cli:ingest-file`)

### Bug 2: File Tree Not Updating After Watcher Events

The renderer's `handleWatcherEvent()` checks `event.type === 'watch-event'` to trigger a file tree refresh. However, the main process forwards raw NDJSON events from the watcher stdout directly — without wrapping them in the expected `{ type, data }` envelope defined by the `WatcherEvent` interface. The raw events have shape `{ event_type, path, chunks_processed, ... }`, so the type check never matches and `loadFileTree()` is never called.

Additionally, watcher errors and state changes were sent on separate IPC channels (`watcher:error`, `watcher:state`) that the renderer never listened to, since it only listens on `watcher:event`.

## Goals

- Ingest operations succeed while the watcher is running
- File tree auto-refreshes after the watcher processes file changes
- Watcher state changes and errors are properly forwarded to the renderer
- No regression in existing watcher or ingest functionality

## Non-Goals

- Changing the Tantivy locking mechanism
- In-process ingest (still uses CLI subprocess)
- Debouncing rapid file tree refreshes (out of scope, can be added later)

## Technical Design

### Fix 1: Pause Watcher During Ingest

Add a `withWatcherPaused()` helper in `app/src/main/ipc-handlers.ts` that:

1. Checks if the `WatcherManager` singleton is currently running
2. If running: stops the watcher, executes the callback, then restarts the watcher
3. If not running: executes the callback directly
4. Uses try/finally to ensure the watcher is restarted even if ingest fails

```typescript
async function withWatcherPaused<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const watcher = watcherManager
  const wasRunning = watcher?.isRunning() ?? false

  if (wasRunning && watcher) {
    await watcher.stop()
  }

  try {
    return await fn()
  } finally {
    if (wasRunning && watcher) {
      await watcher.start(root)
    }
  }
}
```

Wrap both `cli:ingest` and `cli:ingest-file` IPC handlers with `withWatcherPaused()`.

### Fix 2: Wrap Watcher Events in Envelope

In the `watcher:start` IPC handler, wrap all forwarded events in the `WatcherEvent` envelope before sending to the renderer:

```typescript
// Before (broken):
watcher.onEvent((event) => {
  mainWindow.webContents.send('watcher:event', event)           // raw NDJSON
})
watcher.onError((error) => {
  mainWindow.webContents.send('watcher:error', { ... })         // separate channel, never received
})
watcher.onStateChange((state) => {
  mainWindow.webContents.send('watcher:state', state)           // separate channel, never received
})

// After (fixed):
watcher.onEvent((event) => {
  mainWindow.webContents.send('watcher:event', { type: 'watch-event', data: event })
})
watcher.onError((error) => {
  mainWindow.webContents.send('watcher:event', { type: 'error', data: { message: error.message } })
})
watcher.onStateChange((state) => {
  mainWindow.webContents.send('watcher:event', { type: 'state-change', data: state })
})
```

This matches the `WatcherEvent` interface defined in `app/src/preload/api.d.ts`:

```typescript
export interface WatcherEvent {
  type: 'state-change' | 'watch-event' | 'error'
  data: unknown
}
```

### Files Changed

| File | Change |
|---|---|
| `app/src/main/ipc-handlers.ts` | Add `withWatcherPaused()` helper; wrap `cli:ingest` and `cli:ingest-file` with it; wrap watcher event/error/state forwarding in `WatcherEvent` envelope |

No changes needed to:
- `app/src/renderer/stores/watcher.ts` — already handles `'watch-event'`, `'state-change'`, `'error'` types correctly
- `app/src/preload/index.ts` — already listens on the correct `watcher:event` channel
- Rust CLI code — watcher and index behavior is correct

## Implementation Steps

1. **Add `withWatcherPaused()` helper** in `app/src/main/ipc-handlers.ts` after the `destroyWatcherManager()` export.

2. **Wrap `cli:ingest` handler** — replace `execCommand(...)` call with `withWatcherPaused(root, () => execCommand(...))`.

3. **Wrap `cli:ingest-file` handler** — same pattern as above.

4. **Fix event forwarding in `watcher:start` handler** — wrap all three callbacks (`onEvent`, `onError`, `onStateChange`) to send on the `watcher:event` channel with the correct `{ type, data }` envelope.

5. **Write tests** (see below).

## Tests

### Unit Tests — `app/src/main/__tests__/watcher-pause.test.ts`

Test the `withWatcherPaused` behavior:

- **Watcher running**: verify watcher is stopped before callback, restarted after callback completes
- **Watcher not running**: verify callback runs directly, watcher is not started
- **Callback throws**: verify watcher is restarted even when the callback throws an error
- **No watcher manager**: verify callback runs normally when `watcherManager` is null

### Unit Tests — `app/src/main/__tests__/event-envelope.test.ts`

Test event forwarding shape:

- **Watch event**: verify `onEvent` callback wraps data as `{ type: 'watch-event', data: <raw event> }`
- **Error event**: verify `onError` callback wraps as `{ type: 'error', data: { message: '...' } }`
- **State change**: verify `onStateChange` callback wraps as `{ type: 'state-change', data: <state> }`

### Integration Tests — `app/tests/integration/watcher-ingest.test.ts`

- Start watcher, trigger ingest, verify ingest succeeds without lock error
- Start watcher, trigger single-file reindex, verify it succeeds
- Verify watcher resumes after ingest completes
- Start watcher, modify a file on disk, verify `watcher:event` arrives with correct envelope shape (`{ type: 'watch-event', data: { event_type: 'Modified', path: '...', success: true, ... } }`)

### E2E Tests — `app/tests/e2e/watcher-ingest.test.ts`

- Open collection, start watcher, click "Reindex File" on a file in the tree, verify no error toast
- Open collection, start watcher, edit a markdown file, verify file tree updates from "Modified" to "Indexed" automatically

## Validation Criteria

- [ ] Ingest succeeds while watcher is running (no Tantivy lock error)
- [ ] Single-file reindex succeeds while watcher is running
- [ ] Watcher automatically resumes after ingest completes
- [ ] Watcher is not started if it wasn't running before ingest
- [ ] File tree auto-refreshes to "Indexed" state after watcher re-indexes a file
- [ ] Watcher state changes are reflected in the status bar
- [ ] Watcher errors are displayed in the UI
- [ ] All new tests pass
- [ ] No regression in existing ingest or watcher tests

## Anti-Patterns to Avoid

- **Do NOT kill the watcher without restarting it** — Always use `withWatcherPaused()` which guarantees restart in the `finally` block.
- **Do NOT send events on separate IPC channels** — All watcher-related events must go through the single `watcher:event` channel using the `WatcherEvent` envelope. The renderer only listens on this one channel.
- **Do NOT assume the watcher is always running** — Check `isRunning()` before stopping; check `wasRunning` before restarting.
