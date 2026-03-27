# PRD: Tabs, Split Panes & Multi-Window

## Overview

Add VS Code-style document tabs, split pane editing, and multi-window support to Tesseract. Users can open multiple markdown files in tabs, view two documents side-by-side in a split pane, and spawn additional Electron windows — each with their own tab bar and split layout. Tabs can be dragged between windows. The sidebar, properties panel, and status bar always reflect the currently focused tab.

## Problem Statement

Tesseract currently supports only a single document open at a time. Switching files replaces the editor content entirely — there's no way to keep multiple files open for reference, comparison, or concurrent editing. Knowledge work frequently requires viewing multiple documents simultaneously (e.g., comparing notes, referencing a source while writing, reviewing linked documents). The single-document model forces users into a disruptive open-read-close-open cycle.

## Goals

- Open multiple files in a tab bar; switch between them without losing scroll position, undo history, or dirty state
- Close tabs individually (with unsaved-changes confirmation), reorder tabs via drag
- Split the editor area into two panes (left/right), each with its own tab bar
- Open multiple Electron windows, each with independent workspace state
- Drag a tab out of a window to create a new window, or drag into another window to merge
- Sidebar, properties panel, and status bar reflect the **focused** pane/tab at all times
- Persist open tabs and split layout across app restarts
- Standard keyboard shortcuts: `Cmd+T` (new tab), `Cmd+W` (close tab), `Cmd+1–9` (switch tab), `Cmd+\` (split), `Cmd+Shift+N` (new window)

## Non-Goals

- Vertical split (top/bottom) — horizontal (left/right) only for v1
- More than 2 split panes — 2 maximum for v1
- Tab groups or colored tab categories
- Drag-to-reorder across panes within the same window (tabs reorder within their own pane only)
- Synchronized scrolling between split panes
- Changes to the Rust CLI backend or IPC channel contracts (all changes are renderer + main process)

---

## Technical Design

### State Model

The core change is replacing the scattered singleton stores (`selectedFilePath`, `fileContent`, `isDirty`, `editorMode`, navigation stacks) with a unified **workspace state** that maps tab IDs to per-tab state.

#### TabState

Each open tab holds its own isolated state:

```typescript
interface TabState {
  id: string                        // Unique tab ID (crypto.randomUUID())
  filePath: string                  // Relative file path within collection
  content: string | null            // File content (null while loading)
  savedContent: string | null       // Last-saved content (for dirty detection)
  isDirty: boolean                  // content !== savedContent
  isLoading: boolean                // Content currently loading
  error: string | null              // Load/save error
  editorMode: 'wysiwyg' | 'editor' // Per-tab editor mode
  editorState: unknown | null       // Serialized CodeMirror/Tiptap state (undo history, cursor, selection)
  scrollPosition: { x: number; y: number } // Scroll offset to restore
  navigation: {                     // Per-tab back/forward history
    backStack: string[]
    forwardStack: string[]
  }
}
```

#### PaneState

A pane is a container with a tab bar and an active tab:

```typescript
interface PaneState {
  id: string                        // Unique pane ID
  tabIds: string[]                  // Ordered tab IDs (tab bar order)
  activeTabId: string | null        // Currently visible tab in this pane
}
```

#### WorkspaceState

Top-level state for one window:

```typescript
interface WorkspaceState {
  tabs: Map<string, TabState>       // All open tabs by ID
  panes: PaneState[]                // 1 or 2 panes (single or split)
  activePaneId: string              // Which pane has focus
  splitEnabled: boolean             // Whether split view is active
  splitRatio: number                // 0.0–1.0, default 0.5
}
```

#### Backward Compatibility

To avoid a big-bang migration of all components, the workspace store exports **derived shims** that mirror the current store API:

```typescript
// These derived stores compute from the focused pane's active tab
export const selectedFilePath = $derived(/* focusedTab?.filePath ?? null */)
export const fileContent = $derived(/* focusedTab?.content ?? null */)
export const isDirty = $derived(/* focusedTab?.isDirty ?? false */)
export const editorMode = $derived(/* focusedTab?.editorMode ?? 'wysiwyg' */)
```

Components that currently import from `stores/files.ts` or `stores/editor.ts` continue working unchanged. Migration to tab-aware props happens incrementally.

### Tab Bar UI

A horizontal tab bar sits between the titlebar and editor area. Each pane has its own tab bar.

```
┌─────────────────────────────────────────────────────────────┐
│  Titlebar (35px) — back/forward, search, graph toggle       │
├─────────────────────────────────────────────────────────────┤
│  TabBar: [file-a.md ×] [file-b.md ● ×] [+]                │
├──────────────────────────┬──────────────────────────────────┤
│  Sidebar (256px)         │  Editor (focused tab content)    │
│  • Collections           │                                  │
│  • File tree             │                                  │
│  • Favorites             │                                  │
├──────────────────────────┴──────────────────────────────────┤
│  StatusBar — word count, tokens, reading time, CLI status   │
└─────────────────────────────────────────────────────────────┘
```

Tab anatomy:
- File icon (Material Symbols `description`)
- Filename (basename, dim directory prefix on hover if ambiguous)
- Dirty indicator: filled circle `●` replaces close icon when dirty
- Close button: `×` (or `●` if dirty), `Cmd+click` to close without prompt
- Active tab: bottom border `var(--color-primary)`, brighter text
- Hover: `var(--color-surface-hover)` background
- Drag handle: entire tab surface is draggable for reordering

Overflow behavior: When tabs exceed available width, the tab bar becomes horizontally scrollable. Scroll buttons appear at edges.

### Split Pane Layout

When split is activated (`Cmd+\`), the editor area divides into two `TabPane` components separated by a draggable resize handle.

```
┌──────────────────────────────────────────────────────┐
│  Titlebar                                            │
├─────────────────────────┬────────────────────────────┤
│  [TabBar A]             │  [TabBar B]                │
│  ┌───────────────────┐  │  ┌──────────────────────┐  │
│  │  Editor A          │  │  │  Editor B              │  │
│  │  (focused)         │◀─┼──│                        │  │
│  └───────────────────┘  │  └──────────────────────┘  │
├─────────────────────────┴────────────────────────────┤
│  StatusBar (reflects focused pane A)                 │
└──────────────────────────────────────────────────────┘
```

- Resize handle: 4px wide, `var(--color-border)`, cursor `col-resize`, highlight on hover/drag
- Minimum pane width: 300px
- Split ratio persisted to `localStorage`
- Focus ring: subtle left-border accent on the focused pane
- Closing the last tab in a split pane collapses back to single-pane mode

### Multi-Window

Each Electron `BrowserWindow` is fully independent with its own `WorkspaceState`. A `WindowManager` in the main process tracks all open windows.

#### WindowManager (main process)

```typescript
class WindowManager {
  private windows: Map<number, BrowserWindow>  // webContents.id → window

