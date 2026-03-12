<script lang="ts">
  import { onMount } from 'svelte';
  import { isDirty, wordCount as wordCountStore, tokenCount as tokenCountStore } from '../stores/editor';
  import WatcherToggle from './WatcherToggle.svelte';
  import logoIcon from '../../../resources/icon.png';

  interface StatusBarProps {
    language?: string;
    syncStatus?: 'synced' | 'syncing' | 'error';
    encoding?: string;
  }

  let {
    language = 'Markdown',
    syncStatus = 'synced',
    encoding = 'UTF-8',
  }: StatusBarProps = $props();

  let currentIsDirty = $state(false);
  isDirty.subscribe((v) => (currentIsDirty = v));

  let currentWordCount = $state(0);
  wordCountStore.subscribe((v) => (currentWordCount = v));

  let currentTokenCount = $state(0);
  tokenCountStore.subscribe((v) => (currentTokenCount = v));

  let cliVersion: string | null = $state(null);
  let cliFound = $state(false);

  onMount(async () => {
    try {
      const path = await window.api.findCli();
      if (path) {
        cliFound = true;
        cliVersion = await window.api.getCliVersion();
      }
    } catch {
      cliFound = false;
      cliVersion = null;
    }
  });
</script>

<div class="status-bar">
  <!-- Screen reader announcements for status changes -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {#if cliFound}
      mdvdb CLI found, version {cliVersion || 'unknown'}
    {:else}
      mdvdb CLI not found
    {/if}
  </div>

  <div class="status-group">
    <span class="status-item interactive">
      <span class="material-symbols-outlined status-icon">markdown</span>
      {language}
      {#if currentIsDirty}
        <span class="dirty-dot"></span>
      {/if}
    </span>
    <span class="status-item interactive">{currentWordCount} words</span>
    <span class="status-item interactive">{currentTokenCount.toLocaleString()} tokens</span>
  </div>

  <div class="status-group">
    <WatcherToggle />
    <span class="status-item cli-indicator" class:cli-found={cliFound} class:cli-missing={!cliFound}>
      <span class="cli-dot" class:cli-dot-found={cliFound} class:cli-dot-missing={!cliFound}></span>
      {#if cliFound}
        mdvdb {cliVersion ? `v${cliVersion}` : ''}
      {:else}
        CLI not found
      {/if}
    </span>
    <img class="status-logo" src={logoIcon} alt="Tesseragt" />
  </div>
</div>

<style>
  .status-bar {
    height: 35px;
    min-height: 35px;
    background: var(--color-surface-darker, #0a0a0a);
    border-top: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px 8px 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 35px;
    color: var(--color-text-dim, #71717a);
    user-select: none;
    letter-spacing: -0.025em;
    z-index: 30;
  }

  .status-group {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-item.interactive {
    cursor: pointer;
    transition: color 0.15s;
  }

  .status-item.interactive:hover {
    color: #fff;
  }

  .status-icon {
    font-size: 12px;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
  }

  .cli-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cli-found {
    color: #10b981;
  }

  .cli-missing {
    color: #ef4444;
  }

  .cli-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cli-dot-found {
    background: #10b981;
  }

  .cli-dot-missing {
    background: #ef4444;
  }

  .status-logo {
    height: 14px;
    width: auto;
    object-fit: contain;
    filter: grayscale(100%);
    opacity: 0.5;
  }

  /* Screen reader only - visually hidden but available to assistive tech */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
