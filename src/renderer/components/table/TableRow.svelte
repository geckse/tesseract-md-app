<script lang="ts">
  import { tableStore, valueToString } from '../../stores/table.svelte'
  import type { CollectionColumn, CollectionRow, JsonValue } from '../../types/cli'

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

  // Only one cell per row is in edit mode at a time.
  let editingCol = $state<string | null>(null)
  let draft = $state('')

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

  function asList(v: JsonValue | undefined): string[] | null {
    return Array.isArray(v) ? v.map((x) => valueToString(x)) : null
  }

  function isEmpty(v: JsonValue | undefined): boolean {
    return v === undefined || v === null || v === ''
  }

  function openDoc(e: MouseEvent): void {
    e.stopPropagation()
    onopen()
  }

  function confirmDelete(e: MouseEvent): void {
    e.stopPropagation()
    if (window.confirm(`Move "${row.path}" to the trash?`)) {
      void tableStore.deleteRow(tabId, row.path)
    }
  }

  function startEdit(col: CollectionColumn): void {
    if (readOnly) return
    if (col.field_type === 'Boolean') {
      tableStore.editCell(tabId, row.path, col.name, !cellValue(col.name))
      return
    }
    const v = cellValue(col.name)
    draft = col.field_type === 'List' ? (asList(v) ?? []).join(', ') : valueToString(v)
    editingCol = col.name
  }

  function cancelEdit(): void {
    editingCol = null
  }

  function commit(col: CollectionColumn): void {
    const d = draft.trim()
    let value: JsonValue | null
    if (d === '') {
      value = null // clear → unset key
    } else if (col.field_type === 'Number') {
      const n = Number(d)
      if (!Number.isFinite(n)) {
        cancelEdit() // reject non-numeric
        return
      }
      value = n
    } else if (col.field_type === 'List') {
      value = d
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    } else {
      value = d // String / Date / Mixed
    }
    editingCol = null
    void tableStore.editCell(tabId, row.path, col.name, value)
  }

  function onCellKeydown(e: KeyboardEvent, col: CollectionColumn): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(col)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  /** Autofocus + select an edit input when it mounts. */
  function autofocus(node: HTMLInputElement): void {
    node.focus()
    node.select?.()
  }
</script>

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
    {#if row.state === 'new'}
      <span class="state-badge state-new" title="On disk, not yet indexed">new</span>
    {:else if row.state === 'modified'}
      <span class="state-badge state-modified" title="Modified since last index">●</span>
    {:else if row.state === 'deleted'}
      <span class="state-badge state-deleted" title="File no longer on disk">gone</span>
    {/if}
    <span class="title-text" class:dim={row.title_source === 'filename'} title={row.title}>
      {row.title}
    </span>
    <button class="popout" title="Open document" onclick={openDoc} aria-label="Open document">
      <span class="material-symbols-outlined">open_in_new</span>
    </button>
    {#if !readOnly}
      <button
        class="popout row-delete"
        title="Delete file"
        onclick={confirmDelete}
        aria-label="Delete file"
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    {/if}
  </div>

  {#each columns as col (col.name)}
    {@const v = cellValue(col.name)}
    {@const cs = tableStore.cellState(tabId, row.path, col.name)}
    <div
      class="cell data-cell"
      class:numeric={col.field_type === 'Number'}
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
      {#if editingCol === col.name}
        {#if col.field_type === 'Date'}
          <input
            class="cell-input"
            type="date"
            bind:value={draft}
            use:autofocus
            onkeydown={(e) => onCellKeydown(e, col)}
            onblur={() => commit(col)}
          />
        {:else if col.field_type === 'Number'}
          <input
            class="cell-input"
            type="number"
            bind:value={draft}
            use:autofocus
            onkeydown={(e) => onCellKeydown(e, col)}
            onblur={() => commit(col)}
          />
        {:else}
          <input
            class="cell-input"
            type="text"
            placeholder={col.field_type === 'List' ? 'comma, separated' : ''}
            bind:value={draft}
            use:autofocus
            onkeydown={(e) => onCellKeydown(e, col)}
            onblur={() => commit(col)}
          />
        {/if}
      {:else if col.field_type === 'Boolean'}
        <button
          class="bool-toggle"
          disabled={readOnly}
          aria-pressed={v === true}
          onclick={(e) => {
            e.stopPropagation()
            startEdit(col)
          }}
        >
          <span class="material-symbols-outlined bool-icon">
            {v ? 'check_box' : 'check_box_outline_blank'}
          </span>
        </button>
      {:else if isEmpty(v)}
        <span class="empty">—</span>
      {:else if col.field_type === 'List' && asList(v)}
        <span class="chips">
          {#each asList(v) ?? [] as item}
            <span class="chip">{item}</span>
          {/each}
        </span>
      {:else}
        <span class="text" title={valueToString(v)}>{valueToString(v)}</span>
      {/if}
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
  }

  .row:hover {
    background: var(--color-surface);
  }

  .row.selected {
    background: var(--color-primary-dim);
  }

  .row.deleted .title-text,
  .row.deleted .text {
    text-decoration: line-through;
    color: var(--color-text-faint);
  }

  .cell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 var(--space-2);
    box-sizing: border-box;
    border-right: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
  }

  .data-cell:not(.deleted) {
    cursor: text;
  }

  .data-cell.numeric {
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
  }

  .data-cell.saving {
    background: var(--color-primary-dim);
  }

  .data-cell.errored {
    box-shadow: inset 0 0 0 1px var(--color-error);
  }

  .title-cell {
    font-weight: var(--weight-medium);
  }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .title-text.dim {
    color: var(--color-text-dim);
    font-style: italic;
  }

  .popout {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--color-text-dim);
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .row:hover .popout {
    opacity: 1;
  }

  .popout:hover {
    color: var(--color-primary);
  }

  .row-delete:hover {
    color: var(--color-error);
  }

  .popout .material-symbols-outlined {
    font-size: 15px;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    color: var(--color-text-faint);
  }

  .cell-input {
    width: 100%;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--text-sm);
    padding: 2px 4px;
    box-sizing: border-box;
  }

  .cell-input:focus {
    outline: none;
  }

  .bool-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
  }

  .bool-toggle:disabled {
    cursor: default;
  }

  .bool-icon {
    font-size: 16px;
    color: var(--color-text-dim);
  }

  .chips {
    display: flex;
    gap: 3px;
    overflow: hidden;
  }

  .chip {
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 6px;
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .state-badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    border-radius: var(--radius-sm);
    padding: 0 4px;
    flex-shrink: 0;
  }

  .state-new {
    color: var(--color-info);
    background: rgba(96, 165, 250, 0.12);
  }

  .state-modified {
    color: var(--color-warning);
  }

  .state-deleted {
    color: var(--color-error);
    background: rgba(239, 68, 68, 0.12);
  }

  .saving-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
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
    .popout {
      transition: none;
    }
  }
</style>
