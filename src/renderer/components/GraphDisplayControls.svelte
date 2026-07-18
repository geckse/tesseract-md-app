<script lang="ts">
  interface Props {
    searchOpen: boolean
    labelsVisible: boolean
    linesVisible: boolean
    shapesVisible: boolean
    shapesAvailable: boolean
    onsearch: () => void
    ontogglelabels: () => void
    ontogglelines: () => void
    ontoggleshapes: () => void
    onrecenter: () => void
  }

  let {
    searchOpen,
    labelsVisible,
    linesVisible,
    shapesVisible,
    shapesAvailable,
    onsearch,
    ontogglelabels,
    ontogglelines,
    ontoggleshapes,
    onrecenter
  }: Props = $props()
</script>

<div class="graph-display-controls" role="toolbar" aria-label="Graph display controls">
  <button
    type="button"
    class="control-button"
    class:active={searchOpen}
    aria-expanded={searchOpen}
    aria-label="Search graph"
    title="Search graph"
    onclick={onsearch}
  >
    <span class="material-symbols-outlined">search</span>
  </button>
  <span class="control-divider"></span>
  <button
    type="button"
    class="control-button"
    class:active={!labelsVisible}
    aria-pressed={!labelsVisible}
    aria-label={labelsVisible ? 'Hide labels' : 'Show labels'}
    title={labelsVisible ? 'Hide labels' : 'Show labels'}
    onclick={ontogglelabels}
  >
    <span class="material-symbols-outlined">label</span>
  </button>
  <button
    type="button"
    class="control-button"
    class:active={!linesVisible}
    aria-pressed={!linesVisible}
    aria-label={linesVisible ? 'Hide lines' : 'Show lines'}
    title={linesVisible ? 'Hide lines' : 'Show lines'}
    onclick={ontogglelines}
  >
    <span class="material-symbols-outlined">timeline</span>
  </button>
  <button
    type="button"
    class="control-button"
    class:active={!shapesVisible}
    aria-pressed={!shapesVisible}
    aria-label={shapesVisible ? 'Hide cluster and topic shapes' : 'Show cluster and topic shapes'}
    title={shapesVisible ? 'Hide cluster and topic shapes' : 'Show cluster and topic shapes'}
    disabled={!shapesAvailable}
    onclick={ontoggleshapes}
  >
    <span class="material-symbols-outlined">hexagon</span>
  </button>
  <span class="control-divider"></span>
  <button
    type="button"
    class="control-button"
    aria-label="Recenter graph"
    title="Recenter graph"
    onclick={onrecenter}
  >
    <span class="material-symbols-outlined">center_focus_strong</span>
  </button>
</div>

<style>
  .graph-display-controls {
    position: absolute;
    right: var(--space-4, 1rem);
    bottom: var(--space-4, 1rem);
    z-index: var(--z-base, 10);
    display: flex;
    align-items: center;
    overflow: hidden;
    padding: 2px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }

  .control-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm, 0.25rem);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition:
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .control-button:hover:not(:disabled) {
    color: var(--color-text, #e4e4e7);
    background: var(--overlay-hover, #1e1e20);
  }

  .control-button.active {
    color: var(--color-primary, #00e5ff);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
  }

  .control-button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .control-button:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: -2px;
  }

  .control-button .material-symbols-outlined {
    font-size: 18px;
  }

  .control-divider {
    width: 1px;
    height: 20px;
    margin: 0 2px;
    background: var(--color-border, #27272a);
  }

  @media (prefers-reduced-motion: reduce) {
    .control-button {
      transition: none;
    }
  }
</style>
