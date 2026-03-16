# PRD: Rich Table Editing

## Overview

Add GitBook-style rich table editing to the Tiptap WYSIWYG editor. Users get a right-click context menu on table cells (insert/delete/move rows and columns, toggle headers, delete table) and a floating toolbar above focused tables with quick-access buttons. Tables remain standard Markdown pipe tables — no merge/split, no column resize. All operations round-trip cleanly through `@tiptap/markdown`.

## Problem Statement

The editor can insert 3x3 tables via the `/Table` slash command, but once a table exists there is no way to manipulate it. Users cannot add or remove rows/columns, reorder them, toggle header rows, or delete the table without manually editing source markdown. This makes tables nearly unusable for anything beyond the initial 3x3 default.

## Goals

- Right-click any table cell to get a context menu with row, column, and table operations
- Floating toolbar appears above the table when any cell is focused
- Insert rows above/below and columns left/right at any position
- Delete rows, columns, or the entire table
- Move rows up/down and columns left/right (reorder)
- Toggle the first row as a header row
- All operations produce valid Markdown pipe tables via `@tiptap/markdown`
- Keyboard-accessible: arrow key navigation in context menu, Escape to dismiss
- Undo/redo works for all operations (ProseMirror transactions)

## Non-Goals

- Cell merging/splitting (colspan/rowspan) — would require HTML table output, breaking Markdown compatibility
- Column resizing — Markdown pipe tables have no width concept
- Drag-and-drop row/column reordering — deferred to a future phase; v1 uses context menu "move" items
- Cell text alignment (left/center/right) — could be added later via `:---`, `:---:`, `---:` separators
- Table creation wizard (row/col picker grid) — the existing `/Table` slash command is sufficient

## Technical Design

### Current State

| Component | Status |
|-----------|--------|
| `@tiptap/extension-table` (TableKit) v3 | Installed, configured in `editor-factory.ts` line 83 |
| `@tiptap/markdown` | Installed, handles table serialization |
| Table CSS | Basic styles in `wysiwyg-theme.css` lines 323-367 |
| Slash command `/Table` | Inserts 3x3 with header row |
| Right-click context menu | Does not exist anywhere in the app |
| Table toolbar | Does not exist |

### Available Tiptap Table Commands

These are provided by `@tiptap/extension-table` (TableKit) and require no custom implementation:

```
insertTable({ rows, cols, withHeaderRow })
addColumnBefore() / addColumnAfter()
addRowBefore() / addRowAfter()
deleteColumn() / deleteRow()
deleteTable()
toggleHeaderRow() / toggleHeaderColumn() / toggleHeaderCell()
setCellAttribute(name, value)
goToNextCell() / goToPreviousCell()
```

### Architecture

One new Tiptap Extension (`table-ui-extension.ts`) creates a ProseMirror plugin that manages two Svelte components:

```
table-ui-extension.ts (Extension + ProseMirror Plugin)
├── Intercepts contextmenu events on table cells
│   └── Mounts TableContextMenu.svelte at cursor position
└── Tracks cursor position on every transaction
    └── Mounts/unmounts TableToolbar.svelte above focused table
```

This follows the exact architecture of the existing `link-bubble-extension.ts`.

### Interface Changes

#### New Extension

```typescript
// table-ui-extension.ts
export const TableUIExtension: Extension
```

Registered in `editor-factory.ts` extensions array after `TableKit`.

#### TableContextMenu Props

```typescript
interface Props {
  editor: Editor
  anchorPos: { x: number; y: number }  // right-click coordinates
  cellInfo: {
    isHeaderRow: boolean
    rowIndex: number
    colIndex: number
    totalRows: number
    totalCols: number
  }
  onClose: () => void
}
```

#### TableToolbar Props

```typescript
interface Props {
  editor: Editor
  tableEl: Element              // <table> DOM element for positioning
  cellInfo: {
    isHeaderRow: boolean
    totalRows: number
    totalCols: number
  }
}
```

### New UI Components

#### Right-Click Context Menu

Appears on `contextmenu` event when clicking inside a table cell. Grouped with separators:

**Row operations:**
| Item | Icon | Tiptap Command | Disabled When |
|------|------|----------------|---------------|
| Insert row above | `keyboard_arrow_up` | `addRowBefore()` | never |
| Insert row below | `keyboard_arrow_down` | `addRowAfter()` | never |
| Move row up | `arrow_upward` | custom transaction | first data row |
| Move row down | `arrow_downward` | custom transaction | last row |
| Delete row | `delete` | `deleteRow()` | `totalRows <= 1` |

