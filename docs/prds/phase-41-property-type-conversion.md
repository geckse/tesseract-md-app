# PRD: Property Type Conversion & Schema Editing (Recursive Database Retyping)

## Overview

Make property **types editable**. Today the type icon in the document property panel (`DocumentHeader`/`PropertyRow`) is a passive glyph and the `TypePickerDropdown` only fires when _adding_ a property — there is no way to change an existing property's type, and no value-conversion logic exists anywhere. This phase makes the type icon a button (and adds a column-header menu in the database table view) that opens the type picker for an **existing** property. Choosing a different type opens a **confirmation modal** that previews, per file, how the value will convert across the property's **folder database (recursive)**; on confirm, a new main-process batch operation converts every file's value through the safe phase-39b frontmatter writer, **pins the chosen type in the vault's schema overlay** (`.markdownvdb.schema.yml`), runs one incremental ingest so the inferred schema and table columns follow the data, and reports exactly what changed and what was skipped. Unconvertible values are **never touched** — skip + report, no data loss.

The same recursive machinery powers two companion capabilities: **property key rename propagation** ("status" → "state" across the database) and **schema annotation editing** (description / required / allowed-values for `select`). All writes happen in the Electron **main** process; the Rust CLI and index remain strictly read-only over Markdown (the overlay file is app-written YAML config, not Markdown).

## Problem Statement

Frontmatter types in Tesseract are **inferred, not authored**. The CLI derives each field's `field_type` from the actual YAML values (`src/renderer/types/cli.ts:151`, mirrored from Rust `schema.rs`), and the app has no write path for types at all. Consequences today:

- A user who typed `tags: evaluation` (a string) in one file and `tags: [rag, testing]` (a list) in another gets a **Mixed** column that renders inconsistently — and there is no way to fix it except manually editing every file.
- Retyping a field ("make `priority` a number everywhere", "make `status` a select") means hand-editing N files and hoping the inference converges.
- Renaming a property key across a folder database is a find-and-replace exercise outside the app.
- Schema annotations that the core already supports (`description`, `required`, `allowed_values` via the `.markdownvdb.schema.yml` overlay, `src/schema.rs:35-46`) are unreachable — the app can read them but nothing can write them.

The database table view (phase 39) made folders feel like structured databases. A database whose column types can't be changed is not a database.

## Interview Decisions (recorded)

| #   | Question                                              | Decision                                                                                                                               |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Propagation scope inside a database folder            | **Folder database, recursive** (path-prefix subtree, matching mdvdb scoped-schema semantics)                                           |
| 2   | File not inside any database folder (vault-root file) | **Convert this file only**, no propagation, no overlay pin                                                                             |
| 3   | UI surfaces                                           | **Both**: property panel row type icon + table view column header menu                                                                 |
| 4   | Unconvertible values                                  | **Skip + report** — leave untouched, list them afterwards                                                                              |
| 5   | Schema update mechanism                               | **Pin in overlay** (`.markdownvdb.schema.yml` scoped entry) _and_ convert values + re-ingest                                           |
| 6   | Confirmation dialog                                   | **Full preview** — count + scrollable per-file before→after, skipped files flagged                                                     |
| 7   | Type vocabulary                                       | **All 10 UI types, smart split** — the preview decides which files need storage changes; string-kind switches usually rewrite nothing  |
| 8   | Execution                                             | **New bulk IPC in main**, watcher paused, per-file results, progress streamed                                                          |
| 9   | text → tags rule                                      | **Split on commas**; no comma → single-item list                                                                                       |
| 10  | Index update                                          | **One incremental `mdvdb ingest`** after the batch (hash-skip leaves untouched files alone)                                            |
| 11  | Undo                                                  | **None** — clear preview before, full report after; vault is expected to be under git/backups                                          |
| 12  | Dirty open tabs                                       | **Convert anyway**; existing file-sync conflict flow handles open editors                                                              |
| 13  | V1 extras                                             | ALL in scope: `select` pins `allowed_values`; live n/N progress in the modal; **key rename propagation**; description/required editing |

## Goals

- Change an existing property's type from the property panel (type icon → picker) and from the table column header menu.
- Confirmation modal with per-file before→after preview, skip flags with reasons, and a Convert button stating the file count.
- Recursive conversion across the folder subtree via a new main-process batch handler reusing the phase-39b `applyFrontmatterPatch` machinery: atomic per-file writes, watcher paused, per-file success/skip/fail results, live `n/N` progress streamed to the modal.
- Deterministic, documented conversion matrix (below). Unconvertible and empty/missing values are never modified.
- Pin the chosen type (and `allowed_values` for `select`) into `.markdownvdb.schema.yml` under the folder's scope; one incremental ingest afterwards so persisted scoped schemas, table columns, and the property panel all reflect the change.
- Property key **rename** across the same scope with the same preview/apply flow, including best-effort rename of references in saved table views.
- Edit `description` and `required` (and `allowed_values`) for a schema field from the UI — overlay write + ingest, no file rewrites.
- Post-operation report: converted / skipped (with reasons) / failed (with reasons) / no-value counts and file lists.
- Same-window and cross-window editors reconcile through the existing file-sync / conflict flow; the vault watcher never double-processes our own writes.
- Fully keyboard-accessible modal (focus trap), `aria-live` progress, `prefers-reduced-motion` fallbacks, dark + light tokens.

