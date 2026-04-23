# PRD: Embedded Terminal Panel

## Overview

Add an embedded terminal to the Markdown VDB desktop app, modelled after VS Code's integrated terminal. Users can open a PTY-backed shell in two places:

1. **Bottom panel** — a toggleable horizontal strip above the status bar, with its own tab bar for multiple terminal sessions. Resizable via a drag handle on its top edge. Toggled with `` Ctrl+` `` (or `` Cmd+` `` on macOS).
2. **Terminal tab** — a new `TerminalTab` kind that can be opened in any tab in the existing `TabPane` / `SplitPaneContainer`. Behaves like any other tab: drag-reorder, close, move between split panes.

Terminals are real PTYs via `node-pty` + `@xterm/xterm`, so interactive tools (`claude`, `aider`, `vim`, `htop`, `mdvdb` itself) work as expected. The default shell is the user's system shell; Settings allows overriding the binary and args globally.

New terminals start in the active collection's root directory so they're immediately useful for running `mdvdb` against that collection. Existing terminals keep running across collection switches — switching collections does not kill PTYs.

## Problem Statement

Today the app is a Markdown editor + viewer over the `mdvdb` CLI, but users who want to interact with that CLI directly, run a terminal agent (Claude Code, aider, codex), or execute git/scripts against their notes directory must leave the app for an external terminal. This breaks the "one surface for your knowledge base" promise and means the app can't host workflows that mix editing, searching, and agentic shell work. Embedding a terminal closes that loop and moves the app from "editor with search" to "IDE-like workspace for Markdown collections".

## Goals

- Embed a PTY-backed terminal emulator usable for any shell workflow (shells, TUIs, agents, CLIs).
- Two placements: bottom panel (multi-tab) + terminal-as-tab (in any split pane).
- Default shell resolves from `$SHELL` / `ComSpec`; globally overridable via Settings.
- New terminals' cwd defaults to the active collection's root.
- Existing terminals survive collection switches with their session and cwd intact.
- Bottom-panel open/closed state and terminal-tab presence persist across app restarts; PTYs themselves are fresh each launch.
- Keyboard: `` Ctrl+` `` / `` Cmd+` `` toggles bottom panel, `` Ctrl+Shift+` `` / `` Cmd+Shift+` `` creates a new terminal in the bottom panel.
- Fully accessible: focus moves into xterm, `Escape` returns focus to the app, screen reader mode available.
- Native-feeling rendering: WebGL addon when available, canvas fallback; true color; ligatures respected if the chosen font has them.

## Non-Goals

- **Not a full terminal emulator** — features like tmux-style split inside a single terminal, per-shell profiles UI, or advanced SSH integration are out of scope.
- **No remote terminals** — local PTY only. No SSH profiles, no WSL picker (WSL works if the user sets their shell to `wsl.exe`).
- **No scrollback persistence** — scrollback and in-flight commands are lost on app relaunch.
- **No terminal-specific theming UI** — the terminal uses the app's existing theme tokens; no separate color pickers.
- **No shell profile manager** — one global shell override only. Per-terminal profile selection is a future phase.
- **No auto-cd on collection switch** — existing terminals keep their cwd when collections change. Only *new* terminals start in the new collection root.

## User Experience

### Bottom panel

- Hidden by default. Toggle with `` Ctrl+` `` / `` Cmd+` ``, or click a terminal icon in the status bar.
- When opened for the first time in a session, a fresh terminal is spawned automatically, cwd'd to `activeCollection.path` (or `~` if no collection is active).
- Height: remembered per-window via `electron-store`. Default 33% of window height, min 120px, max 80% of window.
- Has its own horizontal tab bar (reuses `TabBar`/`TabItem` visual language) listing each open terminal. Tab label: shell name + index, e.g. `zsh — 1`, `claude — 2`. User-renamable via right-click.
- Controls on the right of the tab bar: `+` (new terminal), `⤢` (move active terminal to a new editor-area tab), `×` (close active), `▾` (kill all).
- Drag handle on the top edge resizes height. Double-click the handle to snap to a stored default.
- Closing the last terminal in the panel does not auto-close the panel; user decides when to hide it.

