# PRD: Frontmatter Editor Redesign & Inline File Rename

## Overview

Redesign the frontmatter editor from a hidden accordion into an always-visible, dedicated document header section above the editor content. Add an inline file name editor above the frontmatter. Make adding and editing properties highly interactive with smart type detection, type-specific input widgets (date pickers, datetime pickers, toggles, tag inputs), schema-driven suggestions, and a Notion-style "add property" flow with type selection.

## Problem Statement

The current frontmatter editor is buried behind a collapsed accordion toggle labeled "FRONTMATTER" in small uppercase text. Users don't discover it, and when they do, it requires an extra click to expand. The inputs are generic — dates render as plain text, there's no datetime support, and adding a new property gives a blank key/value pair with no guidance. The file name is shown read-only in the header breadcrumb with no way to rename. This makes the most important document metadata (title, tags, status, dates) harder to access and edit than it should be.

## Goals

- **Always-visible frontmatter section** — no accordion, no toggle, properties shown immediately when a document has frontmatter
- **Inline file name editor** — editable file name above the frontmatter, with rename-on-blur semantics
- **Smart type detection** — automatically detect and render appropriate widgets for: text, number, boolean, date, datetime, array/tags, select/enum, URL, email, complex objects
- **Date picker** — native or custom date picker for `YYYY-MM-DD` values
- **DateTime picker** — combined date + time picker for ISO 8601 datetime values (`YYYY-MM-DDTHH:mm`)
- **Type selector on new property** — when adding a property, show a type picker dropdown so users can choose the field type upfront
- **Schema-driven suggestions** — field name autocomplete, value suggestions, constrained dropdowns from schema data
- **Property type icons** — each row shows a type icon (text, number, date, list, toggle, link) for visual scanning
- **Smooth interactions** — inline editing, click-to-edit values, no modal dialogs

## Non-Goals

- **File move/reorganize** — renaming changes only the filename, not the directory
- **Frontmatter schema enforcement** — suggestions and type hints, but no hard validation that blocks saving
- **Frontmatter in source/raw mode** — this redesign targets WYSIWYG mode only; raw mode continues showing YAML
- **Custom field type definitions** — types are auto-detected or selected from a fixed set, not user-extensible
- **Batch property editing** — editing properties across multiple files simultaneously

## Technical Design

### 1. New IPC Channel: File Rename

Add one new IPC channel to `app/src/main/ipc-handlers.ts`:

| Channel | Signature | Purpose |
|---|---|---|
| `fs:rename-file` | `(oldPath: string, newPath: string) → void` | Rename/move a file. Both paths must be within the same collection. Uses `fs.rename()`. |

**Preload type** (`app/src/preload/api.d.ts`):
```typescript
renameFile(oldAbsolutePath: string, newAbsolutePath: string): Promise<void>
```

**Preload bridge** (`app/src/preload/index.ts`):
```typescript
renameFile: (oldPath, newPath) => invoke('fs:rename-file', oldPath, newPath),
```

**Validation**: Both `oldPath` and `newPath` must resolve within the same collection directory. The new path's parent directory must exist. Fail with descriptive error if the target already exists.

**Post-rename effects**: After successful rename, the renderer must:
1. Update the active tab's `filePath` and `title`
2. Refresh the file tree
3. Update the index via `mdvdb ingest` (incremental — detects the move)

### 2. Extended Type Detection

Replace the current `detectType()` function with a richer type system. The current types are: `text`, `number`, `boolean`, `date`, `array`, `complex`. Extend to:

| Type | Detection Rule | Widget |
|---|---|---|
| `boolean` | `typeof value === 'boolean'` | Toggle switch |
| `number` | `typeof value === 'number'` | Number input with stepper |
| `date` | String matching `/^\d{4}-\d{2}-\d{2}$/` | Date picker (calendar popup) |
| `datetime` | String matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ ` | DateTime picker (calendar + time) |
| `url` | String matching `/^https?:\/\//` | URL input with open-link button |
| `email` | String matching `/^[^@]+@[^@]+\.[^@]+$/` | Email input with mailto button |
| `select` | Schema field has `allowed_values` | Dropdown select |
| `tags` | `Array.isArray(value)` | Tag pills with autocomplete input |
| `text` | Default string fallback | Text input with value autocomplete |
| `complex` | Non-null object (not array) | JSON textarea |

**Schema override**: If a schema field specifies `field_type: 'Date'`, force date picker even if the current value doesn't match the regex (e.g., empty string). Similarly for other types.

