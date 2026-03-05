<script lang="ts">
  import FileTreeNode from './FileTreeNode.svelte'
  import {
    fileTree,
    fileTreeLoading,
    fileTreeError,
    fileStateCounts,
    loadFileTree,
    expandAll,
    collapseAll,
    expandedPaths,
    selectedFilePath,
    toggleExpanded,
  } from '../stores/files'
  import { activeCollection, activeCollectionId } from '../stores/collections'
  import { runIngest, ingestRunning } from '../stores/ingest'
  import { favorites, toggleFavorite } from '../stores/favorites'
  import { setGraphPathFilter, graphViewActive } from '../stores/graph'
  import { get } from 'svelte/store'
  import type { Collection } from '../../preload/api'
  import type { FileTree as FileTreeType, FileState, FileTreeNode as FileTreeNodeType } from '../types/cli'
  import {
    calculateVirtualListState,
    scrollToIndex,
    throttleScroll,
    type VirtualListState,
  } from '../lib/virtual-list'

  interface FileTreeProps {
    onfileselect?: (detail: { path: string }) => void
  }

  let { onfileselect }: FileTreeProps = $props()

  // Reactive subscriptions
  let currentFileTree: FileTreeType | null = $state(null)
  let currentFileTreeLoading: boolean = $state(false)
  let currentFileTreeError: string | null = $state(null)
  let currentFileStateCounts: Record<FileState, number> = $state({ indexed: 0, modified: 0, new: 0, deleted: 0 })
  let currentActiveCollection: Collection | null = $state(null)
  let currentIngestRunning: boolean = $state(false)
  let ingestMenuOpen: boolean = $state(false)
  let currentExpandedPaths: Set<string> = $state(new Set())
  let currentSelectedFilePath: string | null = $state(null)

  import type { FavoriteEntry } from '../../preload/api'
  let currentFavorites: FavoriteEntry[] = $state([])
  let currentActiveCollectionId: string | null = $state(null)
  favorites.subscribe((v) => (currentFavorites = v))
  activeCollectionId.subscribe((v) => (currentActiveCollectionId = v))

  fileTree.subscribe((v) => (currentFileTree = v))
  fileTreeLoading.subscribe((v) => (currentFileTreeLoading = v))
  fileTreeError.subscribe((v) => (currentFileTreeError = v))
  fileStateCounts.subscribe((v) => (currentFileStateCounts = v))
  activeCollection.subscribe((v) => (currentActiveCollection = v))
  ingestRunning.subscribe((v) => (currentIngestRunning = v))
  expandedPaths.subscribe((v) => (currentExpandedPaths = v))
  selectedFilePath.subscribe((v) => (currentSelectedFilePath = v))

  // Context menu state
  let contextMenuPath: string | null = $state(null)
  let contextMenuIsDir: boolean = $state(false)
  let contextMenuPosition = $state({ x: 0, y: 0 })
  let reindexingFile: string | null = $state(null)

  // Keyboard navigation state
  let focusedNodeIndex: number = $state(-1)
  let treeContentElement: HTMLDivElement | null = $state(null)

  // Virtual list state
  const ITEM_HEIGHT = 28 // Fixed height for each tree row in pixels (matches FileTreeNode height)
  const BUFFER = 20 // Number of items to render above/below viewport
  let scrollTop: number = $state(0)
  let containerHeight: number = $state(600) // Will be updated on mount

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  // Build flat list of visible nodes for keyboard navigation
  interface FlatNode {
    path: string
    isDir: boolean
    depth: number
    node: FileTreeNodeType
  }

  function buildFlatNodeList(nodes: FileTreeNodeType[], depth: number = 0): FlatNode[] {
    const result: FlatNode[] = []
    for (const node of nodes) {
      result.push({ path: node.path, isDir: node.is_dir, depth, node })
      if (node.is_dir && currentExpandedPaths.has(node.path)) {
        result.push(...buildFlatNodeList(node.children, depth + 1))
      }
    }
    return result
  }

  let flatNodes = $derived.by(() => {
    if (!currentFileTree) return []
    return buildFlatNodeList(currentFileTree.root.children)
  })

  // Calculate virtual list state for efficient rendering
  let virtualState = $derived.by((): VirtualListState => {
    return calculateVirtualListState(scrollTop, containerHeight, {
      itemHeight: ITEM_HEIGHT,
      totalItems: flatNodes.length,
      buffer: BUFFER,
    })
  })

  // Get visible nodes to render with their absolute positions
  interface VisibleNode {
    node: FileTreeNodeType
    depth: number
    flatIndex: number
  }

  let visibleNodes = $derived.by((): VisibleNode[] => {
    return flatNodes
      .slice(virtualState.start, virtualState.end)
      .map((flatNode, idx) => ({
        node: flatNode.node,
        depth: flatNode.depth,
        flatIndex: virtualState.start + idx,
      }))
  })

  // Keyboard event handler
  function handleKeyDown(e: KeyboardEvent) {
    if (!currentFileTree || flatNodes.length === 0) return

    // Ignore if we're in a text input or menu
    if (contextMenuPath || ingestMenuOpen) return

    const currentNode = flatNodes[focusedNodeIndex]

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusedNodeIndex = Math.min(focusedNodeIndex + 1, flatNodes.length - 1)
        scrollToFocusedNode()
        break

      case 'ArrowUp':
        e.preventDefault()
        focusedNodeIndex = Math.max(focusedNodeIndex - 1, 0)
        scrollToFocusedNode()
        break

      case 'ArrowRight':
        e.preventDefault()
        if (currentNode && currentNode.isDir) {
          if (!currentExpandedPaths.has(currentNode.path)) {
            toggleExpanded(currentNode.path)
          }
        }
        break

      case 'ArrowLeft':
        e.preventDefault()
        if (currentNode && currentNode.isDir) {
          if (currentExpandedPaths.has(currentNode.path)) {
            toggleExpanded(currentNode.path)
          }
        }
        break

      case 'Enter':
        e.preventDefault()
        if (currentNode && !currentNode.isDir) {
          onfileselect?.({ path: currentNode.path })
        }
        break
    }
  }

  function scrollToFocusedNode() {
    if (!treeContentElement || focusedNodeIndex < 0) return

    // Calculate the scroll position for the focused node
    const targetScrollTop = scrollToIndex(focusedNodeIndex, ITEM_HEIGHT, containerHeight, 'center')

    // Smooth scroll to the focused node
    treeContentElement.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    })
  }

  // Throttled scroll handler for performance
  const handleScroll = throttleScroll((scrollTopValue: number) => {
    scrollTop = scrollTopValue
  })

  // Measure container height on mount
  $effect(() => {
    if (treeContentElement) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight = entry.contentRect.height
        }
      })
      resizeObserver.observe(treeContentElement)
      return () => resizeObserver.disconnect()
    }
  })

  // Reset focus when tree changes
  $effect(() => {
    if (currentFileTree) {
      if (focusedNodeIndex >= flatNodes.length) {
        focusedNodeIndex = Math.max(0, flatNodes.length - 1)
      }
      if (focusedNodeIndex < 0 && flatNodes.length > 0) {
        focusedNodeIndex = 0
      }
    }
  })

  function handleNodeContextMenu(detail: { path: string; isDir: boolean; x: number; y: number }) {
    contextMenuPath = detail.path
    contextMenuIsDir = detail.isDir
    contextMenuPosition = { x: detail.x, y: detail.y }
  }

  function closeContextMenu() {
    contextMenuPath = null
  }

  async function handleRevealInFolder() {
    if (!contextMenuPath || !currentActiveCollection) return
    const absolutePath = `${currentActiveCollection.path}/${contextMenuPath}`
    closeContextMenu()
    try {
      await window.api.showItemInFolder(absolutePath)
    } catch (err) {
      console.error('Reveal in folder failed:', err, 'path:', absolutePath)
    }
  }

  async function handleReindexFile() {
    if (!contextMenuPath || !currentActiveCollection || contextMenuIsDir) return
    const filePath = contextMenuPath
    closeContextMenu()
    reindexingFile = filePath
    try {
      await window.api.ingestFile(currentActiveCollection.path, filePath, { reindex: true })
      await loadFileTree()
    } catch (err) {
      console.error('Reindex file failed:', err, 'path:', filePath)
    } finally {
      reindexingFile = null
    }
  }

  async function handleOpenInEditor() {
    if (!contextMenuPath || !currentActiveCollection) return
    const absolutePath = `${currentActiveCollection.path}/${contextMenuPath}`
    closeContextMenu()
    try {
      await window.api.openPath(absolutePath)
    } catch (err) {
      console.error('Open in editor failed:', err)
    }
  }

  async function handleCopyPath() {
    if (!contextMenuPath || !currentActiveCollection) return
    const absolutePath = `${currentActiveCollection.path}/${contextMenuPath}`
    closeContextMenu()
    await window.api.writeToClipboard(absolutePath)
  }

  async function handleCopyRelativePath() {
    if (!contextMenuPath) return
    closeContextMenu()
    await window.api.writeToClipboard(contextMenuPath)
  }

  function isContextMenuFileFavorited(): boolean {
    if (!contextMenuPath || !currentActiveCollectionId) return false
    return currentFavorites.some(
      (f) => f.collectionId === currentActiveCollectionId && f.filePath === contextMenuPath
    )
  }

  async function handleToggleFavorite() {
    if (!contextMenuPath || !currentActiveCollectionId) return
    const filePath = contextMenuPath
    const collectionId = currentActiveCollectionId
    closeContextMenu()
    await toggleFavorite(collectionId, filePath)
  }

  function handleShowInGraph() {
    if (!contextMenuPath) return
    const path = contextMenuPath
    closeContextMenu()
    setGraphPathFilter(path)
    if (!get(graphViewActive)) {
      graphViewActive.set(true)
    }
  }

  async function handleRefresh() {
    await loadFileTree()
  }

  function totalFiles(): number {
    return currentFileTree?.total_files ?? 0
  }

  function handleIngest() {
    runIngest(false)
  }

  function handleReindex() {
    ingestMenuOpen = false
    runIngest(true)
  }

  function toggleIngestMenu() {
    ingestMenuOpen = !ingestMenuOpen
  }

  function handleClickOutside(e: MouseEvent) {
    if (ingestMenuOpen) {
      const target = e.target as HTMLElement
      if (!target.closest('.ingest-split-btn')) {
        ingestMenuOpen = false
      }
    }
    if (contextMenuPath) {
      closeContextMenu()
    }
  }
