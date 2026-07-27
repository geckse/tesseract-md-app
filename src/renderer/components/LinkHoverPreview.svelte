<script lang="ts">
  import { tick } from 'svelte'
  import { computePosition, flip, offset, shift } from '@floating-ui/dom'
  import { resolveHref, resolveWikilinkTarget } from '../lib/link-navigation'
  import type { LinkPreviewData } from '../../shared/link-preview'

  interface Props {
    container?: HTMLElement | null
    collectionPath?: string
    /** Exposed for deterministic component tests; production uses a deliberate dwell. */
    hoverDelayMs?: number
  }

  interface PreviewCandidate {
    element: HTMLElement
    kind: 'external' | 'local'
    value: string
  }

  let { container = null, collectionPath = '', hoverDelayMs = 350 }: Props = $props()

  let card = $state<HTMLDivElement | null>(null)
  let activeCandidate: PreviewCandidate | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let visible = $state(false)
  let positioned = $state(false)
  let state = $state<'loading' | 'ready' | 'unavailable'>('loading')
  let preview = $state<LinkPreviewData | null>(null)
  let displayTarget = $state('')

  function candidateFor(target: EventTarget | null, host: HTMLElement): PreviewCandidate | null {
    if (!(target instanceof Element)) return null

    const wikilink = target.closest<HTMLElement>('.wikilink[data-wikilink-target]')
    if (wikilink && host.contains(wikilink)) {
      const rawTarget = wikilink.dataset.wikilinkTarget?.trim()
      const resolved = rawTarget ? resolveWikilinkTarget(rawTarget) : null
      return resolved ? { element: wikilink, kind: 'local', value: resolved } : null
    }

    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !host.contains(anchor)) return null
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (/^https?:\/\//i.test(href)) {
      return { element: anchor, kind: 'external', value: href }
    }
    if (!href || href.startsWith('#')) return null
    const resolved = resolveHref(href)
    return resolved ? { element: anchor, kind: 'local', value: resolved } : null
  }

  function positionCard(): void {
    if (!card || !activeCandidate) return
    void computePosition(activeCandidate.element, card, {
      strategy: 'fixed',
      placement: 'top-start',
      middleware: [offset(8), flip(), shift({ padding: 10 })]
    }).then(({ x, y }) => {
      if (!card || !activeCandidate) return
      card.style.left = `${Math.round(x)}px`
      card.style.top = `${Math.round(y)}px`
      positioned = true
    })
  }

  function hide(): void {
    generation += 1
    if (timer) clearTimeout(timer)
    timer = null
    activeCandidate = null
    visible = false
    positioned = false
    preview = null
  }

  function begin(candidate: PreviewCandidate): void {
    if (
      activeCandidate?.element === candidate.element &&
      activeCandidate.kind === candidate.kind &&
      activeCandidate.value === candidate.value
    ) {
      return
    }
    hide()
    activeCandidate = candidate
    displayTarget = candidate.value
    const requestGeneration = generation

    timer = setTimeout(
      () => {
        timer = null
        if (requestGeneration !== generation || !activeCandidate) return
        state = 'loading'
        preview = null
        visible = true
        void tick().then(positionCard)

        const request =
          candidate.kind === 'external'
            ? window.api.externalLinkPreview(candidate.value)
            : collectionPath
              ? window.api.localLinkPreview(collectionPath, candidate.value)
              : Promise.resolve(null)

        void request
          .then((result) => {
            if (requestGeneration !== generation || activeCandidate?.element !== candidate.element)
              return
            preview = result
            state = result ? 'ready' : 'unavailable'
            void tick().then(positionCard)
          })
          .catch(() => {
            if (requestGeneration !== generation || activeCandidate?.element !== candidate.element)
              return
            state = 'unavailable'
            preview = null
            void tick().then(positionCard)
          })
      },
      Math.max(0, hoverDelayMs)
    )
  }

  $effect(() => {
    const host = container
    void collectionPath
    if (!host) {
      hide()
      return
    }

    const onPointerOver = (event: PointerEvent) => {
      const candidate = candidateFor(event.target, host)
      if (candidate) begin(candidate)
    }
    const onPointerOut = (event: PointerEvent) => {
      if (!activeCandidate) return
      const related = event.relatedTarget
      if (related instanceof Node && activeCandidate.element.contains(related)) return
      if (event.target instanceof Node && activeCandidate.element.contains(event.target)) hide()
    }
    const onFocusIn = (event: FocusEvent) => {
      const candidate = candidateFor(event.target, host)
      if (candidate) begin(candidate)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!activeCandidate) return
      const related = event.relatedTarget
      if (related instanceof Node && activeCandidate.element.contains(related)) return
      hide()
    }

    host.addEventListener('pointerover', onPointerOver)
    host.addEventListener('pointerout', onPointerOut)
    host.addEventListener('focusin', onFocusIn)
    host.addEventListener('focusout', onFocusOut)
    host.addEventListener('scroll', hide, { passive: true })
    host.addEventListener('pointerdown', hide)
    return () => {
      host.removeEventListener('pointerover', onPointerOver)
      host.removeEventListener('pointerout', onPointerOut)
      host.removeEventListener('focusin', onFocusIn)
      host.removeEventListener('focusout', onFocusOut)
      host.removeEventListener('scroll', hide)
      host.removeEventListener('pointerdown', hide)
      hide()
    }
  })
