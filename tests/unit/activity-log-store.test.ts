import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

let changedCallback:
  | ((event: { collection_id: string; date: string; revision: number }) => void)
  | null = null
const mockApi = {
  openTodayActivityLog: vi.fn(),
  readActivityLog: vi.fn(),
  onActivityLogChanged: vi.fn((callback) => {
    changedCallback = callback
    return vi.fn()
  }),
  saveWindowSession: vi.fn(),
  saveWindowSessionSync: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
  configurable: true
})

import {
  activityUnreadErrors,
  setupActivityLogListener,
  teardownActivityLogListener
} from '../../src/renderer/stores/activity-log'
import { activeCollectionId, collections } from '../../src/renderer/stores/collections'
import { workspace } from '../../src/renderer/stores/workspace.svelte'

function descriptor(content: string, revision: number, errors: number) {
  return {
    collection_id: 'vault-id',
    date: '2026-08-03',
    title: 'Activity 2026-08-03.md',
    content,
    revision,
    read_only: true as const,
    latest_event: revision > 0 ? 'Watcher error' : 'No activity yet',
    summary: {
      events: revision,
      watcher_events: revision,
      reindex_runs: 0,
      estimated_input_tokens: 12,
      api_calls: 1,
      errors,
      watcher_state: errors > 0 ? 'error' : 'running'
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  changedCallback = null
  workspace.reset()
  collections.set([{ id: 'vault-id', name: 'Vault', path: '/vault', addedAt: 1, lastOpenedAt: 1 }])
  activeCollectionId.set('vault-id')
  mockApi.openTodayActivityLog.mockResolvedValue(descriptor('# Initial\n', 0, 0))
})

afterEach(() => {
  teardownActivityLogListener()
  activeCollectionId.set(null)
  collections.set([])
})

describe('activity-log renderer store', () => {
  it('live-refreshes an open read-only tab and tracks newly unread errors', async () => {
    const tabId = workspace.openActivityLog(descriptor('# Initial\n', 0, 0))
    setupActivityLogListener()
    await vi.waitFor(() => expect(changedCallback).not.toBeNull())

    mockApi.readActivityLog.mockResolvedValue(descriptor('# Updated\n', 1, 2))
    changedCallback!({ collection_id: 'vault-id', date: '2026-08-03', revision: 1 })

    await vi.waitFor(() => {
      const tab = workspace.tabs[tabId]
      expect(tab.kind === 'document' ? tab.content : null).toBe('# Updated\n')
    })
    const tab = workspace.tabs[tabId]
    expect(tab.kind).toBe('document')
    if (tab.kind === 'document') {
      expect(tab.readOnly).toBe(true)
      expect(tab.savedContent).toBe('# Updated\n')
      expect(tab.isDirty).toBe(false)
    }
    expect(get(activityUnreadErrors)).toBe(2)
  })
})
