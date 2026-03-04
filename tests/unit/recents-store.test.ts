import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  listRecents: vi.fn(),
  addRecent: vi.fn(),
  clearRecents: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

// Mock collections stores
const mockCollections = [
  { id: 'a', name: 'alpha', path: '/alpha', addedAt: 1, lastOpenedAt: 1 },
  { id: 'b', name: 'beta', path: '/beta', addedAt: 2, lastOpenedAt: 2 }
]

vi.mock('../../src/renderer/stores/collections', () => ({
  activeCollection: { subscribe: vi.fn() },
  activeCollectionId: { subscribe: vi.fn() },
  collections: { subscribe: (fn: any) => fn(mockCollections) }
}))

// Mock files stores
vi.mock('../../src/renderer/stores/files', () => ({
  selectedFilePath: { subscribe: vi.fn() }
}))

import {
  recentFiles,
  recentsLoading,
  sortedRecents,
  loadRecents,
  trackRecent,
  clearAllRecents
} from '../../src/renderer/stores/favorites'

beforeEach(() => {
  // Reset stores to defaults
  recentFiles.set([])
  recentsLoading.set(false)

  // Reset mocks
  vi.resetAllMocks()
})

describe('recents store', () => {
  const rec1 = { collectionId: 'a', filePath: 'doc1.md', openedAt: 1000 }
  const rec2 = { collectionId: 'a', filePath: 'doc2.md', openedAt: 2000 }
  const rec3 = { collectionId: 'b', filePath: 'doc3.md', openedAt: 3000 }
  const rec4 = { collectionId: 'a', filePath: 'doc4.md', openedAt: 4000 }

  describe('loadRecents', () => {
    it('loads recents from API', async () => {
      mockApi.listRecents.mockResolvedValue([rec1, rec2, rec3])

      await loadRecents()

      expect(get(recentFiles)).toEqual([rec1, rec2, rec3])
      expect(get(recentsLoading)).toBe(false)
    })

    it('sets loading to true during load', async () => {
      let loadingDuringCall = false
      mockApi.listRecents.mockImplementation(async () => {
        loadingDuringCall = get(recentsLoading)
        return []
      })

      await loadRecents()

      expect(loadingDuringCall).toBe(true)
      expect(get(recentsLoading)).toBe(false)
    })

    it('sets loading to false even on error', async () => {
      mockApi.listRecents.mockRejectedValue(new Error('fail'))

      await expect(loadRecents()).rejects.toThrow('fail')
      expect(get(recentsLoading)).toBe(false)
    })

    it('handles empty recents list', async () => {
      mockApi.listRecents.mockResolvedValue([])

      await loadRecents()

      expect(get(recentFiles)).toEqual([])
    })
  })

  describe('trackRecent', () => {
    it('calls addRecent on the API', async () => {
      mockApi.addRecent.mockResolvedValue(undefined)

      await trackRecent('a', 'doc1.md')

      expect(mockApi.addRecent).toHaveBeenCalledWith('a', 'doc1.md')
    })

    it('does not reload recents (native menu handles display)', async () => {
      mockApi.addRecent.mockResolvedValue(undefined)

      await trackRecent('a', 'doc1.md')

      expect(mockApi.addRecent).toHaveBeenCalledWith('a', 'doc1.md')
      expect(mockApi.listRecents).not.toHaveBeenCalled()
    })
  })

  describe('clearAllRecents', () => {
    it('clears recents and reloads', async () => {
      recentFiles.set([rec1, rec2, rec3])
      mockApi.clearRecents.mockResolvedValue(undefined)
      mockApi.listRecents.mockResolvedValue([])

      await clearAllRecents()

      expect(mockApi.clearRecents).toHaveBeenCalled()
      expect(mockApi.listRecents).toHaveBeenCalled()
      expect(get(recentFiles)).toEqual([])
    })

    it('handles empty recents', async () => {
      recentFiles.set([])
      mockApi.clearRecents.mockResolvedValue(undefined)
      mockApi.listRecents.mockResolvedValue([])

      await clearAllRecents()

      expect(mockApi.clearRecents).toHaveBeenCalled()
      expect(get(recentFiles)).toEqual([])
    })
  })

  describe('sortedRecents derived store', () => {
    it('sorts recents by most recently opened first', () => {
      // Set in random order
      recentFiles.set([rec1, rec3, rec2])

      const result = get(sortedRecents)

      // Should be sorted by openedAt descending
      expect(result[0]).toEqual(rec3) // openedAt: 3000
      expect(result[1]).toEqual(rec2) // openedAt: 2000
      expect(result[2]).toEqual(rec1) // openedAt: 1000
    })

    it('handles single recent file', () => {
      recentFiles.set([rec1])

      const result = get(sortedRecents)

      expect(result).toEqual([rec1])
    })

    it('returns empty array when no recents', () => {
      recentFiles.set([])

      expect(get(sortedRecents)).toEqual([])
    })

    it('maintains sort order with same openedAt timestamps', () => {
      const recA = { collectionId: 'a', filePath: 'a.md', openedAt: 1000 }
      const recB = { collectionId: 'a', filePath: 'b.md', openedAt: 1000 }
      const recC = { collectionId: 'a', filePath: 'c.md', openedAt: 2000 }

      recentFiles.set([recA, recB, recC])

      const result = get(sortedRecents)

      // recC should be first (higher timestamp)
      expect(result[0]).toEqual(recC)
      // recA and recB can be in any order since they have same timestamp
      expect(result.slice(1)).toContainEqual(recA)
      expect(result.slice(1)).toContainEqual(recB)
    })

    it('does not mutate original array', () => {
      const originalRecents = [rec1, rec2, rec3]
      recentFiles.set(originalRecents)

      const result = get(sortedRecents)

      // Modify result
      result.pop()
      result.reverse()

      // Original should be unchanged
      expect(get(recentFiles)).toHaveLength(3)
      expect(get(recentFiles)[0]).toEqual(rec1)
    })

    it('handles large number of recents', () => {
      // Create 50 recent entries (the cap)
      const fiftyRecents = Array.from({ length: 50 }, (_, i) => ({
        collectionId: 'a',
        filePath: `doc${i}.md`,
        openedAt: 1000 + i
      }))

      recentFiles.set(fiftyRecents)

      const result = get(sortedRecents)

      expect(result).toHaveLength(50)
      // Should be sorted descending by openedAt
      expect(result[0].openedAt).toBe(1049) // highest
      expect(result[49].openedAt).toBe(1000) // lowest
    })

    it('sorts correctly with mixed collection IDs', () => {
      recentFiles.set([rec1, rec2, rec3, rec4])

      const result = get(sortedRecents)

      // Should be sorted purely by openedAt, collection doesn't matter
      expect(result[0]).toEqual(rec4) // openedAt: 4000
      expect(result[1]).toEqual(rec3) // openedAt: 3000
      expect(result[2]).toEqual(rec2) // openedAt: 2000
      expect(result[3]).toEqual(rec1) // openedAt: 1000
    })
  })

  describe('integration scenarios', () => {
    it('tracks multiple files in sequence', async () => {
      mockApi.addRecent.mockResolvedValue(undefined)

      await trackRecent('a', 'doc1.md')
      expect(mockApi.addRecent).toHaveBeenCalledWith('a', 'doc1.md')

      await trackRecent('a', 'doc2.md')
      expect(mockApi.addRecent).toHaveBeenCalledWith('a', 'doc2.md')

      // Track doc1 again
      await trackRecent('a', 'doc1.md')
      expect(mockApi.addRecent).toHaveBeenCalledTimes(3)
    })

    it('loads after clearing shows empty list', async () => {
      recentFiles.set([rec1, rec2])

      mockApi.clearRecents.mockResolvedValue(undefined)
      mockApi.listRecents.mockResolvedValue([])

      await clearAllRecents()

      expect(get(recentFiles)).toEqual([])
      expect(get(sortedRecents)).toEqual([])
    })
  })
})
