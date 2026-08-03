<script lang="ts">
  import type { IngestProgress } from '../types/cli'
  import { ingestIsReindex, ingestProgress, ingestRunning, openIngestModal } from '../stores/ingest'
  import {
    activityLatestMessage,
    activitySummary,
    activityUnreadErrors,
    openTodayActivityLog,
    type ActivitySummaryState
  } from '../stores/activity-log'

  let running = $state(false)
  let reindex = $state(false)
  let progress: IngestProgress | null = $state(null)
  let unreadErrors = $state(0)
  let latestMessage = $state('No activity yet')
  let summary: ActivitySummaryState = $state({
    events: 0,
    estimatedInputTokens: 0,
    apiCalls: 0,
    errors: 0,
    watcherEvents: 0,
    watcherState: 'stopped'
  })

  ingestRunning.subscribe((value) => (running = value))
  ingestIsReindex.subscribe((value) => (reindex = value))
  ingestProgress.subscribe((value) => (progress = value))
  activityUnreadErrors.subscribe((value) => (unreadErrors = value))
  activityLatestMessage.subscribe((value) => (latestMessage = value))
  activitySummary.subscribe((value) => (summary = value))

  const phaseLabel = $derived(progress?.phase.replace(/_/g, ' ') ?? 'preparing')
  const percent = $derived(progressPercent(progress))
  const tooltip = $derived(
    `${latestMessage} · Today: ${summary.estimatedInputTokens.toLocaleString()} estimated input tokens`
  )

  function progressPercent(value: IngestProgress | null): number | null {
    if (!value) return null
    if (value.phase === 'parsing' || value.phase === 'skipped' || value.phase === 'file_error') {
      return value.total > 0 ? Math.round((value.current / value.total) * 100) : 0
    }
    if (value.phase === 'embedding') {
      return value.total_chunks > 0
        ? Math.round((value.completed_chunks / value.total_chunks) * 100)
        : 0
    }
    if (value.phase === 'done') return 100
    return null
  }
</script>

<div class="background-activity">
  <button
    type="button"
    class="activity-log-button"
    class:active={running}
    title={tooltip}
    aria-label={`Open activity log. ${unreadErrors} unread errors.`}
    onclick={() => void openTodayActivityLog()}
  >
    <span class="material-symbols-outlined log-icon" class:spinning={running}>receipt_long</span>
    {#if unreadErrors > 0}
      <span class="error-badge">{unreadErrors > 99 ? '99+' : unreadErrors}</span>
    {/if}
  </button>

  {#if running}
    <button
      type="button"
      class="progress-chip"
      title="Open indexing progress"
      onclick={openIngestModal}
    >
      <span class="material-symbols-outlined chip-icon">sync</span>
      <span>{reindex ? 'Reindex' : 'Index'} · {phaseLabel}</span>
      {#if percent !== null}<span class="percent">{percent}%</span>{/if}
    </button>
  {/if}
</div>

<style>
  .background-activity {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .activity-log-button,
  .progress-chip {
    position: relative;
    display: flex;
    align-items: center;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .activity-log-button {
    justify-content: center;
    width: 24px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    background: transparent;
  }

  .activity-log-button:hover,
  .activity-log-button.active {
    color: var(--color-primary, #00e5ff);
    background: var(--overlay-active, rgba(255, 255, 255, 0.08));
  }

  .log-icon {
    font-size: 15px;
  }

  .spinning,
  .chip-icon {
    animation: spin 1.2s linear infinite;
  }

  .error-badge {
    position: absolute;
    top: -4px;
    right: -6px;
    color: var(--color-text-muted, #71717a);
    font-size: 8px;
    font-weight: 600;
    line-height: 1;
    text-align: center;
  }

  .progress-chip {
    gap: 5px;
    height: 22px;
    max-width: 220px;
    padding: 0 8px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 35%, transparent);
    border-radius: 11px;
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 8%, transparent);
    color: var(--color-primary, #00e5ff);
    line-height: 20px;
    white-space: nowrap;
  }

  .progress-chip:hover {
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 14%, transparent);
  }

  .chip-icon {
    flex-shrink: 0;
    font-size: 12px;
  }

  .percent {
    color: var(--color-text, #e4e4e7);
    font-variant-numeric: tabular-nums;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
