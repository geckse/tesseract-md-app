<script lang="ts">
  import { onMount } from 'svelte';
  import { isDirty, wordCount as wordCountStore, readingTime as readingTimeStore } from '../stores/editor';
  import WatcherToggle from './WatcherToggle.svelte';

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

  let currentReadingTime = $state(0);
  readingTimeStore.subscribe((v) => (currentReadingTime = v));

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
  <div class="status-group">
    <span class="status-item interactive">
      <span class="material-symbols-outlined status-icon">markdown</span>
      {language}
      {#if currentIsDirty}
        <span class="dirty-dot"></span>
      {/if}
    </span>
    <span class="status-item interactive">{currentWordCount} words</span>
    <span class="status-item interactive">{currentReadingTime} mins</span>
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
  </div>
</div>

<style>
  .status-bar {
    height: 32px;
    min-height: 32px;
    background: var(--color-surface-darker, #0a0a0a);
    border-top: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    line-height: 32px;
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
</style>
