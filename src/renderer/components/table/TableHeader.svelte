<script lang="ts">
  import { workspace } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import type { CollectionColumn } from '../../types/cli'
  import type { TableSort } from '../../../preload/api'

  interface Props {
    tabId: string
    columns: CollectionColumn[]
    titleWidth: number
  }
  let { tabId, columns, titleWidth }: Props = $props()

  const sort = $derived<TableSort | undefined>(tableStore.mergedConfig(tabId).sort[0])

  /** Material Symbols icon per FieldType (mirrors PropertyRow's type icons). */
  const TYPE_ICONS: Record<string, string> = {
    String: 'notes',
    Number: 'tag',
    Boolean: 'check_box',
    Date: 'calendar_today',
    List: 'sell',
    Mixed: 'data_object'
  }

  function sortDir(name: string): 'asc' | 'desc' | null {
    return sort && sort.columnName === name ? sort.direction : null
  }

  function ariaSort(name: string): 'ascending' | 'descending' | 'none' {
    const d = sortDir(name)
    return d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none'
  }

  /** Cycle a column's sort: none → asc → desc → none. */
  function cycleSort(name: string): void {
    const current = sortDir(name)
    let next: TableSort[]
    if (current === null) next = [{ columnName: name, direction: 'asc' }]
    else if (current === 'asc') next = [{ columnName: name, direction: 'desc' }]
    else next = []
    workspace.setTableEphemeral(tabId, { sort: next })
  }

  function sortIcon(name: string): string {
    const d = sortDir(name)
    return d === 'asc' ? 'arrow_upward' : d === 'desc' ? 'arrow_downward' : 'unfold_more'
  }

  // ── Column resize (drag the right edge) ──────────────────────────────
  let resizing: { name: string; startX: number; startWidth: number } | null = null

  function onResizeMove(e: PointerEvent): void {
    if (!resizing) return
    tableStore.setColumnWidth(
      tabId,
      resizing.name,
      resizing.startWidth + (e.clientX - resizing.startX)
    )
  }

  function endResize(): void {
    resizing = null
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', onResizeMove)
  }

  function startResize(e: PointerEvent, name: string): void {
    e.preventDefault()
    e.stopPropagation()
    resizing = { name, startX: e.clientX, startWidth: tableStore.columnWidth(tabId, name) }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', endResize, { once: true })
  }
</script>

<div class="header-row" role="row">
  <div
    class="header-cell title-cell"
    role="columnheader"
    style="width: {titleWidth}px; min-width: {titleWidth}px;"
  >
    <span class="material-symbols-outlined type-icon" aria-hidden="true">title</span>
    <span class="header-label">Title</span>
  </div>

  {#each columns as col (col.name)}
    <div
      class="header-col"
      style="width: {tableStore.columnWidth(tabId, col.name)}px; min-width: {tableStore.columnWidth(
        tabId,
        col.name
      )}px;"
    >
      <button
        class="header-cell sortable"
        class:unscoped={!col.in_schema}
        role="columnheader"
        aria-sort={ariaSort(col.name)}
        title={col.in_schema ? `${col.name} (${col.field_type})` : `${col.name} (ad-hoc)`}
        onclick={() => cycleSort(col.name)}
      >
        <span class="material-symbols-outlined type-icon" aria-hidden="true">
          {TYPE_ICONS[col.field_type] ?? 'data_object'}
        </span>
        <span class="header-label">{col.name}</span>
        <span class="material-symbols-outlined sort-icon" class:active={sortDir(col.name) !== null}>
          {sortIcon(col.name)}
        </span>
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        title="Drag to resize column"
        onpointerdown={(e) => startResize(e, col.name)}
      ></div>
    </div>
  {/each}
</div>

<style>
  .header-row {
    display: flex;
    position: sticky;
    top: 0;
    z-index: var(--z-base, 10);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  .header-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--space-2, 8px);
    height: 32px;
    box-sizing: border-box;
    border-right: 1px solid var(--color-border);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
    letter-spacing: 0.02em;
    color: var(--color-text-dim);
    overflow: hidden;
  }

  /* Pinned-left Title header: sticky on both axes. Literal z-index — Chromium
     computes `z-index: calc(...)` to auto, which lets sibling columns paint over. */
  .title-cell {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--color-surface);
  }

  :global(.table-inner.scrolled-x) .title-cell {
    box-shadow: var(--shadow-sticky-col, 2px 0 8px rgba(0, 0, 0, 0.35));
    clip-path: inset(0 -12px 0 0);
  }

  .type-icon {
    font-size: 14px;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .header-col {
    position: relative;
    box-sizing: border-box;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    right: 3px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background var(--transition-fast, 150ms ease);
  }

  .resize-handle:hover::after {
    background: var(--color-primary);
    opacity: 0.6;
  }

  .sortable {
    width: 100%;
    background: transparent;
    border-top: none;
    border-left: none;
    border-bottom: none;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background var(--transition-fast, 150ms ease);
  }

  .sortable:hover {
    background: var(--overlay-hover);
  }

  .sortable:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
  }

  .unscoped .header-label {
    font-style: italic;
  }

  .header-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sort-icon {
    font-size: 14px;
    color: var(--color-text-faint);
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .sortable:hover .sort-icon,
  .sortable:focus-visible .sort-icon {
    opacity: 1;
  }

  .sort-icon.active {
    opacity: 1;
    color: var(--color-primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .sortable,
    .sort-icon,
    .resize-handle::after {
      transition: none;
    }
  }
</style>
