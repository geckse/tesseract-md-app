# PRD: Phase 42 — Frontmatter Relations (Relation Cells, Picker, Referenced-By)

## Overview

Phase 42 is the GUI layer over the CLI's phase-31 frontmatter relations (`docs/prds/phase-31-frontmatter-relations.md` in the CLI repo — the authoritative home of the shared JSON contract). Folders-as-tables (phase 39) gain foreign-key columns: frontmatter values like `client: "[[clients/acme]]"` render as clickable document chips with **server-resolved titles**, are edited through a scoped document picker, show reverse references ("Referenced by") in the properties panel, and appear as visually distinct tagged edges in the graph. The CLI resolves everything (`--populate`); the app renders and writes. **The app CAN write frontmatter** — a relation value is a plain YAML string written through the existing `src/main/frontmatter.ts` pipeline, unchanged; only the CLI is read-only. All relation capabilities are gated on the CLI version; on older CLIs the app falls back to today's phase-39/41 behavior exactly.

## Problem Statement

- A wiki link in frontmatter renders as the literal string `[[clients/acme|Acme]]` everywhere today: table cells (`StringCell`), the editable property panel (`PropertyRow` text branch), and the read-only `PropertiesPanel` (`formatValue` at `src/renderer/components/PropertiesPanel.svelte:166-172` prints it raw).
- There is no way to see which invoices point at a client (reverse lookup) short of full-text search.
- There is no picker: users hand-type paths into frontmatter, and typos produce silent dangling references.
- Phase 39 explicitly non-goaled relations ("no cross-table relations, lookups, rollups") — this phase delivers the relation part.

## Canonical JSON Contract (consumed verbatim)

> The section between the `CONTRACT-BEGIN` and `CONTRACT-END` markers is shared **verbatim** with the CLI PRD (`docs/prds/phase-31-frontmatter-relations.md`, authoritative). Edit both together or not at all.

<!-- CONTRACT-BEGIN -->

### RelationValue

Emitted wherever a relation resolves — always inside arrays:

```jsonc
{
  "raw": "[[clients/acme|Acme]]",  // the literal frontmatter value (or list element)
  "path": "clients/acme.md",       // resolved root-relative path; null only if unresolvable (e.g. empty after fragment strip)
  "exists": true,                  // resolved path is present in the index (during full ingest: the discovered file set)
  "title": "Acme Corp",            // derived server-side via the phase-29 title rule on the target; null when !exists
  "frontmatter": { "...": "..." }  // ALWAYS-present key: object | null. null when !exists OR the target has no frontmatter.
}                                  // NEVER nested: a populated target's frontmatter never contains "relations".
```

### Populate surfaces

```jsonc
// mdvdb get <path> --populate — both keys ALWAYS present under --populate, absent (not null) without it:
"relations": { "client": [ /* RelationValue */ ] },   // map keyed by frontmatter field name, alphabetical; values always arrays
"referenced_by": [ { "source": "invoices/i1.md", "field": "client", "title": "Invoice i1" } ]  // sorted by (source, field); unbounded

// mdvdb collection <path> --populate:
//   rows[].relations = the same map, computed for the RETURNED PAGE rows only.
//   rows[].frontmatter stays the RAW object — populate never mutates it (phase-29 guarantee unchanged).

// mdvdb search --populate:
//   results[].file.relations = the same map. graph_context items are NOT populated.
```

### Schema and columns

```jsonc
// mdvdb schema --json fields[] and mdvdb collection --json columns[] gain:
"field_type": "Relation",         // FieldType set is now {"String","Number","Boolean","List","Date","Mixed","Relation"} — PascalCase
"relation_target": "clients"      // string | null. Overlay-declared FK target folder. NO trailing slash emitted.
                                  // (Overlay input accepts "clients" or "clients/"; output is always normalized slash-less.)
```

### Link graph

```jsonc
// Every LinkEntry (links/backlinks/neighborhood JSON) gains an ALWAYS-present key:
"field": "client"                 // string | null. null = body link; "client" = frontmatter relation from that field.
// Frontmatter-origin entries carry "line_number": 0 (sentinel — YAML parsing loses per-key line info).
// Invariant: field != null  ⇔  line_number == 0.

// GraphEdge (mdvdb graph --json edges[]) gains the same ALWAYS-present "field": string | null.
```

### Hard guarantees