**Column operations:**
| Item | Icon | Tiptap Command | Disabled When |
|------|------|----------------|---------------|
| Insert column left | `keyboard_arrow_left` | `addColumnBefore()` | never |
| Insert column right | `keyboard_arrow_right` | `addColumnAfter()` | never |
| Move column left | `arrow_back` | custom transaction | first column |
| Move column right | `arrow_forward` | custom transaction | last column |
| Delete column | `delete` | `deleteColumn()` | `totalCols <= 1` |

**Table operations:**
| Item | Icon | Tiptap Command | Disabled When |
|------|------|----------------|---------------|
| Toggle header row | `table_rows` + checkmark | `toggleHeaderRow()` | never |
| Delete table | `delete_forever` (destructive) | `deleteTable()` | never |

#### Floating Toolbar

Appears above the `<table>` element when any cell is focused. Icon-only buttons with title tooltips:

```
[ + Add row ] [ + Add column ] | [ Toggle header ] | [ Delete table ]
```

| Button | Icon | Tooltip | Command |
|--------|------|---------|---------|
| Add row | `add` | "Add row below" | `addRowAfter()` |
| Add column | `playlist_add` | "Add column right" | `addColumnAfter()` |
| Toggle header | `table_rows` | "Toggle header row" | `toggleHeaderRow()` |
| Delete table | `delete_forever` | "Delete table" | `deleteTable()` |

### Custom Transactions for Row/Column Reorder

Built-in Tiptap commands don't include row/column move. Two custom helper functions are needed:

**Move row:** Delete row node at source index, insert at target index within the same table. Uses `tr.delete(rowStart, rowEnd)` then `tr.insert(targetPos, rowNode)`.

**Move column:** More complex — every row must have its cells reordered. Recommended approach: reconstruct the entire table node with columns in the new order, then `tr.replaceWith(tableStart, tableEnd, newTableNode)`. This avoids position-mapping issues from multiple sequential edits.

### Migration Strategy

None needed. This is a purely additive feature. Existing tables continue to work. No data model changes.

## Implementation Steps

1. **Create `app/src/renderer/lib/tiptap/table-ui-extension.ts`** — Tiptap `Extension.create()` with a ProseMirror plugin. Follow the `link-bubble-extension.ts` pattern: `closeBubble()` function, `mount()`/`unmount()` Svelte components, outside-click handlers. The plugin does two things: (a) intercept `contextmenu` DOM events on table cells to mount `TableContextMenu`, and (b) in `view().update()`, track whether the cursor is inside a table to mount/unmount `TableToolbar`. Include a `resolveCellInfo(state, pos)` helper that walks `$pos.node(depth)` to find `tableRow`/`table` nodes and compute row index, column index, totals, and header status.

2. **Create `app/src/renderer/components/wysiwyg/TableContextMenu.svelte`** — Right-click context menu component. Position with `computePosition` from `@floating-ui/dom` using a virtual element at the click coordinates, with `flip()`, `shift({ padding: 8 })`, and `offset(4)` middleware. Render grouped menu items with Material Symbols icons. Implement keyboard navigation (ArrowUp/ArrowDown to move selection, Enter to execute, Escape to close). Include `moveRow(editor, direction)` and `moveColumn(editor, direction)` helper functions for the reorder transactions. Disable items based on `cellInfo` constraints. Style following `SlashCommandMenu.svelte` patterns. Add `@media (prefers-reduced-motion: reduce)` fallback.

3. **Create `app/src/renderer/components/wysiwyg/TableToolbar.svelte`** — Floating toolbar component. Position above the `<table>` element using `computePosition(tableEl, toolbarEl, { placement: 'top-start', middleware: [...] })`. Recompute position via `$effect`. Render icon-only 28x28 buttons matching `BubbleMenu.svelte` styling. Active state for header toggle when headers are enabled. Destructive hover color on delete button.

4. **Modify `app/src/renderer/lib/tiptap/editor-factory.ts`** — Import `TableUIExtension` and add it to the extensions array after `TableKit` (line 83).

5. **Modify `app/src/renderer/lib/tiptap/wysiwyg-theme.css`** — Add any ProseMirror-level table interaction styles not covered by scoped component styles (e.g., row highlight during reorder). Most styling lives in the Svelte component `<style>` blocks.

