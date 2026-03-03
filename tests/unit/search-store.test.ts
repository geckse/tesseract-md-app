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
}

// Mock localStorage
const localStorageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => localStorageMap.set(key, value)),
  removeItem: vi.fn((key: string) => localStorageMap.delete(key)),
  clear: vi.fn(() => localStorageMap.clear()),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi, localStorage: mockLocalStorage },
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

import {
  searchOpen,
  searchQuery,
  searchResults,
  searchLoading,
  searchMode,
  highlightedIndex,
  searchError,
  restoreSearchMode,
  setSearchMode,
  executeSearch,
  clearSearch,
} from '../../src/renderer/stores/search'

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'

function resetStores() {
  searchOpen.set(false)
  searchQuery.set('')
  searchResults.set(null)
  searchLoading.set(false)
  searchMode.set('hybrid')
  highlightedIndex.set(-1)
  searchError.set(null)
  collections.set([])
  activeCollectionId.set(null)
}

function activateCollection(col: { id: string; name: string; path: string; addedAt: number; lastOpenedAt: number }) {
  collections.set([col])
  activeCollectionId.set(col.id)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  localStorageMap.clear()
  // Clear any pending timers from previous tests
  vi.useRealTimers()
})

describe('search store', () => {
  const collection = { id: 'col1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

  describe('debounce', () => {
    it('triggers only one API call after 300ms when typing fast', () => {
      vi.useFakeTimers()
      activateCollection(collection)
      mockApi.search.mockResolvedValue({ results: [], query: 'test', total_results: 0 })

      executeSearch('t')
      executeSearch('te')
      executeSearch('tes')
      executeSearch('test')

      // Before 300ms, no API call
      vi.advanceTimersByTime(299)
      expect(mockApi.search).not.toHaveBeenCalled()

      // At 300ms, exactly one call
      vi.advanceTimersByTime(1)
      expect(mockApi.search).toHaveBeenCalledTimes(1)
      expect(mockApi.search).toHaveBeenCalledWith('/test', 'test', { mode: 'hybrid' })
    })
  })

  describe('min chars', () => {
    it('does not trigger API call for queries under 2 chars', () => {
      vi.useFakeTimers()
      activateCollection(collection)

      executeSearch('a')

      vi.advanceTimersByTime(500)
      expect(mockApi.search).not.toHaveBeenCalled()
      expect(get(searchLoading)).toBe(false)
    })

    it('clears results for short queries', () => {
      searchResults.set({ results: [], query: 'old', total_results: 0 } as never)

      executeSearch('a')

      expect(get(searchResults)).toBeNull()
    })
  })

  describe('searchMode passed correctly', () => {
    it('passes current search mode to API options', () => {
      vi.useFakeTimers()
      activateCollection(collection)
      searchMode.set('semantic')
      mockApi.search.mockResolvedValue({ results: [], query: 'test', total_results: 0 })

      executeSearch('test')
      vi.advanceTimersByTime(300)

      expect(mockApi.search).toHaveBeenCalledWith('/test', 'test', { mode: 'semantic' })
    })

    it('passes lexical mode correctly', () => {
      vi.useFakeTimers()
      activateCollection(collection)
      searchMode.set('lexical')
      mockApi.search.mockResolvedValue({ results: [], query: 'test', total_results: 0 })

      executeSearch('test query')
      vi.advanceTimersByTime(300)

      expect(mockApi.search).toHaveBeenCalledWith('/test', 'test query', { mode: 'lexical' })
    })
  })

  describe('clearSearch', () => {
    it('resets query, results, loading, and open state', () => {
      searchQuery.set('test')
      searchResults.set({ results: [], query: 'test', total_results: 0 } as never)
      searchLoading.set(true)
      searchOpen.set(true)
      searchError.set('some error')
      highlightedIndex.set(3)

      clearSearch()

      expect(get(searchQuery)).toBe('')
      expect(get(searchResults)).toBeNull()
      expect(get(searchLoading)).toBe(false)
      expect(get(searchOpen)).toBe(false)
      expect(get(searchError)).toBeNull()
      expect(get(highlightedIndex)).toBe(-1)
    })
  })

  describe('error handling', () => {
    it('sets error and clears results when search rejects', async () => {
      vi.useFakeTimers()
      activateCollection(collection)
      mockApi.search.mockRejectedValue(new Error('Network error'))

      executeSearch('test')
      vi.advanceTimersByTime(300)

      // Flush the promise
      await vi.advanceTimersByTimeAsync(0)

      expect(get(searchResults)).toBeNull()
      expect(get(searchLoading)).toBe(false)
      expect(get(searchError)).toBe('Network error')
    })
  })

  describe('stale result cancellation', () => {
    it('second search supersedes first', async () => {
      vi.useFakeTimers()
      activateCollection(collection)

      let resolveFirst: (v: unknown) => void
      const firstPromise = new Promise((r) => { resolveFirst = r })
      const secondResult = { results: [{ path: 'b.md' }], query: 'second', total_results: 1 }

      mockApi.search
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce(secondResult)

      // First search
      executeSearch('first')
      vi.advanceTimersByTime(300)

      // Second search (supersedes first)
      executeSearch('second')
      vi.advanceTimersByTime(300)

      // Resolve second first
      await vi.advanceTimersByTimeAsync(0)

      expect(get(searchResults)).toEqual(secondResult)

      // Now resolve first — should be ignored
      resolveFirst!({ results: [{ path: 'a.md' }], query: 'first', total_results: 1 })
      await vi.advanceTimersByTimeAsync(0)

      // Results should still be from second search
      expect(get(searchResults)).toEqual(secondResult)
    })
  })

  describe('mode persistence', () => {
    it('persists search mode to localStorage', () => {
      activateCollection(collection)

      setSearchMode('semantic')

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('mdvdb-search-mode-col1', 'semantic')
      expect(get(searchMode)).toBe('semantic')
    })

    it('restores search mode from localStorage', () => {
      localStorageMap.set('mdvdb-search-mode-col1', 'lexical')

      restoreSearchMode('col1')

      expect(get(searchMode)).toBe('lexical')
    })

    it('ignores invalid stored values', () => {
      localStorageMap.set('mdvdb-search-mode-col1', 'invalid')

      restoreSearchMode('col1')

      expect(get(searchMode)).toBe('hybrid')
    })

    it('does not persist when no active collection', () => {
      setSearchMode('lexical')

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
      expect(get(searchMode)).toBe('lexical')
    })
  })
})
