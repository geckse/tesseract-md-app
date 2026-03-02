<script lang="ts">
  import { activeCollection } from '../stores/collections';

  interface HeaderProps {
    breadcrumb?: { folder?: string; file?: string };
    propertiesOpen?: boolean;
    onsearch?: (detail: { query: string }) => void;
    ontoggleproperties?: (detail: { open: boolean }) => void;
    onedit?: () => void;
  }

  let {
    breadcrumb = { folder: 'Project Alpha', file: 'Design Specs.md' },
    propertiesOpen = $bindable(false),
    onsearch,
    ontoggleproperties,
    onedit,
  }: HeaderProps = $props();

  let $activeCollection: import('../../preload/api').Collection | null = $state(null);
  activeCollection.subscribe((v) => ($activeCollection = v));

  let collectionName = $derived($activeCollection?.name ?? breadcrumb.folder);

  function handleSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    onsearch?.({ query: target.value });
  }

  function toggleProperties() {
    propertiesOpen = !propertiesOpen;
    ontoggleproperties?.({ open: propertiesOpen });
  }

  function handleEdit() {
    onedit?.();
  }
</script>

<header class="header">
  <!-- Breadcrumb -->
  <div class="breadcrumb">
    {#if collectionName}
      <span class="breadcrumb-folder">{collectionName}</span>
      <span class="material-symbols-outlined breadcrumb-separator">chevron_right</span>
    {/if}
    {#if breadcrumb.file}
      <span class="breadcrumb-file">{breadcrumb.file}</span>
    {/if}
  </div>

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

    <button class="edit-button" onclick={handleEdit}>
      <span>Edit</span>
    </button>
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
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    letter-spacing: -0.025em;
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

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
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

  .edit-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
    border-radius: 2px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-family: inherit;
  }

  .edit-button:hover {
    background: var(--color-primary-dark, #00B8CC);
  }
</style>
