import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  search: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  graphData: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  graphViewActive,
  graphData,
  graphLoading,
  graphError,
  graphSelectedNode,
  graphColoringMode,
  graphHighlightedFolder,
  graphEdgeFilter,
  graphSemanticEdgesEnabled,
  graphEdgeWeakThreshold,
  loadGraphData,
  toggleGraphView,
  selectGraphNode,
  resetGraphState,
  cycleColoringMode,
  setGraphHighlightedFolder,
  toggleEdgeClusterFilter,
  clearEdgeFilter,
  toggleSemanticEdges,
} from '../../src/renderer/stores/graph'


import { collections, activeCollectionId } from '../../src/renderer/stores/collections'

function resetStores() {
  graphViewActive.set(false)
  graphData.set(null)
  graphLoading.set(false)
  graphError.set(null)
  graphSelectedNode.set(null)
  graphColoringMode.set('cluster')
  graphHighlightedFolder.set(null)
  graphEdgeFilter.set(new Set())
  graphSemanticEdgesEnabled.set(true)
  graphEdgeWeakThreshold.set(0.3)
  collections.set([])
  activeCollectionId.set(null)
}

function activateCollection(col: { id: string; name: string; path: string; addedAt: number; lastOpenedAt: number }) {
  collections.set([col])
  activeCollectionId.set(col.id)
}

const collection = { id: 'col1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

const sampleGraphData = {
  nodes: [
    { path: 'a.md', cluster_id: 0 },
    { path: 'b.md', cluster_id: 1 },
  ],
  edges: [{ source: 'a.md', target: 'b.md' }],
  clusters: [{ id: 0, label: 'Cluster 0', keywords: ['test'] }],
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
})