- `relations` / `referenced_by` are present **iff** populate was requested — `{}` / `[]` when empty, never `null`; both keys absent entirely without populate.
- **Relation detection is value-driven**: a key appears in `relations` iff at least one value (or list element) is link-shaped — regardless of the schema's `field_type`. (Persisted schemas go stale after single-file ingest — phase-29 RESOLVED precedent — so schema-driven detection would silently miss fresh edits.) The schema contributes only the `"Relation"` label and `relation_target`. A schema-declared Relation field whose document has no link-shaped value produces **no key**; consumers distinguish "declared but empty" via column/field metadata.
- `relations` arrays preserve the source order of list elements and preserve duplicates; non-link elements in a mixed list are skipped (they produce no RelationValue).
- `RelationValue.frontmatter` is an always-present key, `object | null` — `null` when the target is missing **or** exists without frontmatter. (Deliberately different from the phase-29 row-level "frontmatter is always an object" rule, which continues to apply to `rows[].frontmatter`.)
- **Link-shaped is a whole-value predicate.** The entire trimmed string must be exactly one of: a wiki link `[[target]]` / `[[target|alias]]`; a markdown link `[text](target)` whose target is not external (`http(s)://`, `mailto:`) or a bare `#anchor`; or a bare vault path ending in `.md` with no whitespace. `"See [[x]] for details"` is NOT a relation (that is a body-link concern).
- **Resolution order for frontmatter relation targets** (body-link resolution is UNCHANGED — source-dir-relative):
  1. Target contains `/` → resolve **root-relative** (normalize `.`/`..`, append `.md` if missing); if that path is not in the index, fall back to source-dir-relative; if neither exists, the root-relative candidate is the reported `path` with `exists: false`.
  2. Else, if the field's schema/overlay declares a `target` folder → `target + "/" + name + ".md"`.
  3. Else → source-dir-relative (same as body links).
  No vault-wide basename search (nondeterministic with duplicate basenames — future work). `#fragment` is stripped; `\` normalizes to `/`; alias text is display-only.
- **Self-references are skipped** in both the link graph and `relations` (a self-FK is meaningless).
- A body link and a frontmatter relation to the same target are **two distinct edges** (graph dedup key is `(target, field)`); duplicate values within one field dedupe in the graph but are preserved in `relations`.
- Path matching against the index is **exact-case** (`[[Clients/Acme]]` does not match `clients/acme.md`) — documented limitation.
- `field_type` serialization stays PascalCase (no `rename_all`); all new JSON keys are additive.

<!-- CONTRACT-END -->

The app **never re-implements resolution** — the CLI is the single resolver; the resolution order is reproduced above strictly for reference (and for the one client-side *display fallback* during optimistic edits, see §6.4). `search --populate` is mirrored in types for completeness but **unused by the app in v1**.

## Goals

1. Mirror the phase-31 contract in `src/renderer/types/cli.ts` + `src/preload/api.d.ts`; pass `--populate` on the table and document-get read paths.
2. `RelationCell.svelte`: resolved-title chips, broken-reference styling, click-to-navigate, edit via picker; multi-value arrays supported.
3. A decoupled `RelationPicker.svelte` reusable by table cells and property rows, scoped to `relation_target` when declared.
4. Property panel: a `relation` property type end-to-end — detect, render, edit, type icon, type picker, convert-to-relation via phase-41 property ops, target-folder annotation in Property settings.
5. `PropertiesPanel`: relation values as clickable chips + a "Referenced by" section from `get --populate`.
6. Graph view: frontmatter edges visually distinct (driven by `field != null`).
7. Feature-gate every capability on the CLI version; graceful fallback to today's string rendering on older CLIs.

## Non-Goals

- Nested populate / relations-of-relations (CLI is depth-1 only).
- **Rename propagation.** Renaming a target document does not rewrite referencing frontmatter — every reference dangles (`exists: false` chips). v1's answer is *discoverability* (Referenced-by + broken styling), not repair. State this loudly: it is by design, not a bug. Rename-repair is a future app-side write feature; the CLI's `referenced_by` + doctor check are exactly the primitives it will need.
- Rollups, lookups, or aggregation over relations.
- Relation-aware server-side sort by resolved title (sort stays server-authoritative over raw values — phase-39 rule).
- Using `search --populate` in the search UI.
- Vault-wide basename resolution (CLI non-goal, mirrored).
- A "create missing document" affordance from a broken chip (Open Question; likely a later phase).
- An edge-type filter toggle in the graph view (styling + tooltip only in v1).

## Technical Design

### 6.1 Type Mirrors (exact)

`src/renderer/types/cli.ts`:

```ts
// :151
export type FieldType = 'String' | 'Number' | 'Boolean' | 'List' | 'Date' | 'Mixed' | 'Relation'

