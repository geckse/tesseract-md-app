# PRD: Favorites & Recents

## Overview

Sidebar sections for bookmarked files (favorites) and automatically tracked recently opened files (recents). Both persist across app restarts. Favorites are user-curated; recents are auto-populated every time a file is opened. These appear in the sidebar above the collection list, matching the mockup's "Favorites" and "Recent" navigation items.

## Problem Statement

Users frequently revisit the same files and need quick access without navigating the file tree each time. The sidebar's "Favorites" and "Recent" sections (shown in the mockup) provide one-click access to important and recently used files.

## Goals

- Star/unstar files as favorites from the editor area
- Auto-track recently opened files (deduped, most-recent-first, capped at 50)
- Sidebar sections for Favorites and Recent with file list
- Click to open a file (switches collection if needed)
- Persist both lists across app restarts
- Remove individual favorites via right-click or unstar
- Clear recents list option

## Non-Goals

- Favoriting or pinning collections (just files)
- Search within favorites or recents
- Custom ordering of favorites (sorted by added date)
- Folder favorites
- Syncing favorites across devices

## Technical Design

### Data Model Changes

**Store additions (`electron-store`):**

```typescript
interface AppStore {
  // ... existing fields ...
  favorites: FavoriteEntry[]
  recentFiles: RecentEntry[]
}

interface FavoriteEntry {
  collectionId: string     // Which collection this file belongs to
  filePath: string         // Relative path within the collection
  addedAt: number          // Unix timestamp
}

interface RecentEntry {
  collectionId: string
  filePath: string
  openedAt: number         // Unix timestamp, updated on each open
}
```

### Interface Changes