</script>

{#if visible}
  <div class="link-preview" class:positioned bind:this={card} role="tooltip" aria-live="polite">
    {#if state === 'loading'}
      <span class="material-symbols-outlined preview-icon loading">progress_activity</span>
      <div class="preview-copy">
        <span class="preview-label">Loading preview…</span>
        <span class="preview-target">{displayTarget}</span>
      </div>
    {:else if state === 'ready' && preview}
      <span class="material-symbols-outlined preview-icon">
        {preview.kind === 'local' ? 'description' : 'language'}
      </span>
      <div class="preview-copy">
        <span class="preview-kicker">
          {preview.kind === 'local' ? 'Collection note' : preview.siteName || preview.domain}
        </span>
        <span class="preview-title">
          {preview.title || (preview.kind === 'external' ? preview.domain : preview.path)}
        </span>
        {#if preview.description}
          <span class="preview-description">{preview.description}</span>
        {/if}
        <span class="preview-target">
          {preview.kind === 'local' ? preview.path : preview.finalUrl}
        </span>
      </div>
    {:else}
      <span class="material-symbols-outlined preview-icon muted">link</span>
      <div class="preview-copy">
        <span class="preview-label">Preview unavailable</span>
        <span class="preview-target">{displayTarget}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .link-preview {
    position: fixed;
    z-index: var(--z-tooltip, 80);
    display: flex;
    width: min(360px, calc(100vw - 20px));
    max-height: 180px;
    gap: 10px;
    padding: 11px 12px;
    overflow: hidden;
    pointer-events: none;
    visibility: hidden;
    color: var(--color-text, #f4f4f5);
    background: var(--color-surface-elevated, #18181b);
    border: 1px solid var(--color-border, #303033);
    border-radius: var(--radius-lg, 8px);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.4);
  }

  .link-preview.positioned {
    visibility: visible;
  }

  .preview-icon {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--color-primary, #06b6d4);
    font-size: 20px;
  }

  .preview-icon.muted {
    color: var(--color-text-muted, #71717a);
  }

  .preview-icon.loading {
    animation: preview-spin 0.8s linear infinite;
  }

  .preview-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }

  .preview-kicker,
  .preview-target {
    overflow: hidden;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 10px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .preview-label,
  .preview-title {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-description {
    display: -webkit-box;
    overflow: hidden;
    color: var(--color-text-secondary, #d4d4d8);
    font-size: 11px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  @keyframes preview-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .preview-icon.loading {
      animation: none;
    }
  }
</style>
