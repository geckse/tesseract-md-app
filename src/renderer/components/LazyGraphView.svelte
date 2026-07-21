<script lang="ts">
  import { onMount } from 'svelte'
  import { loadGraphViewComponent } from '../lib/graph-view-loader'
  import { syncGraphStoresFromTab } from '../stores/graph'

  interface Props {
    paneId: string
  }

  let { paneId }: Props = $props()
  // This wrapper is only mounted for a visible graph tab, so starting the
  // shared import here remains lazy. Do not initialize this from the template:
  // assigning reactive state while Svelte evaluates an {#await} expression is
  // forbidden and raises state_unsafe_mutation.
  let componentPromise: ReturnType<typeof loadGraphViewComponent> =
    $state.raw(loadGraphViewComponent())

  function retry(): void {
    componentPromise = loadGraphViewComponent()
  }

  // Mounting this wrapper means a graph tab has become visible. This covers
  // restored sessions and popouts in addition to explicit open commands.
  onMount(syncGraphStoresFromTab)
</script>

{#await componentPromise}
  <div class="graph-module-state" aria-live="polite" aria-busy="true">
    <span class="material-symbols-outlined graph-module-icon" aria-hidden="true"
      >progress_activity</span
    >
    <span>Loading Graph View…</span>
  </div>
{:then GraphView}
  <GraphView {paneId} />
{:catch}
  <div class="graph-module-state" role="alert">
    <span>The graph renderer could not be loaded.</span>
    <button type="button" onclick={retry}>Retry</button>
  </div>
{/await}

<style>
  .graph-module-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .graph-module-icon {
    animation: graph-module-spin 1s linear infinite;
  }

  button {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-main);
    cursor: pointer;
  }

  button:hover {
    border-color: var(--color-primary);
  }

  button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  @keyframes graph-module-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .graph-module-icon {
      animation: none;
    }
  }
</style>
