# PRD: Collection Management

## Overview

Implement the core data model for the desktop app: collections. A collection is a folder on disk that contains markdown files and a `.markdownvdb` configuration. Users can add collections via a folder picker, remove them, and switch between them. The collection list persists across app restarts and renders in the sidebar.

## Problem Statement

The app needs to know which folders to operate on. Unlike the CLI where the user passes `--root` per command, the app needs persistent awareness of multiple folders across sessions. Users need a visual way to manage their mdvdb projects.

## Goals

- Add collections via native folder picker dialog
- Remove collections (does NOT delete files on disk)
- Switch between collections (sets active context for all CLI operations)
- Persist collection list across app restarts via `electron-store`
- Sidebar renders collection list with folder icons and active state
- Auto-detect whether a folder has been initialized (`mdvdb init`)
- Display basic collection stats (document/chunk count from `mdvdb status`)

## Non-Goals

- Auto-scanning the filesystem for collections (manual add only)
- File tree within collections (Phase 4)
- Collection-level settings editing (Phase 10)
- Drag-and-drop reordering of collections
- Collection grouping or tagging

## Technical Design

### Data Model Changes

**New persistent store via `electron-store`:**

```typescript
interface AppStore {
  collections: Collection[]
  activeCollectionId: string | null
  windowBounds: { x: number; y: number; width: number; height: number }
}

interface Collection {
  id: string              // UUID v4
  name: string            // Folder name (e.g., "my-notes")
  path: string            // Absolute path on disk
  addedAt: number         // Unix timestamp
  lastOpenedAt: number    // Unix timestamp (updated on switch)
}
```

### Interface Changes

**New module: `app/src/main/store.ts`**

```typescript
getStore(): ElectronStore<AppStore>
getCollections(): Collection[]
addCollection(path: string): Collection      // Creates and persists a new collection
removeCollection(id: string): void           // Removes from store, does NOT delete files
setActiveCollection(id: string): void        // Updates activeCollectionId + lastOpenedAt
getActiveCollection(): Collection | null
```

**New module: `app/src/main/collections.ts`**

```typescript
// Validates a folder path and prepares it as a collection
validateCollectionPath(path: string): Promise<{
  valid: boolean
  hasConfig: boolean          // .markdownvdb/ exists
  name: string                // Folder basename
  error?: string
}>

// Opens folder picker and returns selected path
pickCollectionFolder(): Promise<string | null>

// Initialize a folder as mdvdb collection (runs `mdvdb init`)
initCollection(path: string): Promise<void>
```

