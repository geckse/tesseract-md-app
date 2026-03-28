<script lang="ts" module>
  /**
   * Shared flag indicating whether a drop was received by any TabBar in this
   * window during the current drag operation. Used by TabItem to detect when
   * a tab has been dragged outside the window (if no internal drop occurred,
   * the tab was dragged out and should be detached to a new window).
   *
   * This is a module-level export (shared across all TabBar instances) so that
   * TabItem can import it. The flag is reset at dragStart and set at drop.
   */
  export const tabBarDropReceived = { value: false }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { workspace } from '../stores/workspace.svelte'
  import type { TabState } from '../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import TabItem from './TabItem.svelte'
  import type { TabTransferData } from '../../preload/api'

  interface TabBarProps {
    paneId: string
    onactivate?: (tabId: string) => void
    onclose?: (tabId: string) => void
  }

  let {
    paneId,
    onactivate,
    onclose,
  }: TabBarProps = $props()

  // ── Reactive tab data ───────────────────────────────────────────────

  const pane = $derived(workspace.panes[paneId])
  const tabs = $derived(pane ? workspace.getTabsInOrder(paneId) : [])
  const activeTabId = $derived(pane?.activeTabId ?? null)
  const graphTabId = $derived(pane?.graphTabId ?? '')

  /** Document tabs (everything except the pinned graph tab). */
  const documentTabs = $derived(tabs.filter((t) => t.kind !== 'graph'))

  /** The pinned graph tab (always last). */
  const graphTab = $derived(tabs.find((t) => t.id === graphTabId) ?? null)

  // ── Scroll state ──────────────────────────────────────────────────

  let scrollContainer: HTMLDivElement | undefined = $state(undefined)
  let canScrollLeft = $state(false)
  let canScrollRight = $state(false)

  function updateScrollState() {
    if (!scrollContainer) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainer
    canScrollLeft = scrollLeft > 1
    canScrollRight = scrollLeft + clientWidth < scrollWidth - 1
  }

  function scrollLeft() {
    scrollContainer?.scrollBy({ left: -120, behavior: 'smooth' })
  }

  function scrollRight() {
    scrollContainer?.scrollBy({ left: 120, behavior: 'smooth' })
  }

  // Update scroll state when tabs change or on mount
  $effect(() => {
    // Access tabs to make this effect reactive when tabs change
    void tabs.length
    // Use requestAnimationFrame to wait for DOM update
    requestAnimationFrame(() => updateScrollState())
  })

  // ── Cross-window tab attach listener ──────────────────────────────

  function handleTabAttach(data: TabTransferData) {
    const newTabId = workspace.attachTab(data, paneId)
    if (newTabId) {
      syncFileStoresFromTab()
      onactivate?.(newTabId)
    }
  }

  onMount(() => {
    // Listen for tabs being attached from other windows via IPC.
    // Only the first pane's TabBar registers the listener to avoid
    // duplicate handling when split panes are active.
    if (workspace.paneOrder[0] === paneId) {
      window.api.onTabAttach(handleTabAttach)
    }
  })

  onDestroy(() => {
    if (workspace.paneOrder[0] === paneId) {
      window.api.removeTabAttachListener()
    }
  })

  // ── Tab activation / close ────────────────────────────────────────

  function handleActivate(tabId: string) {
    workspace.switchTab(tabId, paneId)
    onactivate?.(tabId)
  }

  function handleClose(tabId: string) {
    onclose?.(tabId)
  }

  function handleMiddleClick(tabId: string) {
    onclose?.(tabId)
  }

  // ── Drag-and-drop reorder ─────────────────────────────────────────

  let dragOverTabId: string | null = $state(null)
  let dragOverSide: 'left' | 'right' | null = $state(null)

  /** Visual indicator for cross-window drop on the empty tab bar area. */
  let crossWindowDragOver = $state(false)

  function handleDragOver(e: DragEvent, tab: TabState) {
    // Don't allow dropping on the graph tab
    if (tab.kind === 'graph') return

    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'

    // Determine which side of the tab the cursor is on
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2

    dragOverTabId = tab.id
    dragOverSide = e.clientX < midpoint ? 'left' : 'right'
  }

  function handleDragLeave() {
    dragOverTabId = null
    dragOverSide = null
  }

  /**
   * Handle dragover on the scroll area itself — enables dropping tabs
   * from other windows onto this tab bar (the tab ID from another window
   * won't match any local tab, so handleDrop will treat it as cross-window).
   */
  function handleScrollAreaDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    crossWindowDragOver = true
  }

  function handleScrollAreaDragLeave() {
    crossWindowDragOver = false
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    crossWindowDragOver = false

    // Signal to TabItem that a drop was received in this window
    tabBarDropReceived.value = true

    const draggedTabId = e.dataTransfer?.getData('text/plain')
    if (!draggedTabId || !pane) {
      resetDragState()
      return
    }

    // Check if this tab exists in our workspace (same-window drag)
    const isLocalTab = !!workspace.tabs[draggedTabId]

    if (isLocalTab) {
      // Same-window reorder
      if (!dragOverTabId) {
        resetDragState()
        return
      }

      // Don't reorder onto itself
      if (draggedTabId === dragOverTabId) {
        resetDragState()
        return
      }

      // Calculate the target index
      const currentOrder = pane.tabOrder.filter((id) => id !== draggedTabId)
      let targetIndex = currentOrder.indexOf(dragOverTabId)

      if (targetIndex < 0) {
        resetDragState()
        return
      }

      if (dragOverSide === 'right') {
        targetIndex += 1
      }

      // Clamp before the graph tab
      const graphIdx = currentOrder.indexOf(graphTabId)
      if (graphIdx >= 0 && targetIndex > graphIdx) {
        targetIndex = graphIdx
      }

      workspace.reorderTab(draggedTabId, targetIndex, paneId)
    }

    resetDragState()
  }

  function resetDragState() {
    dragOverTabId = null
    dragOverSide = null
    crossWindowDragOver = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab-bar" role="tablist" aria-label="Open tabs">
  <!-- Left scroll button -->
  {#if canScrollLeft}
    <button
      class="scroll-btn scroll-left"
      onclick={scrollLeft}
      aria-label="Scroll tabs left"
    >
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
  {/if}

  <!-- Scrollable tab area -->
  <div
    class="tab-scroll-area"
    class:cross-window-drag={crossWindowDragOver}
    bind:this={scrollContainer}
    onscroll={updateScrollState}
    ondrop={handleDrop}
    ondragover={handleScrollAreaDragOver}
    ondragleave={handleScrollAreaDragLeave}
    ondragend={resetDragState}
  >
    <!-- Document tabs -->
    {#each documentTabs as tab (tab.id)}
      <div
        class="tab-drop-zone"
        class:drag-left={dragOverTabId === tab.id && dragOverSide === 'left'}
        class:drag-right={dragOverTabId === tab.id && dragOverSide === 'right'}
        ondragover={(e) => handleDragOver(e, tab)}
        ondragleave={handleDragLeave}
      >
        <TabItem
          {tab}
          isActive={activeTabId === tab.id}
          draggable={true}
          onactivate={handleActivate}
          onclose={handleClose}
          onmiddleclick={handleMiddleClick}
        />
      </div>
    {/each}

    <!-- Divider before graph tab -->
    {#if graphTab && documentTabs.length > 0}
      <div class="graph-divider"></div>
    {/if}

    <!-- Pinned graph tab -->
    {#if graphTab}
      <div class="tab-drop-zone graph-tab-zone">
        <TabItem
          tab={graphTab}
          isActive={activeTabId === graphTab.id}
          draggable={false}
          onactivate={handleActivate}
        />
      </div>
    {/if}
  </div>

  <!-- Right scroll button -->
  {#if canScrollRight}
    <button
      class="scroll-btn scroll-right"
      onclick={scrollRight}
      aria-label="Scroll tabs right"
    >
      <span class="material-symbols-outlined">chevron_right</span>
    </button>
  {/if}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    height: 36px;
    min-height: 36px;
    background: var(--color-surface-darker, #0a0a0a);
    border-bottom: 1px solid var(--color-border, #27272a);
    position: relative;
    overflow: hidden;
  }

  /* ── Scroll area ──────────────────────────────────────────────── */

  .tab-scroll-area {
    display: flex;
    align-items: stretch;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none; /* Firefox */
  }

  .tab-scroll-area::-webkit-scrollbar {
    display: none; /* Chrome/Safari */
  }

  /* ── Cross-window drag indicator ─────────────────────────────── */

  .tab-scroll-area.cross-window-drag {
    background: color-mix(in srgb, var(--color-primary, #00E5FF) 8%, transparent);
    outline: 1px dashed var(--color-primary, #00E5FF);
    outline-offset: -1px;
  }

  /* ── Tab drop zones ───────────────────────────────────────────── */

  .tab-drop-zone {
    display: flex;
    align-items: stretch;
    position: relative;
    flex-shrink: 0;
  }

  .tab-drop-zone::before,
  .tab-drop-zone::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: var(--color-primary, #00E5FF);
    border-radius: 1px;
    z-index: 2;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
    pointer-events: none;
  }

  .tab-drop-zone::before {
    left: 0;
  }

  .tab-drop-zone::after {
    right: 0;
  }

  .tab-drop-zone.drag-left::before {
    opacity: 1;
  }

  .tab-drop-zone.drag-right::after {
    opacity: 1;
  }

  .graph-tab-zone {
    flex-shrink: 0;
  }

  /* ── Graph divider ────────────────────────────────────────────── */

  .graph-divider {
    width: 1px;
    margin: 8px 2px;
    background: var(--color-border, #27272a);
    flex-shrink: 0;
  }

  /* ── Scroll buttons ───────────────────────────────────────────── */

  .scroll-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    flex-shrink: 0;
    background: var(--color-surface-darker, #0a0a0a);
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    z-index: 2;
    transition: color var(--transition-fast, 150ms ease);
    padding: 0;
  }

  .scroll-btn:hover {
    color: var(--color-text, #e4e4e7);
  }

  .scroll-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .scroll-left {
    border-right: 1px solid var(--color-border, #27272a);
  }

  .scroll-right {
    border-left: 1px solid var(--color-border, #27272a);
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll-btn {
      transition: none;
    }

    .tab-drop-zone::before,
    .tab-drop-zone::after {
      transition: none;
    }
  }
</style>