### Terminal as a tab

- Command palette entry: "Terminal: New Terminal Tab" opens a new `TerminalTab` in the active pane.
- Behaves like any tab: draggable, closeable, movable to the split pane, closeable with `Cmd+W`.
- A terminal can be moved between the bottom panel and the editor area via the `⤢` tab-menu action ("Move to Editor Area" / "Move to Panel"). The underlying PTY is preserved; only the renderer view re-parents.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `` Ctrl+` `` / `` Cmd+` `` | Toggle bottom panel |
| `` Ctrl+Shift+` `` / `` Cmd+Shift+` `` | New terminal in bottom panel |
| `Ctrl+Shift+T` (inside panel) | Cycle active terminal |
| `Cmd+W` (terminal focused) | Close active terminal |
| `Ctrl+L` (inside terminal) | Passes through to shell (do not intercept) |

Global editor shortcuts (`Cmd+S`, `Cmd+P`, etc.) must NOT fire when a terminal has focus — terminals swallow all keystrokes.

### Visual

- Font: `var(--font-mono)` (JetBrains Mono), size from settings (default 13px, adjustable).
- Colors: derive xterm theme from `tokens.css` (`--color-surface-dark` background, `--color-text-main` foreground, ANSI palette mapped to semantic tokens where possible, accent cursor).
- Cursor: block, blink off by default.
- Scrollbar: matches app chrome scrollbar style.

## Architecture

### Technology

| Concern | Choice | Why |
|---|---|---|
| PTY host | `node-pty` in the Electron main process | Industry-standard PTY bridge, supports macOS/Linux/Windows ConPTY. |
| Emulator UI | `@xterm/xterm` | The de-facto terminal emulator used by VS Code; mature, fast, accessible. |
| Sizing | `@xterm/addon-fit` | Computes cols/rows from container size. |
| Links | `@xterm/addon-web-links` | Clickable `http(s)://` links. |
| WebGL (optional) | `@xterm/addon-webgl` | Faster rendering when GPU available; canvas fallback automatic. |
| Search (optional, phase-2 follow-up) | `@xterm/addon-search` | In-terminal find-in-scrollback. |

xterm.js runs in the renderer. PTY I/O is streamed over IPC from the main process.

### Process split

```
Renderer (Svelte)                                   Main (Electron)
─────────────────                                   ────────────────
Terminal.svelte                                     PtyManager
  xterm.Terminal                                      node-pty spawn()
  FitAddon                                             per-id ptyProcess
  WebLinksAddon                                        stdout → webContents.send(
                                                        'terminal:data', id, chunk)
  onData(d) ─────── terminal:write ─────────────▶
                    terminal:resize ──────────────▶    ptyProcess.onExit →
                                                        webContents.send(
                                                         'terminal:exit', id, code)
  on 'terminal:data' ◀────────────────────────────
       → term.write(data)

Terminal store (Svelte $state)
  terminals: Record<id, TerminalMeta>
  panel: { open, height, tabOrder, activeId }
  openPanel() / closePanel() / togglePanel()
  create({ cwd, shell? }) → id
  dispose(id)
  moveToTab(id, paneId) / moveToPanel(id)

Workspace store (existing)
  TabState |= TerminalTab { kind: 'terminal', terminalId, title }
```

### State model

**New store:** `app/src/renderer/stores/terminal.svelte.ts`

