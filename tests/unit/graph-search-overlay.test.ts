import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// ─── Mock window.api ────────────────────────────────────────────────

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

// ─── Import pure utility functions ──────────────────────────────────

import {
  buildSearchScoreMap,
  buildGraphContextMap,
  computeSearchNodeOpacity,
  computeEdgeSearchAlpha,
  getNodePath,
} from '../../src/renderer/lib/graph-search-utils'

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'

// ─── Helpers ────────────────────────────────────────────────────────

function activateCollection(col: { id: string; name: string; path: string; addedAt: number; lastOpenedAt: number }) {
  collections.set([col])
  activeCollectionId.set(col.id)
}

const collection = { id: 'col1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

/**
 * Simulate the component-local graph search logic since GraphView.svelte
 * functions are not exported. This mirrors the implementation faithfully.
 */
function createGraphSearchController() {
  let graphSearchScores = new Map<string, number>()
  let graphSearchContextScores = new Map<string, number>()
  let graphSearchResultCount = 0
  let graphSearchLoading = false
  let graphSearchError: string | null = null
  let graphSearchGeneration = 0
  let graphSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let graphSearchQuery = ''
  let graphSearchVisible = false

  // Mock graph instance
  const graphMock = {
    nodeOpacity: vi.fn(),
    linkOpacity: vi.fn(),
    linkColor: vi.fn(),
    linkDirectionalArrowLength: vi.fn(),
    nodeThreeObject: vi.fn(),
    refresh: vi.fn(),
  }

  function applySelectionDimming() {
    if (graphSearchScores.size > 0 || graphSearchContextScores.size > 0) return
    graphMock.nodeOpacity(0.15)
  }

  function applySearchDimming() {
    // Mirrors GraphView.svelte logic
    const allScores = new Map<string, number>([...graphSearchScores, ...graphSearchContextScores])
    if (allScores.size === 0) return
    // Would apply node/edge dimming via graph instance
  }

  function onGraphSearchInput(query: string) {
    graphSearchQuery = query
    if (graphSearchDebounceTimer !== null) {
      clearTimeout(graphSearchDebounceTimer)
      graphSearchDebounceTimer = null
    }
    if (query.length < 2) {
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
      graphSearchLoading = false
      graphSearchError = null
      return
    }
    graphSearchLoading = true
    graphSearchDebounceTimer = setTimeout(() => {
      graphSearchDebounceTimer = null
      executeGraphSearch(query)
    }, 400)
  }

  async function executeGraphSearch(query: string) {
    const col = get(collections).find(c => c.id === get(activeCollectionId))
    if (!col) {
      graphSearchLoading = false
      return
    }
    const generation = ++graphSearchGeneration
    try {
      const result = await mockApi.search(col.path, query, {
        mode: 'hybrid',
        boostLinks: true,
        expand: 1,
        limit: 50,
      })
      if (generation !== graphSearchGeneration) return
      const directScores = buildSearchScoreMap(result.results ?? [])
      const contextScores = buildGraphContextMap(result.graph_context ?? [], directScores)
      graphSearchScores = directScores
      graphSearchContextScores = contextScores
      graphSearchResultCount = result.total_results ?? (result.results?.length ?? 0)
      graphSearchError = null
      applySearchDimming()
    } catch (err) {
      if (generation !== graphSearchGeneration) return
      graphSearchError = err instanceof Error ? err.message : String(err)
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
    } finally {
      if (generation === graphSearchGeneration) {
        graphSearchLoading = false
      }
    }
  }

  function clearGraphSearch() {
    if (graphSearchDebounceTimer !== null) {
      clearTimeout(graphSearchDebounceTimer)
      graphSearchDebounceTimer = null
    }
    graphSearchGeneration++
    graphSearchQuery = ''
    graphSearchScores = new Map()
    graphSearchContextScores = new Map()
    graphSearchResultCount = 0
    graphSearchLoading = false
    graphSearchError = null
    graphSearchVisible = false
    applySelectionDimming()
    graphMock.refresh()
  }

  return {
    get scores() { return graphSearchScores },
    get contextScores() { return graphSearchContextScores },
    get resultCount() { return graphSearchResultCount },
    get loading() { return graphSearchLoading },
    get error() { return graphSearchError },
    get generation() { return graphSearchGeneration },
    get query() { return graphSearchQuery },
    get visible() { return graphSearchVisible },
    graphMock,
    onGraphSearchInput,
    executeGraphSearch,
    clearGraphSearch,
    applySelectionDimming,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
  collections.set([])
  activeCollectionId.set(null)
})

// ─── Tests ──────────────────────────────────────────────────────────

describe('graph search overlay', () => {

  describe('executeGraphSearch calls window.api.search with correct params', () => {
    it('passes mode:hybrid, boostLinks:true, expand:1, limit:50', async () => {
      activateCollection(collection)
      mockApi.search.mockResolvedValue({ results: [], total_results: 0 })

      const ctrl = createGraphSearchController()
      await ctrl.executeGraphSearch('test query')

      expect(mockApi.search).toHaveBeenCalledTimes(1)
      expect(mockApi.search).toHaveBeenCalledWith('/test', 'test query', {
        mode: 'hybrid',
        boostLinks: true,
        expand: 1,
        limit: 50,
      })
    })
  })

  describe('buildSearchScoreMap takes max score per file from multiple chunks', () => {
    it('keeps highest score when same file has multiple chunks', () => {
      const results = [
        { file: { path: 'a.md' }, score: 0.5, section: 'intro', content: '' },
        { file: { path: 'a.md' }, score: 0.9, section: 'body', content: '' },
        { file: { path: 'b.md' }, score: 0.3, section: 'intro', content: '' },
      ] as any

      const map = buildSearchScoreMap(results)

      expect(map.get('a.md')).toBe(0.9)
      expect(map.get('b.md')).toBe(0.3)
      expect(map.size).toBe(2)
    })

    it('handles single chunk per file', () => {
      const results = [
        { file: { path: 'x.md' }, score: 0.7, section: '', content: '' },
      ] as any

      const map = buildSearchScoreMap(results)
      expect(map.get('x.md')).toBe(0.7)
    })
  })

  describe('buildGraphContextMap attenuates by hop distance and skips direct matches', () => {
    it('computes 0.4/hop_distance and skips direct matches', () => {
      const directScores = new Map([['a.md', 0.9]])
      const contextItems = [
        { file: { path: 'a.md' }, hop_distance: 1 }, // direct match — should be skipped
        { file: { path: 'b.md' }, hop_distance: 1 }, // 0.4 / 1 = 0.4
        { file: { path: 'c.md' }, hop_distance: 2 }, // 0.4 / 2 = 0.2
      ] as any

      const map = buildGraphContextMap(contextItems, directScores)

      expect(map.has('a.md')).toBe(false) // skipped — direct match
      expect(map.get('b.md')).toBeCloseTo(0.4)
      expect(map.get('c.md')).toBeCloseTo(0.2)
    })

    it('takes max score for same file at different hops', () => {
      const contextItems = [
        { file: { path: 'b.md' }, hop_distance: 2 }, // 0.2
        { file: { path: 'b.md' }, hop_distance: 1 }, // 0.4 — higher
      ] as any

      const map = buildGraphContextMap(contextItems, new Map())
      expect(map.get('b.md')).toBeCloseTo(0.4)
    })
  })

  describe('applySelectionDimming is no-op when search scores present', () => {
    it('does not call graph.nodeOpacity when graphSearchScores is non-empty', () => {
      const ctrl = createGraphSearchController()

      // Simulate having search scores by executing a search first
      // Instead, we directly test the applySelectionDimming guard:
      // Set scores by running a search
      activateCollection(collection)
      mockApi.search.mockResolvedValue({
        results: [{ file: { path: 'a.md' }, score: 0.8 }],
        total_results: 1,
      })

      // We need scores populated — do it via executeGraphSearch
      return ctrl.executeGraphSearch('test').then(() => {
        ctrl.graphMock.nodeOpacity.mockClear()
        ctrl.applySelectionDimming()
        // Should be a no-op because graphSearchScores is non-empty
        expect(ctrl.graphMock.nodeOpacity).not.toHaveBeenCalled()
      })
    })
  })

  describe('clearGraphSearch resets state and restores dimming', () => {
    it('clears all maps, increments generation, calls applySelectionDimming', async () => {
      activateCollection(collection)
      mockApi.search.mockResolvedValue({
        results: [{ file: { path: 'a.md' }, score: 0.8 }],
        total_results: 1,
      })

      const ctrl = createGraphSearchController()
      await ctrl.executeGraphSearch('test')

      expect(ctrl.scores.size).toBeGreaterThan(0)
      const genBefore = ctrl.generation

      ctrl.clearGraphSearch()

      expect(ctrl.scores.size).toBe(0)
      expect(ctrl.contextScores.size).toBe(0)
      expect(ctrl.resultCount).toBe(0)
      expect(ctrl.loading).toBe(false)
      expect(ctrl.error).toBeNull()
      expect(ctrl.query).toBe('')
      expect(ctrl.visible).toBe(false)
      expect(ctrl.generation).toBeGreaterThan(genBefore)
      // applySelectionDimming was called (scores are now empty so nodeOpacity runs)
      expect(ctrl.graphMock.nodeOpacity).toHaveBeenCalledWith(0.15)
      expect(ctrl.graphMock.refresh).toHaveBeenCalled()
    })
  })

  describe('debounce fires after 400ms', () => {
    it('does not fire before 400ms, fires exactly once after', () => {
      vi.useFakeTimers()
      activateCollection(collection)
      mockApi.search.mockResolvedValue({ results: [], total_results: 0 })

      const ctrl = createGraphSearchController()
      ctrl.onGraphSearchInput('test')

      vi.advanceTimersByTime(399)
      expect(mockApi.search).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(mockApi.search).toHaveBeenCalledTimes(1)
    })

    it('resets timer on subsequent input within 400ms', () => {
      vi.useFakeTimers()
      activateCollection(collection)
      mockApi.search.mockResolvedValue({ results: [], total_results: 0 })

      const ctrl = createGraphSearchController()
      ctrl.onGraphSearchInput('te')
      vi.advanceTimersByTime(200)
      ctrl.onGraphSearchInput('tes')
      vi.advanceTimersByTime(200)
      ctrl.onGraphSearchInput('test')

      // 200ms since last input — not yet
      vi.advanceTimersByTime(199)
      expect(mockApi.search).not.toHaveBeenCalled()

      vi.advanceTimersByTime(201)
      expect(mockApi.search).toHaveBeenCalledTimes(1)
    })
  })

  describe('generation counter discards stale results', () => {
    it('only applies results from the latest search', async () => {
      vi.useFakeTimers()
      activateCollection(collection)

      let resolveFirst: (v: unknown) => void
      const firstPromise = new Promise((r) => { resolveFirst = r! })

      const secondResult = {
        results: [{ file: { path: 'b.md' }, score: 0.7 }],
        total_results: 1,
      }

      mockApi.search
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce(secondResult)

      const ctrl = createGraphSearchController()

      // Start first search
      const first = ctrl.executeGraphSearch('first')

      // Start second search (supersedes first)
      const second = ctrl.executeGraphSearch('second')

      // Resolve second
      await vi.advanceTimersByTimeAsync(0)
      await second

      expect(ctrl.scores.has('b.md')).toBe(true)

      // Resolve first (stale)
      resolveFirst!({
        results: [{ file: { path: 'stale.md' }, score: 0.9 }],
        total_results: 1,
      })
      await vi.advanceTimersByTimeAsync(0)
      await first

      // Stale result should be ignored
      expect(ctrl.scores.has('stale.md')).toBe(false)
      expect(ctrl.scores.has('b.md')).toBe(true)
    })
  })

  describe('queries under 2 chars clear results and stop loading', () => {
    it('does not call API for 1-char query', () => {
      vi.useFakeTimers()
      activateCollection(collection)

      const ctrl = createGraphSearchController()
      ctrl.onGraphSearchInput('a')

      vi.advanceTimersByTime(500)
      expect(mockApi.search).not.toHaveBeenCalled()
      expect(ctrl.loading).toBe(false)
    })

    it('clears scores for short queries', async () => {
      activateCollection(collection)
      mockApi.search.mockResolvedValue({
        results: [{ file: { path: 'a.md' }, score: 0.5 }],
        total_results: 1,
      })

      const ctrl = createGraphSearchController()
      await ctrl.executeGraphSearch('test')
      expect(ctrl.scores.size).toBeGreaterThan(0)

      ctrl.onGraphSearchInput('a')
      expect(ctrl.scores.size).toBe(0)
      expect(ctrl.resultCount).toBe(0)
    })
  })

  describe('search dimming priority over selection dimming', () => {
    it('applySelectionDimming is no-op when search scores exist', async () => {
      activateCollection(collection)
      mockApi.search.mockResolvedValue({
        results: [{ file: { path: 'x.md' }, score: 0.6 }],
        total_results: 1,
      })

      const ctrl = createGraphSearchController()
      await ctrl.executeGraphSearch('query')

      // Search scores are populated
      expect(ctrl.scores.size).toBeGreaterThan(0)

      ctrl.graphMock.nodeOpacity.mockClear()
      ctrl.applySelectionDimming()

      // nodeOpacity should NOT be called — search takes priority
      expect(ctrl.graphMock.nodeOpacity).not.toHaveBeenCalled()
    })

    it('applySelectionDimming runs when no search scores', () => {
      const ctrl = createGraphSearchController()
      ctrl.applySelectionDimming()
      expect(ctrl.graphMock.nodeOpacity).toHaveBeenCalledWith(0.15)
    })
  })
})
