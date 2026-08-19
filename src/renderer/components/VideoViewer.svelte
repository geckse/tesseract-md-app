<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { localMediaUrl } from '../lib/media-embed'
  import { activeCollection } from '../stores/collections'

  interface Props {
    filePath?: string
    collectionPath?: string
    /** Renderer-owned object URL for an ephemeral file outside a collection. */
    sourceUrl?: string
    /** Sender-bound capability used for external file actions. */
    externalId?: string
  }

  let { filePath = '', collectionPath, sourceUrl, externalId }: Props = $props()

  let videoElement: HTMLVideoElement | null = $state(null)
  let playing = $state(false)
  let loading = $state(true)
  let mediaError = $state<string | null>(null)
  let actionError = $state<string | null>(null)
  let currentTime = $state(0)
  let duration = $state(0)
  let volume = $state(1)
  let muted = $state(false)
  let playbackRate = $state(1)

  const absolutePath = $derived.by(() => {
    if (sourceUrl) return null
    const root = collectionPath || get(activeCollection)?.path
    if (!root || !filePath) return null
    return `${root.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`
  })
  const resolvedSource = $derived(sourceUrl || (absolutePath ? localMediaUrl(absolutePath) : null))
  const previewLabel = $derived(sourceUrl ? 'External video preview' : 'Video preview')

  function finiteTime(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  function formatTime(value: number): string {
    const totalSeconds = Math.floor(finiteTime(value))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  function syncMetadata(): void {
    if (!videoElement) return
    duration = finiteTime(videoElement.duration)
    currentTime = finiteTime(videoElement.currentTime)
    volume = videoElement.volume
    muted = videoElement.muted
    playbackRate = videoElement.playbackRate
    loading = false
    mediaError = null
  }

  async function togglePlayback(): Promise<void> {
    if (!videoElement || !resolvedSource || mediaError) return
    actionError = null
    if (!videoElement.paused && !videoElement.ended) {
      videoElement.pause()
      playing = false
      return
    }

    try {
      await videoElement.play()
      playing = true
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'The video could not be played.'
    }
  }

  function stopPlayback(): void {
    if (!videoElement) return
    videoElement.pause()
    try {
      videoElement.currentTime = 0
    } catch {
      // An unloaded media element may reject seeking; the visible state still resets.
    }
    currentTime = 0
    playing = false
  }

  function seek(event: Event): void {
    if (!videoElement) return
    const next = Number((event.currentTarget as HTMLInputElement).value)
    if (!Number.isFinite(next)) return
    videoElement.currentTime = next
    currentTime = next
  }

  function toggleMute(): void {
    if (!videoElement) return
    videoElement.muted = !videoElement.muted
    muted = videoElement.muted
  }

  function changeVolume(event: Event): void {
    if (!videoElement) return
    const next = Number((event.currentTarget as HTMLInputElement).value)
    if (!Number.isFinite(next)) return
    videoElement.volume = next
    videoElement.muted = next === 0
    volume = next
    muted = videoElement.muted
  }

  function changePlaybackRate(event: Event): void {
    if (!videoElement) return
    const next = Number((event.currentTarget as HTMLSelectElement).value)
    if (!Number.isFinite(next)) return
    videoElement.playbackRate = next
    playbackRate = next
  }

  function handleMediaError(): void {
    loading = false
    playing = false
    mediaError =
      'This video format or codec cannot be played in Tesseract. Try the default app instead.'
  }

  async function runFileAction(action: 'open' | 'reveal'): Promise<void> {
    actionError = null
    try {
      if (externalId) {
        if (action === 'open') await window.api.openExternalFile(externalId)
        else await window.api.revealExternalFile(externalId)
      } else if (action === 'open' && absolutePath) {
        await window.api.openPath(absolutePath)
      }
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error)
    }
  }

  $effect(() => {
    const source = resolvedSource
    playing = false
    loading = Boolean(source)
    mediaError = source ? null : 'No active collection is available for this video.'
    actionError = null
    currentTime = 0
    duration = 0
    playbackRate = 1
  })

  onDestroy(() => {
    if (videoElement && !videoElement.paused) videoElement.pause()
  })
</script>

<div class="video-viewer">
  <div class="video-stage">
    {#if resolvedSource}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoElement}
        src={resolvedSource}
        preload="metadata"
        aria-label={previewLabel}
        onloadstart={() => (loading = true)}
        onloadedmetadata={syncMetadata}
        ondurationchange={() => {
          if (videoElement) duration = finiteTime(videoElement.duration)
        }}
        oncanplay={() => (loading = false)}
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        onended={() => (playing = false)}
        ontimeupdate={() => {
          if (videoElement) currentTime = finiteTime(videoElement.currentTime)
        }}
        onvolumechange={() => {
          if (videoElement) {
            volume = videoElement.volume
            muted = videoElement.muted
          }
        }}
        onratechange={() => {
          if (videoElement) playbackRate = videoElement.playbackRate
        }}
        onerror={handleMediaError}
      ></video>
    {/if}

    {#if loading && !mediaError}
      <div class="stage-message" role="status">Loading video…</div>
    {:else if mediaError}
      <div class="stage-message error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <span>{mediaError}</span>
      </div>
    {/if}
  </div>

  <div class="controls" role="group" aria-label="Video controls">
    <button
      class="control-button"
      type="button"
      onclick={() => void togglePlayback()}
      disabled={!resolvedSource || !!mediaError}
      aria-label={playing ? 'Pause' : 'Play'}
      title={playing ? 'Pause' : 'Play'}
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {playing ? 'pause' : 'play_arrow'}
      </span>
    </button>
    <button
      class="control-button"
      type="button"
      onclick={stopPlayback}
      disabled={!resolvedSource || !!mediaError}
      aria-label="Stop"
      title="Stop"
    >
      <span class="material-symbols-outlined" aria-hidden="true">stop</span>
    </button>

    <span class="time">{formatTime(currentTime)} / {formatTime(duration)}</span>
    <input
      class="seek"
      type="range"
      min="0"
      max={duration}
      step="0.1"
      value={currentTime}
      disabled={duration <= 0 || !!mediaError}
      aria-label="Seek video"
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      oninput={seek}
    />

    <button
      class="control-button"
      type="button"
      onclick={toggleMute}
      disabled={!resolvedSource || !!mediaError}
      aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
      title={muted || volume === 0 ? 'Unmute' : 'Mute'}
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {muted || volume === 0 ? 'volume_off' : 'volume_up'}
      </span>
    </button>
    <input
      class="volume"
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={volume}
      disabled={!resolvedSource || !!mediaError}
      aria-label="Volume"
      oninput={changeVolume}
    />

    <label class="speed-control">
      <span>Speed</span>
      <select
        value={String(playbackRate)}
        onchange={changePlaybackRate}
        disabled={!resolvedSource || !!mediaError}
        aria-label="Playback speed"
      >
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1">1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
    </label>

    <div class="controls-spacer"></div>
    {#if externalId}
      <button
        class="control-button"
        type="button"
        onclick={() => void runFileAction('reveal')}
        aria-label="Reveal"
        title="Reveal"
      >
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
      </button>
    {/if}
    {#if externalId || absolutePath}
      <button
        class="control-button"
        type="button"
        onclick={() => void runFileAction('open')}
        aria-label="Open in Default App"
        title="Open in Default App"
      >
        <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
      </button>
    {/if}
  </div>

  {#if actionError}
    <p class="action-error" role="alert">{actionError}</p>
  {/if}
</div>

<style>
  .video-viewer {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: var(--color-surface-dark, #0a0a0a);
  }

  .video-stage {
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .stage-message {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px;
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-dim, #71717a);
    text-align: center;
  }

  .stage-message.error,
  .action-error {
    color: var(--color-error, #ef4444);
  }

  .controls {
    display: flex;
    min-height: 48px;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
  }

  .control-button {
    display: inline-flex;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
  }

  .control-button:hover:not(:disabled) {
    border-color: var(--color-border, #27272a);
    background: var(--color-surface-hover, #202024);
    color: var(--color-primary, #00e5ff);
  }

  .control-button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .control-button:disabled,
  input:disabled,
  select:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .control-button .material-symbols-outlined {
    font-size: 20px;
  }

  .time {
    flex: 0 0 auto;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .seek {
    min-width: 100px;
    flex: 1 1 280px;
  }

  .volume {
    width: 76px;
    flex: 0 1 76px;
  }

  input[type='range'] {
    accent-color: var(--color-primary, #00e5ff);
  }

  .speed-control {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    color: var(--color-text-dim, #71717a);
    font-size: 11px;
  }

  select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 5px;
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  .controls-spacer {
    flex: 1 0 0;
  }

  .action-error {
    margin: 0;
    padding: 6px 12px;
    border-top: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
    font-size: 12px;
    text-align: right;
  }

  @media (max-width: 720px) {
    .volume,
    .speed-control > span {
      display: none;
    }

    .seek {
      flex-basis: 120px;
    }
  }
</style>