## Non-Goals

- **No undo / snapshot / .bak files.** The preview is the safety mechanism; the vault is assumed version-controlled.
- **No forced coercion.** We never write nulls, zeros, or serialized blobs for values that don't cleanly convert (interview #4).
- **No Rust CLI changes.** Everything ships app-side. The core already loads and merges the overlay at ingest (`src/lib.rs:1536-1567` in the CLI repo) — verified: the schema recompute runs on every non-`--file` ingest even when zero files changed, so overlay-only edits land after one cheap incremental ingest.
- **No new frontmatter value editors.** Cells and property rows already render per-type widgets (phase 32 / 39b); after conversion they simply receive the new type.
- **No cross-file value normalization beyond the chosen conversion** (no dedupe of tags, no date locale guessing beyond the rules below).
- **No combined rename+retype in a single operation** — two separate ops (can be run back-to-back).
- **No mid-batch cancellation** in V1 — batches are local disk writes and fast; the button disables while running.
- **No conversion of the `title` key** from the Title column (it drives row identity; the property panel can still retype it like any other key if present in frontmatter).

## Type Model

Two vocabularies exist and stay:

- **UI types** (`DetectedType`, `PropertyRow.svelte:7`): `text | number | boolean | date | datetime | url | email | select | tags | complex`
- **Storage types** (`FieldType`, `types/cli.ts:151`): `String | Number | Boolean | List | Date | Mixed` — what YAML + the schema can express (overlay accepts `string|number|boolean|bool|list|array|date|mixed`, `schema.rs:147-158`).

Mapping chosen in the picker → what happens:

