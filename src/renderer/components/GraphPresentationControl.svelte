<script lang="ts">
  interface Props {
    active: boolean
    paused: boolean
    revealed: number
    total: number
    startsFromSelection: boolean
    statusMessage: string
    onstart: () => void
    onpause: () => void
    onresume: () => void
    onreset: () => void
  }

  let {
    active,
    paused,
    revealed,
    total,
    startsFromSelection,
    statusMessage,
    onstart,
    onpause,
    onresume,
    onreset
  }: Props = $props()

  let startActionLabel = $derived(
    startsFromSelection
      ? 'Present graph from selected node'
      : 'Present graph from most root-like node'
  )
  let primaryActionLabel = $derived(
    active
      ? paused
        ? 'Continue graph presentation'
        : 'Pause graph presentation at current step'
      : startActionLabel
  )
  let primaryIcon = $derived(active ? (paused ? 'play_circle' : 'pause_circle') : 'play_circle')
  let primaryText = $derived(active ? (paused ? 'Continue' : 'Pause') : 'Present')

  function handlePrimaryAction(): void {
    if (!active) onstart()
    else if (paused) onresume()
    else onpause()
  }
</script>

<div class="presentation-shell" class:active class:paused class:disabled={!active && total === 0}>
  <button
    type="button"
    class="presentation-control"
    aria-label={primaryActionLabel}
    title={primaryActionLabel}
    disabled={!active && total === 0}
    onclick={handlePrimaryAction}
  >
    <span class="material-symbols-outlined">{primaryIcon}</span>
    <span>{primaryText}</span>
  </button>
  {#if active}
    <button
      type="button"
      class="presentation-control reset-control"
      aria-label="Reset graph presentation"
      title="Reset graph presentation and show all nodes"
      onclick={onreset}
    >
      <span class="material-symbols-outlined">restart_alt</span>
      <span>Reset</span>
    </button>
    <span
      class="presentation-progress"
      role="progressbar"
      aria-label="Graph presentation progress"
      aria-valuemin="0"
      aria-valuemax={total}
      aria-valuenow={revealed}
      aria-valuetext={`${revealed} of ${total} nodes revealed`}>{revealed}/{total}</span
    >
  {/if}
  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</span>
</div>

<style>
  .presentation-shell {
    position: absolute;
    top: calc(var(--space-3, 0.75rem) + 34px);
    left: 50%;
    z-index: var(--z-base, 10);
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    transform: translateX(-50%);
    padding: 0 var(--space-3, 0.75rem);
    background: color-mix(in srgb, var(--color-surface, #161617) 92%, transparent);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 999px;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    cursor: default;
    backdrop-filter: blur(10px);
    transition:
      color var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .presentation-shell:hover:not(.disabled),
  .presentation-shell.active {
    color: var(--color-primary, #00e5ff);
    border-color: var(--color-primary-glow, #00e5ff40);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
  }

  .presentation-shell.disabled {
    opacity: 0.4;
  }

  .presentation-control {
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1, 0.25rem) 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .presentation-control:disabled {
    cursor: default;
  }

  .reset-control {
    padding-left: var(--space-2, 0.5rem);
    border-left: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    opacity: 0.78;
  }

  .reset-control:hover,
  .reset-control:focus-visible {
    opacity: 1;
  }

  .presentation-control:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .material-symbols-outlined {
    font-size: 16px;
  }

  .presentation-progress {
    color: inherit;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    opacity: 0.75;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .presentation-shell {
      transition: none;
    }
  }
</style>
