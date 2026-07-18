import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api before importing the store
const mockApi = {
  clusterDefinitions: vi.fn(),
  customClusters: vi.fn(),
  topicUnassigned: vi.fn(),
  addTopic: vi.fn(),
  updateTopic: vi.fn(),
  removeTopic: vi.fn(),
  deleteCollectionConfig: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  topicDefs,
  topicSummaries,
  topicUnassigned,
  topicsNeedIngest,
  topicsLoading,
  loadTopics,
  addTopic,
  updateTopic,
  removeTopic,
  migrateLegacyDotenvTopics,
  resetTopicsState,
  LEGACY_TOPICS_KEY
} from '@renderer/stores/topics'
import { collectionConfig } from '@renderer/stores/settings'
import type { TopicDef } from '@renderer/types/cli'

const ROOT = '/vault'

const sampleDef: TopicDef = {
  name: 'AI',
  seeds: ['neural nets'],
  description: 'Machine learning notes',
  threshold: 0.4
}

beforeEach(() => {
  vi.clearAllMocks()
  resetTopicsState()
  mockApi.clusterDefinitions.mockResolvedValue([sampleDef])
  mockApi.customClusters.mockResolvedValue([
    { id: 0, name: 'AI', seed_phrases: ['neural nets'], document_count: 3, mean_score: 0.61 }
  ])
  mockApi.topicUnassigned.mockResolvedValue({ count: 2, paths: ['a.md', 'b.md'] })
  mockApi.addTopic.mockResolvedValue(undefined)
  mockApi.updateTopic.mockResolvedValue(undefined)
  mockApi.removeTopic.mockResolvedValue(undefined)
  mockApi.deleteCollectionConfig.mockResolvedValue(undefined)
})

describe('loadTopics', () => {
  it('loads defs, summaries, and unassigned from the CLI', async () => {
    await loadTopics(ROOT)
    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(ROOT)
    expect(mockApi.customClusters).toHaveBeenCalledWith(ROOT)
    expect(mockApi.topicUnassigned).toHaveBeenCalledWith(ROOT)
    expect(get(topicDefs)).toEqual([sampleDef])
    expect(get(topicSummaries)[0].mean_score).toBe(0.61)
    expect(get(topicUnassigned)).toEqual({ count: 2, paths: ['a.md', 'b.md'] })
    expect(get(topicsLoading)).toBe(false)
  })

  it('tolerates sub-load failures independently (no index yet)', async () => {
    mockApi.customClusters.mockRejectedValue(new Error('no index'))
    mockApi.topicUnassigned.mockRejectedValue(new Error('no index'))
    await loadTopics(ROOT)
    expect(get(topicDefs)).toEqual([sampleDef])
    expect(get(topicSummaries)).toEqual([])
    expect(get(topicUnassigned)).toBeNull()
  })

  it('does not flag topicsNeedIngest on a plain load', async () => {
    await loadTopics(ROOT)
    expect(get(topicsNeedIngest)).toBe(false)
  })

  it('does not let a stale root response overwrite the current topics', async () => {
    let resolveOldDefs!: (value: TopicDef[]) => void
    mockApi.clusterDefinitions
      .mockReturnValueOnce(new Promise((resolve) => (resolveOldDefs = resolve)))
      .mockResolvedValueOnce([{ ...sampleDef, name: 'Current' }])
    mockApi.customClusters.mockResolvedValue([])
    mockApi.topicUnassigned.mockResolvedValue(null)

    const oldLoad = loadTopics('/old')
    const currentLoad = loadTopics('/current')
    await currentLoad
    resolveOldDefs([{ ...sampleDef, name: 'Stale' }])
    await oldLoad

    expect(get(topicDefs).map((def) => def.name)).toEqual(['Current'])
    expect(get(topicsLoading)).toBe(false)
  })

  it('contains synchronous partial-bridge failures like rejected reads', async () => {
    mockApi.clusterDefinitions.mockImplementation(() => {
      throw new Error('bridge unavailable')
    })

    await expect(loadTopics(ROOT)).resolves.toBeUndefined()
    expect(get(topicDefs)).toEqual([])
    expect(get(topicSummaries)).not.toEqual([])
  })
})

