<script lang="ts">
  interface Props {
    nodeCount: number
  }

  let { nodeCount }: Props = $props()
  let dismissed = $state(false)

  let message = $derived(
    nodeCount > 2000
      ? `Very large graph (${nodeCount} nodes). Visual quality reduced for performance.`
      : `Large graph (${nodeCount} nodes). Some effects disabled for performance.`
  )
</script>

{#if nodeCount > 500 && !dismissed}
  <div class="graph-performance-warning" role="status">
    <span>{message}</span>
    <button
      type="button"
      class="warning-dismiss"
      onclick={() => (dismissed = true)}
      aria-label="Dismiss large graph warning"
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
{/if}

<style>
  .graph-performance-warning {
    position: absolute;
    bottom: var(--space-4, 1rem);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-2, 0.5rem) var(--space-2, 0.5rem)
      var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-warning, #f59e0b);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-warning, #f59e0b);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-sm, 0.75rem);
  }

  .warning-dismiss {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm, 0.25rem);
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .warning-dismiss:hover {
    background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
  }

  .warning-dismiss:focus-visible {
    outline: 2px solid var(--color-warning, #f59e0b);
    outline-offset: 2px;
  }

  .warning-dismiss .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .warning-dismiss {
      transition: none;
    }
  }
</style>
