# PRD: File Creation, Asset Discovery & Embedded Content

## Overview

Add the ability to create new markdown files directly from the app, discover and display non-markdown assets (images, PDFs, etc.) in the file tree, embed assets into markdown documents via drag-drop/clipboard/dialog, and preview non-markdown files in dedicated viewer tabs. The CLI (`mdvdb`) remains markdown-only; all asset awareness lives entirely in the Electron app layer.

## Problem Statement

Users cannot create new markdown files from within the app — they must switch to Finder or a terminal, create the file, then return and refresh the tree. The file tree only shows `.md` files (sourced from `mdvdb tree --json`), so images, PDFs, and other files referenced in markdown are invisible. There is no way to embed images or link documents from within the editor, and no way to preview non-markdown files. This forces users out of the app for basic file management and content authoring tasks.

## Goals

- Create new `.md` files and directories from the file tree UI (header button + folder context menu)
- Discover non-markdown files (images, PDFs, etc.) via app-level recursive scanning in the main process
- Display a unified file tree merging CLI-sourced markdown nodes with app-discovered asset nodes
- Insert images and file links into the editor via drag-from-tree, drag-from-OS, clipboard paste, and file picker dialog
- Support external drag-and-drop from OS: files from outside the collection are copied alongside the current markdown file with a confirmation prompt; files from inside the collection are linked directly
- Preview non-markdown files in special tabs: images rendered with zoom, PDFs with embedded viewer
- Maintain strict separation — graph/canvas remains markdown-only, assets have no index representation

## Non-Goals

- **Editing non-markdown files** — assets are preview-only, never editable in the app
- **Indexing assets in the CLI** — the Rust CLI continues to know only about `.md` files
- **Image manipulation** — no resizing, cropping, or format conversion
- **Non-markdown files in the 3D graph** — graph stays markdown-only
- **Full-text search across non-markdown files** — search remains markdown-only
- **Renaming or deleting files** — file management beyond creation is a separate phase

## Technical Design

### New IPC Channels

Add six new IPC channels to `app/src/main/ipc-handlers.ts`, all following the existing collection-boundary validation pattern from `fs:read-file` / `fs:write-file`:

| Channel | Signature | Purpose |
|---|---|---|
| `fs:create-file` | `(absolutePath: string, content: string) → void` | Create a new file on disk. Uses `fs.writeFile` with `{ flag: 'wx' }` (exclusive create — fails if exists). |
| `fs:create-directory` | `(absolutePath: string) → void` | Create a new directory. Uses `fs.mkdir` with `{ recursive: true }`. |
| `fs:scan-assets` | `(collectionPath: string) → AssetScanResult` | Recursively scan collection for non-markdown files. Returns structured tree. |
| `fs:read-binary` | `(absolutePath: string) → string` | Read a file as base64-encoded string. For images/PDFs that can't be read as UTF-8. |
| `fs:write-binary` | `(absolutePath: string, base64Data: string) → void` | Write base64 data to a file on disk. For clipboard-pasted images. |
| `fs:file-info` | `(absolutePath: string) → { size: number, mtime: string }` | Get file metadata (size, modified time). |
| `fs:copy-file` | `(sourcePath: string, destPath: string) → void` | Copy a file into the collection. Source can be outside collection (for external drag-and-drop import). Destination must be within a collection. |
| `fs:is-within-collection` | `(absolutePath: string) → { within: boolean, collectionPath?: string }` | Check if a path is inside any known collection. Used by the renderer to decide copy-vs-link for drag-and-drop. |

All channels validate that the destination path is within a known collection before proceeding. The validation logic is identical to the existing `fs:read-file` handler (lines 469–481 of `ipc-handlers.ts`).

### Data Model

**New types in `app/src/renderer/types/cli.ts`** (these are app-only types, NOT mirroring Rust structs):

