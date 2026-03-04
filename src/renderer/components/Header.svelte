<script lang="ts">
  import { activeCollection, activeCollectionId } from '../stores/collections';
  import { selectedFilePath } from '../stores/files';
  import { isDirty, requestSave } from '../stores/editor';
  import { searchOpen, clearSearch } from '../stores/search';
  import { isFavorited, toggleFavorite } from '../stores/favorites';
  import type { SearchResult } from '../types/cli';
  import Search from './Search.svelte';
  import SearchResults from './SearchResults.svelte';

  interface HeaderProps {
    propertiesOpen?: boolean;
    onsearchresultclick?: (result: SearchResult) => void;
    ontoggleproperties?: (detail: { open: boolean }) => void;
  }

  let {
    propertiesOpen = $bindable(false),
    onsearchresultclick,
    ontoggleproperties,
  }: HeaderProps = $props();

  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  activeCollection.subscribe((v) => (currentActiveCollection = v));

  let currentActiveCollectionId: string | null = $state(null);
  activeCollectionId.subscribe((v) => (currentActiveCollectionId = v));

  let currentSelectedFilePath: string | null = $state(null);
  selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));

  let currentIsDirty = $state(false);
  isDirty.subscribe((v) => (currentIsDirty = v));

  let currentSearchOpen = $state(false);
  searchOpen.subscribe((v) => (currentSearchOpen = v));

  let currentIsFavorited = $state(false);
  isFavorited.subscribe((v) => (currentIsFavorited = v));

  let collectionName = $derived(currentActiveCollection?.name ?? null);

  /** Parse selected file path into breadcrumb segments: [dir1, dir2, ..., filename] */
  let pathSegments = $derived.by(() => {
    if (currentSelectedFilePath) {
      return currentSelectedFilePath.split('/').filter((s) => s.length > 0);
    }
    return [];
  });

  /** Directory segments (everything except the last segment / filename) */
  let dirSegments = $derived(pathSegments.length > 1 ? pathSegments.slice(0, -1) : []);

  /** The filename (last segment) */
  let fileName = $derived(pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : null);

  function handleResultClick(result: SearchResult) {
    onsearchresultclick?.(result);
  }

  function handleCloseRequest() {
    clearSearch();
  }

  function toggleProperties() {
    propertiesOpen = !propertiesOpen;
    ontoggleproperties?.({ open: propertiesOpen });
  }

  async function handleToggleFavorite() {
    if (!currentActiveCollectionId || !currentSelectedFilePath) return;
    await toggleFavorite(currentActiveCollectionId, currentSelectedFilePath);
  }
</script>

<header class="header">
  <!-- Breadcrumb (only shown when a collection is active) -->
  {#if collectionName}
    <div class="breadcrumb">
      <span class="breadcrumb-folder">{collectionName}</span>
      {#if pathSegments.length > 0}
        <span class="material-symbols-outlined breadcrumb-separator">chevron_right</span>
      {/if}
      {#each dirSegments as segment}
        <span class="breadcrumb-folder">{segment}</span>
        <span class="material-symbols-outlined breadcrumb-separator">chevron_right</span>
      {/each}
      {#if fileName}
        <span class="breadcrumb-file">{fileName}{#if currentIsDirty}<span class="dirty-indicator"> ●</span>{/if}</span>
        <button
          class="star-button"
          title={currentIsFavorited ? 'Remove from favorites' : 'Add to favorites'}
          onclick={handleToggleFavorite}
        >
          <span class="material-symbols-outlined" class:filled={currentIsFavorited}>star</span>
        </button>
      {/if}
    </div>
  {:else}
    <div></div>
  {/if}

  <!-- Actions -->
  <div class="actions">
    <div class="search-area">
      <Search onsearchresultclick={handleResultClick} />
    </div>

    <div class="divider"></div>

    <button
      class="icon-button"
      class:active={propertiesOpen}
      title="Toggle Properties"
      onclick={toggleProperties}
    >
      <span class="material-symbols-outlined">side_navigation</span>
    </button>

    {#if currentIsDirty}
      <button class="save-button" onclick={requestSave}>
        <span>Save</span>
        <kbd class="save-kbd"><span class="kbd-symbol">⌘</span>S</kbd>
      </button>
    {/if}
  </div>
</header>

{#if currentSearchOpen}
  <div class="search-results-overlay">
    <SearchResults onresultclick={handleResultClick} oncloserequest={handleCloseRequest} />
  </div>
{/if}

<style>
  .header {
    height: 56px;
    min-height: 56px;
    border-bottom: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    background: rgba(15, 15, 16, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 30;
    -webkit-app-region: drag;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    letter-spacing: -0.025em;
    -webkit-app-region: no-drag;
  }

  .breadcrumb-folder {
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color 0.15s;
  }

  .breadcrumb-folder:hover {
    color: #fff;
  }

  .breadcrumb-separator {
    font-size: 14px;
    color: var(--color-border, #27272a);
  }

  .breadcrumb-file {
    color: var(--color-primary, #00E5FF);
    font-weight: 500;
  }

  .dirty-indicator {
    color: var(--color-warning, #f59e0b);
  }

  .star-button {
    padding: 4px;
    margin-left: 8px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .star-button:hover {
    color: var(--color-primary, #00E5FF);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .star-button .material-symbols-outlined {
    font-size: 18px;
  }

  .star-button .material-symbols-outlined.filled {
    font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
    color: var(--color-primary, #00E5FF);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    -webkit-app-region: no-drag;
  }

  .search-area {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-results-overlay {
    position: absolute;
    top: 56px;
    left: 0;
    right: 0;
    z-index: 40;
  }

  .divider {
    height: 16px;
    width: 1px;
    background: var(--color-border, #27272a);
    margin: 0 8px;
  }

  .icon-button {
    padding: 8px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-button:hover,
  .icon-button.active {
    color: var(--color-primary, #00E5FF);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .icon-button .material-symbols-outlined {
    font-size: 20px;
  }

  .save-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
    border-radius: 4px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-family: inherit;
  }

  .save-button:hover {
    background: var(--color-primary-dark, #00B8CC);
  }

  .save-kbd {
    display: inline-flex;
    height: 18px;
    align-items: center;
    gap: 1px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.15);
    padding: 0 5px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
  }
</style>
