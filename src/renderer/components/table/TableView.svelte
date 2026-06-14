<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore, type TableRowGroup } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import {
    calculateVirtualListState,
    throttleScroll,
    type VirtualListState
  } from '../../lib/virtual-list'
  import type { CollectionRow } from '../../types/cli'
  import TableToolbar from './TableToolbar.svelte'
  import TableHeader from './TableHeader.svelte'
  import TableRow from './TableRow.svelte'
  import TableGroupHeader from './TableGroupHeader.svelte'
  import SaveViewModal from './SaveViewModal.svelte'

  interface Props {
    tabId: string
  }
  let { tabId }: Props = $props()

  const ROW_HEIGHT = 36
  const BUFFER = 12
  const TITLE_WIDTH = 240

  let scrollTop = $state(0)
  let viewportHeight = $state(480)
  let scrollEl: HTMLDivElement | null = $state(null)
  let saveModalOpen = $state(false)
  /** Index of the selected visual row (for keyboard nav + Title open). */
  let selectedIndex = $state(-1)

  const tab = $derived(
    (() => {
      const t = workspace.tabs[tabId]
      return t && t.kind === 'table' ? (t as TableTab) : null
    })()
  )

  const status = $derived(tableStore.state(tabId))
  const columns = $derived(tableStore.visibleColumns(tabId))

  /** Flattened render list: group headers interleaved with rows (or just rows). */
  type VisualRow = { type: 'group'; group: TableRowGroup } | { type: 'row'; row: CollectionRow }

  const visualRows = $derived.by<VisualRow[]>(() => {
    const groups = tableStore.groups(tabId)
    if (!groups) {
      return tableStore.filteredRows(tabId).map((row) => ({ type: 'row' as const, row }))
    }
    const collapsed = new Set(tableStore.mergedConfig(tabId).collapsedGroups)
    const out: VisualRow[] = []
    for (const g of groups) {
      out.push({ type: 'group', group: g })
      if (!collapsed.has(g.value)) {
        for (const row of g.rows) out.push({ type: 'row', row })
      }
    }
    return out
  })

  const totalWidth = $derived(
    TITLE_WIDTH + columns.reduce((sum, c) => sum + tableStore.columnWidth(tabId, c.name), 0)
  )

  const virtualState = $derived.by<VirtualListState>(() =>
    calculateVirtualListState(scrollTop, viewportHeight, {
      itemHeight: ROW_HEIGHT,
      totalItems: visualRows.length,
      buffer: BUFFER
    })
  )

  const onScroll = throttleScroll((top) => {
    scrollTop = top
  })

  // Load saved views + collection data when the tab's server-affecting inputs change.
  $effect(() => {
    const col = $activeCollection
    const t = tab
    if (!col || !t) return
    // Touch reactive deps so this re-runs when they change.
    void t.folderPath
    void t.recursive
    void tableStore.mergedConfig(tabId).sort[0]?.columnName
    void tableStore.mergedConfig(tabId).sort[0]?.direction
    tableViewsStore.load(col.id, t.folderPath)
    tableStore.load(tabId, col.id, col.path)
  })

  // Measure the viewport for virtualization.
  $effect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) viewportHeight = entry.contentRect.height
    })
    ro.observe(scrollEl)
    return () => ro.disconnect()
  })

  function openRowDoc(row: CollectionRow): void {
    workspace.openFile(row.path)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (visualRows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = Math.min(visualRows.length - 1, selectedIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = Math.max(0, selectedIndex - 1)
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      const v = visualRows[selectedIndex]
      if (v?.type === 'row') openRowDoc(v.row)
    }
  }
</script>

<div
  class="table-view"
  role="grid"
  aria-label="Folder table"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#if tab}
    <TableToolbar {tabId} onsaveview={() => (saveModalOpen = true)} />

    {#if status.loading && !status.data}
      <div class="table-state" role="status">Loading…</div>
    {:else if status.error}
      <div class="table-state table-error" role="alert">
        <span class="material-symbols-outlined">error</span>
        <span>{status.error}</span>
        <button class="retry" onclick={() => tableStore.reload(tabId)}>Retry</button>
      </div>
    {:else if visualRows.length === 0}
      <div class="table-state">No markdown files in this folder.</div>
    {:else}
      <div class="table-scroll" bind:this={scrollEl} onscroll={onScroll} role="presentation">
        <div class="table-inner" style="width: {totalWidth}px;">
          <TableHeader {tabId} {columns} titleWidth={TITLE_WIDTH} />

          <div class="rows" style="height: {virtualState.totalHeight}px;">
            {#each visualRows.slice(virtualState.start, virtualState.end) as item, i (virtualState.start + i)}
              {@const index = virtualState.start + i}
              <div
                class="virtual-row"
                style="transform: translateY({index * ROW_HEIGHT}px); height: {ROW_HEIGHT}px;"
              >
                {#if item.type === 'group'}
                  <TableGroupHeader {tabId} group={item.group} width={totalWidth} />
                {:else}
                  <TableRow
                    {tabId}
                    row={item.row}
                    {columns}
                    titleWidth={TITLE_WIDTH}
                    selected={index === selectedIndex}
                    onselect={() => (selectedIndex = index)}
                    onopen={() => openRowDoc(item.row)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if saveModalOpen}
      <SaveViewModal {tabId} onclose={() => (saveModalOpen = false)} />
    {/if}
  {/if}
</div>

<style>
  .table-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg);
    outline: none;
  }

  .table-state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    color: var(--color-text-dim);
    font-size: var(--text-base);
  }

  .table-error {
    color: var(--color-error);
  }

  .retry {
    margin-left: var(--space-2);
    padding: 2px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    position: relative;
  }

  .table-inner {
    min-width: 100%;
  }

  .rows {
    position: relative;
  }

  .virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
</style>