```typescript
/** Mime category for display purposes. */
export type MimeCategory = 'image' | 'pdf' | 'video' | 'audio' | 'other'

/** A non-markdown asset file discovered by the app scanner. */
export interface AssetFileNode {
  name: string
  path: string           // relative to collection root
  is_dir: boolean
  children: AssetFileNode[]
  fileSize?: number      // bytes, files only
  mimeCategory?: MimeCategory
}

/** Result of app-level asset scanning. */
export interface AssetScanResult {
  root: AssetFileNode
  totalAssets: number
  scanDurationMs: number
}

/** Unified tree node combining CLI markdown nodes and app asset nodes. */
export interface UnifiedTreeNode {
  name: string
  path: string
  is_dir: boolean
  children: UnifiedTreeNode[]
  state: FileState | null   // present for markdown files from CLI tree
  isAsset: boolean          // true for non-markdown files
  mimeCategory?: MimeCategory
  fileSize?: number
}
```

**New tab type in `app/src/renderer/stores/workspace.svelte.ts`:**

```typescript
export interface AssetTab {
  id: string
  kind: 'asset'
  filePath: string        // relative to collection root
  title: string
  mimeCategory: MimeCategory
  fileSize?: number
}

// Extend TabState union:
export type TabState = DocumentTab | GraphTab | AssetTab
```

### Asset Scanner (Main Process)

New module: `app/src/main/asset-scanner.ts`

A recursive async file scanner that:
1. Walks the collection directory using `fs.readdir` with `{ withFileTypes: true }`
2. Respects `.gitignore` at collection root (parse with the `ignore` npm package or a lightweight gitignore parser)
3. Always skips: `.markdownvdb/`, `.git/`, `node_modules/`, and common build output dirs (`dist/`, `build/`, `out/`, `.next/`, `target/`)
4. Skips `.md` and `.markdown` files (those come from the CLI tree)
5. Includes files matching these extensions: `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf`, `mp4`, `mp3`, `wav`, `ogg`
6. Assigns `mimeCategory` based on extension
7. Builds a tree structure of `AssetFileNode` objects matching directory hierarchy
8. Returns `AssetScanResult` with total count and scan duration
9. Caps depth at 10 levels and total files at 10,000 (logs warning if cap hit)
10. Uses async `fs.readdir` per-directory to avoid blocking the main process event loop

### Tree Merging (Renderer)

New module: `app/src/renderer/lib/tree-merge.ts`

A pure function `mergeTreeNodes(cliTree: FileTree, assetScan: AssetScanResult): UnifiedTreeNode` that:
1. Converts CLI `FileTreeNode` children to `UnifiedTreeNode` (with `isAsset: false`)
2. Converts `AssetFileNode` children to `UnifiedTreeNode` (with `isAsset: true`, `state: null`)
3. Merges directories that exist in both trees (e.g., if both have `docs/`, their children combine)
4. Sorts: directories first (alphabetical), then markdown files (alphabetical), then asset files (alphabetical)
5. Returns a single `UnifiedTreeNode` root

Called in `stores/files.ts` as a derived store: `unifiedTree` recomputes whenever `fileTree` or `assetTree` changes.

### File Creation Flow

```
User clicks "New File" button in tree header (or right-clicks folder → "New File")
  → Inline text input appears at the target location in the tree
  → User types filename, presses Enter
  → Auto-append .md if no extension provided
  → window.api.createFile(absolutePath, initialContent)
  → IPC → fs.writeFile(path, content, { flag: 'wx' })
  → Success: loadFileTree() to refresh, selectFile(relativePath) to open in editor
  → Failure (file exists): show error toast
```

Initial content: empty string by default. If the user triggers "New File with Frontmatter" (context menu variant), use:
```yaml
---
title: <filename without extension>
---

```

### Asset Preview Routing

When clicking a non-markdown file in the tree:
1. `FileTree.svelte` checks `node.isAsset` — if true, calls `openAssetTab(path, mimeCategory)` instead of `selectFile(path)`
2. `openAssetTab()` creates an `AssetTab` and adds it to the active pane
3. Tab content routing: when `tab.kind === 'asset'`, render the appropriate viewer:
   - `mimeCategory === 'image'` → `ImageViewer.svelte`
   - `mimeCategory === 'pdf'` → `PdfViewer.svelte`
   - All others → `AssetInfoCard.svelte`

