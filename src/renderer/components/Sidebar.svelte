<script lang="ts">
  import { untrack } from 'svelte'
  import {
    collections,
    activeCollectionId,
    collectionStatus,
    collectionsLoading,
    addAndActivateCollection,
    removeCollection,
    setActiveCollection,
    openDoctorModal,
    openInfoModal
  } from '../stores/collections'
  import {
    loadFileTree,
    loadAssetTree,
    scopedFileCount,
    syncFileStoresFromTab
  } from '../stores/files'
  import { workspace } from '../stores/workspace.svelte'
  import { runIngest } from '../stores/ingest'
  import { settingsOpen } from '../stores/ui'
  import { settingsTarget, activeSection, openTopicsSettings } from '../stores/settings'
  import { watcherState, toggleWatcher } from '../stores/watcher'
  import { terminalStore } from '../stores/terminal.svelte'
  import FileTree from './FileTree.svelte'
  import Favorites from './Favorites.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import type { Collection } from '../../preload/api'
  import type { ShardInfo } from '../types/cli'
  import ShardModal from './ShardModal.svelte'
  import ShardIcon from './ShardIcon.svelte'
  import {
    activeShard,
    activeShardId,
    buildShardTree,
    refreshAllShards,
    refreshShards,
    removeShardDefinition,
    setActiveShard,
    shardErrorsByCollection,
    shardsByCollection,
    type ShardTreeNode
  } from '../stores/shards'
  import { openGraphViewForPath } from '../stores/graph'

  interface SidebarProps {
    onnavigate?: (detail: { id: string }) => void
    onfileselect?: (detail: { folderId: string; fileId: string; forceNewTab?: boolean }) => void
  }

  let { onfileselect }: SidebarProps = $props()

  let contextMenuCollection: Collection | null = $state(null)
  let contextMenuShard: ShardInfo | null = $state(null)
  let contextMenuPosition = $state({ x: 0, y: 0 })
  let dropdownOpen = $state(false)
  let settingsSubmenuOpen = $state(false)
  let shardModalOpen = $state(false)
  let shardModalCollectionId: string | undefined = $state(undefined)
  let shardModalShard: ShardInfo | null = $state(null)
  let shardModalInitialPath = $state('')
  let expandedCollections: Set<string> = $state(new Set())
  let expandedShards: Set<string> = $state(new Set())
  let focusedSwitcherIndex = $state(0)
  let switcherTree: HTMLDivElement | null = $state(null)
  let switcherSearchInput: HTMLInputElement | null = $state(null)
  let switcherTrigger: HTMLButtonElement | null = $state(null)
  let switcherQuery = $state('')
  const initializedExpandableShards = new Set<string>()
  let expandedActiveCollectionId: string | null = null

  /** Settings sections offered in the collection context menu. */
  const settingsSections = [
    { section: 'embedding', label: 'Embedding Provider', icon: 'memory' },
    { section: 'search', label: 'Search Defaults', icon: 'search' },
    { section: 'chunking', label: 'Chunking', icon: 'splitscreen' },
    { section: 'clusters', label: 'Topics', icon: 'category' },
    { section: 'skills', label: 'Agent Skills', icon: 'school' },
    { section: 'appearance', label: 'Appearance', icon: 'palette' }
  ]

  let currentWatcherState = $state<'stopped' | 'starting' | 'running' | 'error'>('stopped')
  watcherState.subscribe((v) => (currentWatcherState = v))

  // Derived active collection for the dropdown display
  let currentActiveCollection: Collection | null = $derived(
    currentCollections.find((c) => c.id === currentActiveCollectionId) ?? null
  )
  let currentActiveShard: ShardInfo | null = $state(null)
  let currentActiveShardId: string | null = $state(null)
  let currentShardsByCollection: Record<string, ShardInfo[]> = $state({})
  let currentShardErrors: Record<string, string | null> = $state({})
  let currentScopedFileCount = $state(0)
  activeShard.subscribe((value) => (currentActiveShard = value))
  activeShardId.subscribe((value) => (currentActiveShardId = value))
  shardsByCollection.subscribe((value) => (currentShardsByCollection = value))
  shardErrorsByCollection.subscribe((value) => (currentShardErrors = value))
  scopedFileCount.subscribe((value) => (currentScopedFileCount = value))

  interface SwitcherRow {
    key: string
    kind: 'collection' | 'shard'
    collection: Collection
    shard?: ShardInfo
    depth: number
    hasChildren?: boolean
  }

  function flattenShardNodes(
    collection: Collection,
    nodes: ShardTreeNode[],
    depth: number
  ): SwitcherRow[] {
    const rows: SwitcherRow[] = []
    for (const node of nodes) {
      rows.push({
        key: `${collection.id}:${node.shard.id}`,
        kind: 'shard',
        collection,
        shard: node.shard,
        depth,
        hasChildren: node.children.length > 0
      })
      if (expandedShards.has(`${collection.id}:${node.shard.id}`)) {
        rows.push(...flattenShardNodes(collection, node.children, depth + 1))
      }
    }
    return rows
  }

  function flattenAllShardNodes(
    collection: Collection,
    nodes: ShardTreeNode[],
    depth: number
  ): SwitcherRow[] {
    return nodes.flatMap((node) => [
      {
        key: `${collection.id}:${node.shard.id}`,
        kind: 'shard' as const,
        collection,
        shard: node.shard,
        depth,
        hasChildren: node.children.length > 0
      },
      ...flattenAllShardNodes(collection, node.children, depth + 1)
    ])
  }

  let switcherRows = $derived.by<SwitcherRow[]>(() => {
    const rows: SwitcherRow[] = []
    for (const collection of currentCollections) {
      const shardTree = buildShardTree(currentShardsByCollection[collection.id] ?? [])
      const hasChildren = shardTree.length > 0
      rows.push({
        key: collection.id,
        kind: 'collection',
        collection,
        depth: 1,
        hasChildren
      })
      if (hasChildren && expandedCollections.has(collection.id)) {
        rows.push(...flattenShardNodes(collection, shardTree, 2))
      }
    }
    return rows
  })

  let visibleSwitcherRows = $derived.by<SwitcherRow[]>(() => {
    const needle = switcherQuery.trim().toLocaleLowerCase()
    if (!needle) return switcherRows

    const rows: SwitcherRow[] = []
    for (const collection of currentCollections) {
      if (
        collection.name.toLocaleLowerCase().includes(needle) ||
        collection.path.toLocaleLowerCase().includes(needle)
      ) {
        rows.push({
          key: collection.id,
          kind: 'collection',
          collection,
          depth: 1,
          hasChildren: (currentShardsByCollection[collection.id] ?? []).length > 0
        })
      }

      const shardTree = buildShardTree(currentShardsByCollection[collection.id] ?? [])
      rows.push(
        ...flattenAllShardNodes(collection, shardTree, 2).filter((row) => {
          const shard = row.shard
          return (
            shard?.name.toLocaleLowerCase().includes(needle) ||
            shard?.path.toLocaleLowerCase().includes(needle)
          )
        })
      )
    }
    return rows
  })

  $effect(() => {
    if (currentActiveCollectionId && currentActiveCollectionId !== expandedActiveCollectionId) {
      expandedActiveCollectionId = currentActiveCollectionId
      expandedCollections = new Set(untrack(() => expandedCollections)).add(
        currentActiveCollectionId
      )
    }
  })

  // New definitions start expanded so hierarchy is immediately legible; users
  // can collapse any nested branch with ArrowLeft.
  $effect(() => {
    const newKeys: string[] = []
    for (const collection of currentCollections) {
      for (const shard of currentShardsByCollection[collection.id] ?? []) {
        if (
          (currentShardsByCollection[collection.id] ?? []).some(
            (candidate) => candidate.parent_id === shard.id
          )
        ) {
          const key = `${collection.id}:${shard.id}`
          if (!initializedExpandableShards.has(key)) newKeys.push(key)
        }
      }
    }
    if (newKeys.length > 0) {
      const next = new Set(untrack(() => expandedShards))
      for (const key of newKeys) {
        initializedExpandableShards.add(key)
        next.add(key)
      }
      expandedShards = next
    }
  })

  async function handleAddCollection(): Promise<Collection | null> {
    const collection = await addAndActivateCollection()
    if (collection) {
      await Promise.all([loadFileTree(), loadAssetTree()])
    }
    return collection
  }

  async function handleCollectionClick(collection: Collection) {
    if (collection.id !== currentActiveCollectionId) {
      await setActiveCollection(collection.id)
      await Promise.all([loadFileTree(), loadAssetTree(), refreshShards(collection.id)])
    }
  }

  function handleCollectionContextMenu(event: MouseEvent, collection: Collection) {
    event.preventDefault()
    contextMenuCollection = collection
    contextMenuShard = null
    contextMenuPosition = { x: event.clientX, y: event.clientY }
    settingsSubmenuOpen = false
  }

  function handleShardContextMenu(event: MouseEvent, collection: Collection, shard: ShardInfo) {
    event.preventDefault()
    event.stopPropagation()
    contextMenuCollection = collection
    contextMenuShard = shard
    contextMenuPosition = { x: event.clientX, y: event.clientY }
    settingsSubmenuOpen = false
  }

  async function handleRemoveCollection() {
    if (!contextMenuCollection) return
    await removeCollection(contextMenuCollection.id)
    contextMenuCollection = null
    contextMenuShard = null
  }

  function closeContextMenu() {
    contextMenuCollection = null
    contextMenuShard = null
    settingsSubmenuOpen = false
  }

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen
    if (dropdownOpen) {
      switcherQuery = ''
      focusedSwitcherIndex = 0
      void refreshAllShards()
      requestAnimationFrame(() => switcherSearchInput?.focus())
    }
  }

  function closeDropdown() {
    dropdownOpen = false
    switcherQuery = ''
  }

  function closeTransientMenus() {
    closeContextMenu()
    closeDropdown()
  }

  async function handleDropdownSelect(collection: Collection) {
    dropdownOpen = false
    await handleCollectionClick(collection)
    await setActiveShard(null)
  }

  async function handleDropdownShardSelect(collection: Collection, shard: ShardInfo) {
    if (!shard.exists) return
    dropdownOpen = false
    await handleCollectionClick(collection)
    await refreshShards(collection.id)
    await setActiveShard(shard.id)
  }

  function toggleCollectionExpanded(collectionId: string): void {
    const next = new Set(expandedCollections)
    if (next.has(collectionId)) next.delete(collectionId)
    else next.add(collectionId)
    expandedCollections = next
  }

  function toggleShardExpanded(collectionId: string, shardId: string): void {
    const key = `${collectionId}:${shardId}`
    const next = new Set(expandedShards)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedShards = next
  }

  function focusSwitcherRow(index: number): void {
    if (visibleSwitcherRows.length === 0) return
    focusedSwitcherIndex = Math.max(0, Math.min(index, visibleSwitcherRows.length - 1))
    requestAnimationFrame(() => {
      switcherTree
        ?.querySelector<HTMLButtonElement>(`[data-switcher-index="${focusedSwitcherIndex}"]`)
        ?.focus()
    })
  }

  function handleSwitcherKeydown(event: KeyboardEvent): void {
    const row = visibleSwitcherRows[focusedSwitcherIndex]
    if (!row) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusSwitcherRow(focusedSwitcherIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusSwitcherRow(focusedSwitcherIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusSwitcherRow(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusSwitcherRow(visibleSwitcherRows.length - 1)
    } else if (event.key === 'ArrowRight' && row.kind === 'collection') {
      event.preventDefault()
      if (!row.hasChildren) return
      if (!expandedCollections.has(row.collection.id)) {
        toggleCollectionExpanded(row.collection.id)
      } else {
        focusSwitcherRow(focusedSwitcherIndex + 1)
      }
    } else if (event.key === 'ArrowRight' && row.kind === 'shard' && row.shard) {
      event.preventDefault()
      const key = `${row.collection.id}:${row.shard.id}`
      if (row.hasChildren && !expandedShards.has(key)) {
        toggleShardExpanded(row.collection.id, row.shard.id)
      } else if (row.hasChildren) {
        focusSwitcherRow(focusedSwitcherIndex + 1)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (row.kind === 'collection') {
        if (row.hasChildren && expandedCollections.has(row.collection.id)) {
          toggleCollectionExpanded(row.collection.id)
        }
      } else {
        const rowShardId = row.shard?.id
        if (
          rowShardId &&
          row.hasChildren &&
          expandedShards.has(`${row.collection.id}:${rowShardId}`)
        ) {
          toggleShardExpanded(row.collection.id, rowShardId)
          return
        }
        const parentId = row.shard?.parent_id
        const parentIndex = visibleSwitcherRows.findIndex(
          (candidate) =>
            candidate.collection.id === row.collection.id &&
            (parentId
              ? candidate.kind === 'shard' && candidate.shard?.id === parentId
              : candidate.kind === 'collection')
        )
        if (parentIndex >= 0) focusSwitcherRow(parentIndex)
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (row.kind === 'collection') void handleDropdownSelect(row.collection)
      else if (row.shard) void handleDropdownShardSelect(row.collection, row.shard)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeDropdown()
    }
  }

  function handleSwitcherSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusSwitcherRow(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusSwitcherRow(visibleSwitcherRows.length - 1)
    } else if (event.key === 'Enter' && visibleSwitcherRows[0]) {
      event.preventDefault()
      const row = visibleSwitcherRows[0]
      if (row.kind === 'collection') void handleDropdownSelect(row.collection)
      else if (row.shard) void handleDropdownShardSelect(row.collection, row.shard)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeDropdown()
      requestAnimationFrame(() => switcherTrigger?.focus())
    }
  }

  async function handleDropdownAdd() {
    dropdownOpen = false
    await handleAddCollection()
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

  async function handleOpenCollectionInNewWindow() {
    if (!contextMenuCollection) return
    const id = contextMenuCollection.id
    const shardId = contextMenuShard?.id
    closeContextMenu()
    try {
      await window.api.newWindow(id, shardId)
    } catch (err) {
      console.error('Open collection in new window failed:', err)
    }
  }

  async function ensureContextShardActive(): Promise<void> {
    if (!contextMenuCollection || !contextMenuShard) return
    await handleCollectionClick(contextMenuCollection)
    await refreshShards(contextMenuCollection.id)
    if (contextMenuShard.exists) await setActiveShard(contextMenuShard.id)
  }

  async function openCreateShard(collectionId: string, path = ''): Promise<void> {
    closeContextMenu()
    const collection = currentCollections.find((item) => item.id === collectionId)
    if (collection) await handleCollectionClick(collection)
    shardModalCollectionId = collectionId
    shardModalShard = null
    shardModalInitialPath = path
    shardModalOpen = true
  }

  async function openEditShard(collectionId: string, shard: ShardInfo): Promise<void> {
    closeContextMenu()
    const collection = currentCollections.find((item) => item.id === collectionId)
    if (collection) await handleCollectionClick(collection)
    shardModalCollectionId = collectionId
    shardModalShard = shard
    shardModalInitialPath = shard.path
    shardModalOpen = true
  }

  async function handleRemoveShard(): Promise<void> {
    if (!contextMenuCollection || !contextMenuShard) return
    const collectionId = contextMenuCollection.id
    const shard = contextMenuShard
    closeContextMenu()
    const confirmed = await window.api.showConfirmation({
      title: `Remove Shard “${shard.name}”?`,
      message:
        'The Shard definition and its local Topic definitions will be removed. Its folder, files, and the shared collection index remain untouched.',
      confirmLabel: 'Remove Shard',
      tone: 'danger'
    })
    if (!confirmed) return
    await removeShardDefinition(shard.id, collectionId)
  }

  async function handleShardInformation(): Promise<void> {
    if (!contextMenuShard) return
    const path = contextMenuShard.path
    await ensureContextShardActive()
    closeContextMenu()
    openInfoModal(path)
  }

  async function handleShardGraph(): Promise<void> {
    if (!contextMenuShard) return
    const path = contextMenuShard.path
    await ensureContextShardActive()
    closeContextMenu()
    void openGraphViewForPath(path)
  }

  function handleManageShardTopics(): void {
    if (!contextMenuCollection || !contextMenuShard) return
    const collectionId = contextMenuCollection.id
    const shardId = contextMenuShard.id
    closeContextMenu()
    openTopicsSettings(collectionId, shardId)
  }

  async function handleRevealCollection() {
    if (!contextMenuCollection) return
    const path = contextMenuShard
      ? `${contextMenuCollection.path}/${contextMenuShard.path}`
      : contextMenuCollection.path
    closeContextMenu()
    try {
      await window.api.showItemInFolder(path)
    } catch (err) {
      console.error('Reveal collection failed:', err)
    }
  }

  async function handleCopyCollectionPath() {
    if (!contextMenuCollection) return
    const path = contextMenuShard
      ? `${contextMenuCollection.path}/${contextMenuShard.path}`
      : contextMenuCollection.path
    closeContextMenu()
    await window.api.writeToClipboard(path)
  }

  /** Open settings for the context-menu collection at a specific section. */
  function handleCollectionSettingsSection(section: string) {
    if (!contextMenuCollection) return
    const id = contextMenuCollection.id
    closeContextMenu()
    if (section === 'clusters') {
      openTopicsSettings(id, null)
      return
    }
    settingsTarget.set(id)
    activeSection.set(section)
    settingsOpen.set(true)
  }

  /** Make the context-menu collection active (loading its trees) if it isn't. */
  async function ensureContextCollectionActive(): Promise<void> {
    if (!contextMenuCollection) return
    if (contextMenuCollection.id !== currentActiveCollectionId) {
      await handleCollectionClick(contextMenuCollection)
    }
  }

  async function handleSyncCollection() {
    if (!contextMenuCollection) return
    const target = contextMenuCollection
    closeContextMenu()
    if (target.id !== currentActiveCollectionId) {
      await handleCollectionClick(target)
    }
    void runIngest(false)
  }

  async function handleReindexCollection() {
    if (!contextMenuCollection) return
    const id = contextMenuCollection.id
    closeContextMenu()
    // Switch to this collection and reindex
    await setActiveCollection(id)
    runIngest(true)
  }

  async function handleRunDoctor() {
    if (!contextMenuCollection) return
    await ensureContextCollectionActive()
    closeContextMenu()
    openDoctorModal()
  }

  async function handleInformation() {
    if (!contextMenuCollection) return
    const scope =
      contextMenuCollection.id === currentActiveCollectionId ? currentActiveShard?.path : undefined
    await ensureContextCollectionActive()
    closeContextMenu()
    openInfoModal(scope)
  }

  function handleWatcherToggle() {
    closeContextMenu()
    void toggleWatcher()
  }

  function handleOpenInTerminal() {
    if (!contextMenuCollection) return
    const target = contextMenuCollection
    const shard = contextMenuShard
    closeContextMenu()
    void terminalStore.createTerminal({
      cwd: shard ? `${target.path}/${shard.path}` : target.path,
      title: shard?.name ?? target.name
    })
  }

  function formatStats(status: typeof currentCollectionStatus): string {
    if (currentActiveShard) return `${currentScopedFileCount} docs`
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

<svelte:window onclick={closeTransientMenus} />

<aside class="sidebar" style:width="{sidebarWidth}px" style:min-width="{sidebarWidth}px">
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
            bind:this={switcherTrigger}
            class="switcher-trigger"
            class:open={dropdownOpen}
            onclick={toggleDropdown}
            aria-haspopup="tree"
            aria-expanded={dropdownOpen}
            oncontextmenu={(e) => {
              if (currentActiveCollection) handleCollectionContextMenu(e, currentActiveCollection)
            }}
          >
            {#if currentActiveShard}
              <span class="switcher-icon shard-icon-slot"><ShardIcon size={18} /></span>
            {:else}
              <span class="material-symbols-outlined switcher-icon">folder_open</span>
            {/if}
            <div class="switcher-info">
              <span class="switcher-label">
                {currentActiveCollection?.name ?? 'Select collection'}{#if currentActiveShard}
                  <span class="switcher-breadcrumb-separator">
                    ›
                  </span>{currentActiveShard.name}{/if}
              </span>
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
              <div class="dropdown-search">
                <span class="material-symbols-outlined dropdown-search-icon">search</span>
                <input
                  bind:this={switcherSearchInput}
                  bind:value={switcherQuery}
                  type="search"
                  placeholder="Search collections..."
                  aria-label="Search collections and Shards"
                  autocomplete="off"
                  spellcheck="false"
                  oninput={() => (focusedSwitcherIndex = 0)}
                  onkeydown={handleSwitcherSearchKeydown}
                />
                {#if switcherQuery}
                  <button
                    class="dropdown-search-clear"
                    aria-label="Clear collection search"
                    onclick={() => {
                      switcherQuery = ''
                      focusedSwitcherIndex = 0
                      switcherSearchInput?.focus()
                    }}
                  >
                    <span class="material-symbols-outlined">close</span>
                  </button>
                {/if}
              </div>
              <div
                bind:this={switcherTree}
                class="dropdown-tree"
                role="tree"
                aria-label="Collections and Shards"
                tabindex="-1"
                onkeydown={handleSwitcherKeydown}
              >
                {#each visibleSwitcherRows as row, index (row.key)}
                  {#if row.kind === 'collection'}
                    <div class="dropdown-tree-row" role="presentation">
                      {#if row.hasChildren}
                        <button
                          class="dropdown-expand"
                          aria-label={expandedCollections.has(row.collection.id)
                            ? `Collapse ${row.collection.name}`
                            : `Expand ${row.collection.name}`}
                          tabindex="-1"
                          onclick={(event) => {
                            event.stopPropagation()
                            toggleCollectionExpanded(row.collection.id)
                          }}
                        >
                          <span class="material-symbols-outlined">
                            {expandedCollections.has(row.collection.id)
                              ? 'expand_more'
                              : 'chevron_right'}
                          </span>
                        </button>
                      {/if}
                      <button
                        class="dropdown-item collection-row"
                        class:active={currentActiveCollectionId === row.collection.id &&
                          !currentActiveShardId}
                        role="treeitem"
                        aria-level="1"
                        aria-selected={currentActiveCollectionId === row.collection.id &&
                          !currentActiveShardId}
                        aria-expanded={row.hasChildren
                          ? expandedCollections.has(row.collection.id)
                          : undefined}
                        data-switcher-index={index}
                        tabindex={focusedSwitcherIndex === index ? 0 : -1}
                        onfocus={() => (focusedSwitcherIndex = index)}
                        onclick={() => handleDropdownSelect(row.collection)}
                        oncontextmenu={(event) =>
                          handleCollectionContextMenu(event, row.collection)}
                      >
                        <span class="material-symbols-outlined dropdown-item-icon">
                          {currentActiveCollectionId === row.collection.id
                            ? 'folder_open'
                            : 'folder'}
                        </span>
                        <span class="dropdown-item-label">{row.collection.name}</span>
                        {#if currentActiveCollectionId === row.collection.id && !currentActiveShardId}
                          <span class="material-symbols-outlined dropdown-check">check</span>
                        {/if}
                      </button>
                    </div>
                  {:else if row.shard}
                    <div class="dropdown-tree-row shard-tree-row" role="presentation">
                      {#if row.hasChildren}
                        <button
                          class="dropdown-expand"
                          aria-label={expandedShards.has(`${row.collection.id}:${row.shard.id}`)
                            ? `Collapse ${row.shard.name}`
                            : `Expand ${row.shard.name}`}
                          tabindex="-1"
                          style:left={`${3 + (row.depth - 1) * 14}px`}
                          onclick={(event) => {
                            event.stopPropagation()
                            toggleShardExpanded(row.collection.id, row.shard!.id)
                          }}
                        >
                          <span class="material-symbols-outlined">
                            {expandedShards.has(`${row.collection.id}:${row.shard.id}`)
                              ? 'expand_more'
                              : 'chevron_right'}
                          </span>
                        </button>
                      {/if}
                      <button
                        class="dropdown-item shard-row"
                        class:active={currentActiveCollectionId === row.collection.id &&
                          currentActiveShardId === row.shard.id}
                        class:missing={!row.shard.exists}
                        role="treeitem"
                        aria-level={row.depth}
                        aria-selected={currentActiveCollectionId === row.collection.id &&
                          currentActiveShardId === row.shard.id}
                        aria-expanded={row.hasChildren
                          ? expandedShards.has(`${row.collection.id}:${row.shard.id}`)
                          : undefined}
                        aria-disabled={!row.shard.exists}
                        data-switcher-index={index}
                        tabindex={focusedSwitcherIndex === index ? 0 : -1}
                        style:padding-left={`${28 + (row.depth - 1) * 14}px`}
                        onfocus={() => (focusedSwitcherIndex = index)}
                        onclick={() => handleDropdownShardSelect(row.collection, row.shard!)}
                        oncontextmenu={(event) =>
                          handleShardContextMenu(event, row.collection, row.shard!)}
                        title={row.shard.exists
                          ? row.shard.path
                          : `Missing folder: ${row.shard.path}`}
                      >
                        <span class="dropdown-item-icon shard-icon-slot">
                          <ShardIcon size={16} />
                        </span>
                        <span class="dropdown-item-label">{row.shard.name}</span>
                        {#if !row.shard.exists}
                          <span class="material-symbols-outlined dropdown-warning">warning</span>
                        {:else if currentActiveCollectionId === row.collection.id && currentActiveShardId === row.shard.id}
                          <span class="material-symbols-outlined dropdown-check">check</span>
                        {/if}
                      </button>
                    </div>
                  {/if}
                {/each}
                {#if visibleSwitcherRows.length === 0}
                  <div class="dropdown-empty" role="status">No collections or Shards found</div>
                {/if}
                {#if Object.values(currentShardErrors).some(Boolean)}
                  <div class="dropdown-error" role="status">
                    Some Shards could not be loaded. Open the collection to retry.
                  </div>
                {/if}
              </div>
              <div class="dropdown-footer">
                <button class="dropdown-item add-item" onclick={handleDropdownAdd}>
                  <span class="material-symbols-outlined dropdown-item-icon">create_new_folder</span
                  >
                  <span class="dropdown-item-label">Add Collection</span>
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <!-- File Tree -->
    {#if currentActiveCollectionId}
      <div class="file-tree-section">
        <FileTree
          onfileselect={(detail) =>
            onfileselect?.({
              folderId: currentActiveCollectionId!,
              fileId: detail.path,
              forceNewTab: detail.forceNewTab
            })}
          onfolderopen={(detail) => {
            workspace.openTableTab(detail.path, detail.recursive ? { recursive: true } : undefined)
            syncFileStoresFromTab()
          }}
          oncreateshard={(detail) => void openCreateShard(currentActiveCollectionId!, detail.path)}
        />
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
  <div class="context-menu-overlay" onclick={closeContextMenu}>
    <div
      class="context-menu"
      style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
      onclick={(e) => e.stopPropagation()}
    >
      {#if contextMenuShard}
        <button
          class="context-menu-item"
          onclick={() => void openEditShard(contextMenuCollection!.id, contextMenuShard!)}
        >
          <span class="material-symbols-outlined">edit</span>
          <span class="context-menu-label">Edit Shard…</span>
        </button>
        <button class="context-menu-item" onclick={handleShardInformation}>
          <span class="material-symbols-outlined">info</span>
          <span class="context-menu-label">Information</span>
        </button>
        <button class="context-menu-item" onclick={handleManageShardTopics}>
          <span class="material-symbols-outlined">category</span>
          <span class="context-menu-label">Manage Topics…</span>
        </button>
        <button
          class="context-menu-item"
          onclick={handleShardGraph}
          disabled={!contextMenuShard.exists}
        >
          <span class="material-symbols-outlined">hub</span>
          <span class="context-menu-label">Show in Graph</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleOpenCollectionInNewWindow}>
          <span class="material-symbols-outlined">open_in_new</span>
          <span class="context-menu-label">Open in New Window</span>
        </button>
        <button class="context-menu-item" onclick={handleRevealCollection}>
          <span class="material-symbols-outlined">folder_open</span>
          <span class="context-menu-label">
            {isMac ? 'Reveal in Finder' : 'Reveal in File Explorer'}
          </span>
        </button>
        <button class="context-menu-item" onclick={handleCopyCollectionPath}>
          <span class="material-symbols-outlined">content_copy</span>
          <span class="context-menu-label">Copy Path</span>
        </button>
        <button class="context-menu-item" onclick={handleOpenInTerminal}>
          <span class="material-symbols-outlined">terminal</span>
          <span class="context-menu-label">Open in Terminal</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item danger" onclick={handleRemoveShard}>
          <span class="material-symbols-outlined">delete</span>
          <span class="context-menu-label">Remove Shard</span>
        </button>
      {:else}
        <button class="context-menu-item" onclick={handleOpenCollectionInNewWindow}>
          <span class="material-symbols-outlined">open_in_new</span>
          <span class="context-menu-label">Open in New Window</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleRevealCollection}>
          <span class="material-symbols-outlined">folder_open</span>
          <span class="context-menu-label">
            {isMac ? 'Reveal in Finder' : 'Reveal in File Explorer'}
          </span>
        </button>
        <button class="context-menu-item" onclick={handleCopyCollectionPath}>
          <span class="material-symbols-outlined">content_copy</span>
          <span class="context-menu-label">Copy Path</span>
        </button>
        <button class="context-menu-item" onclick={handleOpenInTerminal}>
          <span class="material-symbols-outlined">terminal</span>
          <span class="context-menu-label">Open in Terminal</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" onclick={handleSyncCollection}>
          <span class="material-symbols-outlined">sync</span>
          <span class="context-menu-label">Sync (Incremental)</span>
        </button>
        <button class="context-menu-item" onclick={handleReindexCollection}>
          <span class="material-symbols-outlined">restart_alt</span>
          <span class="context-menu-label">Reindex Collection</span>
        </button>
        {#if contextMenuCollection.id === currentActiveCollectionId}
          <button class="context-menu-item" onclick={handleWatcherToggle}>
            <span class="material-symbols-outlined">
              {currentWatcherState === 'running' ? 'visibility_off' : 'visibility'}
            </span>
            <span class="context-menu-label">
              {currentWatcherState === 'running' ? 'Stop Watching' : 'Watch for Changes'}
            </span>
          </button>
        {/if}
        <button class="context-menu-item" onclick={handleRunDoctor}>
          <span class="material-symbols-outlined">troubleshoot</span>
          <span class="context-menu-label">Run Doctor…</span>
        </button>
        <button class="context-menu-item" onclick={handleInformation}>
          <span class="material-symbols-outlined">info</span>
          <span class="context-menu-label">Information</span>
        </button>
        <button
          class="context-menu-item"
          onclick={() => void openCreateShard(contextMenuCollection!.id)}
        >
          <ShardIcon size={16} />
          <span class="context-menu-label">Create Shard…</span>
        </button>
        <div class="context-menu-separator"></div>
        <div
          class="submenu-wrapper"
          onmouseenter={() => (settingsSubmenuOpen = true)}
          onmouseleave={() => (settingsSubmenuOpen = false)}
        >
          <button
            class="context-menu-item submenu-parent"
            onclick={() => (settingsSubmenuOpen = !settingsSubmenuOpen)}
          >
            <span class="material-symbols-outlined">settings</span>
            <span class="context-menu-label">Settings</span>
            <span class="material-symbols-outlined submenu-arrow">chevron_right</span>
          </button>
          {#if settingsSubmenuOpen}
            <div class="context-submenu">
              {#each settingsSections as entry (entry.section)}
                <button
                  class="context-menu-item"
                  title={entry.label}
                  onclick={() => handleCollectionSettingsSection(entry.section)}
                >
                  <span class="material-symbols-outlined">{entry.icon}</span>
                  <span class="context-menu-label">{entry.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item danger" onclick={handleRemoveCollection}>
          <span class="material-symbols-outlined">delete</span>
          <span class="context-menu-label">Remove Collection</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

{#if shardModalOpen}
  <ShardModal
    collectionId={shardModalCollectionId}
    shard={shardModalShard}
    initialPath={shardModalInitialPath}
    onclose={() => (shardModalOpen = false)}
  />
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
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.1)) transparent;
  }

  .nav-content::-webkit-scrollbar {
    width: 6px;
  }
  .nav-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .nav-content::-webkit-scrollbar-thumb {
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
    border-radius: 3px;
  }
  .nav-content::-webkit-scrollbar-thumb:hover {
    background: var(--overlay-active, rgba(255, 255, 255, 0.2));
  }

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
    color: var(--color-text, #e4e4e7);
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
    color: var(--color-primary, #00e5ff);
    border-color: var(--color-primary, #00e5ff);
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
    border-color: var(--color-primary, #00e5ff);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .switcher-icon {
    font-size: 18px;
    color: var(--color-primary, #00e5ff);
    flex-shrink: 0;
  }

  .shard-icon-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .switcher-breadcrumb-separator {
    color: var(--color-text-dim, #71717a);
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
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
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
    color: var(--color-text, #e4e4e7);
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
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    max-height: 340px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dropdown-search {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 8px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .dropdown-search-icon {
    flex-shrink: 0;
    color: var(--color-text-dim, #71717a);
    font-size: 17px;
  }

  .dropdown-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font: inherit;
    font-size: 12px;
  }

  .dropdown-search input::placeholder {
    color: var(--color-text-dim, #71717a);
  }

  .dropdown-search:focus-within {
    box-shadow: inset 0 -1px var(--color-primary, #00e5ff);
  }

  .dropdown-search-clear {
    display: grid;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
  }

  .dropdown-search-clear:hover,
  .dropdown-search-clear:focus-visible {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text, #e4e4e7);
  }

  .dropdown-search-clear .material-symbols-outlined {
    font-size: 16px;
  }

  .dropdown-tree {
    min-height: 0;
    overflow-y: auto;
    padding: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.1)) transparent;
  }

  .dropdown-footer {
    flex-shrink: 0;
    padding: 4px;
    border-top: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
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

  .dropdown-tree-row {
    position: relative;
    display: flex;
    align-items: center;
  }

  .dropdown-tree-row .dropdown-item {
    padding-left: 28px;
  }

  .dropdown-expand {
    position: absolute;
    left: 3px;
    z-index: 1;
    display: grid;
    width: 22px;
    height: 26px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
  }

  .dropdown-expand:hover,
  .dropdown-expand:focus-visible {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text, #e4e4e7);
  }

  .dropdown-expand .material-symbols-outlined {
    font-size: 15px;
  }

  .shard-row .dropdown-item-icon {
    color: var(--color-primary, #00e5ff);
  }

  .shard-row.missing {
    color: var(--color-warning, #f59e0b);
  }

  .dropdown-warning {
    flex-shrink: 0;
    color: var(--color-warning, #f59e0b);
    font-size: 15px;
  }

  .dropdown-error {
    padding: 7px 10px;
    color: var(--color-warning, #f59e0b);
    font-size: 10px;
    line-height: 1.35;
  }

  .dropdown-empty {
    padding: 20px 10px;
    color: var(--color-text-dim, #71717a);
    font-size: 11px;
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .dropdown-item {
      transition: none;
    }
  }

  .dropdown-item:hover,
  .dropdown-item:focus-visible {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text-white, #fff);
    outline: none;
  }

  .dropdown-item.active {
    color: var(--color-text-white, #fff);
  }

  .dropdown-item-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .dropdown-item.active .dropdown-item-icon {
    color: var(--color-primary, #00e5ff);
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
    color: var(--color-primary, #00e5ff);
    flex-shrink: 0;
  }

  .dropdown-item.add-item {
    color: var(--color-primary, #00e5ff);
  }

  .dropdown-item.add-item:hover {
    color: var(--color-primary, #00e5ff);
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
    white-space: nowrap;
  }

  .context-menu-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-menu-item:hover {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text-white, #fff);
  }

  .context-menu-item:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .context-menu-item.danger:hover {
    color: #ef4444;
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
    flex-shrink: 0;
  }

  .context-menu-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }

  .submenu-wrapper {
    position: relative;
  }

  .submenu-parent .submenu-arrow {
    margin-left: auto;
    font-size: 16px;
  }

  .context-submenu {
    position: absolute;
    left: calc(100% - 4px);
    top: -4px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    padding: 4px;
    min-width: 180px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 102;
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
    color: var(--color-primary, #00e5ff);
  }

  .sidebar-footer-btn .material-symbols-outlined {
    font-size: 18px;
  }
</style>
