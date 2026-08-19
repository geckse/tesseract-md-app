<script lang="ts">
  import { activeCollection } from '../stores/collections'
  import { get } from 'svelte/store'

  interface Props {
    filePath?: string
    collectionPath?: string
    /** Renderer-owned object URL for an ephemeral file outside a collection. */
    sourceUrl?: string
    /** Sender-bound capability used for "Open in Default App". */
    externalId?: string
  }

  let { filePath = '', collectionPath, sourceUrl, externalId }: Props = $props()

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
      let bytes: Uint8Array
      if (sourceUrl) {
        const response = await fetch(sourceUrl)
        if (!response.ok) throw new Error(`Could not read PDF (${response.status})`)
        bytes = new Uint8Array(await response.arrayBuffer())
      } else {
        const collection = get(activeCollection)
        const root = collectionPath || collection?.path
        if (!root) throw new Error('No active collection')

        const absolutePath = `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
        const base64 = await window.api.readBinary(absolutePath)
        const binaryString = atob(base64)
        bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
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
        const naturalViewport = page.getViewport({ scale: 1 })
        const viewerWidth = canvasContainer?.parentElement?.clientWidth ?? 0
        const availableWidth = Math.max(0, viewerWidth - 48)
        const fitScale =
          availableWidth > 0 ? Math.min(1.5, availableWidth / naturalViewport.width) : 1.5
        const viewport = page.getViewport({ scale: fitScale * zoom })

        const pageContainer = document.createElement('div')
        pageContainer.className = 'pdf-page'
        pageContainer.dataset.page = String(i)
        pageContainer.style.width = `${viewport.width}px`
        pageContainer.style.height = `${viewport.height}px`
        pageContainer.style.setProperty('--total-scale-factor', String(viewport.scale))
        pageContainer.style.setProperty('--scale-round-x', '1px')
        pageContainer.style.setProperty('--scale-round-y', '1px')

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.className = 'pdf-page-canvas'

        const textLayerContainer = document.createElement('div')
        textLayerContainer.className = 'textLayer'
        textLayerContainer.dataset.page = String(i)
        textLayerContainer.setAttribute('aria-label', `Selectable text for page ${i}`)

        pageContainer.append(canvas, textLayerContainer)
        canvasContainer?.appendChild(pageContainer)

        const ctx = canvas.getContext('2d')
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise
        }

        try {
          const textContent = await page.getTextContent({
            includeMarkedContent: true,
            disableNormalization: false
          })
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerContainer,
            viewport
          })
          await textLayer.render()
        } catch {
          // Keep the rendered page usable when a malformed PDF has no extractable text layer.
          textLayerContainer.remove()
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleScroll() {
    if (!canvasContainer) return
    const pages = canvasContainer.querySelectorAll<HTMLElement>('.pdf-page')
    const containerTop = canvasContainer.scrollTop
    const containerMid = containerTop + canvasContainer.clientHeight / 2

    for (const page of pages) {
      const top = page.offsetTop
      const bottom = top + page.offsetHeight
      if (containerMid >= top && containerMid < bottom) {
        currentPage = parseInt(page.dataset.page ?? '1')
        break
      }
    }
  }

  function goToPage(page: number) {
    const target = Math.max(1, Math.min(totalPages, page))
    currentPage = target
    const pageElement = canvasContainer?.querySelector(`.pdf-page[data-page="${target}"]`)
    pageElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function zoomIn() {
    zoom = Math.min(3.0, zoom + 0.25)
    loadPdf()
  }

  function zoomOut() {
    zoom = Math.max(0.5, zoom - 0.25)
    loadPdf()
  }

  function openInDefaultApp(): void {
    if (externalId) {
      void window.api.openExternalFile(externalId)
      return
    }
    const root = collectionPath || get(activeCollection)?.path
    if (!root) return
    const absolutePath = `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
    void window.api.openPath(absolutePath)
  }

  $effect(() => {
    void filePath // track dependency
    void collectionPath
    void sourceUrl
    void externalId
    loadPdf()
  })
</script>

<div class="pdf-viewer" aria-label={sourceUrl ? 'External PDF preview' : 'PDF preview'}>
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

  {#if !loading}
    <div class="toolbar">
      {#if totalPages > 0 && !error}
        <button
          class="tool-btn"
          onclick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <span class="page-info">{currentPage} / {totalPages}</span>
        <button
          class="tool-btn"
          onclick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
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
      {/if}
      <div class="toolbar-spacer"></div>
      <button
        class="tool-btn"
        onclick={openInDefaultApp}
        title="Open in Default App"
        aria-label="Open in Default App"
      >
        <span class="material-symbols-outlined">open_in_new</span>
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
    user-select: text;
  }

  .canvas-container {
    flex: 1;
    min-height: 0;
    overflow: auto;
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
    position: relative;
    flex: 0 0 auto;
    overflow: hidden;
    direction: ltr;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    border-radius: 2px;
  }

  .canvas-container :global(.pdf-page-canvas) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .canvas-container :global(.textLayer) {
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));

    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: clip;
    color-scheme: only light;
    line-height: 1;
    text-align: initial;
    text-size-adjust: none;
    transform-origin: 0 0;
    user-select: text;
    forced-color-adjust: none;
  }

  .canvas-container :global(.textLayer span),
  .canvas-container :global(.textLayer br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0 0;
  }

  .canvas-container :global(.textLayer > :not(.markedContent)),
  .canvas-container :global(.textLayer .markedContent span:not(.markedContent)) {
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;

    z-index: 1;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  .canvas-container :global(.textLayer .markedContent) {
    display: contents;
  }

  .canvas-container :global(.textLayer span[role='img']) {
    cursor: default;
    user-select: none;
  }

  .canvas-container :global(.textLayer ::selection) {
    background: color-mix(in srgb, var(--color-primary, #00e5ff), transparent 65%);
  }

  .canvas-container :global(.textLayer br::selection) {
    background: transparent;
  }

  .canvas-container :global(.textLayer[data-main-rotation='90']) {
    transform: rotate(90deg) translateY(-100%);
  }

  .canvas-container :global(.textLayer[data-main-rotation='180']) {
    transform: rotate(180deg) translate(-100%, -100%);
  }

  .canvas-container :global(.textLayer[data-main-rotation='270']) {
    transform: rotate(270deg) translateX(-100%);
  }

  :global(.hiddenCanvasElement) {
    position: absolute;
    top: 0;
    left: 0;
    display: none;
    width: 0;
    height: 0;
  }

  .loading,
  .error {
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
    to {
      transform: rotate(360deg);
    }
  }

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
    color: var(--color-text, #e4e4e7);
    border-color: var(--color-text-dim, #71717a);
  }

  .tool-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .tool-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .page-info,
  .zoom-level {
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

  .toolbar-spacer {
    flex: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning {
      animation: none;
    }
  }
</style>
