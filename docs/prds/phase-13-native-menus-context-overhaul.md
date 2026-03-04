# PRD: Native Menus & Context Menu Overhaul

## Overview

Remove Recents from the sidebar, add a proper native macOS application menu with "Open Recent", and enrich all in-app context menus with more useful actions. Favorites stay in the sidebar as-is.

## Problem Statement

The sidebar "Recents" section takes up space and feels out of place — real desktop apps surface recent files through the native File menu, not a sidebar list. The existing context menus are also too sparse: the file tree menu has only 2 items, the collection menu has 1 item, and they lack standard actions like Copy Path, Open in Editor, and Add to Favorites. The app also has no native macOS menu bar at all (no File, Edit, View, Window menus), which breaks standard keyboard shortcuts like Cmd+C/V in text fields and Cmd+W to close.

## Goals

- Native macOS application menu bar (File, Edit, View, Window)
- "Open Recent" submenu under File that dynamically shows recently opened files
- Richer file context menu: Reveal in Finder, Open in Default Editor, Copy Path, Copy Relative Path, Add/Remove Favorite, Reindex File
- Richer collection context menu: Reveal in Finder, Copy Path, Reindex Collection, Remove Collection
- Remove Recents from the sidebar
- Keep Favorites in the sidebar

## Non-Goals

- Windows/Linux native menus (macOS only for now — those platforms get Electron defaults)
- Native OS context menus (keep the existing CSS-based context menus for dark theme consistency)
- Custom keyboard shortcuts (standard Electron roles handle this)
- Recents pinning or grouping by collection

## Technical Design

### Data Model Changes

No new persistent data. Recents data is already stored in `electron-store` by the main process. The native menu reads directly from the store.

### Interface Changes

**New module: `app/src/main/menu.ts`**

```typescript
export function buildAppMenu(mainWindow: BrowserWindow): void    // Build and set the native app menu
export function refreshRecentMenu(): void                         // Rebuild menu when recents change
```

**New IPC handlers:**
- `shell:open-path` — opens a file in the system default editor (with collection-path security validation)
- `clipboard:write-text` — writes text to system clipboard

**New IPC push channel (main → renderer):**
- `menu:open-recent` — sent when user clicks a recent file in the native File menu, with `{ collectionId, filePath }`

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  openPath(absolutePath: string): Promise<void>
  writeToClipboard(text: string): Promise<void>
  onMenuOpenRecent(callback: (data: { collectionId: string; filePath: string }) => void): void
}
```

### New Commands / API / UI

**Native macOS Menu Bar:**

```
mdvdb
  About mdvdb
  ---
  Hide mdvdb           Cmd+H
  Hide Others           Cmd+Option+H
  Show All
  ---
  Quit mdvdb            Cmd+Q

File
  Open Recent  >
    [recent-file-1]       sublabel: collection-name
    [recent-file-2]       sublabel: collection-name
    ...
    ---
    Clear Recent Files
  ---
  Close Window          Cmd+W

Edit  (role: editMenu — Undo/Redo/Cut/Copy/Paste/SelectAll)

View
  Reload                Cmd+R  (dev only)
  Toggle DevTools       Cmd+Option+I  (dev only)

