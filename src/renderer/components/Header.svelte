<script lang="ts">
  import { activeCollection } from '../stores/collections';
  import { selectedFilePath } from '../stores/files';
  import { isDirty, requestSave } from '../stores/editor';

  interface HeaderProps {
    propertiesOpen?: boolean;
    onsearch?: (detail: { query: string }) => void;
    ontoggleproperties?: (detail: { open: boolean }) => void;
  }

  let {
    propertiesOpen = $bindable(false),
    onsearch,
    ontoggleproperties,
  }: HeaderProps = $props();

  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  activeCollection.subscribe((v) => (currentActiveCollection = v));

  let currentSelectedFilePath: string | null = $state(null);
  selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));

  let currentIsDirty = $state(false);
  isDirty.subscribe((v) => (currentIsDirty = v));

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

  function handleSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    onsearch?.({ query: target.value });
  }

  function toggleProperties() {
    propertiesOpen = !propertiesOpen;
    ontoggleproperties?.({ open: propertiesOpen });
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
      {/if}
    </div>
  {:else}
    <div></div>
  {/if}

  <!-- Actions -->
  <div class="actions">
    <div class="search-wrapper">
      <span class="material-symbols-outlined search-icon">search</span>
      <input
        class="search-input"
        type="text"
        placeholder="Search database..."
        oninput={handleSearch}
      />
      <div class="search-shortcut">
        <kbd class="kbd"><span class="kbd-symbol">⌘</span>K</kbd>
      </div>
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

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    -webkit-app-region: no-drag;
  }

  .search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    pointer-events: none;
    transition: color 0.15s;
  }

  .search-wrapper:focus-within .search-icon {
    color: var(--color-primary, #00E5FF);
  }

  .search-input {
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 6px 48px 6px 36px;
    font-size: 12px;
    color: #fff;
    width: 224px;
    transition: all 0.2s;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    outline: none;
  }

  .search-input::placeholder {
    color: rgba(113, 113, 122, 0.5);
  }

  .search-input:focus {
    border-color: var(--color-primary, #00E5FF);
    box-shadow: 0 0 0 1px var(--color-primary, #00E5FF);
    width: 288px;
  }

  .search-shortcut {
    position: absolute;
    right: 8px;
    pointer-events: none;
    display: none;
  }

  .search-wrapper:focus-within .search-shortcut {
    display: flex;
  }

  .kbd {
    display: inline-flex;
    height: 20px;
    align-items: center;
    gap: 2px;
    border-radius: 4px;
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
    padding: 0 6px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 500;
    color: var(--color-text-dim, #71717a);
  }

  .kbd-symbol {
    font-size: 10px;
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