describe('topic mutations', () => {
  it('addTopic writes via CLI, reloads, and flags for re-ingest', async () => {
    await addTopic(ROOT, sampleDef)
    expect(mockApi.addTopic).toHaveBeenCalledWith(ROOT, sampleDef)
    expect(mockApi.clusterDefinitions).toHaveBeenCalled()
    expect(get(topicsNeedIngest)).toBe(true)
  })

  it('updateTopic addresses the topic by its current name', async () => {
    const renamed = { ...sampleDef, name: 'ML' }
    await updateTopic(ROOT, 'AI', renamed)
    expect(mockApi.updateTopic).toHaveBeenCalledWith(ROOT, 'AI', renamed)
    expect(get(topicsNeedIngest)).toBe(true)
  })

  it('removeTopic removes by name and flags for re-ingest', async () => {
    await removeTopic(ROOT, 'AI')
    expect(mockApi.removeTopic).toHaveBeenCalledWith(ROOT, 'AI')
    expect(get(topicsNeedIngest)).toBe(true)
  })

  it('propagates CLI failures without flagging re-ingest', async () => {
    mockApi.addTopic.mockRejectedValue(new Error('topic already exists'))
    await expect(addTopic(ROOT, sampleDef)).rejects.toThrow('topic already exists')
    expect(get(topicsNeedIngest)).toBe(false)
  })

  it('does not repaint a new target after an old-root mutation finishes', async () => {
    let resolveAdd!: () => void
    await loadTopics('/old')
    mockApi.addTopic.mockReturnValueOnce(new Promise<void>((resolve) => (resolveAdd = resolve)))

    const adding = addTopic('/old', sampleDef)
    await loadTopics('/current')
    const callsBeforeResolve = mockApi.clusterDefinitions.mock.calls.length
    resolveAdd()
    await adding

    expect(mockApi.clusterDefinitions).toHaveBeenCalledTimes(callsBeforeResolve)
    expect(get(topicsNeedIngest)).toBe(false)
  })
})

describe('migrateLegacyDotenvTopics', () => {
  it('parses the legacy value, adds each def, and deletes the dotenv key', async () => {
    collectionConfig.set({ [LEGACY_TOPICS_KEY]: 'AI:nets|Web:html,css' })
    const imported = await migrateLegacyDotenvTopics(ROOT, 'AI:nets|Web:html,css')

    expect(imported).toBe(2)
    expect(mockApi.addTopic).toHaveBeenCalledTimes(2)
    expect(mockApi.addTopic.mock.calls[0][1]).toMatchObject({ name: 'AI', seeds: ['nets'] })
    expect(mockApi.addTopic.mock.calls[1][1]).toMatchObject({ name: 'Web', seeds: ['html', 'css'] })
    expect(mockApi.deleteCollectionConfig).toHaveBeenCalledWith(ROOT, LEGACY_TOPICS_KEY)
    expect(get(collectionConfig)[LEGACY_TOPICS_KEY]).toBeUndefined()
    expect(get(topicsNeedIngest)).toBe(true)
  })

  it('skips defs the CLI rejects but migrates the rest', async () => {
    mockApi.addTopic.mockRejectedValueOnce(new Error('duplicate')).mockResolvedValueOnce(undefined)
    const imported = await migrateLegacyDotenvTopics(ROOT, 'Dup:x|Fresh:y')
    expect(imported).toBe(1)
    expect(mockApi.deleteCollectionConfig).toHaveBeenCalled()
    expect(get(topicsNeedIngest)).toBe(true)
  })

  it('does not flag re-ingest when nothing was imported', async () => {
    mockApi.addTopic.mockRejectedValue(new Error('duplicate'))
    const imported = await migrateLegacyDotenvTopics(ROOT, 'Dup:x')
    expect(imported).toBe(0)
    expect(get(topicsNeedIngest)).toBe(false)
  })
})

describe('resetTopicsState', () => {
  it('clears all topic state', async () => {
    await loadTopics(ROOT)
    topicsNeedIngest.set(true)
    resetTopicsState()
    expect(get(topicDefs)).toEqual([])
    expect(get(topicSummaries)).toEqual([])
    expect(get(topicUnassigned)).toBeNull()
    expect(get(topicsNeedIngest)).toBe(false)
  })
})
