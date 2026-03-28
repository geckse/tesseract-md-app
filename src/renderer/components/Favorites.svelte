<script lang="ts">
  import { favorites, favoritesLoading } from '../stores/favorites'
  import { collections, activeCollectionId, setActiveCollection } from '../stores/collections'
  import { syncFileStoresFromTab } from '../stores/files'
  import { workspace } from '../stores/workspace.svelte'
  import type { FavoriteEntry } from '../../preload/api'

  // Reactive subscriptions
  let currentFavorites: FavoriteEntry[] = $state([])
  let currentCollections = $state([])
  let currentActiveCollectionId: string | null = $state(null)
  let currentLoading: boolean = $state(false)

  favorites.subscribe((v) => (currentFavorites = v))
  collections.subscribe((v) => (currentCollections = v))
  activeCollectionId.subscribe((v) => (currentActiveCollectionId = v))
  favoritesLoading.subscribe((v) => (currentLoading = v))

  // Filter out favorites from collections that no longer exist
  const validFavorites = $derived(
    currentFavorites.filter((fav) =>
      currentCollections.some((col) => col.id === fav.collectionId)
    )
  )

  // Helper to get collection name by ID
  function getCollectionName(collectionId: string): string {
    const collection = currentCollections.find((c) => c.id === collectionId)
    return collection?.name ?? 'Unknown'
  }

  // Helper to get file basename from path
  function getFileName(path: string): string {
    const parts = path.split('/')
    return parts[parts.length - 1] || path
  }

  // Handle clicking a favorite file
  async function handleFavoriteClick(favorite: FavoriteEntry) {
    // Switch collection if needed
    if (currentActiveCollectionId !== favorite.collectionId) {
      await setActiveCollection(favorite.collectionId)
    }
    // Open the file in a workspace tab
    workspace.openTab(favorite.filePath)
    syncFileStoresFromTab()
  }
</script>

{#if !currentLoading && validFavorites.length > 0}
  <div class="nav-section favorites-section">
    <div class="section-header-row">
      <span class="material-symbols-outlined section-icon">star</span>
      <h3 class="section-header">Favorites</h3>
    </div>

    <nav class="nav-list">
      {#each validFavorites as favorite (favorite.collectionId + ':' + favorite.filePath)}
        <button
          class="nav-item favorite-item"
          onclick={() => handleFavoriteClick(favorite)}
        >
          <span class="material-symbols-outlined nav-icon">description</span>
          <div class="favorite-info">
            <span class="nav-label">{getFileName(favorite.filePath)}</span>
            <span class="favorite-collection">{getCollectionName(favorite.collectionId)}</span>
          </div>
        </button>
      {/each}
    </nav>
  </div>
{/if}

<style>
  .favorites-section {
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
    color: #fbbf24;
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

  .favorite-info {
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

  .favorite-collection {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
</style>
