# PRD: App Phase 23 — Schema-Aware Frontmatter Editor

## Overview

Make the app's FrontmatterEditor component aware of the Rust backend's schema system so it can suggest field names, autocomplete values, show constrained dropdowns for fields with allowed values, display description tooltips, and mark required fields. Uses the path-scoped schema from core Phase 23 to provide context-aware suggestions based on the file's directory.

## Problem Statement

The app's FrontmatterEditor is entirely free-form. Users type field names from memory, guess at valid values, and have no indication which fields are standard for their content type. The Rust backend already infers rich schema metadata — field types, sample values (up to 20 unique per field), allowed values (from overlay config), descriptions, and required flags — but none of this reaches the editor UI. This wastes the schema system's potential and forces users to maintain frontmatter consistency manually.

## Goals

- Field name suggestions when adding a new frontmatter property (shows unused schema fields with type labels)
- Value autocomplete for text fields using `sample_values` from the schema
- Constrained dropdowns for fields with `allowed_values` (renders `<select>` instead of free text)
- Tag autocomplete for array fields using `sample_values`, filtering out already-used values
- Description tooltips on field keys from schema `description`
- Required field indicators (`*` in accent color) for fields marked `required: true`
- Scoped schema: suggestions change based on the open file's directory (uses `--path` from core Phase 23)
- Graceful fallback: everything works as before when no schema is available

## Non-Goals

- No schema editing UI (users edit `.markdownvdb.schema.yml` manually or via code editor)
- No frontmatter validation or enforcement (schema is advisory)
- No inline error messages for wrong-typed values
- No schema for nested frontmatter fields (only top-level keys)

## Technical Design

### Data Flow

```
File opened in editor
  → derive path prefix from file's parent directory
  → window.api.schema(root, prefix)
  → IPC: mdvdb schema --path <prefix> --json
  → scoped Schema returned (fields relevant to this directory)
  → passed as prop to FrontmatterEditor
  → powers suggestions, dropdowns, tooltips, indicators
```

### Interface Changes

**IPC bridge** — `app/src/main/ipc-handlers.ts` (line 267):

```typescript
// Before:
ipcMain.handle('cli:schema', (_event, root: string) =>
  wrapHandler(() => execCommand<Schema>('schema', [], root))
)

// After:
ipcMain.handle('cli:schema', (_event, root: string, path?: string) => {
  const args: string[] = []
  if (path) args.push('--path', path)
  return wrapHandler(() => execCommand<Schema>('schema', args, root))
})
```

**Preload API** — `app/src/preload/index.ts` (line 45):

```typescript
// Before:
schema: (root) => invoke('cli:schema', root),

// After:
schema: (root, path?) => invoke('cli:schema', root, path),
```

**Type declaration** — `app/src/preload/api.d.ts` (line 97):

```typescript
schema(root: string, path?: string): Promise<Schema>
```

**FrontmatterEditor props** — `app/src/renderer/components/wysiwyg/FrontmatterEditor.svelte`:

```typescript
interface Props {
  frontmatterYaml: string | null
  onUpdate: (newYaml: string | null) => void
  schema: Schema | null  // NEW — nullable for graceful fallback
}
```

### New Commands / API / UI

**Schema Store** — NEW `app/src/renderer/stores/schema.ts`:

```typescript
import { writable } from 'svelte/store'
import type { Schema } from '../types/cli'

export const collectionSchema = writable<Schema | null>(null)

export async function fetchSchema(root: string, path?: string): Promise<void> {
  try {
    const schema = await window.api.schema(root, path)
    collectionSchema.set(schema)
  } catch {
    collectionSchema.set(null)
  }
}
```

**AutocompleteDropdown** — NEW `app/src/renderer/components/wysiwyg/AutocompleteDropdown.svelte`:

Reusable floating dropdown for value/field suggestions.

Props:
- `suggestions: string[]` — filtered list of suggestions
- `onSelect: (value: string) => void` — callback when a suggestion is picked
- `anchorEl: HTMLElement | null` — input element to position against
- `secondaryLabels?: Map<string, string>` — optional type labels (e.g., "List", "Date")

Behavior:
- Positioned with `@floating-ui/dom` (`computePosition` + `flip` + `shift` + `offset(8)`)
- Arrow up/down to navigate, Enter/Tab to select, Escape to dismiss
- Mouse click to select
- Max 6 visible items with overflow scroll
- Style matches `SlashCommandMenu.svelte`: `background: #161617`, `border: 1px solid #27272a`, item hover `#27272a`

**FrontmatterEditor enhancements:**