  createWindow(options?: { tabs?: SerializedTab[] }): BrowserWindow
  getWindow(id: number): BrowserWindow | undefined
  getAllWindows(): BrowserWindow[]
  broadcastToAll(channel: string, ...args: unknown[]): void
  transferTab(fromWindowId: number, toWindowId: number, tabData: SerializedTab): void
  closeWindow(id: number): void
}
```

#### Tab Transfer Protocol

When a user drags a tab out of a window or between windows:

1. **Drag start**: Renderer serializes the tab state (file path, content, dirty state, editor mode)
2. **Drag out of window**: Renderer sends `tab:detach` IPC with serialized tab data
3. **Main process**: `WindowManager.createWindow({ tabs: [tabData] })` creates a new window pre-loaded with the tab
4. **Drag into existing window**: The target window receives `tab:attach` IPC event and deserializes the tab into its workspace
5. **Source window**: Removes the tab from its workspace; if no tabs remain, closes the window

#### Shared State

Collections, favorites, and recents are shared across all windows (stored in `electron-store`). When one window modifies shared state, the main process broadcasts the change to all other windows via `WindowManager.broadcastToAll()`.

Per-window state (tabs, split layout, pane focus) is NOT shared.

#### IPC Refactoring

The current `registerIpcHandlers(mainWindow: BrowserWindow)` function closes over a single `mainWindow` reference. This must be refactored:

- **Request/response handlers** (`ipcMain.handle`): Already window-agnostic — `event.sender` identifies the requesting window. No change needed.
- **Push events** (watcher events, updater progress, CLI install progress): Currently sent to `mainWindow.webContents.send()`. Must change to either:
  - `event.sender.send()` for responses to a specific window
  - `WindowManager.broadcastToAll()` for events all windows should see (watcher events, collection changes)

### Sidebar Focus Awareness

The sidebar always shows data for the **focused pane's active tab**:

- `selectedFilePath` derived from focused tab → FileTree highlights the correct file
- Properties panel loads backlinks/metadata for the focused tab's file
- Status bar shows word count/tokens for the focused tab's content
- Switching focus between panes (click or `Cmd+Option+Left/Right`) updates all of these reactively

This happens automatically through the derived shims — no sidebar code changes needed for basic focus tracking.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New tab (opens empty tab or file picker) |
| `Cmd+W` | Close active tab (prompt if dirty) |
| `Cmd+Shift+T` | Reopen last closed tab |
| `Cmd+1` – `Cmd+9` | Switch to tab N (9 = last tab) |
| `Cmd+Option+Left` | Switch to previous tab |
| `Cmd+Option+Right` | Switch to next tab |
| `Cmd+\` | Toggle split pane |
| `Cmd+Option+1` / `Cmd+Option+2` | Focus pane 1 / pane 2 |
| `Cmd+Shift+N` | New window |
| `Cmd+Shift+W` | Close window (prompt for all dirty tabs) |

### Persistence

Open tabs and split state are saved to `electron-store` per window on:
- Tab open/close/reorder
- Split toggle or resize
- App quit (graceful)

Schema addition to `electron-store`:

```typescript
interface PersistedWindowState {
  panes: Array<{
    tabPaths: string[]        // File paths of open tabs (in order)
    activeTabPath: string | null
  }>
  splitEnabled: boolean
  splitRatio: number
}

