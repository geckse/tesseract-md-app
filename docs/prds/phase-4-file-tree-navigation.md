# PRD: File Tree & Navigation

## Overview

Display the markdown file tree for the active collection using `mdvdb tree --json`. Files show sync state indicators (indexed, modified, new, deleted). Directories are expandable/collapsible. Clicking a file selects it, updates the breadcrumb, and reads the file content from disk for the editor (Phase 5).

## Problem Statement

After adding a collection, users need to see and navigate its files. The file tree is the primary navigation mechanism, showing the hierarchical structure of markdown files and their index state at a glance.

## Goals

- Render file tree from `mdvdb tree --json` output
- Color-coded sync state indicators for each file
- Expand/collapse directories with chevron icons
- Click-to-select files with active state highlight (mockup style)
- Breadcrumb navigation showing `Collection > path > filename.md`
- Summary counts below collection name: "N files, M modified"
- Manual refresh button to re-fetch the tree
- Read selected file content from disk via IPC

## Non-Goals

- Markdown rendering or editing (Phase 5)
- File creation, deletion, or renaming from the app
- Drag-and-drop file organization
- Search within the file tree (global search is Phase 6)
- Context menus on files (future enhancement)

## Technical Design

### Data Model Changes

No persistent data changes. New in-memory stores in the renderer:

```typescript
// Svelte stores
fileTree: Writable<FileTree | null>           // Parsed CLI output
activeFilePath: Writable<string | null>        // Currently selected file (relative path)
fileContent: Writable<string | null>           // Raw markdown content of selected file
expandedDirs: Writable<Set<string>>            // Expanded directory paths (per-collection)
```

### Interface Changes

**New IPC channel for file reading:**
- `'fs:read-file'` → reads a file from disk given absolute path, returns string content

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  readFile(absolutePath: string): Promise<string>  // Read file content from disk
}
```

### New Commands / API / UI

**FileTree component: `app/src/renderer/components/FileTree.svelte`**

Recursive component rendering `FileTreeNode` objects:

```
📁 docs/               [click to expand/collapse]
  ├── 📄 api.md        ● indexed (green)
  ├── 📄 guide.md      ● modified (yellow)
  └── 📄 new-file.md   ● new (blue)
