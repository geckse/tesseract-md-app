<script lang="ts">
  import {
    collections,
    activeCollectionId,
    activeCollection,
    collectionStatus,
    collectionsLoading,
    addCollection,
    removeCollection,
    setActiveCollection,
  } from '../stores/collections'
  import { loadFileTree, loadAssetTree } from '../stores/files'
  import { runIngest } from '../stores/ingest'
  import { settingsOpen } from '../stores/ui'
  import { settingsTarget } from '../stores/settings'
  import FileTree from './FileTree.svelte'
  import Favorites from './Favorites.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import type { Collection } from '../../preload/api'

  interface SidebarProps {
    onnavigate?: (detail: { id: string }) => void
    onfileselect?: (detail: { folderId: string; fileId: string; forceNewTab?: boolean }) => void
  }

  let {
    onnavigate,
    onfileselect,
  }: SidebarProps = $props()

  let contextMenuCollection: Collection | null = $state(null)
  let contextMenuPosition = $state({ x: 0, y: 0 })

  function handleNavClick(id: string) {
    onnavigate?.({ id })
  }

  async function handleAddCollection() {
    await addCollection()
  }

  async function handleCollectionClick(collection: Collection) {
    await setActiveCollection(collection.id)
    await Promise.all([loadFileTree(), loadAssetTree()])
  }

  function handleCollectionContextMenu(event: MouseEvent, collection: Collection) {
    event.preventDefault()
    contextMenuCollection = collection
    contextMenuPosition = { x: event.clientX, y: event.clientY }
  }

  async function handleRemoveCollection() {
    if (!contextMenuCollection) return
    await removeCollection(contextMenuCollection.id)
    contextMenuCollection = null
  }

  function closeContextMenu() {
    contextMenuCollection = null
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

  async function handleRevealCollection() {
    if (!contextMenuCollection) return
    const path = contextMenuCollection.path
    closeContextMenu()
    try {
      await window.api.showItemInFolder(path)
    } catch (err) {
      console.error('Reveal collection failed:', err)
    }
  }

  async function handleCopyCollectionPath() {
    if (!contextMenuCollection) return
    const path = contextMenuCollection.path
    closeContextMenu()
    await window.api.writeToClipboard(path)
  }

  function handleCollectionSettings() {
    if (!contextMenuCollection) return
    const id = contextMenuCollection.id
    closeContextMenu()
    settingsTarget.set(id)
    settingsOpen.set(true)
  }

  async function handleReindexCollection() {
    if (!contextMenuCollection) return
    const id = contextMenuCollection.id
    closeContextMenu()
    // Switch to this collection and reindex
    await setActiveCollection(id)
    runIngest(true)
  }

  function formatStats(status: typeof currentCollectionStatus): string {
    if (!status) return ''
    const docs = status.document_count ?? 0
    return `${docs} docs`
  }

  // Reactive subscriptions
  let currentCollections: Collection[] = $state([])
  let currentActiveCollectionId: string | null = $state(null)
  let currentCollectionStatus: import('../types/cli').IndexStatus | null = $state(null)
  let currentCollectionsLoading: boolean = $state(false)

  collections.subscribe((v) => (currentCollections = v))
  activeCollectionId.subscribe((v) => (currentActiveCollectionId = v))
  collectionStatus.subscribe((v) => (currentCollectionStatus = v))
  collectionsLoading.subscribe((v) => (currentCollectionsLoading = v))

  // Sidebar width state with localStorage persistence
  let sidebarWidth = $state(
    typeof localStorage !== 'undefined'
      ? parseInt(localStorage.getItem('sidebarWidth') ?? '256')
      : 256
  )

  function handleResize(newWidth: number) {
    sidebarWidth = newWidth
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sidebarWidth', String(newWidth))
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_keys -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside
  class="sidebar"
  style:width="{sidebarWidth}px"
  style:min-width="{sidebarWidth}px"
  onclick={closeContextMenu}
>
  <!-- Scrollable content -->
  <div class="nav-content">
    <!-- Favorites -->
    <Favorites />

    <!-- Collections -->
    <div class="nav-section collections-section">
      <div class="section-header-row">
        <h3 class="section-header">Collections</h3>
        <button class="add-collection-btn" onclick={handleAddCollection} title="Add Collection">
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>

      {#if currentCollectionsLoading}
        <div class="empty-state">
          <span class="material-symbols-outlined empty-icon">hourglass_empty</span>
          <span class="empty-text">Loading...</span>
        </div>
      {:else if currentCollections.length === 0}
        <div class="empty-state">
          <span class="material-symbols-outlined empty-icon">folder_off</span>
          <span class="empty-text">No collections yet</span>
          <button class="add-folder-btn" onclick={handleAddCollection}>
            <span class="material-symbols-outlined">create_new_folder</span>
            Add Folder
          </button>
        </div>
      {:else}
        <nav class="nav-list">
          {#each currentCollections as collection}
            <button
              class="nav-item collection-item"
              class:active={currentActiveCollectionId === collection.id}
              onclick={() => handleCollectionClick(collection)}
              oncontextmenu={(e) => handleCollectionContextMenu(e, collection)}
            >
              <span class="material-symbols-outlined nav-icon">
                {currentActiveCollectionId === collection.id ? 'folder_open' : 'folder'}
              </span>
              <div class="collection-info">
                <span class="nav-label">{collection.name}</span>
                {#if currentActiveCollectionId === collection.id && currentCollectionStatus}
                  <span class="collection-stats">{formatStats(currentCollectionStatus)}</span>
                {/if}
              </div>
            </button>
          {/each}
        </nav>
      {/if}
    </div>

    <!-- File Tree -->
    {#if currentActiveCollectionId}
      <div class="file-tree-section">
        <FileTree onfileselect={(detail) => onfileselect?.({ folderId: currentActiveCollectionId!, fileId: detail.path, forceNewTab: detail.forceNewTab })} />
      </div>
    {/if}
  </div>

  <div class="sidebar-footer">
    <button class="sidebar-footer-btn" onclick={() => settingsOpen.set(true)} title="Settings">
      <span class="material-symbols-outlined">settings</span>
    </button>
  </div>

  <ResizeHandle
    position="right"
    minWidth={180}
    maxWidth={500}
    width={sidebarWidth}
    onresize={handleResize}
  />
</aside>

<!-- Context menu -->
{#if contextMenuCollection}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu-overlay"
    onclick={closeContextMenu}
  >
    <div
      class="context-menu"
      style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
      onclick={(e) => e.stopPropagation()}
    >
      <button class="context-menu-item" onclick={handleRevealCollection}>
        <span class="material-symbols-outlined">folder_open</span>
        {isMac ? 'Reveal in Finder' : 'Reveal in File Explorer'}
      </button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" onclick={handleCopyCollectionPath}>
        <span class="material-symbols-outlined">content_copy</span>
        Copy Path
      </button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" onclick={handleCollectionSettings}>
        <span class="material-symbols-outlined">settings</span>
        Settings
      </button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" onclick={handleReindexCollection}>
        <span class="material-symbols-outlined">restart_alt</span>
        Reindex Collection
      </button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item danger" onclick={handleRemoveCollection}>
        <span class="material-symbols-outlined">delete</span>
        Remove Collection
      </button>
    </div>
  </div>
{/if}

<style>
  .sidebar {
    width: 256px;
    min-width: 256px;
    background: var(--color-surface-darker, #0a0a0a);
    border-right: 1px solid var(--color-border, #27272a);
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    z-index: 20;
  }

  .nav-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px 0 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.10) transparent;
  }

  .nav-content::-webkit-scrollbar { width: 6px; }
  .nav-content::-webkit-scrollbar-track { background: transparent; }
  .nav-content::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.10); border-radius: 3px; }
  .nav-content::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.20); }

  .collections-section {
    flex-shrink: 0;
  }

  .nav-section {
    padding: 0 12px;
    margin-bottom: 24px;
  }

  .file-tree-section {
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--color-border, #27272a);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    margin-bottom: 12px;
  }

  .section-header {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0;
    padding: 0;
  }

  .add-collection-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .add-collection-btn {
      transition: none;
    }
  }

  .add-collection-btn:hover {
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
  }

  .add-collection-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .nav-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-item {
      transition: none;
    }
  }

  .nav-item:hover {
    background: var(--color-surface, #161617);
    color: #fff;
  }

  .nav-item:hover .nav-icon {
    color: var(--color-primary, #00E5FF);
  }

  .nav-icon {
    font-size: 18px;
    transition: color 0.15s;
  }

  .nav-label {
    font-size: 14px;
  }

  .collection-item.active {
    background: var(--color-surface, #161617);
    color: #fff;
    border: 1px solid rgba(39, 39, 42, 0.5);
  }

  .collection-item.active .nav-icon {
    color: var(--color-primary, #00E5FF);
  }

  .collection-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  .collection-info .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .collection-stats {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin-top: 1px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 12px;
    gap: 8px;
  }

  .empty-icon {
    font-size: 32px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.5;
  }

  .empty-text {
    font-size: 13px;
    color: var(--color-text-dim, #71717a);
  }

  .add-folder-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 16px;
    border-radius: 6px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-primary, #00E5FF);
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    transition: all 0.15s;
  }

  .add-folder-btn:hover {
    background: var(--color-surface-darker, #0a0a0a);
    border-color: var(--color-primary, #00E5FF);
  }

  .add-folder-btn .material-symbols-outlined {
    font-size: 18px;
  }

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

  .context-menu-item.danger:hover {
    color: #ef4444;
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  .context-menu-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }

  .sidebar-footer {
    flex-shrink: 0;
    height: 35px;
    min-height: 35px;
    padding: 0 12px 8px 2px;
    border-top: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
  }

  .sidebar-footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar-footer-btn {
      transition: none;
    }
  }

  .sidebar-footer-btn:hover {
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
  }

  .sidebar-footer-btn .material-symbols-outlined {
    font-size: 18px;
  }
</style>