// Store schema addition
windowSessions: {
  type: 'array',
  items: PersistedWindowState,
  default: []
}
```

On app launch, restore each persisted window session. If a file no longer exists, skip that tab silently.

---

## Implementation Steps

### Phase A: Tab Foundation (stores/workspace.ts)

1. **Create `stores/workspace.ts`** — Define `TabState`, `PaneState`, `WorkspaceState` interfaces. Implement the workspace using Svelte 5 `$state` runes. Export mutation functions: `openTab(filePath)`, `closeTab(tabId)`, `switchTab(tabId)`, `setActivePane(paneId)`, `moveTab(tabId, toPaneId, index)`.

2. **Migrate `stores/files.ts`** — Replace `selectedFilePath`, `fileContent`, `fileContentLoading`, `fileContentError` singletons with derived getters from workspace state. The `selectFile()` function becomes `openTab()` (if not already open) + `switchTab()`. Keep the old exports as derived shims for backward compat.

3. **Migrate `stores/editor.ts`** — Move `isDirty`, `editorMode`, `wordCount`, `tokenCount` into per-tab state. Export derived shims that read from the focused tab.

4. **Migrate `stores/navigation.ts`** — Move `backStack`, `forwardStack`, `current` into `TabState.navigation`. `recordNavigation()`, `goBack()`, `goForward()` operate on the focused tab's history.

5. **Add `stores/closed-tabs.ts`** — Maintain a bounded stack of recently closed tabs (path + scroll position + editor mode) for `Cmd+Shift+T` reopen.

### Phase B: Tab Bar UI

6. **Create `components/TabBar.svelte`** — Horizontal tab bar component. Props: `paneId: string`. Reads tab list and active tab from workspace state. Renders tab items with filename, dirty indicator, close button. Handles click-to-switch, middle-click-to-close, close button click.

7. **Create `components/TabItem.svelte`** — Individual tab rendering. Props: `tab: TabState`, `isActive: boolean`, `paneId: string`. Handles drag start for reorder. Shows dirty dot, truncated filename, close button.

8. **Create `components/TabPane.svelte`** — Container that combines a `TabBar` + editor area for a single pane. Props: `paneId: string`. Mounts the appropriate editor (CodeMirror or Tiptap) for the active tab. Handles focus tracking — clicking anywhere in the pane sets `activePaneId`.

9. **Refactor `App.svelte` layout** — Replace the current single-editor area with `TabPane` component(s). In single-pane mode: one `TabPane`. In split mode: two `TabPane`s with a resize handle.

10. **Refactor `Editor.svelte` and `WysiwygEditor.svelte`** — Accept a `tabId` prop. Save/restore editor state (undo history, cursor position, scroll offset) when tabs switch. The CodeMirror `EditorState` must be serialized on tab deactivation and restored on activation. Tiptap editor JSON must be similarly cached.

11. **Update file opening paths** — `FileTree.svelte` click, search result click, favorite click, recent click, and `[[wikilink]]` click all call `openTab(filePath)` instead of `selectFile(path)`. If the file is already open in any tab, switch to that tab instead of opening a duplicate.

12. **Register keyboard shortcuts** — Add `Cmd+T`, `Cmd+W`, `Cmd+1–9`, `Cmd+Option+Left/Right`, `Cmd+Shift+T` handlers in `App.svelte` or a dedicated `shortcuts.ts` module. Platform-aware: `Ctrl` on Windows/Linux.

### Phase C: Split Panes

13. **Create `components/SplitPaneContainer.svelte`** — Renders 1 or 2 `TabPane`s based on `workspace.splitEnabled`. Contains the draggable resize handle between panes. Handles resize drag with min-width constraints (300px per pane). Stores ratio in workspace state.

14. **Implement split actions** — `toggleSplit()`: if single pane, create a second pane (empty or with the same file). `closeSplit()`: merge second pane's tabs into first pane. `moveTabToOtherPane(tabId)`: move a tab from one pane to the other.

15. **Focus tracking** — Clicking in a pane sets `activePaneId`. Visual indicator: subtle `2px` left border with `var(--color-primary)` on the focused pane's tab bar. The sidebar, properties, and status bar derive from focused pane's active tab.

16. **Register split shortcuts** — `Cmd+\` to toggle, `Cmd+Option+1`/`2` to focus pane.

### Phase D: Tab Persistence

17. **Add `windowSessions` to electron-store schema** — Array of `PersistedWindowState` objects. Save on tab open/close/reorder, split toggle/resize, and graceful quit.

18. **Save logic** — Debounced (500ms) serialization of current workspace state to electron-store via IPC. Only save file paths and layout — NOT file content (always reload from disk on restore).

19. **Restore logic** — On app launch, read persisted sessions. For each session, open a window and populate tabs. Skip files that no longer exist. If no persisted session, start with a single empty window (current behavior).

### Phase E: Multi-Window

20. **Create `main/window-manager.ts`** — `WindowManager` class that tracks all `BrowserWindow` instances. `createWindow()` creates a new window with shared preload and config. `broadcastToAll()` sends events to all windows. `closeWindow()` cleans up.

21. **Refactor `main/index.ts`** — Replace the single `createWindow()` call with `WindowManager.createWindow()`. Store the manager instance. Handle `app.on('activate')` to create a window if none exist (macOS dock click).

22. **Refactor `main/ipc-handlers.ts`** — Remove the `mainWindow` parameter closure. For push events (watcher, updater), use `WindowManager.broadcastToAll()`. For request/response, rely on `event.sender` (already correct). The `WatcherManager` and `AppUpdater` become singletons shared across windows.

23. **Add IPC channels for multi-window** — `window:new` (create new window), `tab:detach` (serialize tab, create new window with it), `tab:attach` (receive tab data, add to workspace), `window:broadcast` (relay shared state changes).

24. **Tab drag-to-window** — On drag start, set a `dataTransfer` payload with serialized tab state. If the drag ends outside the window bounds, send `tab:detach` IPC. Main process creates a new window positioned at the drop location. On drag into a window (detected via `dragenter`/`dragover` on the tab bar), send `tab:attach` IPC.

25. **Shared state synchronization** — When collections, favorites, or recents change in one window, the modifying window sends the update to main process. Main process broadcasts to all other windows. Each window's stores update reactively.

26. **New window shortcut** — `Cmd+Shift+N` sends `window:new` IPC. `Cmd+Shift+W` closes current window (with dirty-tab prompts).

---

## Validation Criteria

### Tabs
- [ ] Opening a file creates a new tab; opening the same file switches to the existing tab
- [ ] Switching tabs preserves scroll position, cursor, undo history, and dirty state
- [ ] Closing a dirty tab shows a save/discard/cancel prompt
- [ ] `Cmd+W` closes the active tab; `Cmd+T` opens file picker for new tab
- [ ] `Cmd+1–9` switches to the Nth tab; `Cmd+Option+Left/Right` cycles tabs
- [ ] `Cmd+Shift+T` reopens the last closed tab
- [ ] Tabs can be reordered by drag within the tab bar
- [ ] Tab bar scrolls horizontally when tabs overflow
- [ ] Middle-click on a tab closes it
- [ ] Watcher events update ALL tabs showing the affected file (conflict prompt if dirty)

### Split Panes
- [ ] `Cmd+\` toggles split view; each pane has its own tab bar
- [ ] Clicking a pane gives it focus; sidebar/properties/status bar update to reflect the focused tab
- [ ] Resize handle between panes works with 300px minimum per pane
- [ ] Closing the last tab in a split pane collapses to single-pane mode
- [ ] Split ratio persists across sessions

### Multi-Window
- [ ] `Cmd+Shift+N` opens a new window with the same collection active
- [ ] Each window has independent tabs and split state
- [ ] Dragging a tab out of a window creates a new window with that tab
- [ ] Dragging a tab into another window's tab bar adds it to that window
- [ ] Collection/favorite/recent changes in one window reflect in all windows
- [ ] Watcher events broadcast to all windows
- [ ] Closing a window with dirty tabs prompts for each

### Persistence
- [ ] Open tabs and split state restore on app restart
- [ ] Tabs for deleted files are silently skipped on restore
- [ ] Multiple windows each restore their own tab/split state

### Backward Compatibility
- [ ] All existing keyboard shortcuts (`Cmd+S`, `Cmd+E`, `Cmd+[`, `Cmd+]`, etc.) still work
- [ ] Search results open in a tab in the focused pane
- [ ] `[[wikilink]]` clicks open in a tab in the same pane
- [ ] File tree selection opens in a tab in the focused pane
- [ ] Favorites and recents open in a tab in the focused pane

---

## Anti-Patterns to Avoid

- **Don't keep separate singleton stores alongside workspace state.** The old stores (`selectedFilePath`, `fileContent`, `isDirty`) must become derived views of workspace state — not independent stores that get manually synced. Dual sources of truth will desync.

- **Don't re-mount editors on every tab switch.** Creating a new CodeMirror/Tiptap instance per switch is expensive and destroys undo history. Instead, cache editor instances per tab and show/hide them (or serialize/deserialize state).

- **Don't use Electron's native tab API (`BrowserWindow.addTabbedWindow`).** It's macOS-only, has limited styling control, and doesn't support split panes. Build tabs in the renderer.

- **Don't share `WorkspaceState` across windows via IPC.** Each window owns its workspace state locally in the renderer. Only shared app-level state (collections, favorites, recents) syncs across windows. Trying to sync full workspace state creates race conditions.

- **Don't persist file content in tab sessions.** Only persist file paths. Content must always be loaded from disk on restore — the file may have changed externally.

- **Don't break `Cmd+W` for the last tab.** When the last tab closes, the window should show an empty state (welcome/file picker) — not close the window. `Cmd+Shift+W` closes the window.

---

## Patterns to Follow

- **Workspace store with Svelte 5 runes** — Use `$state` for the workspace object and `$derived` for computed values like `focusedTab`. This matches the app's existing reactive patterns. See `stores/collections.ts` for the current store pattern.

- **Component composition** — `SplitPaneContainer` > `TabPane` > `TabBar` + Editor. Each component manages its own concern. See how `App.svelte` currently composes `Sidebar` + editor + `StatusBar`.

- **Scoped styles with design tokens** — Tab bar styling should use `tokens.css` variables (`--color-surface`, `--color-border`, `--color-primary`, `--font-sans`). See existing components for the pattern.

- **IPC handler pattern** — Follow the existing `ipcMain.handle` / `ipcRenderer.invoke` pattern in `ipc-handlers.ts`. New channels should use consistent naming: `window:new`, `tab:detach`, `tab:attach`.

- **Keyboard shortcut registration** — Follow the existing `before-input-event` pattern in `main/index.ts` for shortcuts that need main-process handling. Renderer shortcuts go through `onkeydown` handlers in `App.svelte`.

- **electron-store schema extension** — Add `windowSessions` to the existing store schema in `main/store.ts`, following the same validation pattern used for `windowBounds` and `collections`.

- **Debounced persistence** — Follow the window bounds save pattern (500ms debounce on resize) for tab session persistence. See `main/index.ts` for the existing debounce implementation.