```ts
export interface TerminalMeta {
  id: string              // UUID, matches PTY id in main
  title: string           // user-editable label, defaults to shell name
  shell: string           // resolved binary path (for display)
  cwd: string             // initial cwd (may drift, renderer doesn't track live cwd)
  createdAt: number       // epoch ms, for ordering
  status: 'running' | 'exited'
  exitCode: number | null
  location: 'panel' | 'tab'  // which renderer hosts the xterm instance
}

export interface BottomPanelState {
  open: boolean
  height: number          // px
  tabOrder: string[]      // terminal ids in panel
  activeId: string | null
}
```

The store is the single source of truth for which terminals exist and where they render. Moving a terminal flips `location` and re-parents the xterm view; the PTY in main is unaffected.

**Extension to `workspace.svelte.ts`:**

```ts
export interface TerminalTab {
  id: string            // tab id
  kind: 'terminal'
  terminalId: string    // foreign key into terminal store
  title: string
}

export type TabState = DocumentTab | GraphTab | AssetTab | TerminalTab
```

### IPC surface

All channels live on the existing `window.api` bridge via `contextBridge`.

| Channel | Args | Returns | Purpose |
|---|---|---|---|
| `terminal:create` | `{ id, cwd, shell?, args?, env?, cols, rows }` | `{ pid, shell }` | Spawn PTY. `id` is generated by the renderer. |
| `terminal:write` | `{ id, data }` | `void` | Write stdin data (UTF-8). |
| `terminal:resize` | `{ id, cols, rows }` | `void` | Resize PTY. |
| `terminal:dispose` | `{ id }` | `void` | Kill PTY and free resources. |
| `terminal:list` | — | `{ id, pid, shell, status }[]` | Enumerate live PTYs (for relaunch reconciliation). |

Main → renderer events (`webContents.send`, listened in preload, re-emitted on `window.api.onTerminal*`):

| Event | Payload |
|---|---|
| `terminal:data` | `{ id, data }` — stdout/stderr chunk |
| `terminal:exit` | `{ id, code, signal }` — PTY has exited |

Errors use the existing `{ error: true, type, message }` serialization pattern from `src/main/errors.ts`. New error classes:
- `TerminalSpawnError` — shell binary not found, permission denied, etc.
- `TerminalNotFoundError` — write/resize/dispose on unknown id.

### PtyManager (main process)

`app/src/main/pty.ts` — new module.

- Holds `Map<id, { pty, window }>`.
- On `create`: resolve shell (see below), call `pty.spawn(shell, args, { cwd, env, cols, rows, name: 'xterm-256color' })`, wire `onData` to `window.webContents.send('terminal:data', …)` and `onExit` to `terminal:exit`.
- On renderer window close: dispose all PTYs owned by that window.
- On app quit (`before-quit`): dispose all PTYs.
- Guards: validate `cwd` exists and is a directory; validate `shell` binary is executable; reject IPC from unknown `webContents`.

### Shell resolution

Priority (first non-empty wins):

1. Explicit `shell` arg in the `terminal:create` call (reserved for future per-terminal profiles).
2. Settings override from `electron-store`: `terminal.shellPath` + `terminal.shellArgs`.
3. Environment:
   - macOS/Linux: `process.env.SHELL` or `/bin/zsh` (macOS default) / `/bin/bash` (Linux default).
   - Windows: `process.env.ComSpec` or `powershell.exe`.

Env merging: inherit `process.env`, then merge any `terminal.envOverrides` from settings, then merge per-call `env`. Always set `TERM=xterm-256color`, `COLORTERM=truecolor`, `MDVDB_COLLECTION_ROOT=<cwd>` (so scripts can discover which collection they were opened against).

### Collection binding

- On `create`, if no `cwd` arg is provided, the renderer passes `activeCollection?.path ?? os.homedir()`.
- The `MDVDB_COLLECTION_ROOT` env var captures the *initial* collection. Users who `cd` elsewhere inside the terminal won't see it change — documented behavior.
- On collection switch: **do nothing** to existing PTYs. Only newly created terminals pick up the new root.
- Add a visible chip to each terminal tab's tooltip: `cwd: ~/notes/work` so users know which collection a given terminal was spawned for.

