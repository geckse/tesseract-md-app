/**
 * Renderer store tests for the Obsidian topic sync notice (phase 44).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api before importing the stores
const mockApi = {
  onObsidianTopicsSynced: vi.fn(),
  clusterDefinitions: vi.fn().mockResolvedValue([]),
  customClusters: vi.fn().mockResolvedValue([]),
  topicUnassigned: vi.fn().mockResolvedValue(null)
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  obsidianImportNotice,
  handleObsidianTopicsSynced,
  setupObsidianImportListener,
  dismissObsidianImportNotice
} from '@renderer/stores/obsidian-import'
import { activeCollectionId } from '@renderer/stores/collections'
import { topicsNeedIngest } from '@renderer/stores/topics'

const EVENT = {
  collectionId: 'col-1',
  root: '/vault',
  added: ['rag', 'ai'],
  updated: ['ops'],
  removed: ['stale']
}

beforeEach(() => {
  vi.clearAllMocks()
  obsidianImportNotice.set(null)
  activeCollectionId.set(null)
  topicsNeedIngest.set(false)
})

describe('handleObsidianTopicsSynced', () => {
  it('surfaces the notice', () => {
    handleObsidianTopicsSynced(EVENT)
    expect(get(obsidianImportNotice)).toEqual(EVENT)
  })

  it('flags re-ingest and reloads topics when the active collection matches', () => {
    activeCollectionId.set('col-1')
    handleObsidianTopicsSynced(EVENT)
    expect(get(topicsNeedIngest)).toBe(true)
    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith('/vault')
  })

  it('leaves topic state alone for a non-active collection', () => {
    activeCollectionId.set('other')
    handleObsidianTopicsSynced(EVENT)
    expect(get(topicsNeedIngest)).toBe(false)
    expect(mockApi.clusterDefinitions).not.toHaveBeenCalled()
    expect(get(obsidianImportNotice)).toEqual(EVENT)
  })
})

describe('setupObsidianImportListener', () => {
  it('registers the preload listener with the handler', () => {
    setupObsidianImportListener()
    expect(mockApi.onObsidianTopicsSynced).toHaveBeenCalledTimes(1)
    // Simulate the broadcast arriving through the registered callback
    const callback = mockApi.onObsidianTopicsSynced.mock.calls[0][0]
    callback(EVENT)
    expect(get(obsidianImportNotice)).toEqual(EVENT)
  })
})

describe('dismissObsidianImportNotice', () => {
  it('clears the notice', () => {
    obsidianImportNotice.set(EVENT)
    dismissObsidianImportNotice()
    expect(get(obsidianImportNotice)).toBeNull()
  })
})