</script>

<div class="file-tree-container" onclick={handleClickOutside} onkeydown={handleKeyDown} tabindex="0">
  <!-- Header -->
  <div class="file-tree-header">
    <h3 class="file-tree-title">Files</h3>
    <div class="header-actions">
      <div class="ingest-split-btn">
        <button
          class="ingest-btn"
          onclick={handleIngest}
          title="Index Collection"
          disabled={currentFileTreeLoading || !currentActiveCollection || currentIngestRunning}
        >
          <span class="material-symbols-outlined ingest-icon" class:spinning={currentIngestRunning}>
            {currentIngestRunning ? 'sync' : 'bolt'}
          </span>
          <span class="ingest-label">{currentIngestRunning ? 'Indexing...' : 'Index'}</span>
        </button>
        <button
          class="ingest-chevron"
          onclick={toggleIngestMenu}
          title="More index options"
          disabled={currentFileTreeLoading || !currentActiveCollection || currentIngestRunning}
        >
          <span class="material-symbols-outlined">expand_more</span>
        </button>
        {#if ingestMenuOpen}
          <div class="ingest-menu">
            <button class="ingest-menu-item" onclick={handleReindex}>
              <span class="material-symbols-outlined">restart_alt</span>
              Reindex All
            </button>
          </div>
        {/if}
      </div>
      <button class="icon-btn" onclick={collapseAll} title="Collapse All">
        <span class="material-symbols-outlined">unfold_less</span>
      </button>
      <button class="icon-btn" onclick={expandAll} title="Expand All">
        <span class="material-symbols-outlined">unfold_more</span>
      </button>
      <button class="icon-btn" onclick={handleRefresh} title="Refresh" disabled={currentFileTreeLoading}>
        <span class="material-symbols-outlined" class:spinning={currentFileTreeLoading}>refresh</span>
      </button>
    </div>
  </div>

  <!-- Summary -->
  {#if currentFileTree}
    <div class="file-tree-summary">
      <span class="summary-item">{totalFiles()} files</span>
      {#if currentFileStateCounts.modified > 0}
        <span class="summary-item state-modified">{currentFileStateCounts.modified} modified</span>
      {/if}
      {#if currentFileStateCounts.new > 0}
        <span class="summary-item state-new">{currentFileStateCounts.new} new</span>
      {/if}
    </div>
  {/if}

  <!-- Content -->
  <div class="file-tree-content" bind:this={treeContentElement} onscroll={handleScroll}>
    {#if !currentActiveCollection}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">folder_off</span>
        <span class="empty-text">No collection selected</span>
      </div>
    {:else if currentFileTreeLoading}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon spinning">hourglass_empty</span>
        <span class="empty-text">Loading files...</span>
      </div>
    {:else if currentFileTreeError}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon error-icon">error</span>
        <span class="empty-text">{currentFileTreeError}</span>
        <button class="retry-btn" onclick={handleRefresh}>
          <span class="material-symbols-outlined">refresh</span>
          Retry
        </button>
      </div>
    {:else if currentFileTree && currentFileTree.root.children.length === 0}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">description</span>
        <span class="empty-text">No markdown files found</span>
      </div>
    {:else if currentFileTree}
      <div class="tree-nodes-virtual" role="tree" aria-label="File tree" style="height: {virtualState.totalHeight}px;">
        {#each visibleNodes as { node, depth, flatIndex } (node.path)}
          <div class="virtual-node-wrapper" style="transform: translateY({flatIndex * ITEM_HEIGHT}px); height: {ITEM_HEIGHT}px;">
            <FileTreeNode
              {node}
              {onfileselect}
              oncontextmenu={handleNodeContextMenu}
              focusedPath={flatNodes[focusedNodeIndex]?.path}
              depth={depth}
              noRecursiveRender={true}
              {currentSelectedFilePath}
              {currentExpandedPaths}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- File context menu -->
{#if contextMenuPath}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="context-menu-overlay" onclick={closeContextMenu}>
    <div
      class="context-menu"
      style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
      onclick={(e) => e.stopPropagation()}
    >
      <button class="context-menu-item" onclick={handleRevealInFolder}>
        <span class="material-symbols-outlined">folder_open</span>
        {isMac ? 'Reveal in Finder' : 'Reveal in File Explorer'}
      </button>
      {#if !contextMenuIsDir}
        <button class="context-menu-item" onclick={handleOpenInEditor}>
          <span class="material-symbols-outlined">open_in_new</span>
          Open in Default Editor
        </button>
      {/if}
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" onclick={handleCopyPath}>
        <span class="material-symbols-outlined">content_copy</span>
        Copy Path
      </button>
      <button class="context-menu-item" onclick={handleCopyRelativePath}>
        <span class="material-symbols-outlined">content_copy</span>
        Copy Relative Path
      </button>
      {#if contextMenuIsDir}
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleShowInGraph}>
          <span class="material-symbols-outlined">hub</span>
          Show in Graph
        </button>
      {/if}
      {#if !contextMenuIsDir}
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleToggleFavorite}>
          <span class="material-symbols-outlined">
            {isContextMenuFileFavorited() ? 'heart_minus' : 'heart_plus'}
          </span>
          {isContextMenuFileFavorited() ? 'Remove from Favorites' : 'Add to Favorites'}
        </button>
        <div class="context-menu-separator"></div>
        <button
          class="context-menu-item"
          onclick={handleReindexFile}
          disabled={reindexingFile !== null}
        >
          <span class="material-symbols-outlined" class:spinning={reindexingFile === contextMenuPath}>
            {reindexingFile === contextMenuPath ? 'sync' : 'refresh'}
          </span>
          {reindexingFile === contextMenuPath ? 'Reindexing...' : 'Reindex File'}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-tree-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    outline: none;
  }

  .file-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .file-tree-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary, #a1a1aa);
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  /* --- Split button for Index / Reindex --- */
  .ingest-split-btn {
    position: relative;
    display: flex;
    align-items: center;
  }

  .ingest-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    border: 1px solid var(--color-border, #27272a);
    border-right: none;
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    border-radius: 4px 0 0 4px;
    cursor: pointer;
    padding: 0 8px 0 6px;
    font-size: 11px;
    font-family: inherit;
    font-weight: 500;
    white-space: nowrap;
  }

  .ingest-btn:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .ingest-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ingest-icon {
    font-size: 14px;
  }

  .ingest-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 24px;
    border: 1px solid var(--color-border, #27272a);
    border-left: 1px solid var(--color-border, #27272a);
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    padding: 0;
  }

  .ingest-chevron:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .ingest-chevron:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ingest-chevron .material-symbols-outlined {
    font-size: 16px;
  }

  .ingest-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 50;
    min-width: 120px;
    overflow: hidden;
  }

  .ingest-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .ingest-menu-item:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .ingest-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  /* --- Icon buttons (collapse, expand, refresh) --- */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
  }

  .icon-btn:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .file-tree-summary {
    display: flex;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11px;
    color: var(--color-text-secondary, #a1a1aa);
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .summary-item {
    white-space: nowrap;
  }

  .state-modified {
    color: var(--color-warning, #eab308);
  }

  .state-new {
    color: var(--color-info, #3b82f6);
  }

  .file-tree-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.10) transparent;
  }

  .file-tree-content::-webkit-scrollbar { width: 6px; }
  .file-tree-content::-webkit-scrollbar-track { background: transparent; }
  .file-tree-content::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.10); border-radius: 3px; }
  .file-tree-content::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.20); }

  .tree-nodes {
    padding: 4px 0;
  }

  .tree-nodes-virtual {
    position: relative;
    width: 100%;
  }

  .virtual-node-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    will-change: transform;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    gap: 8px;
    color: var(--color-text-secondary, #a1a1aa);
  }

  .empty-icon {
    font-size: 32px;
    opacity: 0.5;
  }

  .error-icon {
    color: var(--color-error, #ef4444);
  }

  .empty-text {
    font-size: 13px;
    text-align: center;
  }

  .retry-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    padding: 4px 12px;
    font-size: 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .retry-btn .material-symbols-outlined {
    font-size: 14px;
  }

  /* --- File context menu --- */
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
    min-width: 180px;
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

  .context-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  .context-menu-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }
</style>
