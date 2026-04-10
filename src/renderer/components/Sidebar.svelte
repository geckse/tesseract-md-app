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
  let dropdownOpen = $state(false)

  // Derived active collection for the dropdown display
  let currentActiveCollection: Collection | null = $derived(
    currentCollections.find((c) => c.id === currentActiveCollectionId) ?? null
  )

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

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen
  }

  function closeDropdown() {
    dropdownOpen = false
  }

  async function handleDropdownSelect(collection: Collection) {
    dropdownOpen = false
    await handleCollectionClick(collection)
  }

  async function handleDropdownAdd() {
    dropdownOpen = false
    await handleAddCollection()
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
  onclick={() => { closeContextMenu(); closeDropdown(); }}
>
  <!-- Scrollable content -->
  <div class="nav-content">
    <!-- Favorites -->
    <Favorites />

    <!-- Collection Switcher -->
    <div class="nav-section collections-section">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="collection-switcher" onclick={(e) => e.stopPropagation()}>
        {#if currentCollectionsLoading}
          <div class="switcher-trigger disabled">
            <span class="material-symbols-outlined switcher-icon">hourglass_empty</span>
            <span class="switcher-label">Loading...</span>
          </div>
        {:else if currentCollections.length === 0}
          <button class="switcher-trigger empty" onclick={handleAddCollection}>
            <span class="material-symbols-outlined switcher-icon">create_new_folder</span>
            <span class="switcher-label">Add Collection</span>
            <span class="material-symbols-outlined switcher-chevron">add</span>
          </button>
        {:else}
          <button
            class="switcher-trigger"
            class:open={dropdownOpen}
            onclick={toggleDropdown}
            oncontextmenu={(e) => {
              if (currentActiveCollection) handleCollectionContextMenu(e, currentActiveCollection)
            }}
          >
            <span class="material-symbols-outlined switcher-icon">folder_open</span>
            <div class="switcher-info">
              <span class="switcher-label">{currentActiveCollection?.name ?? 'Select collection'}</span>
              {#if currentActiveCollection && currentCollectionStatus}
                <span class="switcher-stats">{formatStats(currentCollectionStatus)}</span>
              {:else if currentActiveCollection}
                <span class="switcher-stats-skeleton"></span>
              {/if}
            </div>
            <span class="material-symbols-outlined switcher-chevron">
              {dropdownOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {#if dropdownOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="dropdown-overlay" onclick={closeDropdown}></div>
            <div class="dropdown-menu">
              {#each currentCollections as collection}
                <button
                  class="dropdown-item"
                  class:active={currentActiveCollectionId === collection.id}
                  onclick={() => handleDropdownSelect(collection)}
                  oncontextmenu={(e) => handleCollectionContextMenu(e, collection)}
                >
                  <span class="material-symbols-outlined dropdown-item-icon">
                    {currentActiveCollectionId === collection.id ? 'folder_open' : 'folder'}
                  </span>
                  <span class="dropdown-item-label">{collection.name}</span>
                  {#if currentActiveCollectionId === collection.id}
                    <span class="material-symbols-outlined dropdown-check">check</span>
                  {/if}
                </button>
              {/each}
              <div class="dropdown-separator"></div>
              <button class="dropdown-item add-item" onclick={handleDropdownAdd}>
                <span class="material-symbols-outlined dropdown-item-icon">create_new_folder</span>
                <span class="dropdown-item-label">Add Collection</span>
              </button>
            </div>
          {/if}
        {/if}
      </div>
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
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.10)) transparent;
  }

  .nav-content::-webkit-scrollbar { width: 6px; }
  .nav-content::-webkit-scrollbar-track { background: transparent; }
  .nav-content::-webkit-scrollbar-thumb { background: var(--overlay-active, rgba(255, 255, 255, 0.10)); border-radius: 3px; }
  .nav-content::-webkit-scrollbar-thumb:hover { background: var(--overlay-active, rgba(255, 255, 255, 0.20)); }

  .collections-section {
    flex-shrink: 0;
  }

  .nav-section {
    padding: 0 12px;
    margin-bottom: 8px;
  }

  .file-tree-section {
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--color-border, #27272a);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Collection Switcher Dropdown */
  .collection-switcher {
    position: relative;
  }

  .switcher-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-text-main, #e4e4e7);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s ease;
  }

  .switcher-trigger.disabled {
    cursor: default;
    opacity: 0.6;
  }

  .switcher-trigger.empty {
    color: var(--color-text-dim, #71717a);
    border-style: dashed;
  }

  .switcher-trigger.empty:hover {
    color: var(--color-primary, #00E5FF);
    border-color: var(--color-primary, #00E5FF);
  }

  @media (prefers-reduced-motion: reduce) {
    .switcher-trigger {
      transition: none;
    }
  }

  .switcher-trigger:not(.disabled):hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  .switcher-trigger.open {
    border-color: var(--color-primary, #00E5FF);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .switcher-icon {
    font-size: 18px;
    color: var(--color-primary, #00E5FF);
    flex-shrink: 0;
  }

  .switcher-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  .switcher-label {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
    text-align: left;
  }

  .switcher-stats {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin-top: 1px;
  }

  .switcher-stats-skeleton {
    display: inline-block;
    width: 48px;
    height: 11px;
    margin-top: 2px;
    border-radius: 3px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 25%,
      rgba(255, 255, 255, 0.08) 50%,
      rgba(255, 255, 255, 0.04) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .switcher-stats-skeleton {
      animation: none;
      background: rgba(255, 255, 255, 0.06);
    }
  }

  .switcher-chevron {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .switcher-trigger:hover .switcher-chevron {
    color: var(--color-text-main, #e4e4e7);
  }

  @media (prefers-reduced-motion: reduce) {
    .switcher-chevron {
      transition: none;
    }
  }

  .dropdown-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 99;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    max-height: 280px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.10)) transparent;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
    text-align: left;
  }

  @media (prefers-reduced-motion: reduce) {
    .dropdown-item {
      transition: none;
    }
  }

  .dropdown-item:hover {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text-white, #fff);
  }

  .dropdown-item.active {
    color: var(--color-text-white, #fff);
  }

  .dropdown-item-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .dropdown-item.active .dropdown-item-icon {
    color: var(--color-primary, #00E5FF);
  }

  .dropdown-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-check {
    font-size: 16px;
    color: var(--color-primary, #00E5FF);
    flex-shrink: 0;
  }

  .dropdown-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }

  .dropdown-item.add-item {
    color: var(--color-primary, #00E5FF);
  }

  .dropdown-item.add-item:hover {
    color: var(--color-primary, #00E5FF);
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
    color: var(--color-text-white, #fff);
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