// new, near the Schema section
export interface RelationValue {
  raw: string
  path: string | null                              // resolved candidate; null only if unresolvable
  exists: boolean
  title: string | null                             // null when !exists
  frontmatter: Record<string, JsonValue> | null    // always-present key; null when !exists or target has none
}
export interface ReferencedByEntry { source: string; field: string; title: string }

// SchemaField (:154) and CollectionColumn (:179) each gain:
relation_target: string | null                     // folder key, NO trailing slash

// CollectionRow (:191) gains:
relations?: Record<string, RelationValue[]>        // present only under --populate

// DocumentInfo gains:
relations?: Record<string, RelationValue[]>
referenced_by?: ReferencedByEntry[]

// LinkEntry (:418) gains (REQUIRED key, not optional — the CLI always emits it):
field: string | null                               // null = body link; field != null ⇔ line_number == 0

// GraphEdge (:310) gains (REQUIRED key, not optional):
field: string | null

// SearchResultFile gains relations?: Record<string, RelationValue[]>  (mirrored for completeness; unused v1)
```

`src/preload/api.d.ts` — **types here are duplicated by design; update BOTH copies** (see the loud callout in §6.6):

```ts
// CollectionViewOptions (:67-77) gains:  populate?: boolean
// getFile gains options:                 getFile(root, filePath, options?: { populate?: boolean })
// PropertyTargetType (:179-189) gains:   | 'relation'
// OverlayFieldPatch (:261-266) gains:    target?: string | null   // relation target folder annotation
```

`src/renderer/components/table/cells/types.ts` — `CellProps` gains one optional prop so every existing cell stays untouched:

```ts
relations?: RelationValue[]   // resolved values for THIS cell = row.relations?.[column.name]
```

passed by `TableRow.svelte` at the `<Cell …>` callsite.

### 6.2 CLI Version Gating

New module `src/renderer/lib/cli-features.svelte.ts`:

```ts
export const MDVDB_RELATIONS_MIN_VERSION = '<set to the mdvdb version that ships phase-31>'
class CliFeatures {
  version = $state<string | null>(null)
  get supportsRelations(): boolean
}
export const cliFeatures: CliFeatures
```

- Populated once at startup via `window.api.getCliVersion()` (the same call `StatusBar.svelte` already makes); plain numeric semver compare; **unparseable or missing version ⇒ unsupported** (safe default).
- Gates **capabilities**: passing `--populate` (table store + properties store), the `Relation` option in `TypePickerDropdown`, the target-folder field in `PropertySettingsPopover`, and the Referenced-by section.
- Never gates **rendering**: if a schema reports `field_type: 'Relation'` from any source, the `CELLS` dispatch must handle it regardless of CLI version — a Relation column must never crash the table.
- The version constant cannot be known until the CLI ships phase-31 — verify it against the actual released version at implementation time; tests must assert `--populate` is never passed when unsupported (an unknown flag errors the spawned CLI).

### 6.3 Main Process / IPC

- `src/main/ipc-handlers.ts`: `cli:collection` (`:381-401`) appends `--populate` when `options.populate`; `cli:get` accepts `{ populate?: boolean }` and appends `--populate`. No new IPC channels.
- `src/main/frontmatter.ts`: **zero changes.** A relation is a plain string (or string[]) value; the eemeli `yaml` Document API already quotes `[[...]]` correctly. This is exactly why hand-rolled YAML is banned: unquoted, `[[x]]` parses as a nested YAML flow sequence, silently corrupting the value's meaning. Verify `addRow`'s frontmatter seeding also quotes relation defaults.
- `src/main/schema-overlay.ts`: add `'relation'` to `VALID_FIELD_TYPES` (`:33-42`); in `upsertOverlayField` handle `patch.target` → `setIn([...base, 'target'], value)` / `deleteIn` on `null`; validate non-empty and **no trailing slash**, reusing the scope-key rule style at `:94-97` (phase-41 no-slash folder-key grammar — this is why the contract emits `relation_target` slash-less).
- `src/main/property-ops.ts`: `storageKindFor('relation')` → `'string'`; `overlayFieldTypeFor('relation')` → `'relation'`; `convertValue(value, 'relation')` is a **pass-through for strings and string arrays, skip (report) everything else** — converting to relation is a schema pin, never a value rewrite. Converting away from relation = the existing text conversion (values are already strings).

### 6.4 Table View

> **Populate decision: ALWAYS populate table fetches when `cliFeatures.supportsRelations`.** Phase 39 loads the full row set client-side anyway, so this is one flag on one existing CLI call; a lazy per-cell fetch would be an N-request waterfall (the exact N+1 the CLI phase eliminates). The cell needs resolved titles at first paint, and depth-1 populate is bounded. Payload-bloat risk (populated target `frontmatter` rides along even though the table only reads `title`/`path`/`exists`) is recorded in Risks with the coordinated shallow-populate future work.

- `src/renderer/stores/table.svelte.ts` `load()` (`:240-287`): pass `populate: cliFeatures.supportsRelations` to `api.collection(...)`. `requestSignature` is unchanged (the flag is constant per session); `reconcileRows` needs no change (`relations` rides on the row object and the JSON comparison covers it).
- **`RelationCell.svelte`** (new, `src/renderer/components/table/cells/`), registered in the `CELLS` map (`TableRow.svelte:25-32`) under `Relation`:
  - **Display**: one chip per RelationValue (arrays ⇒ multiple chips, `ListCell`-style layout). Chip text = `title ?? basename(path) ?? raw target`. `exists: false` ⇒ warning styling (dashed border, warning-family token, `link_off` icon) + tooltip showing the candidate path. Empty ⇒ em-dash via `isEmptyValue`.
  - **Navigate**: chip click calls `stopPropagation()` (row click selects) then `workspace.openFile(path)` — same route as `TitleCell`'s open. Only when `exists`.
  - **Edit** (dblclick, existing `startEdit`): opens `RelationPicker` anchored to the cell (the `StringCell` PopoverMenu-under-cell pattern). Single-value: pick replaces; a "Clear" item commits `null` (unset). Multi-value (current value is an array): chips gain a remove-x plus an "Add…" affordance opening the picker; commit the new string array (the `ListCell` tag-editing pattern).
  - **Commit format: always `[[<root-relative-path-without-.md>]]`** — the path contains `/`, so it is deterministic under contract resolution rule 1. No alias is written (display always comes from the server-resolved title; embedded aliases go stale). Existing values keep whatever raw form they have until the user re-picks.
  - **Optimistic reconciliation**: after `editCell` (`:407-455`) the row's `relations` is stale until the debounced reindex + reload (`:457-480`). Rule: a chip renders from the RelationValue whose `raw` equals the current frontmatter value; on mismatch (fresh optimistic edit) fall back to a client parse via `parseWikilinkText` (`src/renderer/lib/tiptap/wikilink-extension.ts:15-48`) rendering a **neutral** (not broken) chip until the server confirms. Client parsing is display-fallback only — never resolution.
- **Filter / group / sort for relation columns** (`table.svelte.ts`):
  - **Sort**: unchanged — server-authoritative over raw values (phase-39 rule). Title-sort is explicitly future work.
  - **Filters** (`matchesFilter`): `equals`/`in` adopt the CLI's `relation_key` normalization **at match time** — inner link target, strip `#fragment`, `\`→`/`, strip trailing `.md` — applied to both sides when the cell value is link-shaped, so app-side filtering matches `mdvdb --filter` semantics (CLI/app parity). **Saved views keep storing the raw filter value** (raw is the stable identity; titles are mutable and normalization at storage time would change saved-view semantics). `contains` additionally matches the **resolved title** when `row.relations` is present (users think in titles). Mixed lists: non-link items keep matching as plain strings — never dropped.
  - **Group-by** (`groups()`): group key = **resolved `path` when available, else the raw string**; display label = `title ?? raw`. `[[clients/acme]]` and `clients/acme.md` are the same FK and must land in one group — the path canonicalizes; the raw fallback keeps old-CLI behavior identical. `TableRowGroup` gains an optional `label` (defaults to `value`); `TableGroupHeader.svelte` renders it.
  - Column header: `TableHeader` shows the relation type icon; no new filter UI in v1.
  - `defaultForType`: `'Relation'` ⇒ `''` (add an explicit case).

