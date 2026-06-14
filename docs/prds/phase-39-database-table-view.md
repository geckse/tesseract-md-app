# PRD: Database Table View (Editable Frontmatter Grid)

## Overview

Add a NocoDB/Airtable/Notion-style **database table view** to Tesseract. Clicking a folder in the sidebar can open a rich, editable **table tab** where rows are the Markdown documents in that folder and columns are their YAML frontmatter fields. A dedicated **Title** column shows each document's derived title with a pop-out icon that opens the doc in a normal editor tab.

The table is read through a new **read-only** mdvdb CLI command (`mdvdb collection`, designed in the CLI PRD `docs/prds/phase-29-collection-folder-table.md` of the `markdown-vdb` repo) and rendered by a **custom Svelte 5 virtualized grid** (no data-grid dependency). Cells are inline-editable per `FieldType`. Edits write **directly back into the file's YAML frontmatter** — performed by the Electron **main** process via a new IPC handler that does a safe read-modify-write using a real YAML library, then triggers a single-file re-index so search/schema stay consistent. The Rust CLI/index remains strictly read-only and never writes Markdown.

V1 ships click-to-sort, per-column filtering, show/hide + reorder + resize columns, group-by a field with collapsible group headers, **saved named views per folder**, and add/delete row.

This PRD consumes the **canonical JSON contract** defined by the CLI PRD; the contract is reproduced below and the app's `types/cli.ts` must mirror it exactly. The CLI ships first; this feature is gated on the CLI version that provides `collection`.

## Problem Statement

Tesseract today is a file-tree + editor + graph over `mdvdb`. Frontmatter is only *viewable* per-file in the read-only `PropertiesPanel` (`src/renderer/components/PropertiesPanel.svelte`), and the per-file editing UI from phase-32 (`DocumentHeader` + `PropertyRow` + pickers) edits one document at a time. There is no way to see all documents in a folder *at once* as structured records, compare or sort by a field, bulk-scan status across a project, or edit a field across many files quickly.

Knowledge bases organized as "one folder = one collection of like records" (tasks, contacts, papers, CRM-style notes) are exactly the use case relational/no-code DB tools nail. Bringing a spreadsheet-grade table over Markdown frontmatter — *editable, with the file system as the source of truth* — turns Tesseract from "editor with search" into "structured database over your notes" without giving up plain-text portability.

## Canonical CLI contract (consumed verbatim)

`mdvdb collection <PATH> --json` (CLI PRD phase-29) returns:

```jsonc
{
  "scope": "blog/",
  "recursive": false,
  "columns": [
    {
      "name": "status",             // NOT "key"
      "field_type": "String",       // PascalCase: String|Number|Boolean|List|Date|Mixed
      "description": "Publication status", // string | null
      "occurrence_count": 12,
      "sample_values": ["draft","published"],
      "allowed_values": ["draft","published"], // string[] | null (usually null)
      "required": true,
      "in_schema": true             // false = key found only in a row's frontmatter
    }
  ],
  "rows": [
    {
      "path": "blog/launch.md",
      "title": "Launch Announcement",
      "title_source": "frontmatter", // "frontmatter" | "filename"
      "frontmatter": { "status": "published", "tags": ["news"] }, // ALWAYS object, {} never null
      "content_hash": "abc123…",    // string | null (null for state:"new")
      "file_size": 2048,
      "modified_at": 1718000000,    // number | null
      "indexed_at": 1718000000,     // number | null (null for state:"new")
      "state": "indexed"            // "indexed"|"modified"|"new"|"deleted"
    }
  ],
  "total_rows": 37,                 // post-filter, pre-limit/offset (NOT "total")
  "limit": 50,                      // number | omitted
  "offset": 0
}
```

The app mirrors these field names exactly (`name`, `total_rows`, `description`, `in_schema`, `title_source`, `content_hash`, `indexed_at`) in `types/cli.ts`. Title is derived **server-side** — the app consumes `row.title`/`row.title_source` and does **not** re-derive it (single source of truth).

## Goals

