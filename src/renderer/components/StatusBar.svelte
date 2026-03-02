<script lang="ts">
  export let language = 'Markdown';
  export let wordCount = 742;
  export let readingTime = 4;
  export let syncStatus: 'synced' | 'syncing' | 'error' = 'synced';
  export let encoding = 'UTF-8';

  $: syncLabel = syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Syncing...' : 'Error';
  $: syncColor = syncStatus === 'error' ? 'error' : 'synced';
</script>

<!-- h-7 bg-surface-darker font-mono: 28px status bar with monospace text -->
<div class="status-bar">
  <div class="status-group">
    <span class="status-item interactive">
      <span class="material-symbols-outlined status-icon">markdown</span>
      {language}
    </span>
    <span class="status-item interactive">{wordCount} words</span>
    <span class="status-item interactive">{readingTime} mins</span>
  </div>

  <div class="status-group">
    <span class="status-item interactive sync-indicator" class:sync-error={syncColor === 'error'}>
      <span class="sync-dot" class:sync-dot-error={syncColor === 'error'}></span>
      {syncLabel}
    </span>
    <span class="status-item interactive">{encoding}</span>
  </div>
</div>

<style>
  .status-bar {
    height: 28px;
    min-height: 28px;
    background: var(--color-surface-darker, #0a0a0a);
    border-top: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
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

  .sync-indicator {
    color: #10b981;
  }

  .sync-indicator:hover {
    color: #fff;
  }

  .sync-error {
    color: #ef4444;
  }

  .sync-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .sync-dot-error {
    background: #ef4444;
    animation: none;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