| Picked (UI)     | Stored shape                 | Overlay pin (`field_type`)  | Notes                                                                                                                                                                              |
| --------------- | ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`          | YAML string                  | `string`                    |                                                                                                                                                                                    |
| `url` / `email` | YAML string                  | `string`                    | Presentation refinement; per-file url/email detection stays value-shape-based (`DocumentHeader.detectType`, `DocumentHeader.svelte:70-90`). Documented honestly in the modal copy. |
| `select`        | YAML string                  | `string` + `allowed_values` | `allowed_values` in the schema is what makes every file in the scope render a select widget (schema-driven override in `detectType`).                                              |
| `number`        | YAML number                  | `number`                    |                                                                                                                                                                                    |
| `boolean`       | YAML boolean                 | `boolean`                   |                                                                                                                                                                                    |
| `date`          | quoted `"YYYY-MM-DD"` string | `date`                      | Writer force-quotes date-like strings (`frontmatter.ts:127-130`) so YAML never re-resolves them as timestamps.                                                                     |
| `datetime`      | quoted ISO 8601 string       | `date`                      | Same `Date` FieldType; UI granularity only.                                                                                                                                        |
| `tags`          | YAML sequence of strings     | `list`                      |                                                                                                                                                                                    |
| `complex`       | —                            | —                           | **Not offered as a conversion target** (it is a detection result, not an intent). Shown in the picker only as the current type when applicable.                                    |

**Smart split is computed, not special-cased:** the preview evaluates every file. Files whose stored value already has the target shape appear as "unchanged". If _no_ file needs a storage change (e.g. `text` → `url`), the modal collapses to a light confirm ("No file contents change; the schema for `knowledge-graph` will record this type") — same flow, empty change list.

## Conversion Matrix (deterministic, pure)

Per file, on the **current on-disk value** (not the index). `skip` = leave untouched + report with reason.

| From \ To                   | String (text/url/email/select)                                     | Number                                                 | Boolean                                                        | List (tags)                                              | Date                                                                    | Datetime                                                                               |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| string                      | unchanged                                                          | trim; strict `^-?\d+(\.\d+)?$` → number; else **skip** | ci `true/yes/on/1`→true, `false/no/off/0`→false; else **skip** | split on `,`, trim, drop empties; no comma → 1-item list | `YYYY-MM-DD` unchanged; ISO datetime → truncated to date; else **skip** | ISO datetime unchanged; `YYYY-MM-DD` unchanged (no fabricated midnight); else **skip** |
| number                      | `String(v)`                                                        | unchanged                                              | `1`→true, `0`→false; else **skip**                             | `[String(v)]`                                            | **skip** (timestamps ambiguous)                                         | **skip**                                                                               |
| boolean                     | `"true"`/`"false"`                                                 | true→1, false→0                                        | unchanged                                                      | `[String(v)]`                                            | **skip**                                                                | **skip**                                                                               |
| list                        | join `", "` (items stringified; any map item → **skip**)           | **skip**                                               | **skip**                                                       | unchanged (items stringified if scalar)                  | **skip**                                                                | **skip**                                                                               |
| map (nested)                | **skip**                                                           | **skip**                                               | **skip**                                                       | **skip**                                                 | **skip**                                                                | **skip**                                                                               |
| `null` / missing key / `""` | **untouched** — reported as "no value", not an error (all targets) |                                                        |                                                                |                                                          |                                                                         |                                                                                        |

Rename op: missing key → untouched; **target key already present in the file → skip** ("target key exists" — never overwrite); otherwise `{ set: { newKey: value }, unset: [oldKey] }` with the value passed through verbatim.

## Scope Resolution

- **Property panel trigger:** scope = the file's **parent directory subtree** — exactly the scope the panel's schema already uses (`WysiwygEditor.svelte:87-93` fetches `mdvdb schema --path <dirname>`). A **vault-root file** (no parent dir) → single-file conversion, no overlay pin (interview #2; a global pin from a one-file action would silently retype the whole vault's schema display).
- **Table header trigger:** scope = the tab's `folderPath` subtree — **always recursive regardless of the table's Recursive toggle** (the schema is prefix-scoped; converting only direct children would fork the column's type within its own scope). The modal states this explicitly. A root table (`folderPath: '.'`) converts **vault-wide** and pins under the overlay's global `fields:` section — the modal copy makes the blast radius unmistakable.
- **Overlay scope key format (load-bearing):** the folder's relative path **without trailing slash** — this matches `discover_scopes` output and `normalize_collection_scope`'s `schema_key` (CLI repo `src/schema.rs:184-194`, `src/lib.rs:2849-2859`). Overlay-declared scopes are unioned into the persisted scoped-schema set at ingest (`src/lib.rs:1541-1550`), so **nested folders work** even though auto-discovery only finds top-level dirs.
- File enumeration = the CLI's view of the scope: `mdvdb collection <scope> --recursive --json` (ignore-rule-aware, includes `new`/`modified`/`deleted` states). `deleted` rows are excluded (nothing on disk to write). Preview and apply both read actual file content from disk — the index is only used to enumerate paths.

## User Experience

### Property panel (the screenshot surface)

1. The type icon in `PropertyRow` (`PropertyRow.svelte:95`, today a passive `<span class="pr-type-icon">`) becomes an icon **button** (`aria-label="Change type of STATUS"`), hover affordance consistent with the row's remove button. Click opens the existing `TypePickerDropdown` anchored to it, with the current type highlighted and `complex` excluded as a target.
2. Picking the same type → dropdown closes, nothing happens. Picking a different type → **ConvertTypeModal** opens.
3. A small overflow `⋯` icon-button appears on row hover (next to the existing remove button) with a `PopoverMenu` (`ui/PopoverMenu.svelte`): **Change type…**, **Rename across database…**, **Property settings…** (description / required / allowed values).

### Table column header

`TableHeader.svelte` (header cell at `:88-119`, currently click-cycles sort only) gains a kebab `⋯` per column opening a `PopoverMenu` with: **Change type…**, **Rename property…**, **Property settings…**, plus the existing sort actions. Hidden for the `__title__` column. Uses the same modal; scope = the tab's folder.

### ConvertTypeModal (new, three phases in one dialog)

Template: `SaveViewModal.svelte` + `use:focusTrap` (`src/renderer/lib/focus-trap.ts`), `role="dialog"` `aria-modal="true"`.

**Phase A — Preview** (opens after the preview IPC resolves; spinner while computing):

```
┌ Change type: status → Number ────────────────────────────────┐
│ Database: knowledge-graph  (recursive, 14 files)              │
│                                                               │
│ 9 files convert · 2 skipped · 3 have no value                 │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ evaluation-framework.md   "3"        →  3                 │ │
│ │ graph-rag-architecture.md "12"       →  12                │ │
│ │ ⚠ retrieval-notes.md      "drafted"     can't convert     │ │
│ │ …                                                         │ │
│ └───────────────────────────────────────────────────────────┘ │
│ Skipped values keep their current value and type.             │
│ The schema for knowledge-graph will record: Number.           │
│                                  [Cancel]  [Convert 9 files]  │
└───────────────────────────────────────────────────────────────┘
```

- List virtualized via `src/renderer/lib/virtual-list.ts` above ~200 rows; before/after strings truncated to 200 chars for display.
- Skipped rows flagged with icon + reason tooltip. Zero-convertible case: Convert button reads "Update schema only" (or is disabled if there's also no pin to write).
- For `select`: an editable chip list of `allowed_values`, prefilled with the scope's distinct current values.
- If the **triggering file's tab is dirty**, it is saved first automatically (existing save flow) before the preview computes — you should never immediately conflict your own tab. Other dirty tabs are listed under a small warning line ("2 affected files have unsaved changes in open tabs — they'll show the conflict banner").

**Phase B — Progress:** Convert button disables everything; progress bar + `n/N` + current file path from streamed events; `aria-live="polite"`. No cancel in V1.

**Phase C — Report:** converted / skipped / failed counts with expandable file lists (failures show the error, e.g. "invalid YAML — file not modified"). Single **Close** button. The report is the no-undo contract (interview #11).

### Rename flow

"Rename across database…" opens the same modal in rename mode: text input for the new key (validated: non-empty, no YAML-special characters, ≠ old key), preview lists files that will rename and files skipped because the target key already exists. On apply: per-file `{set/unset}` patches, overlay field entry moved, saved-view references renamed (see below), ingest, report.

### Property settings

A small popover/modal (same focus-trap pattern): description (text), required (toggle), allowed values (chip editor, only meaningful for string fields). Writes only the overlay + triggers ingest; no file rewrites; no preview needed — instant apply with a toast-level confirmation inside the popover.

## Technical Design

### Data Model Changes

**No electron-store, index, or CLI contract changes.** One file gains an app-side writer:

`.markdownvdb.schema.yml` (vault root — already read by the CLI, `schema.rs:281-300`):

```yaml
# global fields (used only by whole-vault conversions from a root table)
fields:
  author: { field_type: string }
