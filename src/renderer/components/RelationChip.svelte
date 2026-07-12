<script lang="ts">
  import type { RelationValue } from '../types/cli'
  import { fallbackChipText, relationBasename } from '../lib/relation-format'

  interface Props {
    /**
     * Server-resolved value. `null`/absent = optimistic/old-CLI fallback: the
     * chip renders NEUTRAL from a client parse of `raw` (display only — the
     * client never resolves paths).
     */
    relation?: RelationValue | null
    /** The raw frontmatter string (fallback display + tooltip source). */
    raw?: string
    /** Navigate to the target (only invoked for resolved, existing targets). */
    onnavigate?: (path: string) => void
    /** When set, renders a remove × (multi-value edit mode). */
    onremove?: () => void
  }

  let { relation = null, raw = '', onnavigate, onremove }: Props = $props()

  const broken = $derived(relation !== null && !relation.exists)
  const text = $derived.by(() => {
    if (relation) {
      if (relation.title) return relation.title
      if (relation.path) return relationBasename(relation.path)
      return relation.raw
    }
    return fallbackChipText(raw)
  })
  const tooltip = $derived.by(() => {
    if (broken) return `Missing: ${relation?.path ?? relation?.raw ?? raw}`
    if (relation?.path) return relation.path
    return raw
  })
  const clickable = $derived(
    relation !== null && relation.exists && !!relation.path && !!onnavigate
  )

  function navigate(e: MouseEvent): void {
    // Row click selects; chip click navigates — never both.
    e.stopPropagation()
    if (relation?.path && relation.exists) onnavigate?.(relation.path)
  }
</script>

<span class="rel-chip" class:broken class:neutral={relation === null} title={tooltip}>
  {#if broken}
    <span class="material-symbols-outlined rel-chip-icon" aria-hidden="true">link_off</span>
  {/if}
  {#if clickable}
    <button class="rel-chip-link" onclick={navigate} tabindex="-1">
      {text}
    </button>
  {:else}
    <span class="rel-chip-text">{text}</span>
  {/if}
  {#if onremove}
    <button
      class="rel-chip-remove"
      aria-label="Remove {text}"
      tabindex="-1"
      onmousedown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onremove()
      }}
    >
      ×
    </button>
  {/if}
</span>

<style>
  .rel-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
    padding: 1px 8px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    background: transparent;
    color: var(--color-primary, #00e5ff);
    font-size: var(--text-xs, 0.625rem);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    white-space: nowrap;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .rel-chip:hover {
    border-color: var(--color-primary, #00e5ff);
  }

  .rel-chip.neutral {
    border-color: var(--color-border, #27272a);
    color: var(--color-text-dim, #71717a);
  }

  .rel-chip.neutral:hover {
    border-color: var(--color-border, #27272a);
  }

  .rel-chip.broken {
    border-style: dashed;
    border-color: var(--color-warning, #eab308);
    color: var(--color-warning, #eab308);
  }

  .rel-chip.broken:hover {
    border-color: var(--color-warning, #eab308);
  }

  .rel-chip-icon {
    font-size: 12px;
    line-height: 1;
  }

  .rel-chip-link {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rel-chip-link:hover {
    text-decoration: underline;
  }

  .rel-chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rel-chip-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .rel-chip-remove:hover {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .rel-chip,
    .rel-chip-remove {
      transition: none;
    }
  }
</style>