### 3. Component Architecture

#### 3.1 `DocumentHeader.svelte` (NEW)

Top-level container that replaces the current `FrontmatterEditor` embedding in `WysiwygEditor.svelte`. Positioned above the TipTap editor content area.

```
┌─────────────────────────────────────────────────────────┐
│  📄  my-document.md                            [rename] │  ← FileNameEditor
├─────────────────────────────────────────────────────────┤
│  ≡ title        System Architecture                     │  ← PropertyRow (text)
│  🏷 tags         [architecture] [backend] [infra]  [+]  │  ← PropertyRow (tags)
│  ≡ category      documentation                    [▾]   │  ← PropertyRow (select)
│  👤 author       Jane Chen                              │  ← PropertyRow (text)
│  ◉ status        ● published                            │  ← PropertyRow (select/status)
│  📅 created      2024-03-15                       [📅]  │  ← PropertyRow (date)
│  📅 updated      2024-03-15T14:30             [📅⏰]    │  ← PropertyRow (datetime)
│  🔢 version      2                                      │  ← PropertyRow (number)
│  ☐ reviewed      ✓                                      │  ← PropertyRow (boolean)
│                                                         │
│  + Add property                                    [⋯]  │  ← AddPropertyRow
└─────────────────────────────────────────────────────────┘
│                                                         │
│  (TipTap editor content starts here)                    │
│                                                         │
```

**Props**:
```typescript
interface Props {
  frontmatterYaml: string | null
  onFrontmatterUpdate: (newYaml: string | null) => void
  schema: Schema | null
  filePath: string              // For FileNameEditor
  collectionPath: string        // For rename validation
  onFileRenamed: (newPath: string) => void
}
```

#### 3.2 `FileNameEditor.svelte` (NEW)

Inline editable file name at the top of the document header.

**Behavior**:
- Displays the file name (without directory path, without `.md` extension) as large, editable text
- Click to focus and edit. Show the `.md` extension grayed out and non-editable
- On blur or Enter: if name changed, call `window.api.renameFile(oldPath, newPath)` and emit `onFileRenamed`
- On Escape: revert to original name
- Validate: no empty names, no path separators, no invalid filesystem characters
- Show error inline (red border + message) if rename fails (e.g., target exists)
- File icon to the left of the name, matching the current file type

