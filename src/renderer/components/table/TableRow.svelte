<script lang="ts">
  import type { Component } from 'svelte'
  import { tableStore } from '../../stores/table.svelte'
  import type { CollectionColumn, CollectionRow, JsonValue } from '../../types/cli'
  import type { CellProps } from './cells/types'
  import TitleCell from './cells/TitleCell.svelte'
  import StringCell from './cells/StringCell.svelte'
  import NumberCell from './cells/NumberCell.svelte'
  import BooleanCell from './cells/BooleanCell.svelte'
  import ListCell from './cells/ListCell.svelte'
  import DateCell from './cells/DateCell.svelte'
  import MixedCell from './cells/MixedCell.svelte'

  interface Props {
    tabId: string
    row: CollectionRow
    columns: CollectionColumn[]
    titleWidth: number
    selected: boolean
    onselect: () => void
    onopen: () => void
  }
  let { tabId, row, columns, titleWidth, selected, onselect, onopen }: Props = $props()

  const CELLS: Record<string, Component<CellProps>> = {
    String: StringCell,
    Number: NumberCell,
    Boolean: BooleanCell,
    List: ListCell,
    Date: DateCell,
    Mixed: MixedCell
  }

  // Only one cell per row is in edit mode at a time.
  let editingCol = $state<string | null>(null)

  const readOnly = $derived(row.state === 'deleted')

  // Lazily augment `new` (unindexed) rows so their on-disk frontmatter is editable.
  $effect(() => {
    if (row.state === 'new' && Object.keys(row.frontmatter ?? {}).length === 0) {
      void tableStore.augmentNewRow(tabId, row.path)
    }
  })

  function cellValue(name: string): JsonValue | undefined {
    return row.frontmatter ? row.frontmatter[name] : undefined
  }

  function confirmDelete(): void {
    if (window.confirm(`Move "${row.path}" to the trash?`)) {
      void tableStore.deleteRow(tabId, row.path)
    }
  }

  function startEdit(col: CollectionColumn): void {
    if (readOnly) return
    // Boolean cells toggle directly — no edit mode.
    if (col.field_type === 'Boolean') return
    editingCol = col.name
  }

  function handleCommit(col: CollectionColumn, value: JsonValue | null): void {
    editingCol = null
    void tableStore.editCell(tabId, row.path, col.name, value)
  }

  function handleCancel(): void {
    editingCol = null
  }
</script>

<!-- Keyboard interaction lives at the grid level (TableView: arrows + Enter); cells
     own their edit-mode keys. Clicks here are selection sugar only. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="row"
  class:selected
  class:deleted={readOnly}
  role="row"
  aria-selected={selected}
  onclick={onselect}
  tabindex="-1"
>
  <!-- Title cell (pinned-left, not editable in v1) -->
  <div
    class="cell title-cell"
    role="gridcell"
    style="width: {titleWidth}px; min-width: {titleWidth}px;"
  >
    <TitleCell {row} {onopen} ondelete={confirmDelete} />
  </div>

  {#each columns as col (col.name)}
    {@const cs = tableStore.cellState(tabId, row.path, col.name)}
    {@const Cell = CELLS[col.field_type] ?? MixedCell}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="cell data-cell"
      tabindex="-1"
      class:numeric={col.field_type === 'Number'}
      class:editable={!readOnly && col.field_type !== 'Boolean'}
      class:editing={editingCol === col.name}
      class:saving={cs.saving}
      class:errored={!!cs.error}
      role="gridcell"
      title={cs.error ?? undefined}
      style="width: {tableStore.columnWidth(tabId, col.name)}px; min-width: {tableStore.columnWidth(
        tabId,
        col.name
      )}px;"
      onclick={(e) => {
        e.stopPropagation()
        onselect()
      }}
      ondblclick={() => startEdit(col)}
    >
      <Cell
        column={col}
        value={cellValue(col.name)}
        editing={editingCol === col.name}
        {readOnly}
        oncommit={(value) => handleCommit(col, value)}
        oncancel={handleCancel}
      />
      {#if cs.saving}
        <span class="saving-dot" aria-hidden="true"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .row {
    display: flex;
    height: 100%;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
    transition: background var(--transition-fast, 150ms ease);
  }

  .row:hover {
    background: color-mix(in srgb, #ffffff 4%, var(--color-bg));
  }

  .row.selected {
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
  }

  .row.deleted .data-cell {
    color: var(--color-text-faint);
    text-decoration: line-through;
  }

  .cell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 var(--space-2, 8px);
    box-sizing: border-box;
    border-right: 1px solid var(--color-border);
    font-size: var(--text-base, 0.875rem);
    color: var(--color-text);
    overflow: hidden;
  }

  /* Pinned-left Title column: opaque backgrounds so scrolled cells slide under it. */
  .title-cell {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--color-bg);
    transition: background var(--transition-fast, 150ms ease);
  }

  .row:hover .title-cell {
    background: color-mix(in srgb, #ffffff 4%, var(--color-bg));
  }

  .row.selected .title-cell {
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
  }

  :global(.table-inner.scrolled-x) .title-cell {
    box-shadow: var(--shadow-sticky-col, 2px 0 8px rgba(0, 0, 0, 0.35));
    clip-path: inset(0 -12px 0 0); /* show the shadow only on the right edge */
  }

  .data-cell.editable {
    cursor: text;
  }

  .data-cell.editable:hover {
    background: var(--overlay-hover);
  }

  .data-cell.numeric {
    justify-content: flex-end;
  }

  .data-cell.editing {
    background: var(--color-bg);
    box-shadow: inset 0 0 0 1.5px var(--color-primary);
  }

  .data-cell.saving {
    background: var(--color-primary-dim);
  }

  .data-cell.errored {
    box-shadow: inset 0 0 0 1px var(--color-error);
  }

  .saving-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .saving-dot {
      animation: none;
    }
    .row,
    .title-cell {
      transition: none;
    }
  }
</style>
