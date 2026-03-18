<script lang="ts">
  import { onDestroy } from 'svelte'
  import Badge from './ui/Badge.svelte'
  import { propertiesFileContent, frontmatter } from '../stores/properties'
  import { fileContent } from '../stores/files'
  import { renderMarkdown, formatFrontmatterValue } from '../lib/markdown-render'
  import { renderMermaidDiagram } from '../lib/mermaid-renderer'
  import { handleLinkClick } from '../lib/link-navigation'
  import type { JsonValue } from '../types/cli'

  // Store subscriptions
  let currentContent: string | null = $state(null)
  let currentFrontmatter: Record<string, JsonValue> | null = $state(null)
  let fallbackContent: string | null = $state(null)

  const unsubs = [
    propertiesFileContent.subscribe((v) => (currentContent = v)),
    frontmatter.subscribe((v) => (currentFrontmatter = v)),
    fileContent.subscribe((v) => (fallbackContent = v))
  ]

  onDestroy(() => unsubs.forEach((u) => u()))

  // Use propertiesFileContent (live from editor debounce) with fileContent fallback
  let effectiveContent = $derived(currentContent ?? fallbackContent)

  // Rendered HTML
  let renderedHtml = $derived(effectiveContent ? renderMarkdown(effectiveContent) : '')

  // Frontmatter accordion state (persisted)
  const FM_STORAGE_KEY = 'previewFrontmatterOpen'
  let frontmatterOpen = $state(localStorage.getItem(FM_STORAGE_KEY) === 'true')

  function toggleFrontmatter() {
    frontmatterOpen = !frontmatterOpen
    localStorage.setItem(FM_STORAGE_KEY, String(frontmatterOpen))
  }

  // Extract tags array
  let tags = $derived.by(() => {
    if (!currentFrontmatter) return []
    const tagValue = currentFrontmatter['tags'] ?? currentFrontmatter['Tags']
    if (Array.isArray(tagValue)) return tagValue.map(String)
    return []
  })

  /** Pick a badge variant based on common status values. */
  function statusVariant(value: string): 'primary' | 'success' | 'warning' | 'info' | 'default' {
    const lower = value.toLowerCase()
    if (lower.includes('progress') || lower.includes('active')) return 'primary'
    if (lower.includes('done') || lower.includes('complete') || lower.includes('published'))
      return 'success'
    if (lower.includes('draft') || lower.includes('review')) return 'warning'
    if (lower.includes('archived') || lower.includes('deprecated')) return 'info'
    return 'default'
  }

  function isArrayValue(value: JsonValue): value is JsonValue[] {
    return Array.isArray(value)
  }

  /** Frontmatter entries excluding empty values. */
  let frontmatterEntries = $derived.by(() => {
    if (!currentFrontmatter) return []
    return Object.entries(currentFrontmatter).filter(([, v]) => v !== '' && v !== null)
  })

  // Mermaid diagram rendering — post-process placeholder divs after HTML is in the DOM
  let previewContainer: HTMLDivElement | undefined = $state(undefined)
  let renderGeneration = 0

  $effect(() => {
    void renderedHtml // re-run when content changes
    const gen = ++renderGeneration
    requestAnimationFrame(() => {
      void (async () => {
        if (!previewContainer || gen !== renderGeneration) return
        const blocks = previewContainer.querySelectorAll('.mermaid-preview[data-mermaid-code]')
        for (const block of blocks) {
          if (gen !== renderGeneration) return
          const code = decodeURIComponent(block.getAttribute('data-mermaid-code') ?? '')
          if (!code) continue
          const result = await renderMermaidDiagram(
            `preview-${gen}-${Math.random().toString(36).slice(2, 8)}`,
            code
          )
          if (gen !== renderGeneration) return
          if ('svg' in result) {
            block.innerHTML = `<div class="mermaid-pan-target">${result.svg}</div>`
            attachZoomPan(block as HTMLElement)
          } else {
            block.innerHTML = `<div class="mermaid-error"><span class="material-symbols-outlined">error</span><pre>${escapeHtml(result.error)}</pre></div>`
          }
        }
      })()
    })
  })

  /** Attach zoom (Ctrl+scroll) and drag-to-pan to a mermaid preview block. */
  function attachZoomPan(wrapper: HTMLElement) {
    const inner = wrapper.querySelector('.mermaid-pan-target') as HTMLElement
    if (!inner) return

    let scale = 1
    let tx = 0
    let ty = 0

    function apply() {
      inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    }

    // Ctrl/Cmd + scroll to zoom
    wrapper.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const next = Math.min(5, Math.max(0.2, scale * factor))
      if (next === scale) return
      const rect = wrapper.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const ratio = next / scale
      tx = cx - ratio * (cx - tx)
      ty = cy - ratio * (cy - ty)
      scale = next
      apply()
    }, { passive: false })

    // Drag to pan
    let panning = false
    let startX = 0
    let startY = 0
    let startTx = 0
    let startTy = 0

    wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      panning = true
      startX = e.clientX
      startY = e.clientY
      startTx = tx
      startTy = ty
      wrapper.style.cursor = 'grabbing'
      e.preventDefault()
    })

    const onMove = (e: MouseEvent) => {
      if (!panning) return
      tx = startTx + (e.clientX - startX)
      ty = startTy + (e.clientY - startY)
      apply()
    }
    const onUp = () => {
      if (!panning) return
      panning = false
      wrapper.style.cursor = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
</script>

<div class="preview-container" bind:this={previewContainer} onclick={handleLinkClick}>
  <!-- Frontmatter accordion -->
  {#if currentFrontmatter && frontmatterEntries.length > 0}
    <div class="frontmatter-card">
      <button class="fm-header" onclick={toggleFrontmatter} aria-expanded={frontmatterOpen}>
        <span class="fm-header-label">Frontmatter</span>
        <span class="material-symbols-outlined fm-chevron" class:open={frontmatterOpen}>
          expand_more
        </span>
      </button>

      {#if frontmatterOpen}
        <div class="fm-body">
          {#each frontmatterEntries as [key, value]}
            <div class="fm-row">
              <span class="fm-key">{key}</span>
              <div class="fm-value">
                {#if key.toLowerCase() === 'status' && typeof value === 'string'}
                  <Badge variant={statusVariant(value)}>{value}</Badge>
                {:else if key.toLowerCase() === 'tags' && isArrayValue(value)}
                  <div class="fm-tags">
                    {#each value as tag}
                      <Badge variant="default">{formatFrontmatterValue(tag)}</Badge>
                    {/each}
                  </div>
                {:else}
                  <span>{formatFrontmatterValue(value)}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Rendered markdown -->
  <div class="markdown-body">
    {@html renderedHtml}
  </div>
</div>

<style>
  .preview-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-6, 24px);
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  .preview-container::-webkit-scrollbar {
    width: 6px;
  }
  .preview-container::-webkit-scrollbar-track {
    background: transparent;
  }
  .preview-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  .preview-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Center content with max-width */
  .markdown-body,
  .frontmatter-card {
    max-width: var(--content-max-width, 48rem);
    margin-left: auto;
    margin-right: auto;
  }

  /* ── Frontmatter accordion ─────────────────────────── */

  .frontmatter-card {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    margin-bottom: var(--space-6, 24px);
    overflow: hidden;
  }

  .fm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-semibold, 600);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease);
  }

  .fm-header:hover {
    color: var(--color-text, #e4e4e7);
  }

  .fm-chevron {
    font-size: 18px;
    transition: transform var(--transition-fast, 150ms ease);
  }

  .fm-chevron.open {
    transform: rotate(180deg);
  }

  .fm-body {
    padding: 0 16px 12px;
    border-top: 1px solid var(--color-border, #27272a);
    padding-top: 12px;
  }

  .fm-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 0;
    gap: 16px;
  }

  .fm-key {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .fm-value {
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fm-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
    justify-content: flex-end;
  }

  /* ── Markdown body ─────────────────────────────────── */

  .markdown-body {
    font-size: var(--text-base, 14px);
    color: var(--color-text, #e4e4e7);
    line-height: 1.7;
    overflow-wrap: break-word;
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    color: var(--color-text-white, #ffffff);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: var(--leading-tight, 1.2);
  }

  .markdown-body :global(h1) {
    font-size: 1.75em;
  }
  .markdown-body :global(h2) {
    font-size: 1.4em;
  }
  .markdown-body :global(h3) {
    font-size: 1.15em;
  }
  .markdown-body :global(h4) {
    font-size: 1em;
  }

  .markdown-body :global(p) {
    margin: 0.75em 0;
  }

  .markdown-body :global(a) {
    color: var(--color-primary, #00e5ff);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(code) {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    background: var(--color-surface, #161617);
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    font-size: 0.9em;
  }

  .markdown-body :global(pre) {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
    overflow-x: auto;
    margin: 1em 0;
  }

  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--color-primary-dim, rgba(0, 229, 255, 0.2));
    margin: 1em 0;
    padding: 0.25em 1em;
    color: var(--color-text-dim, #71717a);
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.5em;
    margin: 0.75em 0;
  }

  .markdown-body :global(li) {
    margin: 0.25em 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border, #27272a);
    margin: 1.5em 0;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--color-border, #27272a);
    padding: 8px 12px;
    text-align: left;
    font-size: var(--text-sm, 12px);
  }

  .markdown-body :global(th) {
    background: var(--color-surface, #161617);
    font-weight: 600;
  }

  .markdown-body :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md, 6px);
  }

  .markdown-body :global(strong) {
    font-weight: 600;
    color: var(--color-text-white, #ffffff);
  }

  /* ── Mermaid diagrams ────────────────────────────── */

  .markdown-body :global(.mermaid-preview) {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    margin: 1em 0;
    overflow: hidden;
    cursor: grab;
  }

  .markdown-body :global(.mermaid-pan-target) {
    display: flex;
    justify-content: center;
    padding: var(--space-4, 16px);
    transform-origin: 0 0;
    pointer-events: none;
  }

  .markdown-body :global(.mermaid-preview svg) {
    max-width: 100%;
    height: auto;
  }

  .markdown-body :global(.mermaid-error) {
    padding: var(--space-3, 12px);
    background: rgba(239, 68, 68, 0.05);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: var(--radius-md, 6px);
    color: #ef4444;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    width: 100%;
  }

  .markdown-body :global(.mermaid-error pre) {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: inherit;
    white-space: pre-wrap;
  }

  .markdown-body :global(.mermaid-loading) {
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-sm, 12px);
    padding: var(--space-4, 16px);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .fm-chevron {
      transition: none;
    }
    .fm-header {
      transition: none;
    }
  }
</style>
