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
  } from '../stores/files'
  import { activeCollection } from '../stores/collections'
  import { runIngest, ingestRunning } from '../stores/ingest'
  import type { Collection } from '../../preload/api'
  import type { FileTree as FileTreeType, FileState } from '../types/cli'

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

  fileTree.subscribe((v) => (currentFileTree = v))
  fileTreeLoading.subscribe((v) => (currentFileTreeLoading = v))
  fileTreeError.subscribe((v) => (currentFileTreeError = v))
  fileStateCounts.subscribe((v) => (currentFileStateCounts = v))
  activeCollection.subscribe((v) => (currentActiveCollection = v))
  ingestRunning.subscribe((v) => (currentIngestRunning = v))

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
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-tree-container" onclick={handleClickOutside}>
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
  <div class="file-tree-content">
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
      <div class="tree-nodes">
        {#each currentFileTree.root.children as child (child.path)}
          <FileTreeNode node={child} {onfileselect} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .file-tree-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
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
</style>