**New IPC channels:**
- `'favorites:list'` → returns all favorites
- `'favorites:add'` → add a file to favorites
- `'favorites:remove'` → remove a file from favorites
- `'favorites:is-favorite'` → check if a file is favorited
- `'recents:list'` → returns recent files (sorted by openedAt desc)
- `'recents:add'` → add/update a file in recents
- `'recents:clear'` → clear all recents

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  listFavorites(): Promise<FavoriteEntry[]>
  addFavorite(collectionId: string, filePath: string): Promise<void>
  removeFavorite(collectionId: string, filePath: string): Promise<void>
  isFavorite(collectionId: string, filePath: string): Promise<boolean>
  listRecents(): Promise<RecentEntry[]>
  addRecent(collectionId: string, filePath: string): Promise<void>
  clearRecents(): Promise<void>
}
```

### New Commands / API / UI

**Sidebar Favorites section** (matching mockup):
- Star icon + "Favorites" label
- List of favorited files: `file icon + filename`, dimmed collection name as subtitle
- Click: open file in editor (switch collection if different from current)
- Hover: `bg-surface-dark text-white`
- Empty state: (section hidden when no favorites)

**Sidebar Recents section** (matching mockup):
- Clock icon + "Recent" label
- List of recently opened files: `file icon + filename`, relative time ("2 min ago", "yesterday")
- Click: open file in editor
- Right-click: "Clear All Recents"
- Max display: show last 10 in sidebar, full list accessible via expanding
- Empty state: (section hidden when no recents)

**Star toggle in editor:**
- Star icon in the header breadcrumb area or near the file name
- Outlined star when not favorited, filled star when favorited
- Click toggles favorite state
- Styled: `text-text-dim hover:text-yellow-400` (unfavorited), `text-yellow-400` (favorited)

### Migration Strategy

N/A — new fields in electron-store. Existing stores are unaffected; new fields default to empty arrays.

## Implementation Steps

1. **Update store schema** — In `app/src/main/store.ts`:
   - Add `favorites: FavoriteEntry[]` and `recentFiles: RecentEntry[]` with default empty arrays.
   - Add helper functions:
     - `addFavorite(collectionId, filePath)`: push to array if not exists.
     - `removeFavorite(collectionId, filePath)`: filter out matching entry.
     - `isFavorite(collectionId, filePath)`: check if entry exists.
     - `addRecent(collectionId, filePath)`: remove existing entry for same file (if any), push new entry at start, cap at 50 entries.
     - `clearRecents()`: set to empty array.

2. **Register IPC handlers** — Add favorites and recents IPC handlers to `app/src/main/ipc-handlers.ts`.

3. **Update preload** — Add favorites and recents methods to `window.api`.

4. **Create Svelte stores** — `app/src/renderer/stores/favorites.ts`:
   - `favorites`: writable, initialized from `window.api.listFavorites()`.
   - `recentFiles`: writable, initialized from `window.api.listRecents()`.
   - Actions: `toggleFavorite(collectionId, filePath)`, `trackRecent(collectionId, filePath)`.
   - `isFavorited` derived store based on active file.

5. **Wire file open to recents** — Update the file selection flow (in `files.ts` store or `selectFile` function):
   - After setting `activeFilePath`, call `trackRecent(activeCollection.id, filePath)`.
   - This ensures every file open is tracked automatically.

6. **Build Favorites component** — `app/src/renderer/components/Favorites.svelte`:
   - Renders `$favorites` list with file icons and names.
   - Each item shows collection name as small dim text below filename (when file is from a non-active collection).
   - Click handler: if file is in active collection, just set `activeFilePath`. If in different collection, switch collection first, then select file.
   - Empty: section not rendered.

7. **Build Recents component** — `app/src/renderer/components/Recents.svelte`:
   - Renders `$recentFiles` (last 10 in sidebar, expandable).
   - Each item: filename + relative time (use a helper to format: "2 min ago", "1 hour ago", "yesterday", "Oct 15").
   - Click handler: same as favorites.
   - Right-click context menu: "Clear All Recents".
   - Empty: section not rendered.

8. **Add star toggle to Header** — Near the breadcrumb or file name:
   - `star` (outlined) or `star` (filled, with FILL=1) Material Symbol.
   - Reactive: checks `$isFavorited`.
   - Click: calls `toggleFavorite()`.

9. **Integrate into Sidebar** — Place Favorites and Recents sections above the "Knowledge Base" collection list, below the sidebar header. Match the mockup's ordering: Favorites first, Recent second.

10. **Handle stale entries** — When a collection is removed, its favorites and recents entries should be removed too. When rendering, validate that the collection still exists; skip entries with missing collections.

11. **Write unit tests**:
    - `tests/unit/favorites-store.test.ts`: add/remove/toggle favorite, persist state, cap behavior.
    - `tests/unit/recents-store.test.ts`: add recent (dedup, cap at 50, most-recent-first), clear recents.
    - `tests/unit/Favorites.test.ts`: render with mock data, verify click handlers.
    - `tests/unit/Recents.test.ts`: render with mock data, verify relative time formatting.

12. **Write E2E tests** — `tests/e2e/favorites-recents.test.ts`:
    - Open several files, verify recents list populates.
    - Click star on a file, verify it appears in favorites.
    - Close and reopen app, verify both lists persist.
    - Click a recent file, verify it opens.
    - Clear recents, verify list is empty.

## Validation Criteria

- [ ] Opening a file automatically adds it to the Recent list
- [ ] Recent list is sorted most-recent-first
- [ ] Duplicate opens update the timestamp, not create a new entry
- [ ] Recent list is capped at 50 entries
- [ ] Clicking the star icon adds/removes a file from Favorites
- [ ] Star icon state reflects whether the current file is favorited
- [ ] Both Favorites and Recents lists persist across app restarts
- [ ] Clicking a recent/favorite file opens it in the editor
- [ ] Files from non-active collections trigger a collection switch before opening
- [ ] "Clear All Recents" empties the recents list
- [ ] Removing a collection cleans up its favorites and recents entries
- [ ] Sections are hidden when their lists are empty
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT store full file content in favorites/recents** — Only store the collection ID and relative file path. Content is loaded on demand.
- **Do NOT fetch file metadata for all favorites/recents on startup** — Only load titles/previews when the sidebar section is expanded and visible.
- **Do NOT allow unlimited recents** — Cap at 50 entries in storage, display only 10 in the sidebar to keep it scannable.
- **Do NOT use absolute paths in favorites/recents** — Store collection ID + relative path. This survives collection path changes (e.g., moved folder) if the collection is re-added.

## Patterns to Follow

- **Mockup reference** — Favorites and Recents sections in `app-mockup-code.html` lines 83-92. Star icon = `star` Material Symbol, clock icon = `schedule`.
- **Dedup on add** — When adding a recent, check if the same `(collectionId, filePath)` exists. If so, update `openedAt` instead of creating a duplicate.
- **Relative time formatting** — Use `Intl.RelativeTimeFormat` or a simple helper that shows "just now", "N min ago", "N hours ago", "yesterday", or formatted date for older entries.
