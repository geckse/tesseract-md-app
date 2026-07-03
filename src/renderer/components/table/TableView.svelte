<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore, type TableRowGroup } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import { calculateVirtualListState, type VirtualListState } from '../../lib/virtual-list'
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
  /** True once the table is scrolled horizontally — drives the sticky Title column shadow. */
  let scrolledX = $state(false)
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

  // rAF-throttled scroll tracking for both axes (vertical drives virtualization,
  // horizontal drives the sticky Title column shadow).
  let scrollFrame: number | null = null
  function onScroll(event: Event): void {
    if (scrollFrame !== null) return
    const target = event.currentTarget as HTMLElement | null
    if (!target) return
    const top = target.scrollTop
    const left = target.scrollLeft
    scrollFrame = requestAnimationFrame(() => {
      scrollTop = top
      scrolledX = left > 0
      scrollFrame = null
    })
  }

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

  // Cancel any pending scroll frame on unmount.
  $effect(() => {
    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    }
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

    <!-- No data and no error yet = first load (or about to start): skeleton, never
         a misleading empty state. Reloads with existing data keep the table visible. -->
    {#if !status.data && !status.error}
      <div class="skeleton" role="status" aria-label="Loading table">
        {#each Array(8) as _, i (i)}
          <div class="skeleton-row" style="opacity: {1 - i * 0.11};">
            <span class="skeleton-block title"></span>
            <span class="skeleton-block"></span>
            <span class="skeleton-block"></span>
            <span class="skeleton-block short"></span>
          </div>
        {/each}
      </div>
    {:else if status.error}
      <div class="table-state" role="alert">
        <span class="material-symbols-outlined state-icon error">error</span>
        <span class="state-title">Couldn't load this folder</span>
        <span class="state-hint">{status.error}</span>
        <button class="retry" onclick={() => tableStore.reload(tabId)}>
          <span class="material-symbols-outlined">refresh</span>
          Retry
        </button>
      </div>
    {:else if visualRows.length === 0}
      <div class="table-state">
        <span class="material-symbols-outlined state-icon">table</span>
        <span class="state-title">No markdown files in this folder</span>
        <span class="state-hint">Use “Add row” above to create the first document.</span>
      </div>
    {:else}
      <div class="table-scroll" bind:this={scrollEl} onscroll={onScroll} role="presentation">
        <div class="table-inner" class:scrolled-x={scrolledX} style="width: {totalWidth}px;">
          <TableHeader {tabId} {columns} titleWidth={TITLE_WIDTH} />

          <div class="rows" style="height: {virtualState.totalHeight}px;">
            {#each visualRows.slice(virtualState.start, virtualState.end) as item, i (virtualState.start + i)}
              {@const index = virtualState.start + i}
              <!-- Positioned via `top`, not translateY: a transform would make this row the
                   containing block for position:fixed popovers (DatePicker, PopoverMenu). -->
              <div class="virtual-row" style="top: {index * ROW_HEIGHT}px; height: {ROW_HEIGHT}px;">
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

  /* ── Centered empty / error states ──────────────────────────── */
  .table-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    padding: var(--space-8, 32px);
    text-align: center;
  }

  .state-icon {
    font-size: 40px;
    color: var(--color-text-dim);
    opacity: 0.5;
  }

  .state-icon.error {
    color: var(--color-error);
    opacity: 0.8;
  }

  .state-title {
    color: var(--color-text);
    font-size: var(--text-base, 0.875rem);
    font-weight: var(--weight-medium, 500);
  }

  .state-hint {
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
    max-width: 360px;
  }

  .retry {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: var(--space-2, 8px);
    padding: 4px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--text-sm, 0.75rem);
    transition:
      background var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease);
  }

  .retry:hover {
    background: var(--color-surface-elevated);
    border-color: var(--color-border-hover);
  }

  .retry .material-symbols-outlined {
    font-size: 15px;
  }

  /* ── Loading skeleton ───────────────────────────────────────── */
  .skeleton {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    overflow: hidden;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    height: 36px;
  }

  .skeleton-block {
    height: 12px;
    flex: 1;
    border-radius: var(--radius-sm, 4px);
    background: linear-gradient(
      90deg,
      var(--color-surface) 25%,
      var(--color-surface-elevated) 50%,
      var(--color-surface) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-block.title {
    flex: 0 0 200px;
  }

  .skeleton-block.short {
    flex: 0 0 80px;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    position: relative;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track, transparent);
  }

  .table-scroll::-webkit-scrollbar {
    width: var(--scrollbar-width, 6px);
    height: var(--scrollbar-width, 6px);
  }

  .table-scroll::-webkit-scrollbar-track {
    background: var(--scrollbar-track, transparent);
  }

  .table-scroll::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-full, 9999px);
  }

  .table-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.2));
  }

  .table-inner {
    min-width: 100%;
  }

  .rows {
    position: relative;
  }

  .virtual-row {
    position: absolute;
    left: 0;
    width: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-block {
      animation: none;
      background: var(--color-surface);
    }
    .retry {
      transition: none;
    }
  }
</style>
