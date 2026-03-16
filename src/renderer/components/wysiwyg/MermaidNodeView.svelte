<script lang="ts">
  import { onDestroy } from 'svelte'
  import { renderMermaidDiagram, generateMermaidId } from '../../lib/mermaid-renderer'

  interface Props {
    code: string
    updateAttributes: (attrs: Record<string, unknown>) => void
    selected: boolean
    editable: boolean
  }

  let { code, updateAttributes, selected, editable }: Props = $props()

  let editing = $state(false)
  let svgHtml = $state('')
  let errorMessage = $state('')
  let loading = $state(true)
  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined)
  let localCode = $state('')
  let copied = $state(false)
  let lightbox = $state(false)
  let lightboxEl: HTMLDivElement | undefined = $state(undefined)
  let wrapperEl: HTMLDivElement | undefined = $state(undefined)
  let previewEl: HTMLDivElement | undefined = $state(undefined)
  let inlineScale = $state(1)
  let inlineTx = $state(0)
  let inlineTy = $state(0)
  let inlinePanning = false
  let inlinePanStartX = 0
  let inlinePanStartY = 0
  let inlineStartTx = 0
  let inlineStartTy = 0

  // Generation counter for stale render prevention
  let renderGen = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Render the diagram whenever code changes and we're not editing
  $effect(() => {
    if (!editing) {
      localCode = code
      inlineScale = 1
      inlineTx = 0
      inlineTy = 0
      renderDiagram(code)
    }
  })

  async function renderDiagram(mermaidCode: string) {
    const gen = ++renderGen
    loading = true
    errorMessage = ''

    const result = await renderMermaidDiagram(generateMermaidId(), mermaidCode)

    if (gen !== renderGen) return // stale
    loading = false

    if ('svg' in result) {
      svgHtml = result.svg
      errorMessage = ''
    } else {
      svgHtml = ''
      errorMessage = result.error
    }
  }

  function autoResize() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = textareaEl.scrollHeight + 'px'
  }

  function enterEditMode() {
    if (!editable) return
    editing = true
    localCode = code
    // Focus textarea and auto-resize next tick
    requestAnimationFrame(() => {
      textareaEl?.focus()
      autoResize()
    })
  }

  function exitEditMode() {
    if (!editing) return
    editing = false
    updateAttributes({ code: localCode })
    renderDiagram(localCode)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // Fallback for environments where clipboard API is restricted
    }
  }

  function handleInlineWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const next = Math.min(5, Math.max(0.2, inlineScale * factor))
    if (next === inlineScale) return
    // Zoom toward cursor
    const rect = wrapperEl!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const ratio = next / inlineScale
    inlineTx = cx - ratio * (cx - inlineTx)
    inlineTy = cy - ratio * (cy - inlineTy)
    inlineScale = next
  }

  function handleInlineMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    inlinePanning = true
    inlinePanStartX = e.clientX
    inlinePanStartY = e.clientY
    inlineStartTx = inlineTx
    inlineStartTy = inlineTy
    if (wrapperEl) wrapperEl.style.cursor = 'grabbing'
    e.preventDefault()

    const onMove = (ev: MouseEvent) => {
      if (!inlinePanning) return
      inlineTx = inlineStartTx + (ev.clientX - inlinePanStartX)
      inlineTy = inlineStartTy + (ev.clientY - inlinePanStartY)
    }
    const onUp = () => {
      inlinePanning = false
      if (wrapperEl) wrapperEl.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function openLightbox() {
    lightbox = true
    // Mount overlay to document.body so it escapes the ProseMirror container
    const overlay = document.createElement('div')
    overlay.className = 'mermaid-lightbox-overlay'
    overlay.tabIndex = -1
    overlay.innerHTML = `
      <div class="mermaid-lightbox-content">
        <div class="mermaid-lightbox-toolbar">
          <button class="mermaid-lightbox-btn mermaid-lightbox-zoom-out" aria-label="Zoom out" title="Zoom out">
            <span class="material-symbols-outlined">remove</span>
          </button>
          <span class="mermaid-lightbox-zoom-level">100%</span>
          <button class="mermaid-lightbox-btn mermaid-lightbox-zoom-in" aria-label="Zoom in" title="Zoom in">
            <span class="material-symbols-outlined">add</span>
          </button>
          <button class="mermaid-lightbox-btn mermaid-lightbox-zoom-fit" aria-label="Fit to view" title="Fit to view">
            <span class="material-symbols-outlined">fit_screen</span>
          </button>
          <button class="mermaid-lightbox-btn mermaid-lightbox-close" aria-label="Close" title="Close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="mermaid-lightbox-diagram">
          <div class="mermaid-lightbox-pan-container">${svgHtml}</div>
        </div>
      </div>
    `

    const diagramEl = overlay.querySelector('.mermaid-lightbox-diagram') as HTMLDivElement
    const panContainer = overlay.querySelector('.mermaid-lightbox-pan-container') as HTMLDivElement
    const zoomLabel = overlay.querySelector('.mermaid-lightbox-zoom-level') as HTMLSpanElement

    let scale = 1
    let tx = 0
    let ty = 0
    let isPanning = false
    let panStartX = 0
    let panStartY = 0
    let startTx = 0
    let startTy = 0

    function applyTransform() {
      panContainer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
      zoomLabel.textContent = `${Math.round(scale * 100)}%`
    }

    function zoomBy(factor: number, cx?: number, cy?: number) {
      const next = Math.min(10, Math.max(0.1, scale * factor))
      if (next === scale) return
      const rect = diagramEl.getBoundingClientRect()
      const px = cx !== undefined ? cx - rect.left : rect.width / 2
      const py = cy !== undefined ? cy - rect.top : rect.height / 2
      const ratio = next / scale
      tx = px - ratio * (px - tx)
      ty = py - ratio * (py - ty)
      scale = next
      applyTransform()
    }

    // Wheel zoom
    diagramEl.addEventListener('wheel', (e) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)
    }, { passive: false })

    // Pan via mouse drag
    diagramEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      startTx = tx
      startTy = ty
      diagramEl.style.cursor = 'grabbing'
      e.preventDefault()
    })

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return
      tx = startTx + (e.clientX - panStartX)
      ty = startTy + (e.clientY - panStartY)
      applyTransform()
    }

    const onMouseUp = () => {
      if (!isPanning) return
      isPanning = false
      diagramEl.style.cursor = 'grab'
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    // Toolbar buttons
    overlay.querySelector('.mermaid-lightbox-zoom-in')!.addEventListener('click', (e) => {
      e.stopPropagation()
      zoomBy(1.3)
    })
    overlay.querySelector('.mermaid-lightbox-zoom-out')!.addEventListener('click', (e) => {
      e.stopPropagation()
      zoomBy(1 / 1.3)
    })
    overlay.querySelector('.mermaid-lightbox-zoom-fit')!.addEventListener('click', (e) => {
      e.stopPropagation()
      scale = 1; tx = 0; ty = 0
      applyTransform()
    })

    // Close on backdrop click or close button
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || (e.target as HTMLElement).closest('.mermaid-lightbox-close')) {
        closeLightbox()
      }
    })
    // Close on Escape
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox()
    })

    // Store cleanup ref for document-level listeners
    ;(overlay as Record<string, unknown>)._cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.body.appendChild(overlay)
    lightboxEl = overlay
    overlay.focus()
  }

  function closeLightbox() {
    if (lightboxEl) {
      const cleanup = (lightboxEl as Record<string, unknown>)._cleanup as (() => void) | undefined
      if (cleanup) cleanup()
      lightboxEl.remove()
      lightboxEl = undefined
    }
    lightbox = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitEditMode()
    }
    // Allow Tab to insert tab character in the textarea
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.target as HTMLTextAreaElement
      const start = ta.selectionStart
      const end = ta.selectionEnd
      localCode = localCode.substring(0, start) + '    ' + localCode.substring(end)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4
        autoResize()
      })
    }
  }

  function handleInput() {
    autoResize()
  }

  function handleBlur(e: FocusEvent) {
    // Only exit if focus moved outside the entire mermaid block
    const related = e.relatedTarget as HTMLElement | null
    if (related?.closest('.mermaid-node-view')) return
    exitEditMode()
  }

  onDestroy(() => {
    renderGen++ // invalidate any pending renders
    if (debounceTimer) clearTimeout(debounceTimer)
    closeLightbox()
  })