# per-folder scopes — keys are relative paths WITHOUT trailing slash
scopes:
  knowledge-graph:
    fields:
      status:
        field_type: number # accepted: string|number|boolean|bool|list|array|date|mixed
        description: Review status # optional annotations (serde names verified, schema.rs:35-46)
        required: true
        allowed_values: [drafted, reviewed, published]
```

Written with the eemeli `yaml` **Document API** (`parseDocument` + `setIn`/`deleteIn`) so user comments and untouched entries survive, exactly like `src/main/frontmatter.ts` does for frontmatter. Created on demand if absent. Atomic dotfile-temp + rename, `registerOwnWrite` before writing (`src/main/own-writes.ts`) so neither watcher tier reacts to our own write.

`.markdownvdb/table-views.json` (`src/main/table-views.ts`): rename ops best-effort-update saved views for the scope folder **and its descendants**: `columns[].name`, `sort[].columnName`, `filters[].columnName`, `groupBy`, bumping `updatedAt`. Anything missed degrades via the existing column-aware view degradation — never errors.

### Interface Changes (IPC + preload)

New main module `src/main/property-ops.ts` (pure conversion rules + plan builder + batch executor) and `src/main/schema-overlay.ts` (overlay read/upsert/rename). New channels in `src/main/ipc-handlers.ts` (lazy-import like `fs:update-frontmatter` at `:717-723`):

```ts
// Shared shapes (preload/api.d.ts + mirrored renderer types)
export type PropertyOp =
  | { kind: 'convert'; target: DetectedType; allowedValues?: string[] }
  | { kind: 'rename'; newKey: string }

export interface PropertyOpRequest {
  collectionId: string
  scope: string | null        // relative folder path, '' /'.' = whole vault, null = single file
  filePath: string | null     // set when scope === null (vault-root file)
  key: string
  op: PropertyOp
}

export type PlanAction = 'convert' | 'rename' | 'unchanged' | 'no-value' | 'skip'
export interface PropertyOpPlanEntry {
  path: string
  action: PlanAction
  before: string | null       // display-truncated (≤200 chars)
  after: string | null
  reason?: string             // for 'skip'
}
export interface PropertyOpPlan {
  scope: string | null
  files: PropertyOpPlanEntry[]
  totals: { convert: number; unchanged: number; noValue: number; skip: number }
  schemaPin: { scopeKey: string | null; fieldType: string; allowedValues?: string[] } | null
}

export interface PropertyOpResultEntry { path: string; status: 'ok' | 'skipped' | 'failed'; reason?: string }
export interface PropertyOpResult {
  entries: PropertyOpResultEntry[]
  totals: { ok: number; skipped: number; failed: number }
  overlayWritten: boolean
}

// ipc-handlers.ts
ipcMain.handle('schema:preview-property-op', (_e, req: PropertyOpRequest) => wrapHandler(...))
ipcMain.handle('schema:apply-property-op',   (e, opId: string, req: PropertyOpRequest) => wrapHandler(...))
ipcMain.handle('schema:update-overlay-field',(_e, collectionId: string, scope: string | null, key: string,
    patch: { description?: string | null; required?: boolean | null; allowedValues?: string[] | null }) => wrapHandler(...))
