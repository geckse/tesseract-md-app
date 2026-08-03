import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'

import {
  activityLatestMessage,
  activitySummary,
  activityUnreadErrors
} from '../../src/renderer/stores/activity-log'
import { ingestIsReindex, ingestProgress, ingestRunning } from '../../src/renderer/stores/ingest'
import BackgroundActivity from '@renderer/components/BackgroundActivity.svelte'

beforeEach(() => {
  ingestRunning.set(false)
  ingestIsReindex.set(false)
  ingestProgress.set(null)
  activityUnreadErrors.set(0)
  activityLatestMessage.set('No activity yet')
  activitySummary.set({
    estimatedInputTokens: 0,
    apiCalls: 0,
    errors: 0,
    watcherEvents: 0,
    watcherState: 'stopped'
  })
})

describe('BackgroundActivity', () => {
  it('shows live reindex progress and unread watcher errors in the footer', () => {
    ingestRunning.set(true)
    ingestIsReindex.set(true)
    ingestProgress.set({
      phase: 'embedding',
      completed_batches: 1,
      total_batches: 2,
      completed_chunks: 5,
      total_chunks: 10,
      estimated_input_tokens: 50,
      total_estimated_input_tokens: 100,
      api_calls: 1,
      elapsed_ms: 500
    })
    activityUnreadErrors.set(3)
    activityLatestMessage.set('14:20:01 — Modified `notes/a.md`')
    activitySummary.set({
      estimatedInputTokens: 120,
      apiCalls: 2,
      errors: 3,
      watcherEvents: 1,
      watcherState: 'running'
    })

    render(BackgroundActivity)

    expect(screen.getByText('Reindex · embedding')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByLabelText('Open activity log. 3 unread errors.').getAttribute('title')).toBe(
      '14:20:01 — Modified `notes/a.md` · Today: 120 estimated input tokens'
    )
  })
})