| Feature | Trigger | Behavior |
|---------|---------|----------|
| Field name suggestions | Focus on empty key input after `addProperty()` | Show AutocompleteDropdown with schema field names not already used. Secondary label shows field type. Selecting fills key + sets type-appropriate default value (`''` for String, `false` for Boolean, `[]` for List, `0` for Number, today's date for Date). |
| Value autocomplete | Focus on text input for a string field | If schema field has `sample_values` and no `allowed_values`, show AutocompleteDropdown filtered by typed text. Selecting fills value. |
| Constrained dropdown | Render of field with `allowed_values` | Replace `<input type="text">` with styled `<select>`. Options from `allowed_values`. Include current value even if not in list (preserve data). |
| Tag autocomplete | Typing in `.fm-tag-input` | If schema field (type List) has `sample_values`, show AutocompleteDropdown filtering out already-used values. Enter still works for free-form. |
| Description tooltip | Render of field key | Set `title` attribute on `.fm-key` input from `getSchemaField(key)?.description`. |
| Required indicator | Render of field key | Show `*` in accent color (`#00E5FF`) after key name when `getSchemaField(key)?.required` is true. |

### Migration Strategy

- No data migration needed — this is purely a UI enhancement
- Existing FrontmatterEditor behavior is preserved when `schema` is `null`
- IPC bridge change is backward compatible (optional parameter)
- Depends on core Phase 23 for `--path` support in `mdvdb schema`; falls back to global schema if `--path` is not available

## Implementation Steps

1. **Update IPC bridge** — `app/src/main/ipc-handlers.ts` (line 267): Add optional `path` parameter to `cli:schema` handler. Pass as `--path` arg to CLI when present.

2. **Update preload API** — `app/src/preload/index.ts` (line 45): Add optional `path` parameter to `schema()`. Update `app/src/preload/api.d.ts` (line 97) type declaration to match.

3. **Create schema store** — NEW `app/src/renderer/stores/schema.ts`: Writable store `collectionSchema` of type `Schema | null`. Async `fetchSchema(root, path?)` function. Silently catches errors (sets null).

4. **Create AutocompleteDropdown** — NEW `app/src/renderer/components/wysiwyg/AutocompleteDropdown.svelte`: Floating dropdown following `SlashCommandMenu.svelte` patterns. Position with `@floating-ui/dom`. Keyboard navigation (arrow keys, Enter, Escape). Mouse selection. Dark theme styling. `@media (prefers-reduced-motion: reduce)` fallback for transitions.

5. **Wire schema into WysiwygEditor** — `app/src/renderer/components/WysiwygEditor.svelte` (line 329): Import `collectionSchema` and `fetchSchema`. Add `$effect` that watches `selectedFilePath` and `activeCollection` — when file changes, derive path prefix from file's parent directory and call `fetchSchema(root, prefix)`. Root-level files (no `/` in path) call `fetchSchema(root)` without prefix (global schema). Pass `$collectionSchema` as `schema` prop to `FrontmatterEditor`.

6. **Add schema prop to FrontmatterEditor** — `app/src/renderer/components/wysiwyg/FrontmatterEditor.svelte`: Add `schema: Schema | null` to Props. Add `getSchemaField(key)` helper. All schema-aware features check `if (schema)` first.

7. **Field name suggestions** — `FrontmatterEditor.svelte`: Track autocomplete state (`activeAutocomplete: { rowId: number, field: 'key' | 'value' } | null`). On `addProperty()`, when the new row's key input focuses and is empty, compute unused schema fields, show AutocompleteDropdown with field names + type as secondary label. On select, fill key and set type-appropriate default value.

8. **Value autocomplete for text fields** — `FrontmatterEditor.svelte`: On focus of a text value input, if `getSchemaField(row.key)` has `sample_values` and no `allowed_values`, show AutocompleteDropdown anchored to the input, filtered by current input text. On select, call `updateValue()`.

9. **Constrained dropdowns** — `FrontmatterEditor.svelte`: In the text input render branch (line 202-221), check `getSchemaField(row.key)?.allowed_values`. If non-null, render a styled `<select>` with those options instead of `<input>`. Add current value as an option if not in the list. Style select to match dark theme.

10. **Tag autocomplete** — `FrontmatterEditor.svelte`: In the tag input section (line 179-187), on input in `.fm-tag-input`, if schema field has `sample_values`, show AutocompleteDropdown with values not already in the array. On select, add the tag.

11. **Description tooltips** — `FrontmatterEditor.svelte`: On the `.fm-key` input (line 137-144), add `title={getSchemaField(row.key)?.description ?? ''}`.

12. **Required indicators** — `FrontmatterEditor.svelte`: After the `.fm-key` input, conditionally render `{#if getSchemaField(row.key)?.required}<span class="fm-required">*</span>{/if}` with `.fm-required { color: #00E5FF; font-size: 10px; margin-left: 2px; }`.

13. **Unit tests** — NEW `app/tests/unit/schema-store.test.ts`: Mock `window.api.schema`, test `fetchSchema` populates store, test failure sets null, test with path parameter passes correctly.

14. **FrontmatterEditor tests** — NEW `app/tests/unit/frontmatter-editor-schema.test.ts`: Test rendering with `schema: null` (no regression, no autocomplete). Test `allowed_values` renders `<select>`. Test required `*` indicator renders for required fields. Test `title` attribute set from description. Test AutocompleteDropdown keyboard navigation.

## Validation Criteria

- [ ] `cd app && npm test` passes — all existing tests plus new schema store and frontmatter editor tests
- [ ] `cd app && npm run typecheck` passes with no errors
- [ ] FrontmatterEditor renders normally when `schema` is `null` (no collection indexed, no CLI available)
- [ ] Clicking "+" on frontmatter card shows field name suggestions from scoped schema
- [ ] Selecting a field name suggestion fills key and sets type-appropriate default value
- [ ] String fields show autocomplete dropdown with sample values on focus
- [ ] Typing in a string field filters the autocomplete suggestions
- [ ] Fields with `allowed_values` render as `<select>` dropdown instead of text input
- [ ] Current value is preserved in dropdown even if not in `allowed_values` list
- [ ] Tag inputs show autocomplete from `sample_values`, filtering out already-used tags
- [ ] Required fields show `*` indicator in accent color (`#00E5FF`)
- [ ] Field descriptions appear as native tooltips on key inputs
- [ ] Schema refetches when switching to a file in a different directory
- [ ] Root-level files (no parent directory) get global schema suggestions
- [ ] AutocompleteDropdown supports keyboard navigation (arrows, Enter, Escape)
- [ ] All transitions have `@media (prefers-reduced-motion: reduce)` fallback

## Anti-Patterns to Avoid

- **Do NOT fetch schema on every keystroke** — Fetch once when the file changes (path changes). Cache in the store. The schema is scope-wide, not per-keystroke.

- **Do NOT break the FrontmatterEditor when schema is unavailable** — Every schema-powered feature must check `if (schema)` first. No collection indexed? No scope match? CLI not found? Component works exactly as before.

- **Do NOT validate frontmatter against the schema** — Schema powers suggestions, not enforcement. A value not in `allowed_values` is fine — show it in the dropdown but don't flag it as an error.

- **Do NOT lose data when rendering constrained fields** — If the current value isn't in `allowed_values`, include it as an extra option in the `<select>`. Never silently change or discard existing values.

- **Do NOT import stores directly in FrontmatterEditor** — Pass schema as a prop from WysiwygEditor. Keeps FrontmatterEditor testable and presentational.

- **Do NOT use `setTimeout` for dropdown dismiss** — Use proper blur/focus event handling with `relatedTarget` checks, same as existing tag input pattern.

## Patterns to Follow

- **IPC handler pattern** — `cli:graph` handler in `app/src/main/ipc-handlers.ts` (line 260) shows optional parameters: `if (path) args.push('--path', path)`.

- **Store pattern** — `app/src/renderer/stores/collections.ts` shows writable store + async fetch + fire-and-forget (`fetchCollectionStatus(id).catch(() => {})`). Schema store mirrors this exactly.

- **Floating dropdown pattern** — `SlashCommandMenu.svelte` in `app/src/renderer/components/wysiwyg/SlashCommandMenu.svelte` uses `@floating-ui/dom` (`computePosition` + `flip` + `shift` + `offset`), keyboard navigation via `handleKeyDown`, and dark theme styling. `AutocompleteDropdown` follows the same approach.

- **FrontmatterEditor prop extension** — `FrontmatterEditor.svelte` (line 5-8) shows the existing Props interface. Adding `schema` is a non-breaking extension.

- **Reactive effect for data fetching** — `WysiwygEditor.svelte` already uses `$effect` blocks for watching store changes and triggering side effects. The schema fetch follows the same reactive pattern.

- **Component test mocking** — Existing tests in `app/tests/unit/` mock `window.api` before importing components. Schema store tests follow the same `Object.defineProperty(globalThis, 'window', ...)` pattern.