</script>

<div class="mermaid-node-view-inner" class:selected>
  {#if editing}
    <!-- Edit mode: textarea for mermaid code -->
    <textarea
      class="mermaid-code-editor"
      bind:this={textareaEl}
      bind:value={localCode}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      spellcheck="false"
      aria-label="Mermaid diagram code"
    ></textarea>
  {:else}
    <!-- Preview mode: toolbar + rendered SVG diagram -->
    <div class="mermaid-toolbar">
      {#if editable}
        <button
          class="mermaid-toolbar-btn"
          onclick={enterEditMode}
          aria-label="Edit mermaid diagram"
          title="Edit"
        >
          <span class="material-symbols-outlined">edit</span>
        </button>
      {/if}
      <button
        class="mermaid-toolbar-btn"
        onclick={copyCode}
        aria-label="Copy mermaid code"
        title="Copy code"
      >
        <span class="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>
      </button>
      {#if svgHtml && !loading && !errorMessage}
        <button
          class="mermaid-toolbar-btn"
          onclick={openLightbox}
          aria-label="Expand diagram"
          title="Expand"
        >
          <span class="material-symbols-outlined">open_in_full</span>
        </button>
      {/if}
    </div>

    {#if loading}
      <div class="mermaid-loading">Loading diagram…</div>
    {:else if errorMessage}
      <div class="mermaid-error">
        <span class="material-symbols-outlined" style="font-size: 16px;">error</span>
        <pre>{errorMessage}</pre>
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mermaid-svg-preview-wrapper"
        bind:this={wrapperEl}
        onwheel={handleInlineWheel}
        onmousedown={handleInlineMouseDown}
      >
        <div
          class="mermaid-svg-preview"
          bind:this={previewEl}
          style:transform="translate({inlineTx}px, {inlineTy}px) scale({inlineScale})"
          style:transform-origin="0 0"
        >
          {@html svgHtml}
        </div>
      </div>
    {/if}
  {/if}
</div>