**New IPC channels:**
- `'collections:list'` → `getCollections()`
- `'collections:add'` → `pickCollectionFolder()` + `addCollection()`
- `'collections:remove'` → `removeCollection(id)`
- `'collections:set-active'` → `setActiveCollection(id)`
- `'collections:get-active'` → `getActiveCollection()`

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing CLI methods ...
  listCollections(): Promise<Collection[]>
  addCollection(): Promise<Collection | null>   // Opens folder picker
  removeCollection(id: string): Promise<void>
  setActiveCollection(id: string): Promise<void>
  getActiveCollection(): Promise<Collection | null>
}
```

### New Commands / API / UI

**Sidebar updates:**
- "Knowledge Base" section renders `collections` list
- Each collection: folder icon + name + small stats text (e.g., "25 docs")
- Active collection: `bg-surface-dark border border-border-dark/50 text-white` with open folder icon
- Inactive collections: `text-text-dim hover:bg-surface-dark hover:text-white`
- Right-click context menu: "Remove Collection" with confirmation dialog
- "Add Collection" button at bottom: folder-plus icon
- Empty state: centered message "No collections yet" + prominent "Add Folder" button

**Header updates:**
- Breadcrumb shows active collection name (or "mdvdb" if none selected)

### Migration Strategy

N/A — new persistent store. On first launch, `electron-store` creates its JSON file in the user data directory.

## Implementation Steps

1. **Install `electron-store`** — `npm install electron-store`. This provides encrypted, schema-validated persistent storage in the user's app data directory.

2. **Create store module** — `app/src/main/store.ts`:
   - Initialize `electron-store` with schema for `AppStore` type.
   - Export getter/setter functions for collections and active collection.
   - Generate UUIDs with `crypto.randomUUID()`.

3. **Create collections module** — `app/src/main/collections.ts`:
   - `validateCollectionPath(path)`: check `fs.existsSync(path)`, check `fs.statSync(path).isDirectory()`, check for `.markdownvdb` directory or `.markdownvdb` file (legacy). Return validation result.
   - `pickCollectionFolder()`: call `dialog.showOpenDialog({ properties: ['openDirectory'] })`. Return selected path or null if cancelled.
   - `initCollection(path)`: call `execCommand('init', [], path)` via CLI bridge.

4. **Register IPC handlers** — Add collection IPC handlers to `app/src/main/ipc-handlers.ts`:
   - `'collections:add'`: call `pickCollectionFolder()`, if path selected → `validateCollectionPath()` → if no config, ask to initialize (via `dialog.showMessageBox`) → `addCollection()` → return new collection.
   - `'collections:remove'`: call `dialog.showMessageBox` for confirmation → `removeCollection(id)`.
   - `'collections:set-active'`: call `setActiveCollection(id)`.
   - Other CRUD handlers as listed above.

5. **Update preload** — Add collection methods to `window.api` in `app/src/preload/index.ts`.

6. **Create Svelte collection store** — `app/src/renderer/stores/collections.ts`:
   - `collections` writable store, initialized from `window.api.listCollections()`.
   - `activeCollection` derived store.
   - `addCollection()` action: calls API, updates store.
   - `removeCollection(id)` action: calls API, updates store.
   - `switchCollection(id)` action: calls API, updates store, fetches status.

7. **Create CollectionStatus type** — Fetch `mdvdb status --json` for active collection. Store in a `collectionStatus` writable store. Refresh on collection switch.

8. **Update Sidebar component** — Replace the empty "Knowledge Base" section:
   - Render collection list from `$collections` store.
   - Each item: `<button>` with folder icon, collection name, small dim stats text.
   - Active state styling from mockup.
   - Click handler: calls `switchCollection(id)`.
   - Right-click: context menu with "Remove" option.
   - "Add Collection" button at bottom of list.
   - Empty state when `$collections.length === 0`.

9. **Update Header breadcrumb** — Show active collection name. If no collection selected, show "mdvdb".

10. **Handle edge cases** — Collection path deleted from disk: show warning icon + "Folder not found" tooltip. Collection path without index: show "Not indexed" badge.

11. **Write unit tests** — `tests/unit/store.test.ts`: test CRUD operations on the store. `tests/unit/collections.test.ts`: test path validation, collection creation. `tests/unit/CollectionList.test.ts`: render component with mock data, verify items rendered, active state.

12. **Write E2E tests** — `tests/e2e/collections.test.ts`:
    - Mock the folder picker dialog to return a temp directory path.
    - Verify collection appears in sidebar after adding.
    - Switch collections, verify breadcrumb updates.
    - Remove collection, verify it disappears from sidebar.
    - Restart app (or reload), verify collections persist.

## Validation Criteria

- [ ] User can add a folder via the native folder picker dialog
- [ ] Added collection appears in the sidebar with correct name and folder icon
- [ ] Collections persist across app restart
- [ ] Clicking a collection switches the active context and updates the breadcrumb
- [ ] Right-click → "Remove Collection" removes it from the list (confirmation dialog shown)
- [ ] Removing a collection does NOT delete any files on disk
- [ ] Adding a folder without `.markdownvdb` config offers to run `mdvdb init`
- [ ] After init, collection shows up with a status
- [ ] Collection status (doc count) displays under the collection name
- [ ] Empty state renders when no collections exist
- [ ] Path-deleted collections show a warning indicator
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT store relative paths** — Collection paths must be absolute. Relative paths break when the working directory changes.
- **Do NOT delete files on collection removal** — "Remove Collection" removes the entry from the app's list. It must NEVER touch the user's files, index, or `.markdownvdb` directory.
- **Do NOT auto-scan the filesystem** — Collections are manual-add only. Scanning is slow, potentially invasive, and confusing for users who don't want certain folders indexed.
- **Do NOT fetch status for all collections eagerly** — Only fetch `mdvdb status` for the active collection. Fetching for all collections would spawn N CLI processes on startup.
- **Do NOT use synchronous IPC** — All collection operations use `ipcMain.handle()` / `ipcRenderer.invoke()` (async). Never `ipcMain.on()` with `event.returnValue`.

## Patterns to Follow

- **electron-store for persistence** — Follow electron-store's schema validation pattern. Define the schema upfront so invalid data is caught early.
- **Svelte writable stores for UI state** — Keep the renderer's collection state in Svelte stores. Sync with the main process on mutation, not on every render.
- **Confirmation dialogs for destructive actions** — Use `dialog.showMessageBox` with cancel/confirm buttons for removal.
- **Folder picker via `dialog.showOpenDialog`** — Use `properties: ['openDirectory']` to restrict selection to directories only.
