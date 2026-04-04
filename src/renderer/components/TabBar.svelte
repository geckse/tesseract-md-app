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
    onclosemany?: (tabIds: string[]) => void
  }

  let {
    paneId,
    onactivate,
    onclose,
    onclosemany,
  }: TabBarProps = $props()

  // ── Reactive tab data ───────────────────────────────────────────────

  const pane = $derived(workspace.panes[paneId])
  const tabs = $derived(pane ? workspace.getTabsInOrder(paneId) : [])
  const activeTabId = $derived(pane?.activeTabId ?? null)
  const graphTabId = $derived(pane?.graphTabId ?? '')
  const isFocused = $derived(workspace.activePaneId === paneId)

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

    // Handle file tree drops — open the file in this pane
    const droppedFilePath = e.dataTransfer?.getData('application/x-mdvdb-path')
    if (droppedFilePath && pane) {
      const assetData = e.dataTransfer?.getData('application/x-mdvdb-asset')
      if (assetData) {
        const { mimeCategory, fileSize } = JSON.parse(assetData)
        workspace.openAssetTab(droppedFilePath, mimeCategory, fileSize, paneId)
      } else {
        workspace.openTab(droppedFilePath, paneId)
      }
      syncFileStoresFromTab()
      resetDragState()
      return
    }

    const draggedTabId = e.dataTransfer?.getData('text/plain')
    if (!draggedTabId || !pane) {
      resetDragState()
      return
    }

    // Check if this tab exists in our workspace (same-window drag)
    const isLocalTab = !!workspace.tabs[draggedTabId]

    if (isLocalTab) {
      // Check if the tab is from a different pane (cross-pane move)
      const sourcePaneId = workspace.findPaneForTab(draggedTabId)
      if (sourcePaneId && sourcePaneId !== paneId) {
        // Cross-pane move within the same window
        workspace.moveTab(draggedTabId, sourcePaneId, paneId)
        syncFileStoresFromTab()
        resetDragState()
        return
      }

      // Same-pane reorder
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
      const draggedTab = workspace.tabs[draggedTabId]
      const currentOrder = pane.tabOrder.filter((id) => id !== draggedTabId)
      let targetIndex = currentOrder.indexOf(dragOverTabId)

      if (targetIndex < 0) {
        resetDragState()
        return
      }

      if (dragOverSide === 'right') {
        targetIndex += 1
      }

      // Clamp before the graph tab (unless we're dragging the graph tab itself)
      if (draggedTab?.kind !== 'graph') {
        const graphIdx = currentOrder.indexOf(graphTabId)
        if (graphIdx >= 0 && targetIndex > graphIdx) {
          targetIndex = graphIdx
        }
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

  // ── Tab context menu ──────────────────────────────────────────────

  let contextMenuTabId: string | null = $state(null)
  let contextMenuPosition = $state({ x: 0, y: 0 })

  const contextTab = $derived(contextMenuTabId ? workspace.tabs[contextMenuTabId] : null)
  const isContextTabGraph = $derived(contextTab?.kind === 'graph')
  const isContextTabDocument = $derived(contextTab?.kind === 'document')
  const isContextTabCloseable = $derived(contextTab?.kind !== 'graph')
  const canSplit = $derived(isContextTabCloseable)
  const canDetach = $derived(isContextTabDocument)
  const hasTabsToLeft = $derived(
    contextMenuTabId ? workspace.getTabIdsToLeft(contextMenuTabId, paneId).length > 0 : false
  )
  const hasTabsToRight = $derived(
    contextMenuTabId ? workspace.getTabIdsToRight(contextMenuTabId, paneId).length > 0 : false
  )
  const hasOtherTabs = $derived(
    contextMenuTabId ? workspace.getOtherTabIds(contextMenuTabId, paneId).length > 0 : false
  )
  const otherPaneId = $derived(
    workspace.splitEnabled && workspace.paneOrder.length >= 2
      ? workspace.paneOrder.find((id) => id !== paneId) ?? null
      : null
  )

  function handleTabContextMenu(tabId: string, event: MouseEvent) {
    const menuWidth = 220
    const menuHeight = 320
    const x = Math.min(event.clientX, window.innerWidth - menuWidth)
    const y = Math.min(event.clientY, window.innerHeight - menuHeight)
    contextMenuTabId = tabId
    contextMenuPosition = { x, y }
  }

  function closeContextMenu() {
    contextMenuTabId = null
  }

  function handleCtxClose() {
    if (!contextMenuTabId) return
    const tabId = contextMenuTabId
    closeContextMenu()
    onclose?.(tabId)
  }

  function handleCtxCloseOthers() {
    if (!contextMenuTabId) return
    const ids = workspace.getOtherTabIds(contextMenuTabId, paneId)
    closeContextMenu()
    onclosemany?.(ids)
  }

  function handleCtxCloseToLeft() {
    if (!contextMenuTabId) return
    const ids = workspace.getTabIdsToLeft(contextMenuTabId, paneId)
    closeContextMenu()
    onclosemany?.(ids)
  }

  function handleCtxCloseToRight() {
    if (!contextMenuTabId) return
    const ids = workspace.getTabIdsToRight(contextMenuTabId, paneId)
    closeContextMenu()
    onclosemany?.(ids)
  }

  function handleCtxCloseSaved() {
    const ids = workspace.getSavedTabIds(paneId)
    closeContextMenu()
    onclosemany?.(ids)
  }

  function handleCtxCloseAll() {
    const ids = workspace.getCloseableTabIds(paneId)
    closeContextMenu()
    onclosemany?.(ids)
  }

  function handleCtxSplitRight() {
    if (!contextMenuTabId) return
    const tabId = contextMenuTabId
    closeContextMenu()
    workspace.splitAndMoveTab(tabId, 'right')
    syncFileStoresFromTab()
  }

  function handleCtxMoveToOtherPane() {
    if (!contextMenuTabId || !otherPaneId) return
    const tabId = contextMenuTabId
    closeContextMenu()
    workspace.moveTab(tabId, paneId, otherPaneId)
    syncFileStoresFromTab()
  }

  function handleCtxMoveToNewWindow() {
    if (!contextMenuTabId) return
    const tabId = contextMenuTabId
    closeContextMenu()
    workspace.detachTab(tabId, paneId).then(() => {
      syncFileStoresFromTab()
    })
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
          paneFocused={isFocused}
          draggable={true}
          onactivate={handleActivate}
          onclose={handleClose}
          onmiddleclick={handleMiddleClick}
          oncontextmenu={handleTabContextMenu}
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
          paneFocused={isFocused}
          draggable={true}
          onactivate={handleActivate}
          oncontextmenu={handleTabContextMenu}
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

{#if contextMenuTabId && contextTab}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="context-menu-overlay" onclick={closeContextMenu}>
    <div
      class="context-menu"
      style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
      onclick={(e) => e.stopPropagation()}
    >
      {#if !isContextTabGraph}
        <button class="context-menu-item" onclick={handleCtxClose}>
          <span class="material-symbols-outlined">close</span>
          Close
          <span class="context-menu-shortcut">⌘W</span>
        </button>
      {/if}

      {#if !isContextTabGraph && hasOtherTabs}
        <button class="context-menu-item" onclick={handleCtxCloseOthers}>
          <span class="material-symbols-outlined">tab_close</span>
          Close Others
          <span class="context-menu-shortcut">⌥⌘T</span>
        </button>
      {/if}

      {#if !isContextTabGraph && hasTabsToLeft}
        <button class="context-menu-item" onclick={handleCtxCloseToLeft}>
          <span class="material-symbols-outlined">tab_close</span>
          Close to the Left
        </button>
      {/if}

      {#if !isContextTabGraph && hasTabsToRight}
        <button class="context-menu-item" onclick={handleCtxCloseToRight}>
          <span class="material-symbols-outlined">tab_close</span>
          Close to the Right
        </button>
      {/if}

      {#if !isContextTabGraph}
        <button class="context-menu-item" onclick={handleCtxCloseSaved}>
          <span class="material-symbols-outlined">tab_close</span>
          Close Saved
          <span class="context-menu-shortcut">⌘K U</span>
        </button>
      {/if}

      <button class="context-menu-item" onclick={handleCtxCloseAll}>
        <span class="material-symbols-outlined">tab_close</span>
        Close All
        <span class="context-menu-shortcut">⌘K W</span>
      </button>

      <div class="context-menu-separator"></div>

      {#if canSplit}
        <button class="context-menu-item" onclick={handleCtxSplitRight}>
          <span class="material-symbols-outlined">vertical_split</span>
          Split Right
        </button>
      {/if}

      {#if canSplit && otherPaneId}
        <button class="context-menu-item" onclick={handleCtxMoveToOtherPane}>
          <span class="material-symbols-outlined">swap_horiz</span>
          Move to Other Pane
        </button>
      {/if}

      {#if canDetach}
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleCtxMoveToNewWindow}>
          <span class="material-symbols-outlined">open_in_new</span>
          Move into New Window
        </button>
      {/if}
    </div>
  </div>
{/if}

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

  /* ── Context menu ─────────────────────────────────────────────── */

  .context-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 100;
  }

  .context-menu {
    position: fixed;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    padding: 4px;
    min-width: 200px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 101;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .context-menu-item:hover {
    background: var(--color-surface-darker, #0a0a0a);
    color: #fff;
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  .context-menu-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }

  .context-menu-shortcut {
    margin-left: auto;
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.6;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll-btn {
      transition: none;
    }

    .tab-drop-zone::before,
    .tab-drop-zone::after {
      transition: none;
    }

    .context-menu-item {
      transition: none;
    }
  }
</style>