### Persistence

- Bottom-panel state (`open`, `height`, ordered terminal slots) is saved to `electron-store` per window.
- A "terminal slot" is `{ kind: 'panel' | 'tab', paneId?: string, shell: string, cwd: string }` — no PTY identifiers, no scrollback.
- On app launch, after collections are restored: if the user had terminals open, recreate one PTY per saved slot with the saved shell + cwd. If the cwd no longer exists, fall back to the active collection's root and record a warning.
- If the saved cwd belongs to a collection that has since been removed, spawn in `~` and show a subtle inline notice in the terminal: `(collection removed — started in $HOME)`.

## File-by-file changes (implementation outline)

This PRD documents intent; the follow-up implementation PR will touch:

**New files**
- `app/src/main/pty.ts` — `PtyManager`, shell resolution helpers.
- `app/src/main/pty-handlers.ts` — IPC handlers for `terminal:*` channels.
- `app/src/renderer/components/BottomPanel.svelte` — panel container + resize handle.
- `app/src/renderer/components/Terminal.svelte` — xterm instance wrapper, mount/unmount, addon wiring, IPC bindings.
- `app/src/renderer/components/TerminalTabBar.svelte` — the panel's own tab bar (or reuse `TabBar` with a `variant="terminal"` prop if feasible).
- `app/src/renderer/stores/terminal.svelte.ts` — terminal state.
- `app/src/renderer/lib/terminal-theme.ts` — map `tokens.css` values to an `xterm` `ITheme`.
- `app/tests/unit/terminal-store.test.ts`, `app/tests/unit/pty-manager.test.ts`, `app/tests/unit/terminal-ipc.test.ts`.
- `app/tests/e2e/terminal.spec.ts` — smoke test that the panel opens, a terminal appears, `echo` works.

**Modified files**
- `app/src/renderer/App.svelte` — insert `<BottomPanel />` between the tab-pane-region and `<StatusBar />` (around lines 588–602).
- `app/src/renderer/stores/workspace.svelte.ts` — add `TerminalTab`, widen `TabState`, handle serialization in `PersistedTab` mapping at lines 1060–1064.
- `app/src/renderer/components/TabPane.svelte` — lines 158–181, add `{:else if tab.kind === 'terminal'}` branch rendering `<Terminal />`.
- `app/src/renderer/components/StatusBar.svelte` — add a small terminal-toggle icon on the right (reuses `IconButton`).
- `app/src/main/index.ts` — register `PtyManager`, wire quit/window-close cleanup.
- `app/src/main/ipc-handlers.ts` — import and register `terminal:*` handlers.
- `app/src/preload/index.ts` — extend `window.api` with `terminalCreate/Write/Resize/Dispose/List` and event subscriptions.
- `app/src/preload/api.d.ts` — type declarations.
- `app/src/main/store.ts` — add `terminal` settings section + `windowState.bottomPanel`.
- `app/package.json` — add deps: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-webgl`, `node-pty`. Add `@electron/rebuild` to devDeps and wire `postinstall` for native module rebuild against the target Electron version.
- `app/electron.vite.config.ts` — mark `node-pty` as external for the main target so Vite doesn't try to bundle the native binding.

## Testing strategy

Per the app's rule "every change must have automated tests":

- **Unit (Vitest + jsdom)**:
  - Terminal store transitions: create, dispose, move between panel/tab, toggle panel.
  - Shell resolution: env-var fallback, settings override precedence, Windows/macOS/Linux branches (mock `process.platform`).
  - IPC handler registration: assert each channel is wired and error-serialized.
  - PtyManager: mock `node-pty` to verify spawn args, data/exit event plumbing, multi-window PTY ownership and cleanup.
- **Integration**: round-trip `terminal:create` → `terminal:write` → mocked `terminal:data` echo → renderer receives.
- **E2E (Playwright)**: open app, press `` Ctrl+` ``, assert bottom panel opens and a terminal is visible, send `echo hello`, assert `hello` appears in the rendered buffer. Gate behind `process.platform !== 'win32'` initially if ConPTY reliability is an issue in CI.
- **Not tested (accepted flaky)**: scrollback visual fidelity, WebGL rendering, Unicode edge cases in shells we don't ship.

