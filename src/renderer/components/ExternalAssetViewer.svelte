<script lang="ts">
  import type { AssetTab } from '../stores/workspace.svelte'

  interface Props {
    tab: AssetTab
  }

  let { tab }: Props = $props()
  let error = $state<string | null>(null)

  function formatSize(bytes?: number): string {
    if (bytes == null) return 'Unknown size'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function run(action: 'open' | 'reveal'): Promise<void> {
    if (!tab.externalId) return
    error = null
    try {
      if (action === 'open') await window.api.openExternalFile(tab.externalId)
      else await window.api.revealExternalFile(tab.externalId)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }
</script>

<div class="external-viewer" aria-label="External file preview">
  {#if tab.mimeCategory === 'image' && tab.externalUrl}
    <img src={tab.externalUrl} alt={tab.title} aria-label="External image preview" />
  {:else if tab.mimeCategory === 'video' && tab.externalUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={tab.externalUrl} controls aria-label="External video preview"></video>
  {:else if tab.mimeCategory === 'audio' && tab.externalUrl}
    <div class="audio-card">
      <span class="material-symbols-outlined" aria-hidden="true">audiotrack</span>
      <strong>{tab.title}</strong>
      <audio src={tab.externalUrl} controls aria-label="External audio preview"></audio>
    </div>
  {:else}
    <div class="info-card">
      <span class="material-symbols-outlined file-icon" aria-hidden="true">draft</span>
      <h2>{tab.title}</h2>
      <p>{formatSize(tab.fileSize)}</p>
      {#if tab.externalPath}<p class="path">{tab.externalPath}</p>{/if}
      {#if !tab.externalUrl && tab.mimeCategory !== 'other'}
        <p class="error" role="alert">This dropped file could not be previewed.</p>
      {/if}
    </div>
  {/if}

  <div class="actions">
    <button type="button" onclick={() => void run('reveal')}>
      <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
      Reveal
    </button>
    <button type="button" onclick={() => void run('open')}>
      <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
      Open in Default App
    </button>
  </div>
  {#if error}<p class="error action-error" role="alert">{error}</p>{/if}
</div>

<style>
  .external-viewer {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: var(--color-surface-dark, #0a0a0a);
  }

  img,
  video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .audio-card,
  .info-card {
    display: flex;
    width: min(520px, 100%);
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 10px;
    background: var(--color-surface, #161617);
    color: var(--color-text, #e4e4e7);
    text-align: center;
  }

  audio {
    width: 100%;
  }

  h2,
  p {
    margin: 0;
  }

  .file-icon,
  .audio-card > .material-symbols-outlined {
    font-size: 52px;
    color: var(--color-primary, #00e5ff);
  }

  .path {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .actions {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    gap: 8px;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    background: var(--color-surface, #161617);
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
  }

  button:hover {
    border-color: var(--color-primary, #00e5ff);
  }

  button:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  button .material-symbols-outlined {
    font-size: 17px;
  }

  .error {
    color: var(--color-error, #ef4444);
  }

  .action-error {
    position: absolute;
    right: 16px;
    bottom: 58px;
  }
</style>