Window  (role: windowMenu — Minimize/Zoom/Bring All to Front)
```

**Enriched File Context Menu** (right-click file in tree):
```
Reveal in Finder
Open in Default Editor
---
Copy Path
Copy Relative Path
---
Add to Favorites          (or "Remove from Favorites" if already favorited)
---
Reindex File
```

**Enriched Directory Context Menu** (right-click directory in tree):
```
Reveal in Finder
---
Copy Path
Copy Relative Path
```

**Enriched Collection Context Menu** (right-click collection in sidebar):
```
Reveal in Finder
---
Copy Path
---
Reindex Collection
---
Remove Collection          (danger-styled)
```

### Migration Strategy

N/A — additive changes plus one removal (Recents.svelte).

## Implementation Steps

1. **Add new IPC handlers** — `shell:open-path` and `clipboard:write-text` in `ipc-handlers.ts` with collection-path security validation. Update preload + `api.d.ts` with `openPath()`, `writeToClipboard()`, `onMenuOpenRecent()`.

2. **Create native menu** — New `app/src/main/menu.ts` with `buildAppMenu(mainWindow)` and `refreshRecentMenu()`. Reads recents from electron-store, builds macOS menu bar with dynamic "Open Recent" submenu. Recent items send `menu:open-recent` IPC to renderer on click.

3. **Wire menu into main process** — In `index.ts`, import and call `buildAppMenu(mainWindow)` after app ready. In `ipc-handlers.ts`, call `refreshRecentMenu()` after `recents:add`, `recents:clear`, and `collections:remove` handlers.

4. **Handle menu:open-recent in renderer** — In `App.svelte`, listen for `menu:open-recent` on mount → switch collection + select file. Remove `loadRecents()` call since renderer no longer displays recents.

5. **Remove Recents from sidebar** — Remove `<Recents />` from `Sidebar.svelte`. Delete `Recents.svelte`. Simplify `trackRecent` in `favorites.ts` to not call `loadRecents()` (keep `window.api.addRecent` since main process needs it for native menu).

6. **Enrich file tree context menu** — In `FileTree.svelte`, add: Open in Default Editor, Copy Path, Copy Relative Path, Add/Remove Favorites, separators. Import `favorites` and `activeCollectionId` stores to check favorited state. Add `.context-menu-separator` styling.

7. **Enrich collection context menu** — In `Sidebar.svelte`, add: Reveal in Finder, Copy Path, Reindex Collection with separators. Import `runIngest` from ingest store. Use existing `contextMenuCollection.path` for all operations.

8. **Write tests** — Unit tests for `menu.ts` (mock Electron Menu), new IPC handlers (security validation), FileTree context menu items, Sidebar context menu items. Delete `Recents.test.ts`.

## Validation Criteria

- [ ] macOS menu bar shows mdvdb, File, Edit, View, Window menus
- [ ] File > Open Recent shows recently opened files with collection names
- [ ] File > Open Recent > clicking a file switches to its collection and opens it
- [ ] File > Open Recent > Clear Recent Files clears the list
- [ ] Opening a file adds it to File > Open Recent dynamically
- [ ] Recents section is gone from the sidebar
- [ ] Favorites section remains in the sidebar
- [ ] Edit menu keyboard shortcuts work (Cmd+C, Cmd+V, Cmd+Z, etc.)
- [ ] File tree right-click: all items work (Reveal, Open, Copy Path, Copy Relative, Favorite toggle, Reindex)
- [ ] Directory right-click: Reveal + Copy Path items work
- [ ] Collection right-click: all items work (Reveal, Copy Path, Reindex, Remove)
- [ ] Copy Path puts the correct absolute path in clipboard
- [ ] Copy Relative Path puts the correct project-relative path in clipboard
- [ ] Add/Remove Favorite correctly toggles in both context menu label and favorites store
- [ ] Reindex Collection triggers full reindex for the selected collection
- [ ] All unit tests pass (`npx vitest run`)
- [ ] No regressions in existing functionality

## Anti-Patterns to Avoid

- **Do NOT use native OS context menus** — The app has a dark theme; native context menus would look jarring. Keep using the CSS-based in-renderer context menus.
- **Do NOT poll or subscribe for recents in the renderer** — The renderer no longer displays recents. Only `window.api.addRecent` (fire-and-forget to main process) and `menu:open-recent` (IPC push from main) are needed.
- **Do NOT try to update individual menu items** — Electron's `Menu` API requires rebuilding the entire menu. `refreshRecentMenu()` must call `Menu.setApplicationMenu()` with a fresh menu. This is the standard Electron pattern.
- **Do NOT skip security validation on new IPC handlers** — `shell:open-path` and `clipboard:write-text` must validate that paths are within known collections, same as `fs:read-file`.
- **Do NOT import menu.ts from ipc-handlers.ts at module level if it causes circular deps** — Use lazy import if needed (same pattern as the favorites circular dep fix).

## Patterns to Follow

- **Context menu CSS** — Reuse the existing `.context-menu-overlay`, `.context-menu`, `.context-menu-item` classes. Add `.context-menu-separator` for dividers.
- **Security validation** — Copy the pattern from `fs:read-file` handler: resolve path, check it starts with a known collection path.
- **IPC wrapping** — Use `wrapHandler()` for all new IPC handlers (consistent error serialization).
- **Menu item icons** — Use Material Symbols Outlined for context menu icons (existing pattern).
