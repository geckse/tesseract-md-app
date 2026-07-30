import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { FileTree, ShardInfo } from '../../src/renderer/types/cli'

const mockApi = {
  listShards: vi.fn(),
  getActiveShardId: vi.fn(),
  setActiveShardId: vi.fn(),
  addShard: vi.fn(),
  updateShard: vi.fn(),
  removeShard: vi.fn(),
  retargetShards: vi.fn(),
  onShardsInvalidated: vi.fn(),
  clusterDefinitions: vi.fn(),
  customClusters: vi.fn(),
  topicUnassigned: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import { activeCollectionId, collections } from '../../src/renderer/stores/collections'
import {
  type ProjectConfigInvalidation,
  activeScopePath,
  activeShardId,
  addShardDefinition,
  buildShardTree,
  clearShardState,
  intersectShardScope,
  isPathInShard,
  nextShardId,
  normalizeShardDefinitionPath,
  pathRelativeToShard,
  projectConfigInvalidation,
  refreshShards,
  restoreShardForCollection,
  setActiveShard,
  setupShardInvalidationListener,
  shardErrorsByCollection,
  shardsByCollection,
  shardsLoadingByCollection
} from '../../src/renderer/stores/shards'
import {
  fileStateCounts,
  fileTree,
  flatFileList,
  scopedFileCount,
  scopedFlatFileList,
  unifiedTree
} from '../../src/renderer/stores/files'
import { resetTopicsState, selectTopicScope, topicDefs } from '../../src/renderer/stores/topics'
import { graphDataDirty, resetGraphState } from '../../src/renderer/stores/graph'

const collection = {
  id: 'vault',
  name: 'Vault',
  path: '/vault',
  addedAt: 1,
  lastOpenedAt: 1
}

function shard(overrides: Partial<ShardInfo> = {}): ShardInfo {
  return {
    id: 'research',
    name: 'Research',
    path: 'work/research',
    parent_id: null,
    exists: true,
    ...overrides
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function scopedTree(): FileTree {
  return {
    root: {
      name: '.',
      path: '.',
      is_dir: true,
      state: null,
      children: [
        {
          name: 'docs',
          path: 'docs',
          is_dir: true,
          state: null,
          children: [
            {
              name: 'research',
              path: 'docs/research',
              is_dir: true,
              state: null,
              children: [
                {
                  name: 'inside.md',
                  path: 'docs/research/inside.md',
                  is_dir: false,
                  state: 'indexed',
                  children: []
                }
              ]
            }
          ]
        },
        {
          name: 'docs-old',
          path: 'docs-old',
          is_dir: true,
          state: null,
          children: [
            {
              name: 'outside.md',
              path: 'docs-old/outside.md',
              is_dir: false,
              state: 'modified',
              children: []
            }
          ]
        }
      ]
    },
    total_files: 2,
    indexed_count: 1,
    modified_count: 1,
    new_count: 0,
    deleted_count: 0
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockApi.setActiveShardId.mockResolvedValue(undefined)
  clearShardState()
  resetTopicsState()
  resetGraphState()
  collections.set([collection])
  activeCollectionId.set(collection.id)
  fileTree.set(null)
})

describe('Shard path and hierarchy helpers', () => {
  it('matches segment boundaries and normalizes Windows separators', () => {
    expect(isPathInShard('docs/note.md', 'docs')).toBe(true)
    expect(isPathInShard('docs', 'docs')).toBe(true)
    expect(isPathInShard('docs-old/note.md', 'docs')).toBe(false)
    expect(isPathInShard('work\\research\\note.md', 'work/research')).toBe(true)
    expect(pathRelativeToShard('work/research/note.md', 'work/research')).toBe('note.md')
  })

  it('normalizes relative definition paths without hiding escapes or absolutes', () => {
    expect(normalizeShardDefinitionPath('work\\research/')).toBe('work/research')
    expect(() => normalizeShardDefinitionPath('/work/research')).toThrow(
      'relative to the collection'
    )
    expect(() => normalizeShardDefinitionPath('../research')).toThrow('cannot leave the collection')
    expect(() => normalizeShardDefinitionPath('.markdownvdb/cache')).toThrow('cannot be a Shard')
  })

  it('builds nested rows from derived parent ids in deterministic path order', () => {
    const root = shard({ id: 'work', name: 'Work', path: 'work' })
    const child = shard({ parent_id: 'work' })
    const peer = shard({ id: 'archive', name: 'Archive', path: 'archive' })

    const tree = buildShardTree([child, root, peer])

    expect(tree.map((node) => node.shard.id)).toEqual(['archive', 'work'])
    expect(tree[1].children.map((node) => node.shard.id)).toEqual(['research'])
  })

  it('creates stable ids and resolves collisions predictably', () => {
    expect(nextShardId('Résumé Notes', [])).toBe('resume-notes')
    expect(
      nextShardId('Research', [
        shard(),
        shard({ id: 'research-2', name: 'Research 2', path: 'other' })
      ])
    ).toBe('research-3')
  })

  it('intersects graph filters with the Shard as a hard outer boundary', () => {
    expect(intersectShardScope('docs/research', null)).toEqual({
      path: 'docs/research',
      disjoint: false
    })
    expect(intersectShardScope('docs/research', 'docs')).toEqual({
      path: 'docs/research',
      disjoint: false
    })
    expect(intersectShardScope('docs/research', 'docs/research/raw')).toEqual({
      path: 'docs/research/raw',
      disjoint: false
    })
    expect(intersectShardScope('docs/research', 'docs-old')).toEqual({
      path: null,
      disjoint: true
    })
  })
})

describe('Shard selection and refresh', () => {
  it('ignores a stale response when a newer refresh finishes first', async () => {
    const first = deferred<{ shards: ShardInfo[]; total_shards: number }>()
    const second = deferred<{ shards: ShardInfo[]; total_shards: number }>()
    mockApi.listShards.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const staleRefresh = refreshShards(collection.id)
    const currentRefresh = refreshShards(collection.id)
    second.resolve({ shards: [shard({ name: 'Current' })], total_shards: 1 })
    await currentRefresh
    first.resolve({ shards: [shard({ name: 'Stale' })], total_shards: 1 })
    await staleRefresh

    expect(get(shardsByCollection)[collection.id]?.[0].name).toBe('Current')
    expect(get(shardsLoadingByCollection)[collection.id]).toBe(false)
    expect(get(shardErrorsByCollection)[collection.id]).toBeNull()
  })

  it('restores an existing Shard and persists explicit selection changes', async () => {
    mockApi.getActiveShardId.mockResolvedValue('research')
    mockApi.listShards.mockResolvedValue({ shards: [shard()], total_shards: 1 })

    await restoreShardForCollection(collection.id)
    expect(get(activeShardId)).toBe('research')
    expect(get(activeScopePath)).toBe('work/research')

    await setActiveShard(null)
    expect(mockApi.setActiveShardId).toHaveBeenCalledWith(collection.id, null)
    expect(get(activeShardId)).toBeNull()
  })

  it('falls back to collection root when the persisted Shard is missing', async () => {
    mockApi.getActiveShardId.mockResolvedValue('research')
    mockApi.listShards.mockResolvedValue({
      shards: [shard({ exists: false })],
      total_shards: 1
    })

    await restoreShardForCollection(collection.id)

    expect(get(activeShardId)).toBeNull()
    expect(mockApi.setActiveShardId).toHaveBeenCalledWith(collection.id, null)
  })

  it('uses deterministic generated ids when creating through the CLI bridge', async () => {
    shardsByCollection.set({
      [collection.id]: [
        shard(),
        shard({ id: 'research-2', name: 'Research 2', path: 'work/research-2' })
      ]
    })
    mockApi.addShard.mockResolvedValue({ action: 'added', shards: [] })
    mockApi.listShards.mockResolvedValue({ shards: [], total_shards: 0 })

    await addShardDefinition('Research', 'work\\research-3', true)

    expect(mockApi.addShard).toHaveBeenCalledWith(
      collection.path,
      'research-3',
      'work/research-3',
      {
        name: 'Research',
        createDir: true
      }
    )
  })

  it('never falls back to the active collection for an explicit stale collection id', async () => {
    await expect(
      addShardDefinition('Research', 'work/research', false, 'removed-vault')
    ).rejects.toThrow('Collection not found: removed-vault')
    expect(mockApi.addShard).not.toHaveBeenCalled()
  })

  it('fans one project-config invalidation out to Shards, active Topics, and graph', async () => {
    let invalidate!: (event: { root: string }) => void
    mockApi.onShardsInvalidated.mockImplementation(
      (callback: (event: { root: string }) => void) => {
        invalidate = callback
      }
    )
    mockApi.listShards.mockResolvedValue({ shards: [shard()], total_shards: 1 })
    mockApi.clusterDefinitions.mockResolvedValue([
      {
        name: 'External Topic',
        seeds: ['external'],
        description: null,
        threshold: null
      }
    ])
    mockApi.customClusters.mockResolvedValue([])
    mockApi.topicUnassigned.mockResolvedValue({ count: 0, paths: [] })
    selectTopicScope(collection.path, 'research')

    setupShardInvalidationListener()
    invalidate({ root: collection.path })

    await vi.waitFor(() => {
      expect(get(topicDefs)[0]?.name).toBe('External Topic')
    })
    expect(mockApi.onShardsInvalidated).toHaveBeenCalledOnce()
    expect(mockApi.listShards).toHaveBeenCalledWith(collection.path)
    expect(mockApi.clusterDefinitions).toHaveBeenCalledWith(collection.path, 'research')
    expect(get(graphDataDirty)).toBe(true)
  })

  it('emits every registered-root config edit with a monotonic identity', () => {
    let invalidate!: (event: { root: string }) => void
    mockApi.onShardsInvalidated.mockImplementation(
      (callback: (event: { root: string }) => void) => {
        invalidate = callback
      }
    )
    mockApi.listShards.mockResolvedValue({ shards: [], total_shards: 0 })
    const events: ProjectConfigInvalidation[] = []
    const unsubscribe = projectConfigInvalidation.subscribe((event) => {
      if (event) events.push(event)
    })

    setupShardInvalidationListener()
    invalidate({ root: '/not-registered' })
    invalidate({ root: collection.path })
    invalidate({ root: collection.path })
    unsubscribe()

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      collectionId: collection.id,
      root: collection.path
    })
    expect(events[1].generation).toBe(events[0].generation + 1)
  })
})

describe('scoped file tree lens', () => {
  it('shows only the Shard subtree while retaining the full catalog', () => {
    fileTree.set(scopedTree())
    shardsByCollection.set({
      [collection.id]: [shard({ id: 'docs', name: 'Docs', path: 'docs', parent_id: null })]
    })
    activeShardId.set('docs')

    expect(get(unifiedTree)?.path).toBe('docs')
    expect(get(unifiedTree)?.children.map((node) => node.path)).toEqual(['docs/research'])
    expect(get(scopedFlatFileList).map((node) => node.path)).toEqual(['docs/research/inside.md'])
    expect(get(scopedFileCount)).toBe(1)
    expect(get(fileStateCounts)).toEqual({
      indexed: 1,
      modified: 0,
      new: 0,
      deleted: 0
    })
    expect(get(flatFileList).map((node) => node.path)).toEqual([
      'docs/research/inside.md',
      'docs-old/outside.md'
    ])
  })
})
