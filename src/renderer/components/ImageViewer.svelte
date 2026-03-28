<script lang="ts">
  import { activeCollection } from '../stores/collections'
  import { get } from 'svelte/store'

  interface Props {
    filePath: string
    fileSize?: number
  }

  let { filePath, fileSize }: Props = $props()

  let dataUrl = $state<string | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let zoom = $state(1)
  let naturalWidth = $state(0)
  let naturalHeight = $state(0)
  let fitMode = $state<'fit' | 'actual'>('fit')

  const MIN_ZOOM = 0.1
  const MAX_ZOOM = 10

  async function loadImage() {
    loading = true
    error = null
    try {
      const collection = get(activeCollection)
      if (!collection) throw new Error('No active collection')
      const absolutePath = `${collection.path}/${filePath}`
      const base64 = await window.api.readBinary(absolutePath)
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
      }
      const mime = mimeMap[ext] ?? 'image/png'
      dataUrl = `data:${mime};base64,${base64}`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.1 : 0.1
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta * zoom))
    fitMode = 'actual'
  }

  function handleImageLoad(event: Event) {
    const img = event.target as HTMLImageElement
    naturalWidth = img.naturalWidth
    naturalHeight = img.naturalHeight
  }

  function fitToView() {
    zoom = 1
    fitMode = 'fit'
  }

  function actualSize() {
    zoom = 1
    fitMode = 'actual'
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  $effect(() => {
    filePath // track dependency
    loadImage()
  })
</script>

<div class="image-viewer" onwheel={handleWheel}>
  {#if loading}
    <div class="loading">
      <span class="material-symbols-outlined spinning">progress_activity</span>
      <span>Loading image...</span>
    </div>
  {:else if error}
    <div class="error">
      <span class="material-symbols-outlined">error</span>
      <span>{error}</span>
    </div>
  {:else if dataUrl}
    <div class="image-container" class:fit-mode={fitMode === 'fit'}>
      <img
        src={dataUrl}
        alt={filePath.split('/').pop()}
        style={fitMode === 'actual' ? `transform: scale(${zoom})` : ''}
        onload={handleImageLoad}
        draggable="false"
      />
    </div>
  {/if}

  <div class="info-bar">
    <span class="filename">{filePath.split('/').pop()}</span>
    {#if naturalWidth && naturalHeight}
      <span class="dimensions">{naturalWidth} × {naturalHeight}</span>
    {/if}
    {#if fileSize}
      <span class="size">{formatSize(fileSize)}</span>
    {/if}
    <div class="spacer"></div>
    <button class="zoom-btn" onclick={fitToView} title="Fit to view" class:active={fitMode === 'fit'}>
      <span class="material-symbols-outlined">fit_screen</span>
    </button>
    <button class="zoom-btn" onclick={actualSize} title="Actual size" class:active={fitMode === 'actual' && zoom === 1}>
      <span class="material-symbols-outlined">crop_original</span>
    </button>
    {#if fitMode === 'actual'}
      <span class="zoom-level">{Math.round(zoom * 100)}%</span>
    {/if}
  </div>
</div>

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-surface-dark, #0a0a0a);
    overflow: hidden;
  }

  .image-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
  }

  .image-container.fit-mode img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .image-container img {
    transform-origin: center center;
    transition: transform 0.1s ease;
  }

  .loading, .error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--color-text-dim, #71717a);
    font-size: 14px;
  }

  .error {
    color: var(--color-error, #ef4444);
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .info-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--color-surface, #161617);
    border-top: 1px solid var(--color-border, #27272a);
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .filename {
    color: var(--color-text-main, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .spacer { flex: 1; }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    padding: 2px 6px;
    cursor: pointer;
  }

  .zoom-btn:hover {
    color: var(--color-text-main, #e4e4e7);
    border-color: var(--color-text-dim, #71717a);
  }

  .zoom-btn.active {
    color: var(--color-primary, #00E5FF);
    border-color: var(--color-primary, #00E5FF);
  }

  .zoom-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .zoom-level {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    min-width: 40px;
    text-align: right;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning { animation: none; }
    .image-container img { transition: none; }
  }
</style>
