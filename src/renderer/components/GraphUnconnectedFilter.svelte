<script lang="ts">
  interface Props {
    count: number
    active: boolean
    ontoggle: () => void
  }

  let { count, active, ontoggle }: Props = $props()

  let description = $derived(
    active
      ? 'Show normal graph colors'
      : `Highlight ${count} unconnected ${count === 1 ? 'node' : 'nodes'} with no incoming or outgoing connections`
  )
</script>

<button
  type="button"
  class="unconnected-filter"
  class:active
  aria-pressed={active}
  aria-label={description}
  title={description}
  disabled={count === 0 && !active}
  onclick={ontoggle}
>
  <span class="material-symbols-outlined">link_off</span>
  <span>Unconnected</span>
  <span class="filter-count">{count}</span>
</button>

<style>
  .unconnected-filter {
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
    transition:
      border-color var(--transition-fast, 150ms ease),
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .unconnected-filter:hover:not(:disabled) {
    border-color: var(--color-primary-glow, #00e5ff40);
    color: var(--color-text, #e4e4e7);
  }

  .unconnected-filter.active {
    border-color: var(--color-primary, #00e5ff);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
    color: var(--color-primary, #00e5ff);
  }

  .unconnected-filter:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .unconnected-filter:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .material-symbols-outlined {
    font-size: 14px;
  }

  .filter-count {
    min-width: 1.25em;
    color: inherit;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    text-align: right;
  }

  @media (prefers-reduced-motion: reduce) {
    .unconnected-filter {
      transition: none;
    }
  }
</style>