### Image Viewer

New component: `ImageViewer.svelte`
- Loads image via `window.api.readBinary(absolutePath)` → base64 data URL
- Centered in content area with dark background
- Zoom: scroll wheel (0.1x–10x range), "Fit to View" button, "Actual Size" button
- Info bar at bottom: filename, dimensions (from `naturalWidth`/`naturalHeight`), file size

### PDF Viewer

New component: `PdfViewer.svelte`
- Uses `pdfjs-dist` (Mozilla pdf.js) as a new dependency
- Loads PDF via `readBinary()`, passes `Uint8Array` to `pdfjsLib.getDocument()`
- Renders pages into canvas elements in a scrollable container
- Controls: page navigation, zoom, scroll through pages
- Set `pdfjs-dist` worker source path correctly for Electron's packaged environment

### Asset Info Card (Fallback)

New component: `AssetInfoCard.svelte`
- Large file type icon (Material Symbol based on mime category)
- File name, size (human-readable), file type/extension, full path
- "Open in Default App" button → `window.api.openPath()`
- "Copy Markdown Reference" button → copies `[name](relative-path)` to clipboard

### Editor Drag-and-Drop

Drag-and-drop supports two sources: **internal** (from the app's file tree) and **external** (from the OS / Finder / Explorer).

#### Internal Drag (from file tree)

**WYSIWYG (TipTap)** — `WysiwygEditor.svelte`:
- Add `ondrop` / `ondragover` handlers on the editor host element
- Read `application/x-mdvdb-path` from `dataTransfer` (already set by `FileTreeNode.svelte` drag start)
- Determine file type from extension
- Compute relative path from current document's directory to dropped file
- Images: `editor.chain().focus().setImage({ src: relativePath, alt: filename }).run()`
- Non-images: insert `[filename](relativePath)` text at cursor

**Source (CodeMirror)** — `Editor.svelte`:
- Add drop handler that inserts raw markdown at the drop position
- Images: `![filename](relativePath)`
- Non-images: `[filename](relativePath)`

#### External Drag (from OS)

When a file is dragged from the OS (Finder, Explorer, desktop) onto the editor:

1. The drop handler checks `event.dataTransfer.files` for native file drops (no `application/x-mdvdb-path` will be set)
2. For each dropped file, read the absolute path from the `File` object's `.path` property (Electron exposes this)
3. Call `window.api.isWithinCollection(absolutePath)` to determine if the file is already inside the active collection

**File is inside the collection:**
- Compute relative path from current document to the dropped file
- Insert markdown link/image syntax directly (no copy needed)

**File is outside the collection:**
- Show a confirmation dialog: "This file is outside your collection. Copy it to `<current-document-folder>/filename`?"
- On confirm: call `window.api.copyFile(sourcePath, destPath)` where `destPath` is alongside the current markdown file (same directory)
- If a file with the same name already exists at the destination, auto-suffix: `image.png` → `image-1.png`
- Insert markdown link/image syntax using the relative path to the copy
- Trigger asset tree refresh to show the newly copied file
- On cancel: do nothing

**Why alongside the current markdown file:** Assets are stored in regular folders — wherever makes sense in the filesystem. Copying alongside the current file keeps assets co-located with the content that references them, which is the most natural and portable layout. Users can later reorganize if they prefer a different structure.

#### Supported file types for external drag

Only files with recognized asset extensions are accepted: `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf`, `mp4`, `mp3`, `wav`, `ogg`. Other file types are ignored with a brief toast: "Unsupported file type".

### Clipboard Paste (Images)

In `WysiwygEditor.svelte`, intercept paste events with image blobs:
1. Check `event.clipboardData.items` for image MIME types
2. Read blob as base64 via `FileReader`
3. Generate filename: `pasted-{Date.now()}.png`
4. Save alongside the current markdown file via `window.api.writeBinary(sameDirPath + filename, base64Data)` — the pasted image lands in the same directory as the document that references it
5. Insert `![](pasted-{timestamp}.png)` into editor (relative to current file)
6. Trigger asset tree refresh

No special `assets/` directory — pasted images go next to the markdown file, keeping assets co-located with content.

### Insert Asset Dialog

New component: `InsertAssetDialog.svelte`
- Triggered from editor toolbar button or TipTap slash command (`/image`, `/file`)
- Searchable list of images/files from the cached asset scan
- Thumbnail previews for images (loaded via `readBinary`)
- On selection: inserts markdown syntax at cursor position
- "Browse..." button to open OS file picker scoped to collection

### WYSIWYG Inline Image Resolution

For relative-path images (`![](images/photo.png)`) to render in WYSIWYG mode:
- Add custom node view or `parseHTML` override for TipTap's Image extension
- Detect relative `src` values (not starting with `http`, `data:`, or `/`)
- Resolve against current document's directory + collection root
- Load via `window.api.readBinary()` and convert to `data:image/...;base64,...` for display
- Cache resolved data URLs to avoid redundant IPC calls

## Implementation Steps

### Track A: File Creation (Steps 1–2)

**Step 1: IPC channels — `fs:create-file` and `fs:create-directory`**

Files: `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts`

Add two new `ipcMain.handle()` registrations following the `fs:write-file` pattern. `fs:create-file` uses `{ flag: 'wx' }` for exclusive create. `fs:create-directory` uses `{ recursive: true }`.

**Step 2: File creation UI — button, context menu, inline input**

Files: `FileTree.svelte`, `stores/files.ts`

Add "New File" icon button (`note_add` Material Symbol) in tree header. Add "New File" and "New Folder" items to folder context menu. Implement inline text input at target tree position (renders as a `<input>` inside the virtual list at the appropriate position). On Enter: validate name, call `window.api.createFile()`, refresh tree, open tab.

### Track B: Asset Discovery + Tree (Steps 3–6)

**Step 3: Asset scanner main process module**

New file: `app/src/main/asset-scanner.ts`
Files: `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts`

Implement recursive scanner. Register `fs:scan-assets` and `fs:file-info` IPC handlers.

**Step 4: Unified tree types and merge logic**

New file: `app/src/renderer/lib/tree-merge.ts`
Files: `types/cli.ts`, `stores/files.ts`

Add `AssetFileNode`, `AssetScanResult`, `UnifiedTreeNode`, `MimeCategory` types. Implement `mergeTreeNodes()`. Add `assetTree` writable store, `unifiedTree` derived store, `showAssets` toggle store, `loadAssetTree()` action.

**Step 5: File tree displays unified tree with asset nodes**

Files: `FileTree.svelte`, `FileTreeNode.svelte`

Switch from `fileTree` to `unifiedTree` store. Add toggle button for showing/hiding assets. Asset nodes get Material Symbol icons by mime category: `image` (images), `picture_as_pdf` (PDF), `videocam` (video), `audiotrack` (audio), `attach_file` (other). Asset nodes have no state indicators. `buildFlatNodeList()` works with `UnifiedTreeNode` with minimal changes.

**Step 6: Asset context menu**

Files: `FileTree.svelte`

Extend context menu: when target node has `isAsset: true`, show asset-specific items (reveal in finder, copy path, copy relative path, copy markdown reference). Hide markdown-specific items (reindex, show in graph, favorites).

### Track C: Preview Tabs (Steps 7–11)

**Step 7: AssetTab type and workspace integration**

Files: `stores/workspace.svelte.ts`, `preload/api.d.ts`

Add `AssetTab` interface, extend `TabState` union, add `openAssetTab()` method. Update `PersistedTab` for session persistence. Route asset file clicks through `openAssetTab()` instead of `selectFile()`.

**Step 8: ImageViewer + `fs:read-binary`**

New file: `app/src/renderer/components/ImageViewer.svelte`
Files: `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts`

Add `fs:read-binary` IPC handler (reads file, returns base64 string). Build ImageViewer: loads image as base64 data URL, centers in content area, scroll-wheel zoom (0.1x–10x), fit-to-view / actual-size buttons, info bar.

**Step 9: PdfViewer**

New file: `app/src/renderer/components/PdfViewer.svelte`
Dependency: `pdfjs-dist`

Loads PDF via `readBinary()`, renders pages into canvases. Page navigation, zoom controls, scrollable container. Must configure worker source path for Electron packaging.

**Step 10: AssetInfoCard (fallback)**

New file: `app/src/renderer/components/AssetInfoCard.svelte`

File info display for unsupported types. Large icon, name, size, type, path, "Open in Default App" button, "Copy Markdown Reference" button.

**Step 11: Tab content routing**

Files: The component that renders tab content (e.g., `SplitPaneContainer.svelte` or content router)

Add branch for `tab.kind === 'asset'`: route to `ImageViewer`, `PdfViewer`, or `AssetInfoCard` based on `tab.mimeCategory`.

### Track D: Editor Integration (Steps 12–15)

**Step 12: Drag-and-drop — internal (tree) and external (OS)**

Files: `WysiwygEditor.svelte`, `Editor.svelte`, `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts`

Add `fs:copy-file` and `fs:is-within-collection` IPC handlers. Add drop handlers to both editors that handle two cases: (a) internal tree drag via `application/x-mdvdb-path` — compute relative path, insert markdown; (b) external OS drag via `dataTransfer.files` — check if within collection, if outside show confirmation dialog then copy alongside current file, insert markdown link.

**Step 13: Clipboard paste images alongside current file**

Files: `WysiwygEditor.svelte`, `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts`

Add `fs:write-binary` IPC handler. Intercept paste events with image blobs. Save alongside the current markdown file (same directory), insert relative markdown reference, refresh asset tree.

**Step 14: Insert Asset Dialog**

New file: `app/src/renderer/components/InsertAssetDialog.svelte`

Modal with searchable list from asset cache, thumbnail previews, file picker. Triggered from toolbar or slash command.

**Step 15: WYSIWYG inline image resolution**

Files: `WysiwygEditor.svelte` or `lib/tiptap/editor-factory.ts`

Custom node view for TipTap Image extension: resolve relative `src` to base64 data URL via `readBinary()`. Cache resolved URLs.

## Dependency Graph

```
Track A: Step 1 → Step 2
Track B: Step 3 → Step 4 → Step 5 → Step 6
Track C: Step 7 → Step 8 → Step 9 → Step 10 → Step 11
Track D: Step 12 → Step 13 → Step 14 → Step 15

A and B can be built in parallel.
C depends on B (Step 7 needs UnifiedTreeNode + asset click routing from Step 5).
D depends on B and C (Step 12 needs asset nodes in tree from Step 5, Step 15 needs readBinary from Step 8).
```

## Validation Criteria

- [ ] Clicking "New File" button in tree header creates a `.md` file at collection root, opens it in editor
- [ ] Right-clicking a folder shows "New File" and "New Folder" options that work correctly
- [ ] Auto-appends `.md` extension when user omits it
- [ ] Cannot create file outside collection boundary (security validation)
- [ ] Cannot overwrite existing file (exclusive create flag — shows error)
- [ ] New folder creation works, including nested paths
- [ ] Asset scanner finds images and PDFs in deep subfolders (up to depth 10)
- [ ] Asset scanner respects `.gitignore` patterns
- [ ] Asset scanner skips `.markdownvdb/`, `.git/`, `node_modules/`
- [ ] Unified tree displays markdown files with state indicators alongside asset files with type icons
- [ ] Asset toggle button hides/shows non-markdown files in tree
- [ ] Sort order: directories first, then markdown files, then assets (all alphabetical)
- [ ] Clicking an image in tree opens ImageViewer tab (not editor)
- [ ] Clicking a PDF in tree opens PdfViewer tab (not editor)
- [ ] Clicking other asset types opens AssetInfoCard
- [ ] Image viewer supports zoom in/out (scroll wheel) and fit-to-view / actual-size buttons
- [ ] PDF viewer renders pages and supports page navigation and zoom
- [ ] Dragging image from tree into WYSIWYG editor inserts `![](relative-path)` and renders inline
- [ ] Dragging image from tree into CodeMirror editor inserts `![](relative-path)` at drop position
- [ ] Dragging non-image file inserts `[filename](relative-path)` link syntax
- [ ] Dragging a file from OS (Finder/Explorer) that is inside the collection inserts a link (no copy)
- [ ] Dragging a file from OS that is outside the collection shows confirmation dialog, copies alongside current file, inserts link
- [ ] External drag with duplicate filename auto-suffixes (`image.png` → `image-1.png`)
- [ ] External drag of unsupported file type shows "Unsupported file type" toast
- [ ] Pasting image from clipboard saves alongside current markdown file and inserts reference
- [ ] Insert Asset Dialog shows searchable list of collection assets with thumbnails
- [ ] WYSIWYG mode renders relative-path images inline (resolved to data URLs)
- [ ] Asset files have no representation in the 3D graph/canvas
- [ ] Asset context menu shows "Copy Markdown Reference" but NOT "Reindex", "Show in Graph", or "Favorites"
- [ ] Asset tabs persist across session save/restore
- [ ] Performance: asset scan completes in under 2 seconds for collections with 5,000+ files
- [ ] All new IPC channels validate paths against collection boundaries

## Anti-Patterns to Avoid

- **Don't modify the Rust CLI or its types** — Asset awareness is app-only. The `FileTree` / `FileTreeNode` types in `types/cli.ts` that mirror Rust structs must not be changed.
- **Don't use `file://` protocol for images in the renderer** — Electron's CSP blocks this. Use base64 data URLs loaded through the IPC bridge.
- **Don't scan assets synchronously in the main process** — Use async `fs.readdir` to avoid blocking the event loop.
- **Don't merge trees in the main process** — Send the CLI tree and asset tree separately to the renderer. Merge in the renderer to keep the main process simple.
- **Don't pollute the existing `flatFileList` derived store** — That store is used for markdown-specific search and navigation. Create separate derived stores for asset lists if needed.
- **Don't use `fs.watch` for asset change detection** — Reuse the existing watcher infrastructure. Extend its event handling to trigger asset rescans when non-markdown files change.
- **Don't embed pdf.js as a global script** — Import `pdfjs-dist` as an ES module and set the worker source path for Electron's packaged environment.
- **Don't create files with `fs.writeFile` without the `wx` flag** — Exclusive create prevents silent overwrites of existing files.
- **Don't force a special `assets/` directory** — Assets live wherever they naturally are in the filesystem. Pasted images and externally-dragged files are saved alongside the current markdown file (same directory). Users organize their own folder structure.

## Patterns to Follow

- **IPC handler pattern**: Follow `fs:read-file` / `fs:write-file` in `ipc-handlers.ts` — validate collection boundary via `getCollections()`, use `wrapHandler`, use `resolve()` for path normalization.
- **Preload API pattern**: Follow the `invoke()` wrapper pattern in `preload/index.ts` — each new method calls `invoke(channel, ...args)`.
- **Store action pattern**: Follow `loadFileTree()` in `stores/files.ts` — set loading state, try/catch the API call, set error state, finally clear loading.
- **Tab creation pattern**: Follow `createDocumentTab()` in `stores/workspace.svelte.ts` — factory function returns a typed tab with `crypto.randomUUID()` for ID.
- **Context menu pattern**: Follow the existing context menu in `FileTree.svelte` — overlay + positioned div with conditional items based on node type.
- **Drag data transfer**: Follow `handleDragStart` in `FileTreeNode.svelte` — set both `text/plain` and `application/x-mdvdb-path` data on dragstart.
- **Component structure**: Follow existing patterns — script block with `Props` interface, `$props()` / `$state()` runes, then template, then scoped styles using `tokens.css` custom properties.