**Styling**:
- Font: `--font-display` (Space Grotesk), `--text-xl` (20px), `--color-text` (#e4e4e7)
- Transparent background, border only on hover/focus
- `.md` suffix in `--color-text-dim` (#71717a)

#### 3.3 `PropertyRow.svelte` (NEW)

Single property row with type icon, key label, and type-specific value widget.

**Props**:
```typescript
interface Props {
  rowKey: string
  value: JsonValue
  fieldType: DetectedType               // 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'email' | 'select' | 'tags' | 'complex'
  schemaField: SchemaField | null       // For suggestions, allowed_values, description, required
  onKeyChange: (newKey: string) => void
  onValueChange: (newValue: JsonValue) => void
  onRemove: () => void
}
```

**Layout**: Three columns — type icon (24px) | key (120px, editable) | value (flex, type-specific widget) | remove button (on hover)

**Type Icons** (Material Symbols):
| Type | Icon | Symbol Name |
|---|---|---|
| text | ≡ | `notes` |
| number | # | `tag` |
| boolean | ☐ | `check_box_outline_blank` / `check_box` |
| date | 📅 | `calendar_today` |
| datetime | 📅⏰ | `event` |
| url | 🔗 | `link` |
| email | ✉ | `mail` |
| select | ▾ | `arrow_drop_down_circle` |
| tags | 🏷 | `sell` |
| complex | {} | `data_object` |

**Key label**: Monospace, `--color-text-dim`, uppercase. Click to edit. Shows tooltip with `schemaField.description` if available. Required indicator (*) in cyan if `schemaField.required`.

**Value widgets by type**:

- **text**: Inline text input. On focus, show sample_values autocomplete if available.
- **number**: Number input with up/down stepper arrows.
- **boolean**: Toggle switch (existing design, cyan when on).
- **date**: Text input showing `YYYY-MM-DD`. Clicking the calendar icon (or the value) opens a date picker popover.
- **datetime**: Text input showing `YYYY-MM-DDTHH:mm`. Clicking opens a combined date + time picker popover.
- **url**: Text input. Small "open" icon button that opens the URL in the default browser.
- **email**: Text input. Small "mail" icon button.
- **select**: Dropdown with `allowed_values`. Current value preserved even if not in the list.
- **tags**: Tag pills with `×` remove. Inline input with `+ tag` placeholder. Autocomplete from `sample_values`.
- **complex**: Expandable JSON textarea.

#### 3.4 `DatePicker.svelte` (NEW)

Custom date picker popover component. Not using `<input type="date">` because native date pickers have inconsistent styling and don't respect the dark theme.

**Behavior**:
- Calendar grid showing one month at a time
- Navigation: `<` / `>` arrows for month, click month/year header to switch to month picker / year picker
- Click a day to select. Selected day highlighted in cyan
- Today indicator (subtle dot or ring)
- Keyboard: Arrow keys to navigate days, Enter to select, Escape to close
- Anchored to the input field via Floating UI (same pattern as AutocompleteDropdown)

**Styling**: Dark theme matching the app. Background `--color-surface`, border `--color-border`, selected day `--color-primary`, today `--color-primary-dim`.

#### 3.5 `DateTimePicker.svelte` (NEW)

Extends DatePicker with a time input section below the calendar.

**Behavior**:
- Calendar grid (same as DatePicker) on top
- Time input below: hour (00–23) and minute (00–59) as two number inputs with steppers, or a combined `HH:mm` text input
- Output format: `YYYY-MM-DDTHH:mm`
- "Now" button that sets current date and time
- "Clear time" button that converts datetime to date-only

#### 3.6 `AddPropertyRow.svelte` (NEW)

Interactive "add property" row at the bottom of the frontmatter section.

**Behavior**:
1. Shows `+ Add property` button (subtle, left-aligned)
2. On click, transforms into an inline input for the property name
3. As the user types, show autocomplete dropdown with:
   - Schema fields not yet used (with type badge and description)
   - Free-text option: "Create `{typed text}`" at the bottom
4. After selecting/entering a name, show a **type picker dropdown**:
   - Grid or list of type options: Text, Number, Boolean, Date, DateTime, URL, Tags, Select
   - Each option shows the type icon + label
   - If a schema field was selected, auto-pick the matching type and skip this step
5. After type selection, insert the new row with appropriate default value and focus the value input
6. Pressing Escape at any step cancels and reverts to the `+ Add property` button

**Default values by type**:
| Type | Default Value |
|---|---|
| text | `''` (empty string) |
| number | `0` |
| boolean | `false` |
| date | Today's date (`YYYY-MM-DD`) |
| datetime | Current datetime (`YYYY-MM-DDTHH:mm`) |
| url | `'https://'` |
| email | `''` |
| select | First `allowed_values` item, or `''` |
| tags | `[]` (empty array) |
| complex | `{}` |

#### 3.7 `TypePickerDropdown.svelte` (NEW)

Dropdown for selecting a property type when adding a new row.

**Layout**: 2-column grid of type options, each showing icon + label. Highlighted on hover. Keyboard navigable (arrow keys + Enter).

**Types shown**: Text, Number, Boolean, Date, DateTime, URL, Email, Tags, Select, JSON

### 4. Integration into WysiwygEditor

**File**: `app/src/renderer/components/WysiwygEditor.svelte`

Replace the current `<FrontmatterEditor>` embedding (line ~720) with `<DocumentHeader>`:

```svelte
{#if activeDocTab}
  <div class="wysiwyg-editor-container">
    <ConflictNotification />
    <DocumentHeader
      frontmatterYaml={currentFrontmatter}
      onFrontmatterUpdate={handleFrontmatterUpdate}
      schema={currentSchema}
      filePath={activeDocTab.filePath}
      collectionPath={currentActiveCollection?.path ?? ''}
      onFileRenamed={handleFileRenamed}
    />
    <!-- TipTap editor area below -->
```

**`handleFileRenamed` callback**: Updates the tab's `filePath` and `title`, refreshes the file tree, triggers incremental ingest.

### 5. Styling Guidelines

**Document header area**:
- Background: `--color-surface` (#161617) or transparent (blends with editor background)
- No card border — properties flow naturally as part of the document
- Padding: `1rem 4rem` (matching editor content margins)
- Subtle divider line (`--color-border`) between file name and properties, and between properties and editor content

**Property rows**:
- Row height: ~36px
- Hover: subtle background highlight (`rgba(255, 255, 255, 0.03)`)
- Key text: `--font-mono`, 11px, `--color-text-dim`, uppercase
- Value text: `--font-mono`, 13px, `--color-text`
- Type icon: 16px, `--color-text-dim`, brightens to `--color-primary` on row hover
- Remove button: appears on row hover, right side, `--color-text-dim` → `--color-error` on hover
- Row gap: 0 (tight spacing, rows separated by alignment only)

**Transitions**: All hover/focus state changes use `150ms ease`. Respect `prefers-reduced-motion`.

**Add property row**: `--color-text-dim` text, `+` icon. On hover: `--color-text` text. No background change.

### 6. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Tab` / `Shift+Tab` | Navigate between property values |
| `Enter` | Confirm edit, move to next row value |
| `Escape` | Cancel edit, revert to previous value |
| `Cmd+Shift+P` | Focus the "Add property" input |
| Arrow keys in dropdowns | Navigate options |

### 7. Empty State

When a document has no frontmatter:
- Show the file name editor
- Show a subtle `+ Add property` link below it
- When the first property is added, frontmatter is created automatically
- When the last property is removed, frontmatter is removed (YAML delimiters stripped)

### 8. Removing the Old FrontmatterEditor

Delete `app/src/renderer/components/wysiwyg/FrontmatterEditor.svelte` after the new `DocumentHeader` is fully functional. Update all imports and tests accordingly. The `AutocompleteDropdown.svelte` component is reused by the new components.

## Implementation Order

| Step | Task | Files | Dependencies |
|---|---|---|---|
| 1 | Add `fs:rename-file` IPC channel | `ipc-handlers.ts`, `api.d.ts`, `index.ts` | None |
| 2 | Create `PropertyRow.svelte` with all type-specific widgets (except date/datetime pickers) | `components/wysiwyg/PropertyRow.svelte` | None |
| 3 | Create `DatePicker.svelte` calendar popover | `components/wysiwyg/DatePicker.svelte` | Floating UI |
| 4 | Create `DateTimePicker.svelte` extending DatePicker | `components/wysiwyg/DateTimePicker.svelte` | Step 3 |
| 5 | Create `TypePickerDropdown.svelte` | `components/wysiwyg/TypePickerDropdown.svelte` | None |
| 6 | Create `AddPropertyRow.svelte` with name input + type picker flow | `components/wysiwyg/AddPropertyRow.svelte` | Steps 2, 5 |
| 7 | Create `FileNameEditor.svelte` | `components/wysiwyg/FileNameEditor.svelte` | Step 1 |
| 8 | Create `DocumentHeader.svelte` composing FileNameEditor + PropertyRows + AddPropertyRow | `components/wysiwyg/DocumentHeader.svelte` | Steps 2–7 |
| 9 | Integrate DocumentHeader into WysiwygEditor, remove old FrontmatterEditor | `WysiwygEditor.svelte` | Step 8 |
| 10 | Update tests | `tests/unit/` | Step 9 |

## Verification

- Open a markdown file with frontmatter → file name is editable, all properties are visible without clicking
- Rename a file → file tree updates, tab title updates, breadcrumb updates
- Add a new property → type picker appears, selecting "Date" inserts a date picker row
- Edit a date field → calendar popover opens with the current date selected
- Edit a datetime field → calendar + time picker popover opens
- Boolean field → toggle switch works inline
- Tags field → add/remove tags, autocomplete from schema `sample_values`
- Select field → dropdown with `allowed_values`, preserves custom values
- URL field → shows open-in-browser icon
- Remove a property → row disappears, YAML updated
- Empty frontmatter → shows file name + "Add property" link
- Keyboard navigation → Tab through values, Enter to confirm, Escape to cancel

## Testing

### Unit Tests (`app/tests/unit/`)

| Test File | What to Test |
|---|---|
| `document-header.test.ts` | Renders file name + properties, emits updates, handles empty frontmatter |
| `file-name-editor.test.ts` | Rename flow, validation (empty name, invalid chars), error display, escape to cancel |
| `property-row.test.ts` | Each type renders correct widget, value changes emit updates, type icon matches |
| `date-picker.test.ts` | Month navigation, day selection, keyboard navigation, today indicator |
| `datetime-picker.test.ts` | Date + time selection, "Now" button, format output |
| `add-property-row.test.ts` | Name input → autocomplete → type picker → row insertion flow |
| `type-picker-dropdown.test.ts` | All types shown, keyboard navigation, selection callback |
| `rename-ipc.test.ts` | IPC handler validates paths, calls fs.rename, rejects cross-collection moves |
