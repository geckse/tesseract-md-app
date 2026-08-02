<script lang="ts">
  import {
    watcherState,
    watcherError,
    watcherToggling,
    watcherEvents,
    toggleWatcher
  } from '../stores/watcher'

  type WatcherStateValue = 'stopped' | 'starting' | 'running' | 'error'

  let currentState: WatcherStateValue = $state('stopped')
  watcherState.subscribe((v) => (currentState = v as WatcherStateValue))

  let currentError: string | null = $state(null)
  watcherError.subscribe((v) => (currentError = v))

  let toggling = $state(false)
  watcherToggling.subscribe((v) => (toggling = v))

  let computedSummary = $state<string | null>(null)
  watcherEvents.subscribe((events) => {
    const report = events
      .filter((event) => event.type === 'watch-event')
      .flatMap((event) => event.data.module_reports ?? [])
      .find(
        (moduleReport) =>
          moduleReport.module === 'formula' || moduleReport.module === 'lookup_rollup'
      )
    computedSummary = report
      ? `${report.module === 'formula' ? 'Formula' : 'Lookup & Rollup'}: ${report.fields_updated} fields updated, ${report.diagnostics.length} diagnostics`
      : null
  })

  const stateLabel: Record<WatcherStateValue, string> = {
    stopped: 'Watch',
    starting: 'Starting...',
    running: 'Watching',
    error: 'Watch Error'
  }

  function handleClick(): void {
    if (toggling) return
    toggleWatcher()
  }
</script>

<button
  class="watcher-toggle"
  class:stopped={currentState === 'stopped'}
  class:starting={currentState === 'starting'}
  class:running={currentState === 'running'}
  class:error={currentState === 'error'}
  disabled={toggling || currentState === 'starting'}
  title={currentError ?? computedSummary ?? `Watcher: ${currentState}`}
  onclick={handleClick}
>
  <span
    class="watcher-dot"
    class:dot-stopped={currentState === 'stopped'}
    class:dot-starting={currentState === 'starting'}
    class:dot-running={currentState === 'running'}
    class:dot-error={currentState === 'error'}
  ></span>
  {#if computedSummary}<span class="formula-activity" aria-hidden="true"
      >{computedSummary.startsWith('Formula') ? 'ƒx' : 'Σ'}</span
    >{/if}
  {stateLabel[currentState]}
</button>

<style>
  .watcher-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    line-height: 32px;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color 0.15s;
    letter-spacing: -0.025em;
  }

  .watcher-toggle:hover:not(:disabled) {
    color: var(--color-text-white, #fff);
  }

  .watcher-toggle:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .watcher-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .formula-activity {
    color: var(--color-primary);
    font: 700 9px var(--font-mono, 'JetBrains Mono', monospace);
  }

  .dot-stopped {
    background: var(--color-text-dim, #71717a);
  }

  .dot-starting {
    background: #f59e0b;
    animation: pulse 1s ease-in-out infinite;
  }

  .dot-running {
    background: #10b981;
    animation: pulse 2s ease-in-out infinite;
  }

  .dot-error {
    background: #ef4444;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