- Open a folder as an editable table tab: rows = `.md` files in the folder, columns = frontmatter fields.
- Row scope toggle: **direct children only** (default) vs **recursive** (include nested subfolders).
- A Title column with the server-derived title and a pop-out icon that opens the doc via the existing `workspace.openFile` path.
- Inline editing per `FieldType` (String/Number/Boolean/List/Date/Mixed) with a type-appropriate editor, **reusing the phase-32 cell editors** where possible.
- **Safe** frontmatter write-back in the main process (real YAML lib, body byte-preserved, atomic write), followed by single-file re-index.
- Click-to-sort, per-column filter, show/hide + drag-reorder + resize columns, group-by with collapsible headers.
- **Saved named views per folder**, persisted via `electron-store`, keyed by `collectionId` + folder path, with a `version` field + load-time migration.
- Add row (create a new `.md` pre-filled with the folder's schema fields) and delete row (trash the `.md`, with confirm).
- Virtualized rendering for large folders; smooth at thousands of rows.
- Multi-window consistency via the existing `file:saved-externally` broadcast.
- Fully keyboard-navigable and accessible; respects `prefers-reduced-motion`; dark + light theme via `tokens.css`.

## Non-Goals

- **No relational features** — no cross-table relations, lookups, rollups, or formulas. Each column maps 1:1 to a single frontmatter key.
- **No schema editing from the grid** — you cannot rename/retype a column definition from the table in V1 (you can set a value on an existing column for a row, and editing a blank cell adds that key to one file). New column *definitions* arrive by editing files or via "add row".
- **No body/markdown editing in cells** — cells edit frontmatter only. The body is opened via the Title pop-out.
- **No bulk multi-row edit / fill-down** in V1 (single-cell edits only). Deferred.
- **No CLI writes** — mdvdb stays read-only; all writes happen in the Electron main process.
- **No CSV/Airtable import-export** in V1. Deferred.
- **No cell-level conflict merge UI** — concurrent external edits reload the file and re-render (last-write-wins at file granularity, mirroring the existing editor behavior).

## Build order (within this PRD)

To de-risk the user-file-mutating surface, implement in two slices:

- **39a — read-only table:** tab kind + triggers, `cli:collection` IPC + types, virtualized grid, Title pop-out, sort/filter/columns/group, saved views. No writes. This validates the whole CLI contract before touching files.
- **39b — editing/writes (isolated):** `fs:update-frontmatter` writer (eemeli `yaml`, main process), per-`FieldType` cell editors, optimistic UI + post-write re-index + refetch, add/delete row. Heaviest test coverage. A write bug cannot ship coupled to the read-only view.

(Optional **39c**, deferred: multi-sort, server-paging mode for huge folders, CSV.)

## User Experience

### Trigger: opening a folder as a table

Folders in the tree currently **expand/collapse** on click (`FileTreeNode.svelte:69`, `handleClick` → `toggleExpanded`). We must not break that. New affordances:

1. **Hover affordance** — on a directory row in `FileTreeNode.svelte`, a small trailing `table`/`grid_on` Material Symbol icon button. Clicking it opens the table tab; it does **not** toggle expansion (`event.stopPropagation()`).
2. **Context menu item** — add **"Open as Table"** to the directory branch of the file-tree context menu in `FileTree.svelte` (the `{#if contextMenuIsDir}` block ~`:707`). The discoverable, always-available entry point.
3. **Double-click a folder row** opens it as a table (single-click keeps expand/collapse), gated by a setting (default on).

All three call one new sidebar handler that dispatches to the workspace store. The clicked folder's relative path becomes the table's `folderPath` (root is sent as `.`, never `""`, to match the CLI's root sentinel).

### The table tab

- Opens as a new tab kind (`'table'`) in the active pane, inserted before the pinned graph tab exactly like document/asset/terminal tabs. Tab title = folder name (e.g. `projects`), with a `table` icon in the tab bar.
- Movable between panes, detachable to a popup window, closable with `Cmd/Ctrl+W`, restored on relaunch (folder path + recursive + active view id persisted).

### Anatomy

```
┌ Table toolbar ───────────────────────────────────────────────┐
│ [folder ▸ projects]  [Recursive ▢]  [View: "Active" ▾]        │
│ [+ Add row]  [Group by ▾]  [Columns ▾]  [⟳]   42 rows          │
├───────────────────────────────────────────────────────────────┤
│ ⠿ Title            │ status   │ tags        │ due        │ ⋯   │  ← header (sortable/resizable/draggable)
├───────────────────────────────────────────────────────────────┤
│ Project Alpha  ⤢   │ [draft▾] │ [a][b] +    │ 2026-01-01 │     │  ← row (virtualized)
│ Project Beta   ⤢   │ [done▾]  │ [x]   +     │ —          │     │
└───────────────────────────────────────────────────────────────┘
```

- **Title column** (pinned-left, not removable): server-derived title text + a pop-out `open_in_new` icon. Clicking the text selects the row; clicking the pop-out opens the doc in an editor tab. Dim styling when `title_source === 'filename'`.
- **Toolbar**: folder breadcrumb, Recursive toggle, View selector (saved views), Add row, Group by, Columns (show/hide + reorder), refresh, live row count (`aria-live="polite"`).
- **Header**: click cycles sort `none → asc → desc`; drag to reorder; drag the right edge to resize; a kebab (`⋯`) per column for hide/sort/filter.
- **Filter row** (toggleable under the header): one filter control per visible column, typed by `FieldType`.
- **Group-by**: collapsible group headers showing the group value and count.

### Cell editing UX (39b)

- Single click selects a cell; `Enter` or double-click enters edit mode; `Escape` cancels; `Tab`/`Shift+Tab` and arrow keys move between cells. Editing inside a cell suppresses global shortcuts except `Cmd/Ctrl+S` and `Escape` (per `CLAUDE.md` keyboard rules).
- On commit, the cell shows an **optimistic** value with a subtle "saving" pulse; on success the pulse clears; on failure it reverts and shows an inline error with retry (per the app's "never silent failure" rule).
- **`deleted`-state rows are read-only** (editing would write to a missing file): cells show but do not enter edit mode; a tooltip explains the file is gone.

### Empty / degenerate states

- Empty folder → friendly empty state ("No markdown files in this folder") with an **Add row** button.
- Folder where no doc has frontmatter → table shows only the **Title** column plus an "Add a property by editing a file or adding a row" hint; user can still add rows.
- Files present on disk but not yet indexed (`state: "new"`) → row shown with a "new" badge (reuse `state-new` styling from `FileTreeNode.svelte:272`); its `frontmatter` is read **live from disk** (see §Data) so it's still editable even though the CLI returns `{}` for it.

## Architecture

### New tab kind in the workspace store

Extend the discriminated union in `src/renderer/stores/workspace.svelte.ts` exactly as the existing kinds are defined (`DocumentTab`/`GraphTab`/`AssetTab`/`TerminalTab` at lines 44–96):

```ts
/** A table tab — editable frontmatter grid over a folder. */
export interface TableTab {
  id: string
  kind: 'table'
  folderPath: string            // relative to collection root; '' = root (sent to CLI as '.')
  title: string                 // folder name (or 'Root')
  recursive: boolean            // include nested subfolders
  activeViewId: string | null   // id of the saved view applied (null = ad-hoc/default)
  /** Ephemeral, unsaved table state (overlaid on top of the active saved view). */
  ephemeral: TableViewConfig | null
}

export type TabState = DocumentTab | GraphTab | AssetTab | TerminalTab | TableTab
```

`TableViewConfig` (shared shape, also persisted for saved views). Column identity uses the CLI's `name` (the Title column uses the sentinel `'__title__'`):

```ts
export interface TableSort { columnName: string; direction: 'asc' | 'desc' }
export interface TableColumnLayout {
  name: string           // frontmatter key (== CLI column.name), or '__title__' for Title
  hidden: boolean
  width: number          // px
  order: number          // display order
}
export interface TableColumnFilter {
  columnName: string
  // 'equals' maps to CLI --filter (server-side); the rest are client-side in v1
  op: 'equals' | 'in' | 'range' | 'exists' | 'contains'
  value?: JsonValue
  values?: JsonValue[]
  min?: JsonValue
  max?: JsonValue
}
export interface TableViewConfig {
  sort: TableSort[]
  filters: TableColumnFilter[]
  columns: TableColumnLayout[]
  groupBy: string | null      // column name, or null
  collapsedGroups: string[]   // group values currently collapsed
}
```

New store mutations mirroring the existing `openTerminalTab`/`openAssetTab` pattern (insert-before-graph, set active, `_scheduleSave()`):

- `openTableTab(folderPath, opts?: { recursive?: boolean; paneId?: string }): string` — if a table tab for the same `folderPath` already exists in the pane, switch to it (mirrors `openAssetTab`'s dedupe at `workspace.svelte.ts:530`).
- `setTableRecursive(tabId, recursive)`, `setTableActiveView(tabId, viewId)`, `setTableEphemeral(tabId, patch)`.

**Session persistence** (`serializeSession` at `workspace.svelte.ts:1167`, `restoreSession` at `:1222`): add a `'table'` branch persisting `{ kind: 'table', filePath: folderPath, recursive, activeViewId }`. Extend `PersistedTab` in `src/main/store.ts:39` and `src/preload/api.d.ts:85` to allow `kind: 'table'` plus `recursive?: boolean` and `tableViewId?: string`, and the electron-store schema enum at `store.ts:221`. On restore, validate the folder still exists (reuse the `fileInfo`/`getActiveCollection` pattern at `:1303`); silently skip if gone.

### TabPane render branch

Add a branch in `src/renderer/components/TabPane.svelte` alongside the existing `{:else if tabKind === 'terminal'}` block (`:159`):

```svelte
{:else if tabKind === 'table'}
  {@const tableTab = activeTab?.kind === 'table' ? activeTab : null}
  {#if tableTab}
    <div class="content-region" role="main" aria-label="Table view">
      <TableView tabId={tableTab.id} />
    </div>
  {/if}
```

`TableView` is lazy-imported (dynamic `import()`) to keep it out of the base renderer bundle (per the app's "lazy-load heavy components" rule).

### Trigger wiring (sidebar → workspace)

`FileTree.svelte` already exposes folder interactions via `handleFolderClick` (`:519`) and a directory context menu. Add:

- A new prop callback `onfolderopen?: (detail: { path: string }) => void` threaded from `Sidebar.svelte` (alongside the existing `onfileselect`) down through `FileTree.svelte` → `FileTreeNode.svelte`.
- In `Sidebar.svelte`, `onfolderopen` calls `workspace.openTableTab(detail.path)` then `syncFileStoresFromTab()` (matching the `onfileselect` flow at `Sidebar.svelte:248`).
- In `FileTreeNode.svelte`, the trailing table-icon button (dir rows only) and a `dblclick` handler that calls `onfolderopen`; `event.stopPropagation()` so expansion is unaffected. In `FileTree.svelte`, the **"Open as Table"** context-menu item in the `{#if contextMenuIsDir}` block.

### Data flow: the `collection` CLI command

New CLI bridge channel `cli:collection`, mirroring the `cli:schema`/`cli:tree` handlers in `src/main/ipc-handlers.ts`. **Note the corrected arg grammar** — `--sort` and `--order` are **separate** flags, and `--filter` is **repeatable** (push once per entry); do NOT copy the single-`--filter`/combined-sort shape:

```ts
// ipc-handlers.ts
ipcMain.handle('cli:collection', (_event, root: string, folderPath: string,
    options?: { recursive?: boolean; sort?: string; order?: 'asc' | 'desc';
                filter?: string[]; limit?: number; offset?: number }) => {
  const args: string[] = [folderPath || '.']          // root sentinel '.'
  if (options?.recursive) args.push('--recursive')
  if (options?.sort) args.push('--sort', options.sort)             // field name only
  if (options?.order) args.push('--order', options.order)          // separate flag
  for (const f of options?.filter ?? []) args.push('--filter', f)  // repeatable: KEY=VALUE each
  if (options?.limit != null) args.push('--limit', String(options.limit))
  if (options?.offset != null) args.push('--offset', String(options.offset))
  return wrapHandler(() => execCommand<CollectionOutput>('collection', args, root))
})
```

Preload method in `src/preload/index.ts` (mirrors `tree`/`schema`) and `MdvdbApi` signature in `src/preload/api.d.ts` with the same `options` shape (`sort`/`order`/`filter: string[]`).

New TypeScript types mirrored into `src/renderer/types/cli.ts`, **matching the canonical contract exactly** (`name` not `key`, `total_rows` not `total`, include `description`/`in_schema`/`title_source`/`content_hash`/`indexed_at`; `frontmatter` is a non-null object):

```ts
export interface CollectionColumn {
  name: string                   // == frontmatter key
  field_type: FieldType          // existing union, types/cli.ts:151 (PascalCase)
  description: string | null
  occurrence_count: number
  sample_values: string[]
  allowed_values: string[] | null
  required: boolean
  in_schema: boolean
}
export type TitleSource = 'frontmatter' | 'filename'
export interface CollectionRow {
  path: string
  title: string
  title_source: TitleSource
  frontmatter: Record<string, JsonValue>   // always an object ({} never null)
  content_hash: string | null              // null for state:'new'
  file_size: number
  modified_at: number | null
  indexed_at: number | null                // null for state:'new'
  state: FileState                          // existing union, types/cli.ts:275
}
export interface CollectionOutput {
  scope: string
  recursive: boolean
  columns: CollectionColumn[]
  rows: CollectionRow[]
  total_rows: number
  limit?: number
  offset: number
}
```

**Graceful degradation / version gate:** feature-gate the table on `cli:version` (the app already calls `getCliVersion`). If the CLI is older than the version that ships `collection`, show "Table view requires mdvdb ≥ X" instead of parsing absent fields. Within a compatible CLI, still defensively default: missing `state` → `'indexed'`, missing `total_rows` → `rows.length`, but rely on the contract for the rest.

### New renderer store: `table.svelte.ts`

`src/renderer/stores/table.svelte.ts` (Svelte 5 runes class singleton, same pattern as `workspace.svelte.ts`/`terminal.svelte.ts`):

- Holds per-tab loaded data keyed by tab id: `Record<tabId, { loading, error, data: CollectionOutput | null, lastLoadedAt }>`.
- `load(tabId)` — reads the tab's `folderPath`/`recursive`, calls `window.api.collection(collection.path, folderPath, { recursive, sort, order, filter })`, stores result. Debounced + deduped per the app's "never fire duplicate concurrent CLI calls" rule.
- `mergedConfig(tabId)` — composes the **effective** `TableViewConfig` = active saved view (from views store) overlaid with the tab's `ephemeral`. `recursive` precedence: tab ephemeral/tab field > active saved view's `recursive` > default `false`.
- `derivedRows(tabId)` — applies client-side sort/filter/group on the loaded rows when not delegated to the CLI (see §Features).
- For `state: 'new'` rows whose `frontmatter` is `{}` from the CLI, lazily fetch live content via `window.api.readFile` and parse it with the **shared** frontmatter splitter (`markdown-bridge.ts`, see §Write-back) so newly-created-but-unindexed files are still editable. (Documented divergence: the CLI returns `{}` for `new` rows; the app augments client-side.)

### Components

- `src/renderer/components/table/TableView.svelte` — container: loads data via the table store, owns toolbar, virtualization scroll container, selection/keyboard state, group rendering. Reuses the existing virtual-list helper `src/renderer/lib/virtual-list.ts` (the one `FileTree.svelte:32` uses) for windowed row rendering.
- `TableToolbar.svelte` — folder breadcrumb, Recursive toggle, view selector, Add row, Group-by menu, Columns menu, refresh, row count.
- `TableHeader.svelte` — header cells: sort indicators, drag-reorder, resize handle, per-column kebab menu, optional filter row.
- `TableRow.svelte` — one record; renders the Title cell + each visible data cell; row selection + keyboard focus.
- `TableGroupHeader.svelte` — collapsible group row with value + count.
- `cells/` — one editor per FieldType (see §Cells).
- `SaveViewModal.svelte` — name + save a view; manage (rename/delete) saved views.

### Grid: build custom vs. add a dependency — **decision: build custom**

**Recommendation: build a custom Svelte 5 virtualized table.** Rationale:

- **Edit control.** Cells must host bespoke, type-aware editors (reused from phase-32) with optimistic write-back, per-cell saving/error state, and tight integration with the workspace/IPC layer. Off-the-shelf grids (AG Grid, TanStack Table + virtual, RevoGrid) impose their own cell-renderer/editor lifecycles we'd fight.
- **Bundle size.** The app already carries heavy deps (Tiptap, 3d-force-graph, three, pdfjs, xterm). We already own a virtualization primitive (`lib/virtual-list.ts`) and the design-token styling system; a hand-rolled grid avoids a new runtime dependency.
- **Theming.** The app is strictly token-driven (`tokens.css`, dark + light); a custom grid styles cleanly with scoped `<style>` blocks.
- **Svelte 5 fit.** TanStack Table's Svelte adapter targets Svelte 4 stores; a native runes implementation is simpler.

We **virtualize rows** (windowed via `lib/virtual-list.ts`; viewport + buffer only) with **fixed row height** in V1 (matches `FileTree`'s `ITEM_HEIGHT` at `FileTree.svelte:99`). Columns are not virtualized in V1 (folder schemas are small). TanStack Table (headless) is the recorded fallback if needs grow.

## Cells by FieldType (39b)

Each cell renders a read view and, on edit, an inline editor. Editors live in `src/renderer/components/table/cells/` and **reuse the phase-32 widgets** (`PropertyRow` value widgets, `DatePicker`, `DateTimePicker`, `TypePickerDropdown`, the `DetectedType` detection, `Badge` for list chips, the `formatDate` helper) rather than rebuilding them. Commit = `Enter`/blur; cancel = `Escape`.

| FieldType | Read render | Editor | Write value |
|---|---|---|---|
| `String` | text (ellipsized) | single-line text input; textarea if value has newlines | YAML string |
| `Number` | right-aligned number | `<input type="number">`; rejects non-numeric | YAML **number** (not a quoted string) |
| `Boolean` | checkbox/toggle glyph | toggle/checkbox (reuse phase-32 toggle) | `true`/`false` |
| `List` | chips/`Badge` per item (as `PropertiesPanel` does at `:243`) | tag/chip editor (reuse phase-32 tags): add via input+Enter, remove via chip ✕ | YAML **sequence** |
| `Date` | localized date (`formatDate`, `PropertiesPanel.svelte:133`) | reuse phase-32 `DatePicker` (+ free-text ISO fallback) | **quoted** `"YYYY-MM-DD"` string (see Write-back: keeps it a string, not a YAML timestamp) |
| `Mixed` | best-effort string of the raw value | text input editing the **raw** value | writer infers scalar type on commit; never silently coerces a list/map to a string |

**Title column** (`name: '__title__'`): renders `row.title` + a pop-out `open_in_new` IconButton calling `workspace.openFile(row.path)` (existing smart-open at `workspace.svelte.ts:382`). Not directly editable in V1 (a tooltip explains "open the doc to rename"). Dim style when `title_source === 'filename'`.

**Unknown / missing field for a row:** render an empty, editable cell (placeholder "—"). Editing it **adds** the key to that file's frontmatter (typed per the column's `field_type`).

## Edit write-back (critical path, 39b)

### Decision: real YAML library, in the **main** process

The renderer's existing hand-rolled frontmatter helpers (`markdown-bridge.ts` `splitFrontmatter`/`joinFrontmatter`/`parseFrontmatterData`/`serializeFrontmatter`, used by phase-32's `DocumentHeader`) are fine for whole-block re-serialization in the editor, but for **surgical, lossless single-key edits across arbitrary user files** we use a proper YAML AST.

**Decision 1 — use a real YAML library for the write merge.** Add **`yaml`** (eemeli/yaml) as a dependency. Its **Document API** parses to a CST/AST that preserves source formatting of *untouched* nodes and lets us set/delete a single key while leaving everything else byte-stable as much as YAML round-tripping allows. We deliberately do **not** hand-roll a line-splice (brittle for block sequences, multi-line scalars, indentation), and we avoid `gray-matter`/`js-yaml` `dump` which reformats the whole block. We **reuse `markdown-bridge.ts`'s `splitFrontmatter`/`joinFrontmatter`** only to separate and re-attach the body byte-for-byte; the YAML *mutation* goes through eemeli `yaml`.

**Decision 2 — do the merge + write in MAIN, not the renderer.** A new IPC handler `fs:update-frontmatter` performs the read-modify-write atomically in the main process: single owner of the mutation, the same collection-path security check as `fs:write-file` (`ipc-handlers.ts:531`), atomic temp-file + `rename`, and reuse of the existing `file:saved-externally` broadcast. The renderer never assembles raw file bytes.

### Safe read-modify-write algorithm (main process)

`src/main/frontmatter.ts` (new module), invoked by the `fs:update-frontmatter` handler. **The handler takes `(collectionId, relativePath, patch)`** and resolves the absolute path *in main* (so the renderer never constructs arbitrary absolute paths; the collection boundary is enforced server-side):

1. Resolve `absolutePath = collection.path + relativePath` and **validate** it is within the collection (identical guard to `fs:write-file`).
2. Read the file as UTF-8 (detect + preserve original EOL: `\r\n` vs `\n`, and trailing newline).
3. **Split** into `[frontmatterBlock][body]` via `markdown-bridge.ts` `splitFrontmatter`.
4. **If a leading `---…---` exists but won't parse, ABORT** — do not synthesize a second block, do not clobber. Only synthesize a new frontmatter block when there is **no** leading `---` at all. (The index may show `{}` for a file whose YAML is broken on disk; never overwrite unparseable frontmatter.)
5. Parse the block with `YAML.parseDocument(block)`.
6. **Set/clear the single changed field** with `doc.setIn(keyPath, node)` / `doc.deleteIn(keyPath)`. Values arrive **typed** from the renderer (string/number/boolean/array/null) so we write proper YAML scalars/sequences. **Date cells write an explicitly quoted string scalar** (e.g. `doc.createNode(value, { type: 'QUOTE_DOUBLE' })` or equivalent) so `2026-01-01` is **not** re-resolved as a YAML `!!timestamp` — this keeps the value a string, matching what mdvdb's index/schema inferred (`FieldType::Date` from a string). For `Mixed` columns only, accept raw text and let `yaml` infer (documented: editing a `Mixed` cell may shift its inferred type after re-ingest).
7. Re-serialize **only** the frontmatter via `doc.toString()`, re-attach the **byte-identical** body via `joinFrontmatter`, restore original EOL/trailing newline.
8. **Atomic write**: temp file → `fsync` → `rename` over the original (mirrors the index's atomic writes). Preserve file mode where possible.
9. Broadcast `file:saved-externally` to all **other** windows (reuse `ipc-handlers.ts:546`) with the new full content + the **absolute** path.
10. Return the updated `frontmatter` object (parsed) so the renderer reconciles its optimistic value.

IPC + preload surface:

```ts
// ipc-handlers.ts
ipcMain.handle('fs:update-frontmatter', (event, collectionId: string, relativePath: string,
    patch: { set?: Record<string, JsonValue>; unset?: string[] }) =>
  wrapHandler(() => updateFrontmatter(event, windowManager, collectionId, relativePath, patch)))

// preload/index.ts
updateFrontmatter: (collectionId, relativePath, patch) =>
  invoke('fs:update-frontmatter', collectionId, relativePath, patch),

// api.d.ts
updateFrontmatter(collectionId: string, relativePath: string,
  patch: { set?: Record<string, JsonValue>; unset?: string[] }): Promise<Record<string, JsonValue>>
```

### Post-write re-index + refresh

After a successful write, the renderer calls the existing single-file ingest path `window.api.ingestFile(collection.path, row.path, { reindex: true })` (`ipc-handlers.ts:501`, used by FileTree's "Reindex File" at `FileTree.svelte:305`; already wrapped in `withWatcherPaused` at `:174` to prevent a double-ingest race). The cell value is already saved to disk; re-index updates derived state (`state`, schema columns) asynchronously. The table store **refetches `collection` data when the ingest promise resolves** (not on a fixed timer) so columns/state don't lag, debounced so rapid edits don't thrash. Note: if single-file ingest does not recompute scoped schemas (open item flagged in the CLI PRD), a newly-added key still renders as an `in_schema:false` column from the CLI's column union — acceptable; document the resolved behavior here once the CLI side is decided.

### Optimistic UI + multi-window sync

- On commit: update the in-memory row immediately (optimistic), mark the cell "saving."
- On `updateFrontmatter` resolve: replace with the authoritative parsed value; clear "saving."
- On reject: revert; show inline error + retry.
- **Multi-window:** the table tab subscribes to `window.api.onFileSavedExternally` (`preload/index.ts:213`). The broadcast carries an **absolute** path while rows are **relative**, so reconcile by comparing `${collection.path}/${row.path}` to the broadcast path (the `App.svelte:116` pattern). On match, reload that row's frontmatter from the broadcast content (parsed via the shared splitter) — no prompt, last-write-wins at file granularity.

## Features

### Click-to-sort

- Header click cycles `none → asc → desc → none` for that column. **V1 ships single-field sort** (multi-sort deferred to 39c, or client-only on a fully-loaded set — pick one; default: single-field).
- **Where it runs — explicit rule:** sorting is **server-authoritative** — pass `sort: "<field>"` + `order: "asc"|"desc"` to `cli:collection`. The app may sort **client-side only** when the full set is already loaded (no `limit`/`offset` in play, `total_rows ≤ threshold`, e.g. ≤2,000). **When server `--limit/--offset` paging is active, sort MUST be delegated to the CLI** — client-sorting a server-paginated page sorts the wrong subset.

### Per-column filter

- A toggleable filter row; each column gets a typed control:
  - String/Mixed → contains / equals text.
  - Number/Date → range (min/max).
  - Boolean → tri-state (any/true/false).
  - List → "has any of" / "has all of" chips.
  - Any → "is not empty" → `exists`; **"is empty" is client-side** (the CLI has no "not exists").
- **Ownership rule:** only `equals` (`KEY=VALUE`) is expressible via the CLI `--filter` (server-side). `range`/`in`/`contains`/`is-empty` are **client-side** in v1, applied to the loaded page. **`total_rows` reflects only CLI-side filters** — when any client-side filter is active, the row counter must show the **client count**, not `total_rows` (otherwise the counter lies).
- **`new` rows + server filters:** any active CLI `--filter` drops `{}`/unindexed rows (per the CLI contract). When the user wants `new` rows visible under a filter, apply that filter **client-side** so they remain.

### Show/hide, reorder, resize columns

- **Columns menu** (toolbar): checkbox list to toggle visibility; drag to reorder.
- **Header drag** reorders columns directly; **header right-edge drag** resizes (min-width clamp). Persisted into the active view's `columns: TableColumnLayout[]`. Title column is pinned-left and non-hideable.

### Group-by

- Group-by menu picks a column name (or "none"). Rows render under collapsible `TableGroupHeader` rows showing the group value + count; collapsed values persist in `collapsedGroups`.
- Grouping is **client-side** over the loaded/sorted rows. **Disabled (or forces a full load) whenever server `--limit/--offset` paging is active** — grouping a partial page yields wrong groups/counts. List-typed group-by groups by each item (a row can appear under multiple groups) — documented.

### Saved views (per folder)

**Persistence model:** a new `electron-store` section `tableViews`, keyed by `collectionId` then folder path:

```ts
// store.ts — AppStore addition
tableViews: Record<string /* collectionId */, Record<string /* folderPath */, SavedTableView[]>>

export interface SavedTableView {
  id: string            // uuid
  name: string
  version: number       // config schema version, for migration/degradation
  config: TableViewConfig
  recursive: boolean
  isDefault?: boolean   // applied when the folder is first opened
  createdAt: number
  updatedAt: number
}
```

IPC (`tableviews:*`, mirroring the `favorites:*`/`recents:*` handler style in `ipc-handlers.ts`): `tableviews:list` / `:save` / `:update` / `:delete` / `:set-default`, all keyed by `(collectionId, folderPath[, view|viewId])`. Preload methods + a small renderer store `table-views.svelte.ts` that the toolbar's view selector binds to.

**Migration / degradation (required):** on load, run a version check. A saved view may reference a column `name` that has since been renamed/removed from the folder's frontmatter, or a filter op a newer client added. The loader must **degrade, not error**: hide layout entries / drop sorts + filters that reference columns absent from the current `collection` columns, and bump the view to the current `version`. The `version` field future-proofs adding server-side `contains` etc.

When a folder opens, load its `isDefault` view if present, else an implicit "All fields" default. Unsaved sort/filter/columns/group edits live in the tab's `ephemeral` config; "Save"/"Save as new" persists into a `SavedTableView`.

### Add row / Delete row

- **Add row:** capture a filename via a small inline new-row form (reuse the inline-input pattern from `FileTree.svelte:616`). Create `<folder>/<name>.md` via the existing **`fs:create-file`** handler (`ipc-handlers.ts:556`, exclusive `wx`), pre-filling frontmatter from the folder's **schema fields** (each `in_schema` column key with an empty/typed default; `createNewFile` in `files.ts:589` is the precedent for creating a file with `title:` frontmatter). Then `ingestFile … { reindex: true }` and refresh.
- **Delete row:** confirm dialog → trash the `.md` via the existing **`fs:delete`** handler (`ipc-handlers.ts:720`, `shell.trashItem`). Close any open editor tabs for that path (reuse the loop in `FileTree.svelte:446`), remove the row optimistically, then refresh. The row may show a transient `state:"deleted"` until re-index reconciles the index.

## Edge cases to cover

- **Empty folder** — empty state + Add row CTA; columns from schema (may be just Title).
- **No frontmatter anywhere** — only the Title column; editing a cell *creates* the frontmatter block via the writer (synthesize-only-when-no-leading-`---`). Group-by/filter menus show "no fields yet."
- **Mixed-type columns** — render raw value; editor edits raw text; writer infers scalar type but never silently coerces a list/map to a string; sort uses the CLI's lexicographic fallback. Document that editing may shift inferred type after re-ingest.
- **Files on disk but not indexed (`state: 'new'`)** — "new" badge; CLI returns `{}` so frontmatter is read **live from disk** (via `readFile` + shared splitter) to stay editable; dropped by any server `--filter` (use client-side filtering to keep them visible). Badge clears after edit + re-index refresh.
- **`deleted` rows** — read-only (no cell editing); shown until re-index removes them.
- **Very large folders** — row virtualization; CLI-delegated sort/filter and optional `--limit/--offset` paging above an in-memory threshold. **Server paging and client-side sort/filter/group are mutually exclusive on a view** — when paging is active, client group/sort/filter are disabled (or the view forces a full load) with a clear UI note.
- **Concurrent edits across windows** — `file:saved-externally` reload with relative↔absolute reconciliation; last-write-wins at file granularity; the "saving" cell that loses a race re-renders to authoritative content (no merge UI in V1).
- **Read-only / locked files** — `updateFrontmatter` surfaces `EACCES`/`EPERM` through the serialized-error path; the cell reverts with "File is read-only," no retry loop.
- **Malformed existing YAML** — abort the write, never clobber; show "Couldn't safely edit frontmatter (invalid YAML) — open the file to fix."
- **Unicode filenames & values, CRLF vs LF** — preserved by the YAML Document API + EOL detection; covered by writer tests.
- **Title** — consumed from `row.title`/`row.title_source`; the app does not re-derive. `title_source === 'filename'` drives dim styling.

## File-by-file changes (implementation outline)

**New files**
- `src/renderer/components/table/{TableView,TableToolbar,TableHeader,TableRow,TableGroupHeader,SaveViewModal}.svelte`.
- `src/renderer/components/table/cells/{StringCell,NumberCell,BooleanCell,ListCell,DateCell,MixedCell,TitleCell}.svelte` (reusing phase-32 widgets internally).
- `src/renderer/stores/table.svelte.ts` — per-tab data + derived rows + load/merge logic.
- `src/renderer/stores/table-views.svelte.ts` — saved views CRUD bound to `tableviews:*` IPC.
- `src/main/frontmatter.ts` — `updateFrontmatter()` safe read-modify-write using `yaml` (39b).
- `src/main/table-views.ts` — `electron-store` CRUD for `tableViews` (with migration).
- Tests: `tests/unit/{table-store,frontmatter-writer,table-views}.test.ts`, `tests/integration/collection-ipc.test.ts`, `tests/e2e/table-view.spec.ts`.

**Modified files**
- `src/renderer/stores/workspace.svelte.ts` — add `TableTab` + `TableViewConfig` types, widen `TabState` (`:96`), `openTableTab`/`setTableRecursive`/`setTableActiveView`/`setTableEphemeral`, and `'table'` branches in `serializeSession` (`:1167`) / `restoreSession` (`:1222`).
- `src/renderer/components/TabPane.svelte` — add `{:else if tabKind === 'table'}` branch (near `:159`) rendering lazy `<TableView />`.
- `src/renderer/components/Sidebar.svelte` — thread `onfolderopen` → `workspace.openTableTab` (near `:248`).
- `src/renderer/components/FileTree.svelte` — thread `onfolderopen`; add "Open as Table" to the dir context menu (`:707`).
- `src/renderer/components/FileTreeNode.svelte` — trailing table-icon button for dirs + `dblclick` calling `onfolderopen` (`:69`).
- `src/main/ipc-handlers.ts` — register `cli:collection`, `fs:update-frontmatter`, and `tableviews:*` handlers.
- `src/preload/index.ts` + `src/preload/api.d.ts` — add `collection`, `updateFrontmatter`, table-views methods + types; widen `PersistedTab`.
- `src/renderer/types/cli.ts` — add `CollectionOutput`/`CollectionColumn`/`CollectionRow`/`TitleSource` (canonical contract).
- `src/main/store.ts` — add `tableViews` to `AppStore` + schema; widen `PersistedTab` enum to include `'table'` (+ `recursive`, `tableViewId`).
- `package.json` — add dependency `yaml` (eemeli/yaml).

## Testing strategy

Per the app's "every change must have automated tests" rule and its Vitest + Playwright conventions:

- **Unit (Vitest + jsdom)**:
  - **Frontmatter writer** (`frontmatter.ts`) — highest-risk surface. Fixture tests: set/clear scalar; number stays unquoted; **date written stays a quoted string (not a YAML timestamp) and re-ingest still infers `Date` with no quote churn**; list round-trips as a block sequence; nested map + comments/anchors preserved on untouched keys; unicode; CRLF vs LF + trailing newline preserved; **body byte-identical** after edit; synthesize frontmatter only when no leading `---`; **refuse to write on malformed YAML** (leading `---` that won't parse); typed values from renderer write correct scalars; atomic temp+rename; read-only file surfaces error; path resolved + validated from `(collectionId, relativePath)`.
  - **Table store** — load → columns/rows mapped from the canonical contract (`name`/`total_rows`/`title_source`); ephemeral overlay on saved view; `recursive` precedence; CLI-vs-client sort threshold decision; client filter count vs `total_rows`; `new`-row live-read augmentation; server-paging disables client group/sort/filter.
  - **Table-views store** — CRUD, default selection, keying by `collectionId`+folder, **version migration/degradation** (dead column dropped, not errored).
  - **Workspace store** — `openTableTab` dedupe/insert-before-graph; serialize/restore `'table'` tabs (skip missing folder).
  - **Components** — `@testing-library/svelte`: header sort cycling, column hide/reorder/resize state, each cell editor commit/cancel, Title pop-out calls `workspace.openFile`, `deleted` row read-only, optimistic value + revert on rejected write (mock `window.api.updateFrontmatter`).
- **Integration** (`vitest.integration.config.ts`): IPC registration + error serialization for `cli:collection` (correct `--sort`/`--order` split + repeatable `--filter` arg construction), `fs:update-frontmatter` (real `yaml` against a temp file, body preservation + `file:saved-externally` broadcast to a mocked second window), `tableviews:*`.
- **E2E (Playwright)**: open a folder as a table; assert rows/columns render; edit a `status` cell → on-disk `.md` frontmatter changed, body intact; edit a `date` cell → value stays a quoted string; add a row → file created with schema frontmatter; delete a row → file trashed + row removed; toggle Recursive → nested files appear; save a view, reopen folder → layout/sort/filter restored; open a folder under an older CLI → version-gate message.
- **Not exhaustively tested (accepted):** pixel-level resize fidelity, native date-picker chrome across platforms, very-large-folder scroll perf (manual QA note).

## Accessibility

- ARIA grid semantics: `role="grid"`, `role="row"`, `role="columnheader"` (`aria-sort`), `role="gridcell"`; group headers `role="rowgroup"`/`aria-expanded`.
- Keyboard model: arrow keys move the active cell; `Enter`/`F2` edits; `Escape` cancels; `Tab` next cell; `Home`/`End`/`PageUp`/`PageDown` navigate; menus arrow-navigable with `Escape` to close.
- Row count + "saving"/error status via `aria-live="polite"`. Visible focus indicators everywhere; the Save-view modal traps focus and restores on close. Never override `Cmd/Ctrl+C/V/Z/A` in cell editors. All transitions have `prefers-reduced-motion` fallbacks.

## Performance

- Row virtualization via `lib/virtual-list.ts` (viewport + buffer; fixed row height in V1).
- Lazy-import `TableView` + cell editors so the base bundle is unaffected unless a table is opened.
- Debounce + dedupe all `cli:collection` calls; never fire concurrent identical requests.
- Diff-update rows in place after edits/re-index rather than replacing the whole dataset.
- CLI-delegate sort/filter for large folders; disable client grouping above a hard threshold with a graceful warning.
- Re-index is async/fire-and-forget; never block the UI on it.

## Risks

- **Frontmatter write fidelity.** Even with `yaml`'s Document API, round-tripping can reflow some formatting. Mitigation: edit via `setIn`/`deleteIn` only (one node), keep the body byte-identical, force-quote dates, refuse to write on parse errors, and cover preservation with fixture tests.
- **New dependency (`yaml`).** Small, well-maintained; acceptable. Recorded because the app has no YAML writer today.
- **CLI coupling.** The table depends on the new `collection` command + contract. Mitigation: version-gate on `cli:version`; types mirrored in `types/cli.ts` from the CLI's golden JSON.
- **Folder-open vs expand ambiguity.** Mitigation: single-click = expand; double-click gated behind a (default-on) setting; explicit context-menu + hover-icon entry points.

## Acceptance criteria

1. A folder can be opened as a table via the hover icon, the "Open as Table" context-menu item, and double-click (when enabled) — none of which break single-click expand/collapse.
2. The table renders rows = `.md` files in the folder and columns = frontmatter fields (from the canonical contract), with a pinned Title column whose pop-out opens the doc in an editor tab.
3. Toggling **Recursive** includes/excludes nested subfolders and refetches.
4. Each cell edits per `FieldType` and, on commit, the file's YAML frontmatter is updated on disk with the body byte-identical and that one file re-indexed; dates stay strings; malformed YAML is never clobbered; `deleted` rows are read-only.
5. Editing in one window reflects in other windows via `file:saved-externally` (relative↔absolute reconciled) with no conflict prompt.
6. Click-to-sort (server-authoritative), per-column filter (equals server-side, others client-side with correct row count), show/hide + drag-reorder + resize columns, and group-by-with-collapsible-headers all work per the documented CLI/client split, with server-paging mutually exclusive with client group/sort/filter.
7. Saved views persist per `collectionId`+folder with a `version` field, migrate/degrade gracefully on load, and restore sort/filter/columns/group on reopen; a default view applies on open.
8. Add row creates a schema-seeded `.md`; delete row trashes the `.md` with confirm; both re-index.
9. All §"Edge cases" behave as specified.
10. The grid virtualizes (only viewport rows mounted) and stays responsive on a multi-thousand-row folder.
11. An older CLI without `collection` shows a version-gate message rather than erroring.
12. New unit/integration/E2E tests cover the writer, stores, IPC, and end-to-end flows; `npm test`, `npm run test:e2e`, `npm run lint`, and `npm run typecheck` are all clean.

## Open questions (not blocking the PRD)

- Should the Title column allow rename (write filename and/or frontmatter `title`) in a later phase? (V1: read-only Title.)
- Bulk edit / fill-down / multi-select rows — defer.
- Horizontal column virtualization and variable row heights — only if folder schemas get wide; otherwise YAGNI.
- Multi-field sort beyond v1 single-field.
- CSV/Airtable import-export and a "convert folder to typed collection" wizard — separate future PRD.
- Should saved views sync across machines (they live in `electron-store`, local only today)?