describe('graph store', () => {
  describe('loadGraphData', () => {
    it('loads graph data for active collection', async () => {
      activateCollection(collection)
      mockApi.graphData.mockResolvedValue(sampleGraphData)

      await loadGraphData()

      expect(mockApi.graphData).toHaveBeenCalledWith('/test', 'document', undefined)
      expect(get(graphData)).toEqual(sampleGraphData)
      expect(get(graphLoading)).toBe(false)
      expect(get(graphError)).toBeNull()
    })

    it('does nothing when no active collection', async () => {
      await loadGraphData()

      expect(mockApi.graphData).not.toHaveBeenCalled()
      expect(get(graphLoading)).toBe(false)
    })

    it('sets error on failure', async () => {
      activateCollection(collection)
      mockApi.graphData.mockRejectedValue(new Error('CLI failed'))

      await loadGraphData()

      expect(get(graphError)).toBe('CLI failed')
      expect(get(graphData)).toBeNull()
      expect(get(graphLoading)).toBe(false)
    })

    it('discards stale results', async () => {
      activateCollection(collection)

      let resolveFirst: (v: unknown) => void
      const firstPromise = new Promise((r) => { resolveFirst = r })

      mockApi.graphData
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce(sampleGraphData)

      // Start first load
      const firstLoad = loadGraphData()

      // Start second load (supersedes first)
      const secondLoad = loadGraphData()

      // Resolve second
      await secondLoad

      expect(get(graphData)).toEqual(sampleGraphData)

      // Resolve first — should be ignored
      resolveFirst!({ nodes: [], edges: [], clusters: [] })
      await firstLoad

      // Results should still be from second load
      expect(get(graphData)).toEqual(sampleGraphData)
    })
  })

  describe('toggleGraphView', () => {
    it('activates graph view and triggers load', () => {
      activateCollection(collection)
      mockApi.graphData.mockResolvedValue(sampleGraphData)

      toggleGraphView()

      expect(get(graphViewActive)).toBe(true)
      expect(mockApi.graphData).toHaveBeenCalled()
    })

    it('deactivates graph view and clears selection', () => {
      graphViewActive.set(true)
      graphSelectedNode.set({ path: 'a.md', cluster_id: 0 })

      toggleGraphView()

      expect(get(graphViewActive)).toBe(false)
      expect(get(graphSelectedNode)).toBeNull()
    })
  })

  describe('selectGraphNode', () => {
    it('sets selected node', () => {
      const node = { path: 'a.md', cluster_id: 0 }
      selectGraphNode(node)
      expect(get(graphSelectedNode)).toEqual(node)
    })

    it('clears selected node with null', () => {
      graphSelectedNode.set({ path: 'a.md', cluster_id: 0 })
      selectGraphNode(null)
      expect(get(graphSelectedNode)).toBeNull()
    })
  })

  describe('resetGraphState', () => {
    it('resets all graph state to defaults', () => {
      graphViewActive.set(true)
      graphData.set(sampleGraphData)
      graphLoading.set(true)
      graphError.set('some error')
      graphSelectedNode.set({ path: 'a.md', cluster_id: 0 })
      graphColoringMode.set('none')
      graphHighlightedFolder.set('/some/folder')

      resetGraphState()

      expect(get(graphViewActive)).toBe(false)
      expect(get(graphData)).toBeNull()
      expect(get(graphLoading)).toBe(false)
      expect(get(graphError)).toBeNull()
      expect(get(graphSelectedNode)).toBeNull()
      expect(get(graphColoringMode)).toBe('cluster')
      expect(get(graphHighlightedFolder)).toBeNull()
      expect(get(graphEdgeFilter).size).toBe(0)
      expect(get(graphSemanticEdgesEnabled)).toBe(true)
      expect(get(graphEdgeWeakThreshold)).toBe(0.3)
    })
  })

  describe('cycleColoringMode', () => {
    it('cycles through cluster → folder → none → cluster', () => {
      graphColoringMode.set('cluster')

      cycleColoringMode()
      expect(get(graphColoringMode)).toBe('folder')

      cycleColoringMode()
      expect(get(graphColoringMode)).toBe('none')

      cycleColoringMode()
      expect(get(graphColoringMode)).toBe('cluster')
    })
  })

  describe('setGraphHighlightedFolder', () => {
    it('sets highlighted folder path', () => {
      setGraphHighlightedFolder('/docs')
      expect(get(graphHighlightedFolder)).toBe('/docs')
    })

    it('toggles same path to null', () => {
      setGraphHighlightedFolder('/docs')
      expect(get(graphHighlightedFolder)).toBe('/docs')

      setGraphHighlightedFolder('/docs')
      expect(get(graphHighlightedFolder)).toBeNull()
    })

    it('replaces with different path', () => {
      setGraphHighlightedFolder('/docs')
      expect(get(graphHighlightedFolder)).toBe('/docs')

      setGraphHighlightedFolder('/notes')
      expect(get(graphHighlightedFolder)).toBe('/notes')
    })

    it('clears with null', () => {
      setGraphHighlightedFolder('/docs')
      expect(get(graphHighlightedFolder)).toBe('/docs')

      setGraphHighlightedFolder(null)
      expect(get(graphHighlightedFolder)).toBeNull()
    })
  })

  describe('toggleEdgeClusterFilter', () => {
    it('adds cluster ID to empty filter set', () => {
      toggleEdgeClusterFilter(0)
      expect(get(graphEdgeFilter)).toEqual(new Set([0]))
    })

    it('adds multiple cluster IDs', () => {
      toggleEdgeClusterFilter(0)
      toggleEdgeClusterFilter(2)
      expect(get(graphEdgeFilter)).toEqual(new Set([0, 2]))
    })

    it('removes cluster ID if already present', () => {
      toggleEdgeClusterFilter(0)
      toggleEdgeClusterFilter(1)
      toggleEdgeClusterFilter(0)
      expect(get(graphEdgeFilter)).toEqual(new Set([1]))
    })

    it('results in empty set when all removed', () => {
      toggleEdgeClusterFilter(0)
      toggleEdgeClusterFilter(0)
      expect(get(graphEdgeFilter).size).toBe(0)
    })
  })

  describe('clearEdgeFilter', () => {
    it('clears all edge cluster filters', () => {
      toggleEdgeClusterFilter(0)
      toggleEdgeClusterFilter(1)
      toggleEdgeClusterFilter(2)

      clearEdgeFilter()

      expect(get(graphEdgeFilter).size).toBe(0)
    })

    it('is a no-op when already empty', () => {
      clearEdgeFilter()
      expect(get(graphEdgeFilter).size).toBe(0)
    })
  })

  describe('toggleSemanticEdges', () => {
    it('disables semantic edges when enabled', () => {
      expect(get(graphSemanticEdgesEnabled)).toBe(true)
      toggleSemanticEdges()
      expect(get(graphSemanticEdgesEnabled)).toBe(false)
    })

    it('enables semantic edges when disabled', () => {
      graphSemanticEdgesEnabled.set(false)
      toggleSemanticEdges()
      expect(get(graphSemanticEdgesEnabled)).toBe(true)
    })

    it('toggles back and forth', () => {
      toggleSemanticEdges()
      expect(get(graphSemanticEdgesEnabled)).toBe(false)
      toggleSemanticEdges()
      expect(get(graphSemanticEdgesEnabled)).toBe(true)
    })
  })

  describe('graphEdgeWeakThreshold', () => {
    it('defaults to 0.3', () => {
      expect(get(graphEdgeWeakThreshold)).toBe(0.3)
    })

    it('can be set to a custom value', () => {
      graphEdgeWeakThreshold.set(0.5)
      expect(get(graphEdgeWeakThreshold)).toBe(0.5)
    })
  })
})