### 6.5 RelationPicker (new, decoupled)

`src/renderer/components/RelationPicker.svelte`. Why new: `LinkAutocomplete.svelte` is welded to the TipTap `Suggestion` plugin and the `link-autocomplete-state.svelte.ts` singleton — not reusable from a cell. Reuse instead: `AutocompleteDropdown.svelte` (generic keyboard/floating listbox) plus LinkAutocomplete's data recipes (`extractTitle`, recents → hybrid `window.api.search` → `window.api.tree` fallback).

```ts
interface Props {
  anchorEl: HTMLElement
  root: string                      // collection root for CLI calls
  targetFolder?: string | null      // column.relation_target / schemaField.relation_target
  excludePaths?: string[]           // already-linked paths (multi-value add mode)
  onpick: (path: string) => void    // root-relative path WITH .md; the caller formats the raw value
  ondismiss: () => void
}
```

Behavior: inline text input above an `AutocompleteDropdown`; debounced (250 ms) + generation-guarded (LinkAutocomplete's `searchGeneration` pattern). Data source: if `targetFolder` is set → one `window.api.collection(root, targetFolder, { recursive: true })` call cached for the picker's lifetime, filtered client-side by title/path substring (scoped folders are small, and this naturally scopes the picker to the FK's table); a missing/empty target folder shows an explicit empty-state message ("No documents in `clients/`"). Else → hybrid `window.api.search` with recents when the query is empty and `window.api.tree` fallback. Primary label = title, secondary = path. Returns a path; the caller wraps it into `[[path-sans-.md]]`.

Consumers: `RelationCell` (edit mode) and `PropertyRow` (relation branch). A shared **`RelationChip.svelte`** renders the chip in both surfaces (and PropertiesPanel) to avoid three divergent implementations. Future: `LinkAutocomplete` could be refactored onto the picker — out of scope, noted.

### 6.6 Property Panel (editing surface)

- `DocumentHeader.svelte` `detectType` (`:79-99`): in the schema-override block, `if (sf?.field_type === 'Relation') return 'relation'`; in the string value-shape block, `if (/^\[\[[^\]]+\]\]$/.test(value)) return 'relation'` (shape fallback lets chips render even for ad-hoc fields and old CLIs). `getDefaultValue('relation')` ⇒ `''`.
- `PropertyRow.svelte`: the `DetectedType` union (`:10-20`) gains `'relation'`; `typeIcons` gains `relation: 'account_tree'` (**not** `link` — `url` already uses it). New `{#if fieldType === 'relation'}` branch in the value-cell dispatch: `RelationChip` list + edit affordance opening `RelationPicker`; `onValueChange('[[path]]')` (or a string array for multi-value). Resolved data source: `PropertyRow` only has `value` + `schemaField`, so `DocumentHeader` threads down a new optional `relationValues?: RelationValue[]` prop from the properties store's populated `get` (§6.7); fallback = client parse ⇒ neutral chips.
- `TypePickerDropdown.svelte` `allTypeOptions` (`:17-28`): add `{ type: 'relation', icon: 'account_tree', label: 'Relation' }`, removed via the existing `excludeTypes` when `!cliFeatures.supportsRelations` (caller passes it).
- `src/renderer/lib/property-types.ts`: `FIELD_TO_DETECTED` gains `Relation: 'relation'`. In `detectedTypeForField`, **Relation wins over `allowed_values`** (a relation with allowed_values is nonsensical; guard anyway).
- **LOUD CALLOUT — two hand-synced copies of the type vocabulary:** `DetectedType` (`PropertyRow.svelte:10-20`) and `PropertyTargetType` (`api.d.ts:179-189`) are intentionally duplicated across the renderer/preload boundary. Adding `'relation'` to one but not the other typechecks in isolation in some edit orders and then breaks the main-process property-ops path at runtime. Update **both**, plus the `property-types.ts` mapping, and add a unit test asserting the unions stay congruent.
- **Convert-to-relation**: the existing `ConvertTypeModal` flow (`src/renderer/stores/property-ops.svelte.ts`) works once the type exists — preview shows string values as `unchanged`, non-strings as `skip`; apply pins `field_type: relation` into the overlay. Post-apply refresh order unchanged (ingest → schema/table refresh → file-sync routing).
- `PropertySettingsPopover.svelte`: when the field's current type is relation, show a **"Target folder"** text input (placeholder `e.g. clients`), validated non-empty-or-null + **no trailing slash**, saved via the property-ops overlay patch (`{ target }`) → overlay `target:` key. Prefill from `schemaField.relation_target` (new optional prop). Gated on `cliFeatures.supportsRelations`. Folder autocomplete from `window.api.tree` is an Open Question (default: plain input).

### 6.7 PropertiesPanel (read-only) + Properties Store

- `src/renderer/stores/properties.ts` `loadProperties` (`:172-197`): call `window.api.getFile(collection.path, filePath, { populate: cliFeatures.supportsRelations })`; `documentInfo` now carries `relations`/`referenced_by`. **Do NOT derive referenced-by from backlinks filtered by field** — `get --populate` returns it directly, in one call.
- Frontmatter rows (`PropertiesPanel.svelte:259-277`): before the `formatValue` fallback, if `documentInfo.relations?.[key]` exists, render the `RelationChip` list; click → the existing `onfileselect({ path })`. Broken refs: warning chip, non-clickable, tooltip = candidate path.
- New collapsible **"Referenced by"** section placed with the Links sections (`:334+`), following the section-header/chevron pattern: entries grouped by `field` (subheading = field name), each row = title + source path, click → `onfileselect`. Count badge = total; section hidden when empty; **collapse past ~50 entries** ("Show all (N)") — `referenced_by` is unbounded by contract, and a hub document (1k invoices → 1 client) must not lock up the panel.
- One sentence of UX copy distinguishing **"Referenced by"** (frontmatter relations) from **"Backlinks"** (body links). Additionally, annotate existing Backlinks entries carrying `field != null` with a small field tag (`client`) — `LinkEntry.field` makes this free and keeps the two sections consistent (frontmatter edges also appear in the CLI's backlinks output).

### 6.8 Graph View

`GraphEdge.field` arrives from the CLI (`mdvdb graph`). Edges with `field != null` get a distinct treatment — dashed/short-dash line + a slightly different hue token; hover tooltip appends `via frontmatter: <field>`. Implement a single `isFrontmatterEdge(edge)` helper consumed by **both** renderer paths (cosmos GPU + 3D force graph) so styling can't drift; `src/renderer/stores/graph.ts` (→ `window.api.graphData()`) is the data hook. Styling + tooltip only; an edge-type filter toggle is future work (Non-Goals).

### 6.9 Migration Strategy

- **No persisted app-state changes.** Saved table views store raw filter values (unchanged semantics — normalization happens at match time only); no `SavedTableViewVersion` bump; electron-store untouched.
- **Old CLI + new app**: gating returns everything to phase-39/41 behavior — string cells, no Relation type option, no `--populate` flag ever passed (the CLI would reject an unknown flag).
- **New CLI + old app**: additive JSON keys are ignored by old mirrors — safe.
- **CLI index self-heal context**: the CLI ships phase-31 with an index-layout change that self-heals by deleting + rebuilding the index on first open (VERSION stays 1). The first open after a CLI upgrade may therefore present an **empty index until the next ingest** — the app already tolerates fresh/empty vaults and re-ingests; no new handling required, but expect it during upgrade testing.
- **`exists: false` window**: a target document created moments ago reports `exists: false` until reindex (contract pins `exists` = "present in the index"). Combined with optimistic edits, chips may briefly render neutral/broken after legitimate operations — the reconciliation rule (§6.4) covers it; do not "fix" by resolving client-side.

## Implementation Steps

1. **Type mirrors** — `types/cli.ts` (FieldType, `RelationValue`, `ReferencedByEntry`, `relation_target` on SchemaField/CollectionColumn, `CollectionRow.relations`, `DocumentInfo.relations/referenced_by`, `LinkEntry.field`, `GraphEdge.field`, `SearchResultFile.relations`) + `api.d.ts` (populate options, `PropertyTargetType`, `OverlayFieldPatch.target`). Typecheck-green checkpoint.
2. **`lib/cli-features.svelte.ts`** + startup wiring + unit tests.
3. **Main process** — `cli:collection`/`cli:get` populate arg; `schema-overlay.ts` `'relation'` + `target` patch member; `property-ops.ts` relation storage-kind/overlay-type/convertValue pass-through. Unit tests alongside.
4. **Preload** — thread `populate` through `getFile`/`collection` (`src/preload/index.ts`).
5. **Shared `RelationChip.svelte` + `RelationPicker.svelte`** + unit tests.
6. **Table** — `RelationCell.svelte`, `CELLS` registration, `CellProps.relations` threading in `TableRow`, table-store populate flag + relation-aware `equals`/`in`/`contains` + group-by canonicalization. Tests.
7. **Property panel** — `detectType`, `PropertyRow` branch, `TypePickerDropdown` option, `property-types.ts` mapping, `PropertySettingsPopover` target field. Tests (including the union-congruence test).
8. **PropertiesPanel** — chips + Referenced-by section + properties-store populate. Tests.
9. **Graph** — `isFrontmatterEdge` + styling + tooltip in both renderer paths.
10. **E2E flows; docs** (CLAUDE.md IPC table row for the changed `cli:get` options); lint/typecheck sweep (Node 22 for lint).

## Validation Criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` green.
- [ ] A table over a folder with relation columns shows title chips; a broken ref shows a warning chip with a candidate-path tooltip; multi-value shows N chips in source order (duplicates preserved).
- [ ] Dblclick opens the picker; with `relation_target` declared, only that folder's documents are offered; picking writes `[[path]]` into frontmatter via `updateFrontmatter` — verify the on-disk YAML value is a quoted string and the body is byte-identical.
- [ ] Chip click opens the target document; row selection is unaffected.
- [ ] Property settings pins `field_type: relation` + `target:` into `.markdownvdb.schema.yml` with comments preserved and no trailing slash.
- [ ] PropertiesPanel's Referenced-by lists referencing documents grouped by field; click navigates; long lists collapse.
- [ ] Filtering a relation column with `equals` matches `[[clients/acme]]`, `clients/acme.md`, and `clients/acme` interchangeably (relation_key parity with the CLI); non-link values filter exactly as before; saved views created pre-42 load unchanged.
- [ ] Group-by puts `[[clients/acme]]` and `clients/acme.md` in one group labeled by the resolved title.
- [ ] With an old CLI: zero relation UI, `--populate` never passed to any spawned command (asserted in tests), no errors, string rendering identical to phase 41.
- [ ] Graph renders frontmatter edges dashed with the `via frontmatter: <field>` tooltip in both GPU and 3D paths.

## Testing Strategy

**Vitest (unit):**

- `cli-features`: version parse/compare; unparseable ⇒ unsupported.
- `property-types`: `Relation → 'relation'`; relation-beats-allowed_values; **union-congruence test** importing both `DetectedType` and `PropertyTargetType`.
- `detectType`: schema `Relation` override; `[[x]]` shape fallback.
- `RelationChip`/`RelationCell` render states: resolved, broken (`exists:false`), multi-value order, empty em-dash, optimistic raw-mismatch neutral fallback, readOnly.
- `RelationCell` edit: single replace commits `'[[clients/acme]]'`; multi add/remove commits the array; clear commits `null`.
- `RelationPicker`: scoped mode calls `api.collection(targetFolder, recursive)` once and filters client-side; empty-folder empty state; unscoped debounced search; keyboard nav via `AutocompleteDropdown`; `excludePaths` honored.
- `table.svelte.ts`: `populate` passed iff supported; `equals`/`in` relation_key normalization (raw stored, normalized matched); `contains` matches resolved title; group-by canonicalization + label; mixed-list non-link items never dropped.
- Main process: `schema-overlay` writes/clears `target`, rejects trailing slash, accepts `relation` field_type (comment-preservation case); `property-ops` convert-to-relation passes strings / skips numbers & objects; `ipc-handlers` arg construction includes `--populate` when asked and **never** when unsupported (mock execFile).
- `properties` store: populate flag threading; Referenced-by grouping and order.

**E2E (Playwright)** — two flows against a fixture vault (`invoices/` → `clients/`), independently runnable and tagged (31 pre-existing failures are unrelated noise; new tests must be green in isolation):

1. **Table flow**: open invoices as a table → relation column shows client titles → edit a cell via the picker → reopen the file: frontmatter contains the raw wiki link (quoted) → chip navigates to the client doc.
2. **Panel flow**: open a client doc → Referenced-by lists invoices grouped under `client` → click navigates; Property settings pins the target folder and the overlay file contains it.

## Anti-Patterns to Avoid

- **Never resolve relations client-side** — no tree scans, no re-implementing the 3-step resolution order. The CLI is the single resolver; client parsing (`parseWikilinkText`) is a display fallback for the optimistic window only. Client resolution would drift from CLI semantics the first time either changes.
- **Never write resolved titles or aliases into frontmatter; never "auto-fix" broken refs.** The raw `[[root-relative-path]]` is the durable value; titles are display-only and mutable.
- **Never hand-concatenate YAML.** Unquoted `[[x]]` parses as a nested flow sequence — a silently corrupted value. All writes go through `frontmatter.ts` / the eemeli `yaml` Document API (which quotes correctly).
- **No per-cell CLI fetches.** One populated collection call feeds the whole table; per-cell fetches are the N+1 this feature exists to remove.
- **Don't persist normalized/resolved values in saved views or filters.** Raw is the identity; normalization happens at match time only. Persisting resolved forms breaks saved views when files move.
- **Don't add a third copy of the type union.** Exactly two documented copies exist (`DetectedType`, `PropertyTargetType`) plus the `property-types.ts` mapping — extend those, nothing else.
- **Don't rename or re-case mirrored contract fields.** `FieldType` stays PascalCase `'Relation'`; `field`/`frontmatter` are required keys (`| null`), not optional — key absence and `null` mean different things.
- **Don't bypass `schema-overlay.ts` for the `target` annotation; don't write trailing-slash folder keys.** The overlay writer is comment-preserving and enforces the phase-41 folder-key grammar.
- **Don't gate rendering on the CLI version.** Gate capabilities only — a `Relation` column arriving from any source must render (fallback chip/string), never crash the `CELLS` dispatch.

## Patterns to Follow

- Cell contract & PopoverMenu-under-cell editing: `StringCell.svelte`; array chips: `ListCell.svelte`; `CELLS` dispatch + fallback: `TableRow.svelte:25-32,96`.
- Optimistic edit → `updateFrontmatter` → debounced reindex → reload: `table.svelte.ts:407-480` (reused verbatim — no new write path).
- Floating keyboard list: `AutocompleteDropdown.svelte`; anchored popovers with focus trap/escape/outside-pointerdown: `PopoverMenu.svelte` / `PropertySettingsPopover.svelte`.
- Overlay writes: `schema-overlay.ts` upsert pattern; post-apply refresh order: `property-ops.svelte.ts` `refreshAfterApply`.
- Collapsible sections with counts: the PropertiesPanel section-header pattern.
- Contract-mirror + "consumed verbatim" section: phase-39 PRD; cross-repo cross-referencing: phase-29 ↔ phase-39.
- `prefers-reduced-motion` fallbacks on chip transitions; Material Symbols icons.

## Risks

- **Payload bloat under always-populate**: `RelationValue.frontmatter` for every relation cell of every row rides the single `collection --json` response through the 10 MB execFile buffer; a 1k-row table with multi-value relations to fat docs could hit it. The table only reads `title`/`path`/`exists`. Mitigation: measure; the pressure valve is a **shallow populate** variant (no target `frontmatter`) — flagged as coordinated future work in the CLI PRD (phase-31, Cross-Repo Coordination).
- **Optimistic staleness window**: between `updateFrontmatter` and the debounced reload, `row.relations` mismatches `row.frontmatter`; format-only edits (e.g. `clients/acme.md` → `[[clients/acme]]`) flicker neutral chips. Accepted; covered by the reconciliation rule.
- **Version-gate constant wrong**: set before the CLI release lands ⇒ either `--populate` crashes older CLIs or the feature hides on capable ones. Verify against the shipped version; tests assert the unsupported path.
- **Type-union drift** across the duplicated `DetectedType`/`PropertyTargetType` — mitigated by the congruence unit test.
- **Graph edge volume**: frontmatter edges add to body edges; dense FK folders (1k invoices → 1 client) create hub explosions in the force layout. GPU path should absorb it; watch cosmos perf — the edge-type filter toggle may need pulling forward.
- **E2E signal quality**: 31 pre-existing Playwright failures; new tests must run green in isolation and be tagged for attribution.

## Open Questions (non-blocking)

- Alias preservation: re-picking the same doc over `[[clients/acme|Acme Inc]]` writes `[[clients/acme]]` (alias dropped). Acceptable? (Default: yes — titles are server-resolved.)
- Picker "create new document in target folder" affordance — defer? (Default: defer.)
- Right-click "fix reference…" on broken table chips? (Default: dblclick-edit suffices.)
- Folder autocomplete in the target-folder input vs. plain text? (Default: plain text v1.)
- Backlinks field-tag annotation vs. fully separate sections? (Default: annotate — cheap via `LinkEntry.field`.)

## Cross-Repo Coordination

CLI counterpart: `docs/prds/phase-31-frontmatter-relations.md` (CLI repo) — the authoritative contract. The app's type mirror must land with (or gate on) the CLI release. Coordinated future work flagged in both PRDs: the **shallow populate** variant for collection payload pressure. App-side future work enabled by the CLI primitives: rename-repair ("update N references?" on file rename, driven by `referenced_by` + the doctor dangling-relations check).
