# PRD: Popup Windows — Focused Pop-Out Editing

## Overview

Add a lightweight "popup window" mode that opens a single file, asset, or graph view in a minimal, chrome-free window — just the content editor/viewer and nothing else. This complements the existing "open in new window" feature (which spawns a full app window with sidebar, tabs, status bar, etc.) by offering a focused, distraction-free alternative for quick editing or reference.

Think picture-in-picture for your knowledge base: pop out a markdown file to edit alongside your main workspace, keep a reference PDF visible while writing, or float the graph view on a second monitor.

## Problem Statement

The current multi-window support creates full-featured windows — sidebar, tab bar, titlebar, status bar, properties panel. This is powerful but heavyweight. Many use cases don't need the full chrome:

- **Quick edits**: Pop out a file to make a small change without losing your place in the main window
- **Reference viewing**: Keep a document, image, or PDF visible alongside the main workspace
- **Graph monitoring**: Float the graph view on a second monitor while editing documents
- **Focused writing**: Open a single file with zero distractions — no sidebar, no tabs, no panels

Users need a lighter-weight window option that shows just the content, opens fast, and stays out of the way.

## Goals

- Open any markdown file in a minimal popup window with only the editor (WYSIWYG or raw) and a mode toggle
- Open any asset (image, PDF, video, audio) in a minimal popup window with only the viewer
- Open the graph view in a minimal popup window with only the 3D force-graph and its controls
- Popup windows have a simple titlebar: file name, dirty indicator, and mode/level toggle — no sidebar, tabs, status bar, or properties panel
- Full editing capability in document popups: typing, undo/redo, Cmd+S to save, dirty tracking
- File watcher integration: external changes reflected in the popup (with conflict handling for dirty documents)
- Multiple popups can be open simultaneously, each independent
- Popup windows are independent of the main window lifecycle (closing one doesn't affect the other)
- "Open in Popup Window" available from tab context menu, file tree context menu, and graph view
- Dragging a tab outside the window opens it as a popup (replaces the current full-window detach behavior)
- Support popping out a dirty (unsaved) tab — unsaved content transfers to the popup
- Popup respects current theme (dark/light) and accent color

## Non-Goals

- Popup session persistence across app restarts — popups are ephemeral for v1
- Tabs within popup windows — one popup = one piece of content
- Drag-to-merge popup back into main window (user can re-open the file in main)
- Split panes within popups
- Properties panel or backlinks in popups
- Sidebar or file navigation in popups
- Creating new files from within a popup
- Keyboard shortcut to pop out the current tab (menu/context menu/drag only for v1)
- Keeping the old "drag tab out → full new window" behavior (fully replaced by popup)

---

## Technical Design

### Approach: Query Parameter + PopupShell

The popup window loads the same `index.html` and Vite bundle as full windows. The main process passes URL search params (`?mode=popup&kind=document&filePath=...`) when creating the window. `App.svelte` reads these params at mount and renders a lightweight `PopupShell` component instead of the full chrome.

This approach:
- **Maximizes code reuse**: Editors, viewers, and graph are complex — they work unmodified
- **No build config changes**: No second HTML entry, no second Vite target
- **Same preload/IPC surface**: Popup uses the same `window.api`
- **Clean separation**: Full chrome vs popup is a single branch in `App.svelte`, delegating to entirely different component trees

```
Main Process                          Renderer
  WindowManager                         App.svelte
    createWindow()    ──full──►           └─ Full chrome (Sidebar, Titlebar, ...)
    createPopupWindow() ──popup──►        └─ PopupShell.svelte
                                               ├─ PopupTitlebar.svelte
                                               └─ Content: Editor | WysiwygEditor | GraphView | AssetViewer
```

Each popup is a separate `BrowserWindow` → separate renderer process → separate `workspace` singleton. The popup initializes workspace in "popup mode" with a single tab and single pane.

### Window Configuration

| Property | Full Window | Popup Window |
|---|---|---|
| Default size | 1200×800 | 700×500 |
| Min size | 800×600 | 400×300 |
| Title bar | `hiddenInset` | `frame: false` (frameless) |
| Preload | Same | Same |
| Bounds persistence | Yes (electron-store) | No (ephemeral) |
| Session persistence | Yes | No |

### Data Model Changes

#### PopupWindowOptions (Main Process)

```typescript
interface PopupWindowOptions {
  kind: 'document' | 'asset' | 'graph'
  filePath?: string             // Absolute path for documents/assets
  editorMode?: EditorMode       // 'wysiwyg' | 'editor' — for documents
  collectionId?: string         // Active collection ID (for CLI calls)
  collectionPath?: string       // Active collection root path
  mimeCategory?: MimeCategory   // For assets: 'image' | 'pdf' | 'video' | 'audio' | 'other'
  graphLevel?: GraphLevel       // For graph: 'document' | 'chunk'
  graphColoringMode?: GraphColoringMode  // For graph: 'cluster' | 'folder' | 'none'
  // Dirty document transfer (popping out a tab with unsaved changes):
  isDirty?: boolean
  content?: string | null
  savedContent?: string | null
}
```

#### PopupInitData (IPC Event)

Sent from main process to popup renderer after `did-finish-load` when a dirty document is being transferred:

```typescript
interface PopupInitData {
  content: string | null
  savedContent: string | null
  isDirty: boolean
}
```

### Interface Changes

#### WindowManager

```typescript
class WindowManager {
  // Existing:
  createWindow(): BrowserWindow

  // New:
  createPopupWindow(options: PopupWindowOptions): BrowserWindow
  isPopup(id: number): boolean

  // Internal:
  private popups: Set<number>  // Track popup webContents IDs
}
```

#### Workspace

```typescript
class Workspace {
  // New:
  isPopup = $state(false)

  initAsPopup(kind: 'document' | 'asset' | 'graph', options: {
    filePath?: string
    editorMode?: EditorMode
    content?: string | null
    savedContent?: string | null
    mimeCategory?: MimeCategory
    graphLevel?: GraphLevel
    graphColoringMode?: GraphColoringMode
  }): void
}
```

#### Preload API Additions

```typescript
interface MdvdbApi {
  // New:
  openPopup(options: PopupOpenOptions): Promise<void>
  onPopupInit(callback: (data: PopupInitData) => void): void
  removePopupInitListener(): void
  updatePopupTitle(title: string): Promise<void>
}
```

### Modified IPC Channels

| Channel | Direction | Change |
|---|---|---|
| `tab:detach` | Renderer → Main | **Modified**: Now creates a popup window instead of a full window. Calls `windowManager.createPopupWindow()` instead of `windowManager.createWindow()`. Sends `popup:init` (instead of `tab:attach`) after load. |

### New IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `popup:open` | Renderer → Main | Request a new popup window (from context menus) |
| `popup:init` | Main → Renderer | Send content to popup after load (dirty transfers + detach) |
| `popup:title-update` | Renderer → Main | Update OS window title (dirty indicator) |

### New Components

#### PopupShell.svelte

Root component for popup windows. Receives URL params as props.

```
┌────────────────────────────────────────┐
│  PopupTitlebar (36px, draggable)       │
│  ● ● ●    filename.md    [Editor|Raw] │
├────────────────────────────────────────┤
│                                        │
│  Content area (full-bleed, flex-grow)  │
│                                        │
│  Document: Editor or WysiwygEditor     │
│  Asset: ImageViewer / PdfViewer / ...  │
│  Graph: GraphView with controls        │
│                                        │
└────────────────────────────────────────┘
```

Responsibilities:
- Parse URL params, initialize workspace in popup mode
- Load theme and accent color
- Load file content (or receive dirty content via `popup:init`)
- Register Cmd+S save shortcut for documents
- Set up file watcher for external change detection
- Render appropriate content component based on `kind`

#### PopupTitlebar.svelte

Minimal titlebar for popup windows.

- Height: 36px
- `-webkit-app-region: drag` for native window dragging
- Left: 70px spacer for macOS traffic light buttons
- Center: File name (documents/assets) or "Graph" label, with dirty dot indicator
- Right: Mode toggle for documents (Editor/Raw pill), level toggle for graph (Document/Chunk)
- Updates OS window title via `window.api.updatePopupTitle()` on dirty state or file name changes

### Migration Strategy

No migration needed. This is a purely additive feature. Existing "open in new window" behavior is unchanged. No data format changes, no config changes.

---

## Implementation Steps

### 1. WindowManager: Add `createPopupWindow()`

**File:** `app/src/main/window-manager.ts`

- Add `private popups: Set<number> = new Set()` field
- Add `createPopupWindow(options: PopupWindowOptions): BrowserWindow` method:
  - Create BrowserWindow with 700×500 default, 400×300 min, same `titleBarStyle` and `webPreferences`
  - Build URL query string from options (encode `filePath`, `kind`, `editorMode`, etc.)
  - Load the renderer URL with query params appended
  - Track in both `this.windows` and `this.popups`
  - On `closed`: remove from `this.popups`
  - Do NOT save bounds to electron-store
  - If `options.isDirty && options.content`, wait for `did-finish-load` then send `popup:init` event with content data
- Add `isPopup(id: number): boolean` method
- Clean up popups from `this.popups` Set in `getWindow()` and `getAllWindows()` stale-entry cleanup

### 2. IPC Handlers: Add popup channels + modify tab:detach

**File:** `app/src/main/ipc-handlers.ts`

- **Modify existing `tab:detach` handler** (currently at lines 1018-1027):
  - Instead of `windowManager.createWindow()`, call `windowManager.createPopupWindow(tabData)` — converting `TabTransferData` to `PopupWindowOptions` (kind from tabData.kind, filePath, editorMode, isDirty, content, savedContent, plus collection context)
  - Instead of sending `tab:attach` after load, send `popup:init` with the content data
  - This makes drag-out open a popup instead of a full window
- Add `ipcMain.handle('popup:open', ...)`:
  - Validate options
  - Call `windowManager.createPopupWindow(options)`
  - Return success
- Add `ipcMain.handle('popup:title-update', ...)`:
  - Get sender window via `BrowserWindow.fromWebContents(event.sender)`
  - Call `win.setTitle(title)`

### 3. Preload API: Wire popup methods

**File:** `app/src/preload/api.d.ts`

- Add `PopupOpenOptions` and `PopupInitData` type definitions
- Add `openPopup`, `onPopupInit`, `removePopupInitListener`, `updatePopupTitle` to `MdvdbApi`

**File:** `app/src/preload/index.ts`

- Wire `openPopup` → `ipcRenderer.invoke('popup:open', options)`
- Wire `onPopupInit` → `ipcRenderer.on('popup:init', callback)`
- Wire `removePopupInitListener` → `ipcRenderer.removeAllListeners('popup:init')`
- Wire `updatePopupTitle` → `ipcRenderer.invoke('popup:title-update', title)`

### 4. Workspace: Add `initAsPopup()`

**File:** `app/src/renderer/stores/workspace.svelte.ts`

- Add `isPopup = $state(false)` field
- Add `initAsPopup(kind, options)` method:
  - Set `this.isPopup = true`
  - Create a single pane (ID: `'popup-pane'`)
  - Create a single tab of the given kind:
    - `'document'`: Create `DocumentTab` with provided `filePath`, `editorMode`, optionally `content`/`savedContent`
    - `'asset'`: Create `AssetTab` with `filePath`, `mimeCategory`
    - `'graph'`: Create `GraphTab` with `graphLevel`, `graphColoringMode`
  - Set the tab as the active tab in the pane
  - Do NOT start session auto-persistence (skip the debounced `saveSession` call)

### 5. App.svelte: Popup mode branch

**File:** `app/src/renderer/App.svelte`

- At top of `<script>`: parse `window.location.search`, check `mode === 'popup'`
- In template: `{#if isPopupMode} <PopupShell {urlParams} /> {:else} <!-- existing --> {/if}`
- In `onMount`: wrap existing heavyweight initialization (collections, session restore, shortcuts, watcher, etc.) in `if (!isPopupMode)`

### 6. Create PopupShell component

**New file:** `app/src/renderer/components/PopupShell.svelte`

- Props: `urlParams: URLSearchParams`
- Extract `kind`, `filePath`, `editorMode`, `collectionId`, `collectionPath`, `mimeCategory`, `graphLevel`, `graphColoringMode` from params
- On mount:
  1. Load theme via `loadTheme()` and accent color via `loadAccentColors()` (reuse existing store functions)
  2. Set active collection from `collectionId` param (call `setActiveCollection`)
  3. Call `workspace.initAsPopup(kind, options)` with extracted params
  4. For documents: load file content via `window.api.readFile(filePath)` and set on tab
  5. Listen for `popup:init` IPC — if received (dirty tab transfer or drag-out), override tab content with the provided data
  6. Register `Cmd+S` shortcut (via `shortcutManager`) that triggers save: `window.api.writeFile(path, content)`, update `savedContent`, clear `isDirty`, update title
  7. Set up watcher listener for external file changes (reuse `setupWatcherListener`)
- Template structure:
  ```svelte
  <div class="popup-shell">
    <PopupTitlebar {kind} {title} {isDirty} {editorMode} {graphLevel} />
    <div class="popup-content">
      {#if kind === 'document'}
        {#if currentEditorMode === 'wysiwyg'}
          <WysiwygEditor tabId={tabId} />
        {:else}
          <Editor tabId={tabId} />
        {/if}
      {:else if kind === 'asset'}
        {#if mimeCategory === 'image'}
          <ImageViewer filePath={filePath} fileSize={fileSize} />
        {:else if mimeCategory === 'pdf'}
          <PdfViewer filePath={filePath} />
        {:else}
          <AssetInfoCard filePath={filePath} mimeCategory={mimeCategory} fileSize={fileSize} />
        {/if}
      {:else if kind === 'graph'}
        <GraphView paneId="popup-pane" />
      {/if}
    </div>
  </div>
  ```
- Styles: full viewport, no margins/padding on content area, dark background matching theme

### 7. Create PopupTitlebar component

**New file:** `app/src/renderer/components/PopupTitlebar.svelte`

- Props: `kind`, `title`, `isDirty`, `editorMode`, `graphLevel`, `onmodechange`, `onlevelchange`
- Layout:
  - 36px height, `background: var(--color-surface)`, `border-bottom: 1px solid var(--color-border)`
  - `-webkit-app-region: drag` on the container
  - Left spacer (70px) for macOS traffic lights
  - Center: title text + dirty dot (red dot before filename when dirty)
  - Right: mode toggle buttons (document) or level toggle buttons (graph), wrapped in `-webkit-app-region: no-drag`
- Mode toggle: two small pill buttons ("Editor" / "Raw"), styled like existing ModeBar toggle but compact
- Level toggle: two small pill buttons ("Document" / "Chunk")
- `$effect` to call `window.api.updatePopupTitle(title)` when title or dirty state changes (formats as `"● filename.md"` when dirty, `"filename.md"` when clean)

### 8. Trigger: Tab drag-out (now opens popup)

No renderer changes needed for drag-out — `TabItem.svelte` already calls `workspace.detachTab()` which calls `window.api.detachTab(data)`. The behavior change is entirely in the main process `tab:detach` handler (step 2), which now creates a popup instead of a full window.

**File:** `app/src/renderer/components/TabItem.svelte`

- The existing drag-out logic (lines 69-114) stays as-is. It already serializes the tab and calls `workspace.detachTab()`.
- The only change: remove the `tab.kind === 'document'` guard (line 109) so asset and graph tabs can also be dragged out into popups.

### 9. Trigger: Tab context menu

**File:** `app/src/renderer/components/TabBar.svelte`

- **Rename** "Move into New Window" to "Pop Out" (or "Open in Popup Window") — since detach now creates a popup, the existing `handleCtxMoveToNewWindow()` already does the right thing (it calls `workspace.detachTab()` → `tab:detach` IPC → popup). Just update the label and icon:
  ```svelte
  <button class="context-menu-item" onclick={handleCtxMoveToNewWindow}>
    <span class="material-symbols-outlined">picture_in_picture_alt</span>
    Pop Out
  </button>
  ```
- Make it available for ALL tab kinds (document, asset, graph) — adjust the `canDetach` logic or move the button outside the `{#if canDetach}` block

### 10. Trigger: File tree context menu

**File:** `app/src/renderer/components/FileTree.svelte`

- Add `handleOpenInPopup()` function:
  - Get `contextMenuPath`
  - Detect if asset via `detectAssetMime()` (or reuse the extension map)
  - Build `PopupOpenOptions` with `kind: 'document'` or `kind: 'asset'`, plus `filePath`, `collectionId`, `collectionPath`
  - Call `window.api.openPopup(options)`
  - Close context menu
- Add menu item after "Open in New Tab" for markdown files:
  ```svelte
  <button class="context-menu-item" onclick={handleOpenInPopup}>
    <span class="material-symbols-outlined">picture_in_picture_alt</span>
    Open in Popup Window
  </button>
  ```
- For asset files (where "Open in New Tab" isn't shown): add after "Open in Default App"

### 11. Trigger: Graph view pop-out

**File:** `app/src/renderer/components/GraphView.svelte`

- Add a pop-out button in the graph controls area (top-right corner alongside existing controls)
- Icon: `picture_in_picture_alt`
- Handler: calls `window.api.openPopup({ kind: 'graph', collectionId, collectionPath, graphLevel, graphColoringMode })`

### 12. External file change handling

**File:** `app/src/renderer/components/PopupShell.svelte` (part of step 6)

- On watcher event matching the popup's file path:
  - If popup is NOT dirty: silently reload content from disk, update tab content
  - If popup IS dirty: show a simple confirmation dialog ("File changed on disk. Reload and lose changes, or keep editing?")
    - "Reload": re-read from disk, update tab, clear dirty
    - "Keep editing": ignore the external change, keep current content

---

## Validation Criteria

- [ ] Dragging a tab outside the window opens it as a popup (not a full new window)
- [ ] Right-click tab → "Pop Out" opens a minimal popup with just the editor
- [ ] Right-click file in tree → "Open in Popup Window" opens popup for that file
- [ ] Graph view has a pop-out button that opens graph in a popup
- [ ] Document popup shows WYSIWYG editor by default, with mode toggle to switch to raw
- [ ] Document popup shows dirty indicator (dot in titlebar) when content is modified
- [ ] Cmd+S in document popup saves the file to disk and clears dirty state
- [ ] Popping out a dirty tab transfers unsaved content to the popup
- [ ] Image popup shows ImageViewer with zoom controls
- [ ] PDF popup shows PdfViewer with page navigation and zoom
- [ ] Other asset types show AssetInfoCard with metadata and actions
- [ ] Graph popup shows interactive 3D force-graph with level toggle
- [ ] Multiple popups can be open simultaneously without interference
- [ ] Closing the main window does not close popups; closing a popup does not affect the main window
- [ ] Popup respects current theme (dark/light) and accent color
- [ ] External file changes are reflected in the popup (reload if clean, prompt if dirty)
- [ ] Popup windows have correct macOS traffic lights (close/minimize/maximize)
- [ ] Window title reflects file name and dirty state
- [ ] Popups do NOT persist across app restarts (ephemeral)
- [ ] Popups do NOT save session state to electron-store
- [ ] All existing "open in new window" functionality remains unchanged
- [ ] Editor undo/redo works correctly in popup
- [ ] Editor extensions (wikilinks, slash commands, link autocomplete, mermaid, tables) all work in popup

## Anti-Patterns to Avoid

- **Don't duplicate editor components** — The editors are complex (pooling, extensions, dirty tracking). Reuse them unmodified by initializing workspace in popup mode. Don't create "simplified" editor variants.
- **Don't add a second Vite entry point** — Same `index.html` with query params is simpler and avoids build config complexity. No `popup.html`.
- **Don't scatter popup conditionals through existing components** — The popup branch should be a single `{#if}` in `App.svelte` delegating to `PopupShell`. Don't add `if (isPopup)` checks inside `Sidebar`, `TabBar`, `StatusBar`, etc.
- **Don't share workspace state across windows** — Each BrowserWindow is a separate renderer process with its own `workspace` instance. Popups initialize their own workspace in popup mode. Don't try to sync state between windows.
- **Don't persist popup window bounds** — Popups are ephemeral. Don't add popup-specific entries to electron-store's `windowBounds`. This keeps v1 simple.
- **Don't override native window controls** — Use `titleBarStyle: 'hiddenInset'` and let macOS traffic lights handle close/minimize/maximize. Don't add custom close buttons.

## Patterns to Follow

- **Tab detach flow** (`TabBar.svelte:361-368`, `TabItem.svelte:69-114`, `ipc-handlers.ts:1018-1027`): The existing drag-out and "Move into New Window" serialize tab data → IPC `tab:detach` → main creates window. We modify the main-side handler to create a popup instead of a full window, so the renderer-side flow stays the same.
- **WindowManager.createWindow()** (`window-manager.ts:29-121`): The popup version mirrors this structure — same `webPreferences`, same preload, same `ready-to-show` pattern. Differences: smaller size, no bounds persistence, URL with query params.
- **Workspace initialization** (`workspace.svelte.ts`): The existing `restoreSession()` and `openTab()` patterns show how tabs are created and initialized. `initAsPopup()` follows the same tab creation logic but with a single tab and no persistence.
- **Editor pool pattern** (`Editor.svelte`, `WysiwygEditor.svelte`): Editors manage their own instance pools per renderer process. Popups get their own pool automatically (separate process). No changes needed.
- **Context menu pattern** (`FileTree.svelte:587-660`, `TabBar.svelte:527-535`): Follow the existing context menu item structure — same CSS classes, same icon + label layout, same handler pattern.
- **Theme loading** (`App.svelte` onMount): Reuse `loadTheme()`, `loadAccentColors()`, `loadCollectionAccentColor()` — call these in PopupShell's onMount to ensure correct theming.
