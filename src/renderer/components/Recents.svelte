<script lang="ts">
  import { recentFiles, recentsLoading, sortedRecents, clearAllRecents } from '../stores/favorites'
  import { collections, activeCollectionId, setActiveCollection } from '../stores/collections'
  import { selectFile } from '../stores/files'
  import type { RecentEntry } from '../../preload/api'

  // Reactive subscriptions
  let currentRecents: RecentEntry[] = $state([])
  let currentCollections = $state([])
  let currentActiveCollectionId: string | null = $state(null)
  let currentLoading: boolean = $state(false)

  sortedRecents.subscribe((v) => (currentRecents = v))
  collections.subscribe((v) => (currentCollections = v))
  activeCollectionId.subscribe((v) => (currentActiveCollectionId = v))
  recentsLoading.subscribe((v) => (currentLoading = v))

  // Context menu state
  let showContextMenu = $state(false)
  let contextMenuPosition = $state({ x: 0, y: 0 })

  // Filter out recents from collections that no longer exist
  $: validRecents = currentRecents.filter((recent) =>
    currentCollections.some((col) => col.id === recent.collectionId)
  )

  // Helper to get file basename from path
  function getFileName(path: string): string {
    const parts = path.split('/')
    return parts[parts.length - 1] || path
  }

  // Format relative time
  function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`

    // Older: format as date
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Handle clicking a recent file
  async function handleRecentClick(recent: RecentEntry) {
    // Switch collection if needed
    if (currentActiveCollectionId !== recent.collectionId) {
      await setActiveCollection(recent.collectionId)
    }
    // Open the file
    await selectFile(recent.filePath)
  }

  // Handle right-click to show context menu
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    showContextMenu = true
    contextMenuPosition = { x: event.clientX, y: event.clientY }
  }

  // Close context menu
  function closeContextMenu() {
    showContextMenu = false
  }

  // Handle clear all recents
  async function handleClearAll() {
    await clearAllRecents()
    closeContextMenu()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if !currentLoading && validRecents.length > 0}
  <div class="nav-section recents-section" oncontextmenu={handleContextMenu}>
    <div class="section-header-row">
      <span class="material-symbols-outlined section-icon">schedule</span>
      <h3 class="section-header">Recent</h3>
    </div>

    <nav class="nav-list">
      {#each validRecents as recent (recent.collectionId + ':' + recent.filePath)}
        <button
          class="nav-item recent-item"
          onclick={() => handleRecentClick(recent)}
        >
          <span class="material-symbols-outlined nav-icon">description</span>
          <div class="recent-info">
            <span class="nav-label">{getFileName(recent.filePath)}</span>
            <span class="recent-time">{formatRelativeTime(recent.openedAt)}</span>
          </div>
        </button>
      {/each}
    </nav>
  </div>
{/if}

<!-- Context menu -->
{#if showContextMenu}
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
      <button class="context-menu-item" onclick={handleClearAll}>
        <span class="material-symbols-outlined">delete_sweep</span>
        Clear All Recents
      </button>
    </div>
  </div>
{/if}

<style>
  .recents-section {
    flex-shrink: 0;
  }

  .nav-section {
    padding: 0 12px;
    margin-bottom: 24px;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    margin-bottom: 12px;
  }

  .section-icon {
    font-size: 14px;
    color: var(--color-primary, #00E5FF);
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
    transition: all 0.15s;
    font-family: inherit;
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

  .recent-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  .nav-label {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .recent-time {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
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

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }
</style>
