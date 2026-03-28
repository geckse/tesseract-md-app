<script lang="ts">
  import { activeCollection } from '../stores/collections'
  import { get } from 'svelte/store'

  interface Props {
    filePath: string
  }

  let { filePath }: Props = $props()

  let loading = $state(true)
  let error = $state<string | null>(null)
  let totalPages = $state(0)
  let currentPage = $state(1)
  let canvasContainer: HTMLDivElement | null = $state(null)
  let zoom = $state(1.0)

  async function loadPdf() {
    loading = true
    error = null

    try {
      const collection = get(activeCollection)
      if (!collection) throw new Error('No active collection')

      const absolutePath = `${collection.path}/${filePath}`
      const base64 = await window.api.readBinary(absolutePath)
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // Dynamic import for pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist')

      // Configure worker — use Vite's URL resolution pattern
      const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.href

      const doc = await pdfjsLib.getDocument({ data: bytes }).promise
      totalPages = doc.numPages

      // Render all pages
      if (canvasContainer) {
        canvasContainer.innerHTML = ''
      }

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const viewport = page.getViewport({ scale: 1.5 * zoom })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.className = 'pdf-page'
        canvas.dataset.page = String(i)

        const ctx = canvas.getContext('2d')
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise
        }

        canvasContainer?.appendChild(canvas)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleScroll() {
    if (!canvasContainer) return
    const canvases = canvasContainer.querySelectorAll('canvas')
    const containerTop = canvasContainer.scrollTop
    const containerMid = containerTop + canvasContainer.clientHeight / 2

    for (const canvas of canvases) {
      const top = canvas.offsetTop
      const bottom = top + canvas.offsetHeight
      if (containerMid >= top && containerMid < bottom) {
        currentPage = parseInt(canvas.dataset.page ?? '1')
        break
      }
    }
  }

  function goToPage(page: number) {
    const target = Math.max(1, Math.min(totalPages, page))
    currentPage = target
    const canvas = canvasContainer?.querySelector(`canvas[data-page="${target}"]`)
    canvas?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function zoomIn() {
    zoom = Math.min(3.0, zoom + 0.25)
    loadPdf()
  }

  function zoomOut() {
    zoom = Math.max(0.5, zoom - 0.25)
    loadPdf()
  }

  $effect(() => {
    filePath // track dependency
    loadPdf()
  })
</script>

<div class="pdf-viewer">
  {#if loading}
    <div class="loading">
      <span class="material-symbols-outlined spinning">progress_activity</span>
      <span>Loading PDF...</span>
    </div>
  {:else if error}
    <div class="error">
      <span class="material-symbols-outlined">error</span>
      <span>{error}</span>
    </div>
  {/if}

  <div
    class="canvas-container"
    bind:this={canvasContainer}
    onscroll={handleScroll}
    class:hidden={loading || !!error}
  ></div>

  {#if totalPages > 0 && !loading && !error}
    <div class="toolbar">
      <button class="tool-btn" onclick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <span class="page-info">{currentPage} / {totalPages}</span>
      <button class="tool-btn" onclick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
      <div class="separator"></div>
      <button class="tool-btn" onclick={zoomOut} title="Zoom out">
        <span class="material-symbols-outlined">remove</span>
      </button>
      <span class="zoom-level">{Math.round(zoom * 100)}%</span>
      <button class="tool-btn" onclick={zoomIn} title="Zoom in">
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .pdf-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-surface-dark, #0a0a0a);
  }

  .canvas-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 24px;
  }

  .canvas-container.hidden {
    display: none;
  }

  .canvas-container :global(.pdf-page) {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    border-radius: 2px;
    max-width: 100%;
    height: auto;
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

  .error { color: var(--color-error, #ef4444); }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--color-surface, #161617);
    border-top: 1px solid var(--color-border, #27272a);
    flex-shrink: 0;
  }

  .tool-btn {
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

  .tool-btn:hover:not(:disabled) {
    color: var(--color-text-main, #e4e4e7);
    border-color: var(--color-text-dim, #71717a);
  }

  .tool-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .tool-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .page-info, .zoom-level {
    font-size: 12px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--color-text-dim, #71717a);
    min-width: 50px;
    text-align: center;
  }

  .separator {
    width: 1px;
    height: 20px;
    background: var(--color-border, #27272a);
    margin: 0 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning { animation: none; }
  }
</style>
