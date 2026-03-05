<script lang="ts">
  import {
    updateState,
    updateVersion,
    downloadProgress,
    updateError,
    updateDismissed,
    downloadUpdate,
    installUpdate,
    skipVersion,
    dismissNotification,
  } from '../stores/updater'

  let currentState = $state<'idle' | 'checking' | 'update-available' | 'downloading' | 'ready' | 'error'>('idle')
  let currentVersion = $state<string | null>(null)
  let currentProgress = $state(0)
  let currentError = $state<string | null>(null)
  let currentDismissed = $state(false)

  updateState.subscribe((v) => (currentState = v))
  updateVersion.subscribe((v) => (currentVersion = v))
  downloadProgress.subscribe((v) => (currentProgress = v))
  updateError.subscribe((v) => (currentError = v))
  updateDismissed.subscribe((v) => (currentDismissed = v))

  let visible = $derived(
    !currentDismissed &&
    (currentState === 'update-available' || currentState === 'downloading' || currentState === 'ready' || currentState === 'error')
  )

  function handleDownload() {
    downloadUpdate()
  }

  function handleInstall() {
    installUpdate()
  }

  function handleSkip() {
    skipVersion()
  }

  function handleLater() {
    dismissNotification()
  }
</script>

{#if visible}
  <div class="update-banner" class:update-error={currentState === 'error'}>
    {#if currentState === 'update-available'}
      <span class="material-symbols-outlined update-icon">system_update</span>
      <span class="update-message">
        Version {currentVersion ?? 'unknown'} is available
      </span>
      <div class="update-actions">
        <button class="update-btn update-btn-primary" onclick={handleDownload}>Download</button>
        <button class="update-btn update-btn-secondary" onclick={handleLater}>Later</button>
        <button class="update-btn update-btn-secondary" onclick={handleSkip}>Skip</button>
      </div>

    {:else if currentState === 'downloading'}
      <span class="material-symbols-outlined update-icon spinning">downloading</span>
      <span class="update-message">
        Downloading update… {Math.round(currentProgress)}%
      </span>
      <div class="update-progress-track">
        <div class="update-progress-fill" style="width: {currentProgress}%"></div>
      </div>

    {:else if currentState === 'ready'}
      <span class="material-symbols-outlined update-icon">restart_alt</span>
      <span class="update-message">Update ready to install</span>
      <div class="update-actions">
        <button class="update-btn update-btn-primary" onclick={handleInstall}>Restart Now</button>
        <button class="update-btn update-btn-secondary" onclick={handleLater}>Later</button>
      </div>

    {:else if currentState === 'error'}
      <span class="material-symbols-outlined update-icon">error</span>
      <span class="update-message">Update failed: {currentError ?? 'Unknown error'}</span>
      <div class="update-actions">
        <button class="update-btn update-btn-secondary" onclick={handleLater}>Dismiss</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--color-accent, #4a9eff);
    color: var(--color-on-accent, #fff);
    font-size: 13px;
    min-height: 32px;
  }

  .update-banner.update-error {
    background: var(--color-error, #e53935);
  }

  .update-icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  .update-message {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .update-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .update-btn {
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .update-btn-primary {
    background: rgba(255, 255, 255, 0.25);
    color: inherit;
    font-weight: 600;
  }

  .update-btn-primary:hover {
    background: rgba(255, 255, 255, 0.4);
  }

  .update-btn-secondary {
    background: transparent;
    color: inherit;
    opacity: 0.85;
  }

  .update-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
    opacity: 1;
  }

  .update-progress-track {
    width: 120px;
    height: 4px;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .update-progress-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .spinning {
    animation: spin 1.5s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
