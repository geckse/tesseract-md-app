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

  // Generation counter for stale render prevention
  let renderGen = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Render the diagram whenever code changes and we're not editing
  $effect(() => {
    if (!editing) {
      localCode = code
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

  function openLightbox() {
    lightbox = true
    // Mount overlay to document.body so it escapes the ProseMirror container
    const overlay = document.createElement('div')
    overlay.className = 'mermaid-lightbox-overlay'
    overlay.innerHTML = `
      <div class="mermaid-lightbox-content">
        <div class="mermaid-lightbox-toolbar">
          <button class="mermaid-lightbox-close" aria-label="Close lightbox">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="mermaid-lightbox-diagram">${svgHtml}</div>
      </div>
    `
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
    document.body.appendChild(overlay)
    lightboxEl = overlay
    overlay.focus()
  }

  function closeLightbox() {
    if (lightboxEl) {
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
      <div class="mermaid-svg-preview">
        {@html svgHtml}
      </div>
    {/if}
  {/if}
</div>
