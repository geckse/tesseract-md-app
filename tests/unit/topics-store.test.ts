import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const mockInvalidateGraphAnalysis = vi.hoisted(() => vi.fn())
vi.mock('@renderer/stores/graph', () => ({
  invalidateGraphAnalysis: mockInvalidateGraphAnalysis
}))

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
  topicErrors,
  topicComputedEnabled,
  topicStatesByScope,
  topicScopeKey,
  loadTopics,
  refreshActiveTopicsForConfig,
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
  mockInvalidateGraphAnalysis.mockReset()
  mockInvalidateGraphAnalysis.mockResolvedValue(undefined)
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

  it('restores needs-ingest state when definitions have no computed summaries', async () => {
    mockApi.customClusters.mockResolvedValueOnce([])

    await loadTopics(ROOT)

    expect(get(topicsNeedIngest)).toBe(true)
    expect(get(topicStatesByScope)[topicScopeKey(ROOT)].needsIngest).toBe(true)

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

  it('loads and guards collection and Shard scopes independently', async () => {
    await loadTopics(ROOT)
    mockApi.clusterDefinitions.mockResolvedValueOnce([{ ...sampleDef, name: 'Shard AI' }])

    await loadTopics(ROOT, 'research')

    expect(mockApi.clusterDefinitions).toHaveBeenLastCalledWith(ROOT, 'research')
    expect(mockApi.customClusters).toHaveBeenLastCalledWith(ROOT, 'research')
    expect(mockApi.topicUnassigned).toHaveBeenLastCalledWith(ROOT, 'research')
    expect(get(topicDefs).map((def) => def.name)).toEqual(['Shard AI'])

    const states = get(topicStatesByScope)
    expect(states[topicScopeKey(ROOT)].definitions[0].name).toBe('AI')
    expect(states[topicScopeKey(ROOT, 'research')].definitions[0].name).toBe('Shard AI')
  })

  it('keeps last good values and records independent read errors', async () => {
    await loadTopics(ROOT)
    mockApi.clusterDefinitions.mockRejectedValueOnce(new Error('bad definitions'))
    mockApi.customClusters.mockRejectedValueOnce(new Error('bad summaries'))

    await loadTopics(ROOT)

    expect(get(topicDefs)).toEqual([sampleDef])
    expect(get(topicSummaries)).toHaveLength(1)
    expect(get(topicErrors)).toMatchObject({
      definitions: 'bad definitions',
      summaries: 'bad summaries'
    })
  })

  it('loads definitions only when computed state is disabled for a missing Shard', async () => {
    await loadTopics(ROOT, 'missing', { includeComputed: false })

    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(ROOT, 'missing')
    expect(mockApi.customClusters).not.toHaveBeenCalled()
    expect(mockApi.topicUnassigned).not.toHaveBeenCalled()
    expect(get(topicComputedEnabled)).toBe(false)
  })

  it('refreshes the active matching scope after external config edits', async () => {
    await loadTopics(ROOT, 'research')
    vi.clearAllMocks()
    mockApi.clusterDefinitions.mockResolvedValue([{ ...sampleDef, name: 'Externally Edited' }])

    await refreshActiveTopicsForConfig(ROOT)

    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(ROOT, 'research')
    expect(mockApi.customClusters).toHaveBeenCalledWith(ROOT, 'research')
    expect(get(topicDefs)[0].name).toBe('Externally Edited')
  })

  it('keeps computed reads disabled when an external edit leaves the Shard missing', async () => {
    await loadTopics(ROOT, 'missing', { includeComputed: false })
    vi.clearAllMocks()
    mockApi.clusterDefinitions.mockResolvedValue([sampleDef])

    await refreshActiveTopicsForConfig(ROOT)

    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(ROOT, 'missing')
    expect(mockApi.customClusters).not.toHaveBeenCalled()
    expect(mockApi.topicUnassigned).not.toHaveBeenCalled()
  })
})

describe('topic mutations', () => {
  it('addTopic writes via CLI, reloads, and flags for re-ingest', async () => {
    await addTopic(ROOT, sampleDef)
    expect(mockApi.addTopic).toHaveBeenCalledWith(ROOT, sampleDef)
    expect(mockApi.clusterDefinitions).toHaveBeenCalled()
    expect(get(topicsNeedIngest)).toBe(true)
    expect(mockInvalidateGraphAnalysis).toHaveBeenCalledOnce()
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
    expect(mockInvalidateGraphAnalysis).not.toHaveBeenCalled()
  })

  it('refreshes and flags the mutated scope without repainting the active scope', async () => {
    let resolveAdd!: () => void
    await loadTopics('/old')
    mockApi.addTopic.mockReturnValueOnce(new Promise<void>((resolve) => (resolveAdd = resolve)))

    const adding = addTopic('/old', sampleDef)
    await loadTopics('/current')
    const callsBeforeResolve = mockApi.clusterDefinitions.mock.calls.length
    resolveAdd()
    await adding

    expect(mockApi.clusterDefinitions).toHaveBeenCalledTimes(callsBeforeResolve + 1)
    expect(get(topicsNeedIngest)).toBe(false)
    expect(get(topicStatesByScope)[topicScopeKey('/old')].needsIngest).toBe(true)
    expect(get(topicStatesByScope)[topicScopeKey('/current')].needsIngest).toBe(false)
  })

  it('passes a Shard id through mutations and keeps computed reads disabled', async () => {
    await loadTopics(ROOT, 'missing', { includeComputed: false })
    vi.clearAllMocks()
    mockApi.addTopic.mockResolvedValue(undefined)
    mockApi.clusterDefinitions.mockResolvedValue([sampleDef])

    await addTopic(ROOT, sampleDef, 'missing')

    expect(mockApi.addTopic).toHaveBeenCalledWith(ROOT, sampleDef, 'missing')
    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(ROOT, 'missing')
    expect(mockApi.customClusters).not.toHaveBeenCalled()
    expect(mockApi.topicUnassigned).not.toHaveBeenCalled()
    expect(get(topicsNeedIngest)).toBe(true)
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