📄 README.md           ● indexed (green)
📄 orphan.md           ● deleted (red)
```

**State indicators:**
| State | Color | Icon/Badge | Tailwind Classes |
|---|---|---|---|
| indexed | green | small dot | `text-emerald-500` |
| modified | yellow | small dot | `text-yellow-500` |
| new | blue | small dot | `text-blue-400` |
| deleted | red | small dot | `text-red-500` |

**Active file styling** (from mockup):
- Background: `bg-primary-dim` (rgba(0, 229, 255, 0.1))
- Text: `text-primary` (#00E5FF)
- Right border: `border-r-2 border-primary`
- Font weight: `font-medium`

**Breadcrumb in Header:**
- Format: `Collection Name > parent_dir > filename.md`
- Collection name: `text-text-dim hover:text-white` (clickable, deselects file)
- Chevron separators: `text-border-dark`
- Filename: `text-primary font-medium`

### Migration Strategy

N/A — new components and stores.

## Implementation Steps

1. **Add file reading IPC** — In `app/src/main/ipc-handlers.ts`, add handler for `'fs:read-file'`: accepts an absolute path string, reads with `fs.promises.readFile(path, 'utf-8')`, returns the content. Validate that the path is within a known collection root (security check).

2. **Update preload** — Add `readFile(absolutePath)` method to `window.api`.

3. **Create file stores** — `app/src/renderer/stores/files.ts`:
   - `fileTree`: writable, initialized to null. Updated when collection changes.
   - `activeFilePath`: writable, relative path of selected file. Reset on collection switch.
   - `fileContent`: writable, raw markdown string. Updated when `activeFilePath` changes.
   - `expandedDirs`: writable `Set<string>`, persisted per-collection in a Map.
   - `fetchFileTree(root)`: calls `window.api.tree(root)`, updates `fileTree` store.
   - `selectFile(relativePath)`: sets `activeFilePath`, reads file content via IPC, updates `fileContent`.
   - `toggleDir(dirPath)`: adds/removes from `expandedDirs` set.

4. **Build FileTreeNode component** — `app/src/renderer/components/FileTreeNode.svelte`:
   - Recursive component: renders a single node.
   - If directory: chevron icon (rotates on expand), folder icon, name, click to toggle.
   - If file: document icon, name, state dot indicator, click to select.
   - Active file: apply mockup highlight styles.
   - Indentation via `padding-left` based on depth (16px per level).
   - Sort: directories first (alphabetical), then files (alphabetical).

5. **Build FileTree component** — `app/src/renderer/components/FileTree.svelte`:
   - Takes `FileTree` data as prop.
   - Renders `FileTreeNode` recursively starting from `root.children`.
   - Summary line at bottom: `"N files (M indexed, P modified, Q new)"`.
   - Refresh button: circular arrow icon, re-fetches tree.
   - Loading state: skeleton placeholder while fetching.
   - Empty state: "No markdown files found" message.

6. **Integrate into Sidebar** — When a collection is expanded/active, render `FileTree` below the collection name in the sidebar. The file tree replaces the empty space.

7. **Update Header breadcrumb** — Show full path: `Collection Name > dir > filename.md`. Parse `activeFilePath` into path segments. Each segment is a clickable span.

8. **Wire collection switching** — When `activeCollection` changes:
   - Call `fetchFileTree(collection.path)`.
   - Reset `activeFilePath` to null.
   - Restore `expandedDirs` for that collection (from Map).

9. **Handle file content loading** — Subscribe to `activeFilePath` changes:
   - Construct absolute path: `join(activeCollection.path, activeFilePath)`.
   - Call `window.api.readFile(absolutePath)`.
   - Update `fileContent` store.
   - This content will be consumed by the editor in Phase 5.

10. **Write unit tests** — `tests/unit/FileTree.test.ts`:
    - Render FileTree with mock `FileTree` data.
    - Verify correct number of nodes rendered.
    - Verify state dots have correct colors (green for indexed, yellow for modified, etc.).
    - Verify clicking a directory toggles its children visibility.
    - Verify clicking a file triggers the select callback.
    - Verify active file has the correct highlight classes.
    - Verify directories are sorted before files.

11. **Write E2E tests** — `tests/e2e/file-tree.test.ts`:
    - Open a collection with files (create temp dir with markdown files + init + ingest).
    - Verify file tree renders in sidebar.
    - Click a directory to expand it.
    - Click a file, verify breadcrumb updates.
    - Verify state indicators match file states.

## Validation Criteria

- [ ] File tree renders with correct hierarchy matching `mdvdb tree --json` output
- [ ] Indexed files show green dot, modified show yellow, new show blue, deleted show red
- [ ] Clicking a directory expands/collapses its children with chevron rotation
- [ ] Clicking a file highlights it with the mockup's active state styling
- [ ] Breadcrumb updates to show `Collection > path > filename.md`
- [ ] File content is loaded into the `fileContent` store on selection
- [ ] Summary counts are accurate ("N files, M modified")
- [ ] Refresh button re-fetches the tree from CLI
- [ ] Expand/collapse state is preserved when switching between collections
- [ ] Directories are sorted before files, both alphabetically
- [ ] Empty collection shows "No markdown files found" message
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT read all file contents eagerly** — Only read the content of the selected file. Reading all files on tree load would be slow for large collections.
- **Do NOT use absolute paths in the tree** — The tree uses relative paths (matching CLI output). Only convert to absolute when reading the file from disk.
- **Do NOT render deep trees without virtualization considerations** — For Phase 4, simple rendering is fine. Phase 12 adds virtualization for 1000+ file collections.
- **Do NOT mutate the file tree data** — The tree is read-only data from the CLI. Selection state is tracked separately in stores, not by modifying tree nodes.
- **Do NOT block the UI on tree fetching** — Use async loading with a skeleton/spinner state.

## Patterns to Follow

- **Recursive Svelte components** — Use `<svelte:self>` for recursive `FileTreeNode` rendering. Pass `depth` prop for indentation calculation.
- **Derived stores** — Use Svelte's `derived()` for computed values like "summary counts" derived from `fileTree` store.
- **Mockup reference** — The file tree styling (indentation, icons, active state, hover states) should match `docs/prds/app/app-mockup-code.html` lines 96-133 exactly.
- **Material Symbols icons** — Use `description` icon for files, `folder`/`folder_open` for directories, `chevron_right`/`expand_more` for expand toggle.
