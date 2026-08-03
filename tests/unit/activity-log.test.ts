import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => testState.userData }
}))

import { ActivityLogStore, redactActivityText } from '../../src/main/activity-log'

let temporaryDirectory = ''

const collection = {
  id: 'vault-id',
  name: 'Test Vault',
  path: '/vault',
  addedAt: 1,
  lastOpenedAt: 1
}

function dateOffset(days: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'tesseract-activity-'))
  testState.userData = temporaryDirectory
})

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('ActivityLogStore', () => {
  it('writes a read-only Markdown log with exact daily token and API accounting', async () => {
    const changes: unknown[] = []
    const store = new ActivityLogStore(
      () => [collection],
      (event) => changes.push(event)
    )
    const timestamp = Date.now()

    await store.recordIngest({
      type: 'started',
      run_id: 'run-1',
      root: '/vault',
      reindex: true,
      timestamp
    })
    await store.recordIngest({
      type: 'progress',
      run_id: 'run-1',
      root: '/vault',
      reindex: true,
      timestamp: timestamp + 1,
      progress: {
        phase: 'file_error',
        current: 1,
        total: 2,
        path: 'bad.md',
        message: 'parse failed',
        error_count: 1,
        elapsed_ms: 10
      }
    })
    expect((await store.openToday(collection.id)).summary.errors).toBe(1)
    await store.recordIngest({
      type: 'completed',
      run_id: 'run-1',
      root: '/vault',
      reindex: true,
      timestamp: timestamp + 2,
      result: {
        files_indexed: 1,
        files_skipped: 0,
        files_removed: 0,
        chunks_created: 2,
        api_calls: 1,
        estimated_input_tokens: 24,
        files_failed: 1,
        errors: [{ path: 'bad.md', message: 'parse failed' }],
        duration_secs: 0.1,
        cancelled: false,
        module_reports: []
      }
    })

    const descriptor = await store.openToday(collection.id)
    expect(descriptor.read_only).toBe(true)
    expect(descriptor.content).toContain('# Activity — Test Vault')
    expect(descriptor.content).toContain('Reindex started')
    expect(descriptor.content).toContain('`bad.md`')
    expect(descriptor.summary).toMatchObject({
      reindex_runs: 1,
      estimated_input_tokens: 24,
      api_calls: 1,
      errors: 1
    })
    expect(changes).toHaveLength(3)
  })

  it('persists only phase changes and ten-percent progress snapshots', async () => {
    const store = new ActivityLogStore(
      () => [collection],
      () => undefined
    )
    const base = Date.now()
    for (const current of [1, 2, 9, 10, 11, 20]) {
      await store.recordIngest({
        type: 'progress',
        run_id: 'run-progress',
        root: '/vault',
        reindex: false,
        timestamp: base + current,
        progress: {
          phase: 'parsing',
          current,
          total: 100,
          path: `${current}.md`,
          elapsed_ms: current
        }
      })
    }
    const descriptor = await store.openToday(collection.id)
    expect(descriptor.content.match(/Index progress/g)).toHaveLength(3)
  })

  it('logs rename paths, module diagnostics, and watcher accounting', async () => {
    const store = new ActivityLogStore(
      () => [collection],
      () => undefined
    )
    await store.recordWatchEvent('/vault', {
      event_type: 'Renamed',
      previous_path: 'notes/old.md',
      path: 'notes/new.md',
      chunks_processed: 2,
      estimated_input_tokens: 18,
      api_calls: 1,
      duration_ms: 15,
      success: true,
      error: null,
      module_reports: [
        {
          module: 'formula',
          event: 'files_changed',
          files_evaluated: 1,
          fields_updated: 0,
          duration_ms: 2,
          diagnostics: [
            {
              module: 'formula',
              path: 'notes/new.md',
              field: 'total',
              code: 'evaluation_failed',
              message: 'Authorization: Bearer do-not-log',
              span_start: null,
              span_end: null
            }
          ]
        }
      ]
    })

    const descriptor = await store.openToday(collection.id)
    expect(descriptor.content).toContain('`notes/old.md` → `notes/new.md`')
    expect(descriptor.content).toContain('evaluation_failed')
    expect(descriptor.content).not.toContain('do-not-log')
    expect(descriptor.summary).toMatchObject({
      watcher_events: 1,
      estimated_input_tokens: 18,
      api_calls: 1,
      errors: 1
    })
  })

  it('rejects unmanaged dates and does not recreate expired logs during reads', async () => {
    const store = new ActivityLogStore(
      () => [collection],
      () => undefined
    )
    await expect(store.read(collection.id, '../../secret')).rejects.toThrow(
      'Invalid activity-log date'
    )
    await expect(store.read(collection.id, '2000-01-01')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('prunes oldest daily files outside the configured local-day retention window', async () => {
    const store = new ActivityLogStore(
      () => [collection],
      () => undefined,
      {
        retentionDays: 2,
        collectionCapBytes: 10 * 1024 * 1024
      }
    )
    await store.open(collection.id, dateOffset(-3))
    await store.open(collection.id, dateOffset(-1))
    await store.recordWatcherState('/vault', 'running')

    await expect(store.read(collection.id, dateOffset(-3))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(store.read(collection.id, dateOffset(-1))).resolves.toMatchObject({
      date: dateOffset(-1)
    })
  })

  it('compacts oldest successful entries while retaining errors and the daily summary', async () => {
    const store = new ActivityLogStore(
      () => [collection],
      () => undefined,
      {
        retentionDays: 7,
        collectionCapBytes: 2_500
      }
    )
    await store.recordWatcherState(
      '/vault',
      'error',
      `persistent failure marker ${'x'.repeat(200)}`
    )
    for (let index = 0; index < 8; index++) {
      await store.recordWatchEvent('/vault', {
        event_type: 'Modified',
        path: `success-${index}-${'p'.repeat(300)}.md`,
        chunks_processed: 1,
        estimated_input_tokens: 10,
        api_calls: 1,
        duration_ms: 1,
        success: true,
        error: null,
        module_reports: []
      })
    }

    const descriptor = await store.openToday(collection.id)
    expect(descriptor.content).toContain('persistent failure marker')
    expect(descriptor.content).toContain('Older successful entries were compacted')
    expect(descriptor.content).not.toContain('success-0-')
    expect(descriptor.summary).toMatchObject({
      watcher_events: 8,
      estimated_input_tokens: 80,
      api_calls: 8,
      errors: 1
    })
  })

  it('redacts credentials and sensitive query parameters', () => {
    expect(
      redactActivityText(
        'Authorization: Bearer abc123 https://host/path?api_key=secret-value token=another-secret'
      )
    ).toBe('Authorization: Bearer <redacted> https://host/path?api_key=<redacted> token=<redacted>')
  })
})
