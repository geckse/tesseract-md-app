<script lang="ts">
  import { runIngest, runPreview } from '../stores/ingest'
  import { activeCollection } from '../stores/collections'
  import { ingestRunning } from '../stores/ingest'
  import type { Collection } from '../../preload/api'

  let dropdownOpen = $state(false)
  let currentCollection: Collection | null = $state(null)
  let currentRunning = $state(false)

  activeCollection.subscribe((v) => (currentCollection = v))
  ingestRunning.subscribe((v) => (currentRunning = v))

  let disabled = $derived(!currentCollection || currentRunning)

  function toggleDropdown() {
    if (disabled) return
    dropdownOpen = !dropdownOpen
  }

  function closeDropdown() {
    dropdownOpen = false
  }

  async function handleIngest() {
    closeDropdown()
    await runIngest(false)
  }

  async function handlePreview() {
    closeDropdown()
    await runPreview()
  }

  async function handleFullReindex() {
    closeDropdown()
    await runIngest(true)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && dropdownOpen) {
      closeDropdown()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if dropdownOpen}
  <div class="dropdown-overlay" onclick={closeDropdown}></div>
{/if}

<div class="ingest-panel">
  <button
    class="ingest-trigger"
    class:disabled
    onclick={toggleDropdown}
    title={disabled ? (currentRunning ? 'Ingest in progress...' : 'Select a collection first') : 'Ingest actions'}
  >
    <span class="material-symbols-outlined trigger-icon">bolt</span>
    <span class="trigger-label">Ingest</span>
    <span class="material-symbols-outlined trigger-chevron" class:open={dropdownOpen}>expand_more</span>
  </button>

  {#if dropdownOpen}
    <div class="dropdown-menu" role="menu">
      <button class="dropdown-item" role="menuitem" onclick={handleIngest}>
        <span class="material-symbols-outlined item-icon">sync</span>
        <div class="item-content">
          <span class="item-label">Ingest</span>
          <span class="item-desc">Index new & changed files</span>
        </div>
      </button>
      <button class="dropdown-item" role="menuitem" onclick={handlePreview}>
        <span class="material-symbols-outlined item-icon">preview</span>
        <div class="item-content">
          <span class="item-label">Preview</span>
          <span class="item-desc">Dry run — see what would change</span>
        </div>
      </button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item dropdown-item-warning" role="menuitem" onclick={handleFullReindex}>
        <span class="material-symbols-outlined item-icon">restart_alt</span>
        <div class="item-content">
          <span class="item-label">Full Reindex</span>
          <span class="item-desc">Re-embed all files from scratch</span>
        </div>
      </button>
    </div>
  {/if}
</div>

<style>
  .ingest-panel {
    position: relative;
  }

  .ingest-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-primary, #00E5FF);
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.15s;
  }

  .ingest-trigger:hover:not(.disabled) {
    background: var(--color-surface-darker, #0a0a0a);
    border-color: var(--color-primary, #00E5FF);
    box-shadow: 0 0 8px rgba(0, 229, 255, 0.15);
  }

  .ingest-trigger.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .trigger-icon {
    font-size: 16px;
  }

  .trigger-label {
    font-size: 13px;
  }

  .trigger-chevron {
    font-size: 16px;
    transition: transform 0.15s;
    margin-left: 2px;
  }

  .trigger-chevron.open {
    transform: rotate(180deg);
  }

  .dropdown-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 49;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 50;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    border-radius: 6px;
    color: var(--color-text-secondary, #a1a1aa);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: all 0.15s;
  }

  .dropdown-item:hover {
    background: var(--color-surface-darker, #0a0a0a);
    color: #fff;
  }

  .dropdown-item:hover .item-icon {
    color: var(--color-primary, #00E5FF);
  }

  .dropdown-item-warning:hover .item-icon {
    color: #f59e0b;
  }

  .item-icon {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .item-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .item-label {
    font-size: 13px;
    font-weight: 500;
  }

  .item-desc {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 8px;
  }
</style>