## Accessibility

- `xterm`'s built-in screen-reader mode enabled (bounded to `50` buffer lines for announcements).
- Focus contract: tabbing into the panel focuses the active terminal; `Escape` returns focus to the tab bar; `Tab` from the tab bar exits the panel region.
- All toggle icons have `aria-label` and keyboard activation.
- Color themes meet WCAG AA against the chosen xterm background.

## Performance

- WebGL addon by default, canvas fallback — auto-detected at `Terminal.svelte` mount.
- Lazy-mount xterm: instantiate only when a terminal first becomes visible (similar to the existing `Editor.svelte` pool pattern). Unmounting hides but doesn't dispose, keeping the PTY attached to a detached buffer.
- Cap scrollback at 10,000 lines (xterm default) to avoid runaway memory for long-running agents.
- Debounce `fit()` calls on window resize (≤60fps).
- Never log PTY data from main — it's unbounded.

## Error and edge-case handling

- Shell binary missing → surface `TerminalSpawnError` in the terminal area with a retry button that reopens Settings.
- PTY exits unexpectedly → render exit code inline, offer a "Restart" action that respawns with the same config.
- Collection removed while a bound terminal is open → do not kill; annotate the tab title with a subtle `(detached)` marker.
- On macOS, if `node-pty` fails to load (arch mismatch) → show a one-time modal explaining `npm rebuild` and link to docs.
- Closing the last window with running PTYs → confirm if any terminal has received stdout in the last 5s (heuristic for "actively running").

## Risks

- **`node-pty` is a native module.** Requires rebuild against the Electron ABI. Historically the largest pain point. Mitigation: add `@electron/rebuild` to `postinstall`, document in app README, pin `node-pty` version.
- **Windows ConPTY quirks.** Some TUIs render poorly on older Windows. Acceptable; document in known-issues.
- **xterm.js bundle size.** ~400KB. Mitigation: code-split `@xterm/*` into a dynamic import so the main renderer bundle doesn't grow unless the user opens a terminal.
- **Security.** PTYs run with the user's shell — same privilege as the app. Document explicitly and make sure IPC is not exposed to arbitrary WebContents (origin-check incoming senders).

## Acceptance criteria

1. Pressing `` Ctrl+` `` / `` Cmd+` `` toggles a bottom panel with an attached terminal.
2. A new command "Terminal: New Terminal Tab" opens a terminal in the active pane.
3. New terminals have `cwd` = active collection path and `MDVDB_COLLECTION_ROOT` set accordingly.
4. Switching collections leaves existing terminals' PTYs and cwd untouched; terminals opened after the switch use the new root.
5. `zsh`, `bash`, `powershell`, `claude`, `aider`, `vim`, `htop` all render correctly (manual QA matrix).
6. Terminal survives moving between bottom panel and editor-area tab without losing its PTY.
7. App relaunch restores bottom-panel open state and the count/placement of terminal slots (PTYs are fresh).
8. Settings > Terminal lets the user override shell path, args, font size, and font family.
9. All existing tests pass; new unit/integration/E2E tests cover the flows above.
10. `npm run lint` and `npm run typecheck` stay clean.

## Open questions (not blocking the PRD)

- Do we want a "Send to Terminal" command from the editor (selection or code-fence)? Deferred.
- Profile manager (named shell configs) — do we pull this in for v2? Deferred.
- Split terminals inside the bottom panel (two panes in the panel itself) — deferred; cover with a YAGNI note.
- Task running (`tasks.json`-style `mdvdb ingest` button) — separate future PRD.