## Validation Criteria

- [ ] Right-click on a table cell shows context menu at cursor position
- [ ] Context menu does NOT appear when right-clicking outside a table (browser default menu shows)
- [ ] "Insert row above/below" adds a row at the correct position
- [ ] "Insert column left/right" adds a column at the correct position
- [ ] "Delete row" removes the row; disabled when table has only 1 row
- [ ] "Delete column" removes the column; disabled when table has only 1 column
- [ ] "Move row up/down" swaps the row with its neighbor; disabled at boundaries
- [ ] "Move column left/right" swaps the column with its neighbor; disabled at boundaries
- [ ] "Toggle header row" converts first row between `th` and `td`; checkmark reflects state
- [ ] "Delete table" removes the entire table
- [ ] Floating toolbar appears when clicking into a table
- [ ] Floating toolbar disappears when clicking outside the table
- [ ] Toolbar "Add row" / "Add column" / "Toggle header" / "Delete table" buttons work
- [ ] Context menu dismisses on Escape, outside click, or after action
- [ ] Keyboard navigation works in context menu (arrows, Enter, Escape)
- [ ] All operations are undoable with Ctrl/Cmd+Z
- [ ] Switching to source mode after edits shows valid Markdown pipe table
- [ ] Reloading the file preserves all table changes
- [ ] Header row toggle produces correct Markdown separator line (`|---|---|`)
- [ ] Context menu positions correctly near viewport edges (flips/shifts)
- [ ] Toolbar positions correctly when table is near top of editor
- [ ] Both toolbar and context menu can be visible simultaneously
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (no regressions)

## Anti-Patterns to Avoid

- **Do NOT use `window.prompt()` or `window.confirm()`** for any table operations — all interactions happen through the context menu and toolbar components. The existing codebase has one legacy `window.prompt` in BubbleMenu for links; don't add more.

- **Do NOT mutate ProseMirror state outside transactions** — all table modifications must go through `editor.chain()...run()` or `view.dispatch(tr)`. This ensures undo/redo works and the editor stays in sync.

- **Do NOT modify multiple cells individually for column reorder** — ProseMirror positions shift after each edit, causing corruption. Reconstruct the entire table node in a single `tr.replaceWith()` instead.

- **Do NOT add custom markdown serialization** — `@tiptap/markdown` already handles pipe table serialization. Adding custom serializers risks breaking round-trip fidelity.

- **Do NOT use `setTimeout` for visual state changes** — use Svelte `$effect` and CSS transitions per the project's animation guidelines.

- **Do NOT forget `@media (prefers-reduced-motion: reduce)`** on all transitions and animations — required by project convention.

- **Do NOT use inline styles** — use CSS custom properties from `tokens.css` and scoped `<style>` blocks.

## Patterns to Follow

- **Plugin lifecycle:** Follow `link-bubble-extension.ts` (`app/src/renderer/lib/tiptap/link-bubble-extension.ts`) — `closeBubble()` cleanup, `mount()`/`unmount()` Svelte components into DOM containers, `view().update()` for cursor tracking, outside-click handlers via `document.addEventListener('mousedown', ...)`.

- **Floating UI positioning:** Follow `SlashCommandMenu.svelte` (`app/src/renderer/components/wysiwyg/SlashCommandMenu.svelte`) — `computePosition` with `flip`, `shift`, `offset` middleware from `@floating-ui/dom`.

- **Toolbar button styling:** Follow `BubbleMenu.svelte` (`app/src/renderer/components/wysiwyg/BubbleMenu.svelte`) — 28x28 icon buttons, `--color-surface` background, `--color-border` hover, `--color-primary-dim`/`--color-primary` active state, `--z-overlay` z-index, `focus-visible` outlines.

- **Menu item styling:** Follow `SlashCommandMenu.svelte` — icon + label rows, keyboard navigation with selected index state, `role="menu"`/`role="menuitem"` ARIA attributes.

- **Drag/reorder transactions:** Follow `block-drag-extension.ts` (`app/src/renderer/lib/tiptap/block-drag-extension.ts`) — `tr.delete()` + `tr.insert()` pattern for moving nodes within the document tree.

- **Svelte 5 component structure:** `interface Props`, `let { ... }: Props = $props()`, `$state()` for local state, `$effect()` for side effects, `onMount`/`onDestroy` for lifecycle.