// progress: event.sender.send('schema:property-op-progress', { opId, done, total, path })
//   — same streaming pattern as INSTALL_PROGRESS_CHANNEL (src/main/cli-install.ts:144-153)

// preload/index.ts + api.d.ts
previewPropertyOp(req): Promise<PropertyOpPlan>
applyPropertyOp(opId, req): Promise<PropertyOpResult>
updateOverlayField(collectionId, scope, key, patch): Promise<void>
onPropertyOpProgress(cb: (p: { opId; done; total; path }) => void): () => void
```

`opId` is a renderer-generated uuid so progress events correlate to the invoking modal (multi-window safe). Main rejects a second concurrent `apply` for the same collection with a typed error.

### Batch execution algorithm (main process)

`applyPropertyOp`:

1. Resolve collection from `collectionId`; guard every path with the same boundary check as `fs:update-frontmatter` (`frontmatter.ts:146-156`).
2. Enumerate: `scope === null` → the single `filePath`; else `execCommand('collection', [scope || '.', '--recursive'], root)` and take `rows[].path`, excluding `state: 'deleted'`.
3. `withWatcherPaused(root, …)` (`ipc-handlers.ts:184-199`) around the whole batch. For each file: read from disk → recompute the conversion on the **current** value (never trust the preview snapshot — files may have changed) → if action is convert/rename, build a `FrontmatterPatch` and run the existing `applyFrontmatterPatch` (`frontmatter.ts:89-143`) → atomic dotfile-temp write + `registerOwnWrite` (reuse the write tail of `updateFrontmatter`, `frontmatter.ts:162-196`, refactored to share) → broadcast `file:saved-externally` to other windows per file → `event.sender.send('schema:property-op-progress', …)`.
4. Per-file failures (`MalformedFrontmatterError`, `EACCES`, …) are collected as `failed` entries; the batch continues. No partial rollback (interview #11).
5. Overlay upsert via `schema-overlay.ts` (skip when `scope === null`). For rename: move the overlay field key; call `table-views` rename helper.
6. Return `PropertyOpResult`.

Renderer follow-up (in the modal's apply handler): `await window.api.ingest(root)` — one incremental ingest (`cli:ingest` is already `withWatcherPaused`-wrapped, `ipc-handlers.ts:252-261`; hash-skip means only converted files re-embed) → `fetchSchema(root, currentPrefix)` (`stores/schema.ts:8`) → `tableStore.reload` for any open table tab under the scope → route each changed path through the file-sync store (`stores/file-sync.ts` — `handleVaultFileEvent`/`applyDiskContentToTab` at `:64`/`:239`) so **same-window** editors reload (clean tabs silently, dirty tabs get the existing conflict banner). This explicit routing is required: `registerOwnWrite` deliberately suppresses the watcher events for our own writes, and the per-file broadcast only reaches _other_ windows.

### New Commands / API / UI (summary)

- UI: clickable type icon + row overflow menu in `PropertyRow`; column kebab menu in `TableHeader`; `ConvertTypeModal.svelte`; `PropertySettingsPopover.svelte`.
- IPC: `schema:preview-property-op`, `schema:apply-property-op`, `schema:property-op-progress` (event), `schema:update-overlay-field`.
- Main: `src/main/property-ops.ts`, `src/main/schema-overlay.ts`, rename helper in `src/main/table-views.ts`.
- No new CLI commands; no CLI version gate needed (`collection`, `schema --path`, and overlay loading all pre-date this phase).

### Migration Strategy

Nothing to migrate. The overlay file is optional and created on demand; vaults without it behave exactly as today. An overlay written by this feature is plain documented core config — the CLI merges it on every full ingest (`src/lib.rs:1534-1567`), older CLI versions included (overlay support dates to phase 7/23). Saved views: rename is best-effort; the existing degradation path covers stale references.

## Edge Cases

- **Empty / missing / null values** — untouched, reported as "no value"; the overlay pin still records the intended type so the column doesn't degrade to Mixed (interview #5).
- **Whole batch unconvertible** — Convert button becomes "Update schema only"; files list shows all-skip; overlay still pinned.
- **String-kind switch (text↔url↔email)** — usually zero file changes; light confirm; overlay pins `string`. Files whose stored value is _not_ a string (e.g. a number in one file) still convert — the preview surfaces them.
- **`select` with out-of-set values** — `allowed_values` chips prefill from distinct scope values so nothing is invalid by default; the user can edit the set (values outside it are not rewritten — select is presentation + validation, not coercion).
- **Malformed YAML frontmatter in one file** — that file fails (`MalformedFrontmatterError`), is reported, batch continues. Never clobbered (`frontmatter.ts:78-83`).
- **`new` (unindexed) files** — enumerated by `collection` with `state:'new'`; content read live from disk, converted like any other file.
- **`deleted` rows** — excluded from enumeration; nothing on disk.
- **Nested folder scope never ingested as a scope before** — overlay-declared scopes join the persisted set on the post-op ingest (`src/lib.rs:1546-1550`); the panel's on-the-fly scoped inference covers the gap until then.
- **Root table (whole vault)** — converts vault-wide, pins in overlay global `fields:`; modal copy states "entire vault (N files)".
- **Vault-root single file** — single-file convert, no pin; modal shows one row.
- **Rename target key exists in a file** — that file skips ("target key exists"); rename never merges or overwrites values.
- **Rename of the `title` key** — allowed but the modal warns that titles fall back to filenames where the new key isn't `title` (server-side title derivation).
- **Concurrent second op** — main rejects; renderer disables entry points while a modal op runs.
- **File changed between preview and apply** — apply recomputes per file from disk; the deterministic rules make the outcome well-defined; the report reflects what actually happened.
- **Files open in editors** — triggering tab auto-saves first; other clean tabs reload silently; dirty tabs get the conflict banner (interview #12). Other windows reconcile via the per-file `file:saved-externally` broadcast.
- **Very large scopes (thousands of files)** — preview list virtualized; values truncated for display; progress streamed; the batch is sequential disk I/O in main (no renderer jank).

## Implementation Steps

1. **Pure conversion rules** — `src/main/property-ops.ts`: `convertValue(value: JsonValue, target: DetectedType): { ok: true; value: JsonValue; changed: boolean } | { ok: false; reason: string }` implementing the matrix verbatim, plus `planPropertyOp(files: {path, frontmatter}[], key, op)` producing `PropertyOpPlan`. Pure, no I/O — unit-test the whole matrix here.
2. **Overlay writer** — `src/main/schema-overlay.ts`: `upsertOverlayField(root, scope | null, key, { fieldType, allowedValues?, description?, required? })`, `renameOverlayField(root, scope | null, oldKey, newKey)`. eemeli `yaml` Document API, comment-preserving, atomic write, `registerOwnWrite`. Scope keys without trailing slash.
3. **Refactor the frontmatter write tail** — extract the read→patch→atomic-write→broadcast steps of `updateFrontmatter` (`src/main/frontmatter.ts:162-196`) into a reusable `writePatchedFile(...)` so single-cell edits and the batch share one code path.
4. **Batch executor + IPC** — `previewPropertyOp` / `applyPropertyOp` in `property-ops.ts`; register `schema:preview-property-op`, `schema:apply-property-op`, `schema:update-overlay-field` in `src/main/ipc-handlers.ts` (lazy-import, `wrapHandler`, collection-boundary validation); progress via `event.sender.send`. Concurrency guard per collection.
5. **Saved-views rename helper** — in `src/main/table-views.ts`: `renamePropertyInViews(collectionId, scope, oldKey, newKey)` updating folder entries for the scope + descendants.
6. **Preload surface** — `src/preload/index.ts` + `api.d.ts`: `previewPropertyOp`, `applyPropertyOp`, `updateOverlayField`, `onPropertyOpProgress` (subscribe/unsubscribe pattern like `onFileSavedExternally`).
7. **Renderer types + store** — mirror the request/plan/result types; new `src/renderer/stores/property-ops.svelte.ts` (runes class like `table.svelte.ts`): holds modal state (phase, plan, progress, result), `preview()`, `apply()` (incl. the follow-up ingest → `fetchSchema` → `tableStore.reload` → file-sync routing), scope resolution helpers (`scopeForPanelFile(filePath)`, `scopeForTableTab(tab)`).
8. **ConvertTypeModal** — `src/renderer/components/ConvertTypeModal.svelte`: three phases, virtualized preview list, `allowed_values` chip editor for select, rename input mode, progress bar with `aria-live`, report phase. Focus-trapped; Escape cancels only in Phase A.
9. **PropertyRow entry points** — `src/renderer/components/wysiwyg/PropertyRow.svelte`: type icon → button opening `TypePickerDropdown` (exclude `complex`, highlight current); hover overflow `⋯` → `PopoverMenu` (Change type… / Rename across database… / Property settings…). Thread callbacks up through `DocumentHeader.svelte`; the header does **not** locally mutate the value on type change — mutation always flows disk → file-sync → editor (no double-apply).
10. **Auto-save the triggering tab** — before preview, if the active document tab is dirty, run the existing save flow and await it.
11. **TableHeader entry point** — `src/renderer/components/table/TableHeader.svelte`: kebab per column (not `__title__`) with the same three items + existing sort actions, via `PopoverMenu`.
12. **PropertySettingsPopover** — description / required / allowed-values form calling `updateOverlayField` + one incremental ingest + `fetchSchema`/`tableStore.reload` refresh.
13. **Tests** — see Testing Strategy; add all new suites.
14. **Docs** — update `app/CLAUDE.md` IPC channel table (`schema:*` additions) and note the overlay writer in Core Design Decisions.

## Validation Criteria

- [ ] Type icon in the property panel opens the picker; choosing a new type shows the preview modal with correct per-file before→after and skip reasons for every matrix cell.
- [ ] Confirming converts exactly the previewed convertible files on disk (spot-check YAML: numbers unquoted, dates quoted, lists as sequences), bodies byte-identical, unconvertible and empty values untouched.
- [ ] `.markdownvdb.schema.yml` gains/updates the scoped `field_type` (+ `allowed_values` for select) without disturbing unrelated entries or comments; scope key has no trailing slash; `mdvdb schema --path <scope> --json` reflects the pin after the ingest.
- [ ] After the post-op ingest, the table column `field_type` and the property panel's widgets reflect the new type; a column with skipped values still shows the pinned type (not Mixed).
- [ ] text→tags splits on commas ("rust, search" → [rust, search]); single value wraps; List→String joins with ", ".
- [ ] Rename: values move to the new key everywhere; files already containing the target key are skipped and reported; overlay entry and saved-view references renamed; degradation handles anything missed.
- [ ] Property settings edits (description/required/allowed values) persist to the overlay and surface in the schema after ingest with zero file rewrites.
- [ ] Progress events stream n/N during a batch; report lists ok/skipped/failed accurately including a deliberately malformed-YAML file (failed, unmodified on disk).
- [ ] Same-window clean tabs on converted files reload; dirty tabs show the conflict banner; a second window updates via `file:saved-externally`.
- [ ] Vault-root file conversion touches exactly one file and writes no overlay; root-table conversion warns "entire vault".
- [ ] Watcher never re-processes our own writes (no duplicate ingest storm during/after a batch).
- [ ] Keyboard-only operation of picker, menus, and modal; focus restored on close; `prefers-reduced-motion` respected.
- [ ] `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck` all clean.

## Testing Strategy

- **Unit (Vitest):**
  - `property-ops` conversion matrix — every from/to cell including empty/null/missing, comma splitting, strict number parse rejects `"1e3"`? (decide: regex above rejects exponent notation — assert it), boolean token table, date truncation, map skips, rename collision.
  - Plan builder — totals, unchanged detection, display truncation, deleted-row exclusion.
  - `schema-overlay` — creates file when absent; upserts scoped field without touching comments/siblings; rename moves keys; global vs scoped sections; no trailing slash.
  - Store — scope resolution (panel dirname vs table folderPath vs root file), modal phase transitions, concurrency guard, follow-up sequence order (ingest → schema → table → file-sync).
  - Components — icon button opens picker with current type highlighted and no `complex` target; modal renders plan rows/flags; select chip editor; progress `aria-live`; report lists; TableHeader kebab hidden for `__title__` (mock `window.api`).
- **Integration (`vitest.integration.config.ts`):** IPC registration + error serialization; `applyPropertyOp` against a real temp vault — batch convert with a mix of convertible/skip/malformed files (assert disk state per file + body preservation + broadcast to a mocked second window + progress events + result totals); overlay written atomically; rename incl. table-views.json updates; `updateOverlayField` round-trip.
- **E2E (Playwright):** open the test vault → change `status` text→number from the panel → modal preview shows skips → convert → on-disk YAML converted, skipped file untouched, table column shows Number; rename `category`→`topic` from the table header → files renamed, saved view sort survives; select conversion → allowed values pinned and select widget renders in another file; report phase shows counts.
- **Accepted manual QA:** multi-thousand-file batch timing; cross-platform file-permission failure surfaces.

## Anti-Patterns to Avoid

- **Do not convert values in the renderer or write files from the renderer.** All mutation goes through main (`property-ops.ts`) — same rule phase 39b established; the renderer never assembles file bytes.
- **Do not apply the type change locally in `DocumentHeader` state when the modal confirms.** The editor must receive the change from disk via file-sync, or the triggering file gets a double-apply/divergent state.
- **Do not trust the preview snapshot at apply time.** Recompute per file from disk — files change between preview and click.
- **Do not skip the explicit file-sync routing after apply** assuming "the watcher will pick it up" — `registerOwnWrite` suppresses our own events by design; without routing, same-window tabs go stale and the next editor save clobbers converted frontmatter.
- **Do not serialize skipped values "best effort"** (maps → strings, NaN → 0). Skip + report was an explicit decision; forced coercion destroys data silently.
- **Do not write overlay scope keys with a trailing slash** or the pin lands in a scope `mdvdb collection`/`schema --path` never look up (schema_key is slash-less).
- **Do not hand-roll YAML edits with string splicing** — frontmatter _and_ the overlay both go through the eemeli `yaml` Document API (`frontmatter.ts` precedent) or formatting/comments are destroyed.
- **Do not run per-file `ingestFile` in a loop after the batch** — one incremental ingest recomputes schemas once (interview #10); N single-file ingests skip schema recomputation entirely (`src/lib.rs:1520` gate) and spawn N processes.
- **Do not block on the ingest inside the main batch handler** — return the write results, let the renderer own the follow-up sequence with visible state.
- **Do not add a data-grid or dialog dependency** — `PopoverMenu`, `focusTrap`, `virtual-list`, and the SaveViewModal pattern already cover the UI.

## Patterns to Follow

- `src/main/frontmatter.ts` — the gold standard this feature extends: Document-API patching, malformed-YAML abort, EOL/body preservation, dotfile-temp atomic write, `registerOwnWrite`, other-window broadcast.
- `src/main/ipc-handlers.ts:184-199` (`withWatcherPaused`) around the batch; `:717-723` for lazy-imported handler registration; `wrapHandler` error serialization everywhere.
- `src/main/cli-install.ts:144-153` — the progress-streaming channel pattern (`webContents.send` + preload subscription).
- `src/renderer/stores/table.svelte.ts` — runes-class store shape, `load`/`reload`, debounced follow-ups (`:458-480`), `updateFrontmatter` usage (`:440`).
- `src/renderer/components/table/SaveViewModal.svelte` + `src/renderer/lib/focus-trap.ts` — modal structure, focus trap, `ui/Button`/`IconButton`, saving/error state.
- `src/renderer/components/ui/PopoverMenu.svelte` (`anchorEl`, `items`, `onselect`, `ondismiss`) for the row overflow and column kebab menus.
- `src/renderer/stores/file-sync.ts` (`handleVaultFileEvent` `:64`, `applyDiskContentToTab` `:239`) for post-op editor reconciliation and conflicts.
- `AddPropertyRow.svelte:42-48` FieldType↔DetectedType mapping and `TypePickerDropdown.svelte:13-24` options — reuse, don't duplicate.
- Tokens-only styling with scoped `<style>`, Material Symbols icons, `prefers-reduced-motion` fallbacks — per `app/CLAUDE.md`.

## Risks

- **Batch write fidelity across arbitrary user YAML.** Mitigated by reusing the proven phase-39b writer per file, per-file failure isolation, and heavy fixture tests; the batch adds no new YAML surface.
- **Schema pin vs inference disagreement.** A pinned `number` column whose skipped values remain strings shows Number in the schema while some files hold strings — this is the designed trade-off (interview #5); the report makes the residue visible, and re-running the conversion later converges.
- **Scope semantics surprise** (recursive conversion from a non-recursive table; vault-wide from a root table). Mitigated by explicit modal copy naming the scope and file count — the number is the consent.
- **Rename blast radius** (saved views, links to frontmatter keys elsewhere). Views are handled; anything else (e.g. queries typed into terminal history) is out of app control — documented.
- **Long batches lock the main-process event loop?** Writes are async fs ops awaited sequentially; progress events keep the UI honest. If profiling shows need, chunk with `setImmediate` between files — noted, not built.

## Acceptance Criteria

1. Changing a property's type from the property panel or a table column header shows a full per-file preview and, on confirm, recursively converts the folder database per the conversion matrix, skipping and reporting unconvertible values.
2. The chosen type (and select `allowed_values`) is pinned in `.markdownvdb.schema.yml` under the correct scope key, and after one incremental ingest the schema, table columns, and property widgets all reflect it.
3. Rename propagates a key across the scope with collision-skip semantics and updates overlay + saved views.
4. Description/required/allowed-values are editable from the UI via the overlay with no file rewrites.
5. Progress streams live; the report accounts for every enumerated file; failures never modify their file.
6. Open editors in all windows converge on the new content through the existing sync/conflict flows; the watcher never double-processes the batch.
7. Vault-root files convert alone with no pin; root tables warn vault-wide scope.
8. All new code paths covered by unit + integration + E2E tests; `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck` clean.

## Open Questions (non-blocking)

- Should a later phase offer **combined rename+retype** in one pass (single batch, single ingest)?
- Should the report offer "copy skipped file list" / open-all-skipped-in-tabs affordances?
- Should `url`/`email` gain first-class overlay types core-side (new `FieldType` variants) so the pin is honest? (CLI-repo change; revisit if presentation pins prove confusing.)
- Mid-batch cancellation for very large vaults (requires cooperative checks between files) — deferred until someone hits it.
