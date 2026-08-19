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
    dismissNotification
  } from '../stores/updater'

  let currentState = $state<
    'idle' | 'checking' | 'update-available' | 'downloading' | 'ready' | 'error'
  >('idle')
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
      (currentState === 'update-available' ||
        currentState === 'downloading' ||
        currentState === 'ready' ||
        currentState === 'error')
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
  <div
    class="update-banner"
    class:update-error={currentState === 'error'}
    role="status"
    aria-live="polite"
  >
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
    border-top: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 22%, transparent);
    background: color-mix(
      in srgb,
      var(--color-primary, #00e5ff) 10%,
      var(--color-surface, #161617)
    );
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    min-height: 34px;
  }

  .update-banner.update-error {
    border-top-color: color-mix(in srgb, var(--color-error, #e53935) 35%, transparent);
    background: color-mix(in srgb, var(--color-error, #e53935) 10%, var(--color-surface, #161617));
  }

  .update-icon {
    font-size: 18px;
    flex-shrink: 0;
    color: var(--color-primary, #00e5ff);
  }

  .update-error .update-icon {
    color: var(--color-error, #e53935);
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
    border: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 45%, transparent);
    background: transparent;
    color: var(--color-primary, #00e5ff);
    font-weight: 600;
  }

  .update-btn-primary:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.08));
  }

  .update-btn-secondary {
    background: transparent;
    color: inherit;
    opacity: 0.85;
  }

  .update-btn-secondary:hover {
    background: var(--overlay-active, rgba(255, 255, 255, 0.15));
    opacity: 1;
  }

  .update-btn:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .update-error .update-btn:focus-visible {
    outline-color: #fff;
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
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .update-progress-fill {
      transition: none;
    }

    .spinning {
      animation: none;
    }
  }
</style>
