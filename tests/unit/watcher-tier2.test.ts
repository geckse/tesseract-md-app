import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

const mockApi = {
  status: vi.fn().mockResolvedValue({
    document_count: 10,
    chunk_count: 40,
    vector_count: 40,
    last_updated: 0,
    file_size: 0,
    embedding_config: { provider: 'mock', model: 'm', dimensions: 8 }
  }),
  graphData: vi.fn(),
  tree: vi.fn().mockResolvedValue(null),
  scanAssets: vi.fn().mockResolvedValue(null)
}
Object.defineProperty(globalThis, 'window', { value: { api: mockApi }, writable: true })

import { handleWatcherEvent } from '../../src/renderer/stores/watcher'
import { collections, activeCollectionId, collectionStatus } from '../../src/renderer/stores/collections'
import { fileTree } from '../../src/renderer/stores/files'
import { graphData, graphDataSource, graphLevel } from '../../src/renderer/stores/graph'
import type { FileTree, GraphData, WatchEventReport } from '../../src/renderer/types/cli'

function tree(): FileTree {
  return {
    root: {
      name: '',
      path: '',
      is_dir: true,
      state: null,
      children: [{ name: 'note.md', path: 'note.md', is_dir: false, state: 'modified', children: [] }]
    },
    total_files: 1,
    indexed_count: 0,
    modified_count: 1,
    new_count: 0,
    deleted_count: 0
  }
}

function graph(nodeIds: string[]): GraphData {
  return {
    nodes: nodeIds.map((id) => ({ id, path: id, label: null, cluster_id: null, custom_cluster_id: null, chunk_index: null })),
    edges: [],
    clusters: [],
    level: 'document'
  }
}

function report(over: Partial<WatchEventReport> = {}): WatchEventReport {
  return {
    event_type: 'Modified',
    path: 'note.md',
    success: true,
    chunks_processed: 1,
    duration_ms: 12,
    error: null,
    ...over
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllTimers() // drop any debounce timers leaked from a prior test's module state
  vi.clearAllMocks()
  collections.set([{ id: 'c1', name: 'v', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
  activeCollectionId.set('c1')
  collectionStatus.set(null)
  fileTree.set(tree())
  // Graph already loaded from a normal (cli) load
  graphLevel.set('document')
  graphDataSource.set('cli')
  graphData.set(graph(['note.md', 'other.md']))
  mockApi.graphData.mockResolvedValue(graph(['note.md', 'other.md', 'created.md']))
})

describe('Tier-2 watch-event integration (mdvdb reindex → app patch)', () => {
  it('flips the file tree node to indexed on a successful reindex', () => {
    handleWatcherEvent({ type: 'watch-event', data: report({ event_type: 'Modified', path: 'note.md', success: true }) })
    const node = get(fileTree)!.root.children.find((c) => c.path === 'note.md')
    expect(node?.state).toBe('indexed')
  })

  it('re-fetches the graph after the debounce window', async () => {
    handleWatcherEvent({ type: 'watch-event', data: report({ success: true }) })
    expect(mockApi.graphData).not.toHaveBeenCalled() // debounced
    await vi.advanceTimersByTimeAsync(900)
    expect(mockApi.graphData).toHaveBeenCalledTimes(1)
    // The store received the fresh graph (which GraphView then diffs/patches)
    expect(get(graphData)!.nodes.map((n) => n.id)).toContain('created.md')
  })

  it('refreshes collection status counts', async () => {
    handleWatcherEvent({ type: 'watch-event', data: report({ success: true }) })
    await vi.advanceTimersByTimeAsync(600)
    expect(mockApi.status).toHaveBeenCalledTimes(1)
    expect(get(collectionStatus)?.document_count).toBe(10)
  })

  it('optimistically bumps document_count on a successful Created event', () => {
    collectionStatus.set({
      document_count: 5,
      chunk_count: 0,
      vector_count: 0,
      last_updated: 0,
      file_size: 0,
      embedding_config: { provider: 'mock', model: 'm', dimensions: 8 }
    })
    handleWatcherEvent({ type: 'watch-event', data: report({ event_type: 'Created', path: 'created.md', success: true }) })
    expect(get(collectionStatus)?.document_count).toBe(6)
  })

  it('does NOT touch the tree or graph when the reindex failed', async () => {
    handleWatcherEvent({ type: 'watch-event', data: report({ success: false, error: 'api error' }) })
    const node = get(fileTree)!.root.children.find((c) => c.path === 'note.md')
    expect(node?.state).toBe('modified') // unchanged
    await vi.advanceTimersByTimeAsync(900)
    expect(mockApi.graphData).not.toHaveBeenCalled()
  })

  it('handles the CLI startup line harmlessly', () => {
    // First NDJSON line is {status:'watching',...}, forwarded as a watch-event
    expect(() =>
      handleWatcherEvent({ type: 'watch-event', data: { status: 'watching', message: 'x' } as unknown as WatchEventReport })
    ).not.toThrow()
    // Tree unchanged (no event_type/success)
    expect(get(fileTree)!.root.children[0].state).toBe('modified')
  })
})
