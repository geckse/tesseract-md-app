import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  isFavorite: vi.fn(),
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
const mockSelectedFilePath = { subscribe: vi.fn() }

vi.mock('../../src/renderer/stores/files', () => ({
  selectedFilePath: mockSelectedFilePath
}))

import {
  favorites,
  recentFiles,
  favoritesLoading,
  recentsLoading,
  isFavorited,
  favoritesByCollection,
  sortedRecents,
  loadFavorites,
  loadRecents,
  toggleFavorite,
  trackRecent,
  clearAllRecents
} from '../../src/renderer/stores/favorites'

beforeEach(() => {
  // Reset stores to defaults
  favorites.set([])
  recentFiles.set([])
  favoritesLoading.set(false)
  recentsLoading.set(false)

  // Reset mocks
  vi.resetAllMocks()
})

describe('favorites store', () => {
  const fav1 = { collectionId: 'a', filePath: 'doc1.md', addedAt: 1000 }
  const fav2 = { collectionId: 'a', filePath: 'doc2.md', addedAt: 2000 }
  const fav3 = { collectionId: 'b', filePath: 'doc3.md', addedAt: 3000 }

  const rec1 = { collectionId: 'a', filePath: 'doc1.md', openedAt: 1000 }
  const rec2 = { collectionId: 'a', filePath: 'doc2.md', openedAt: 2000 }
  const rec3 = { collectionId: 'b', filePath: 'doc3.md', openedAt: 3000 }

  describe('loadFavorites', () => {
    it('loads favorites from API', async () => {
      mockApi.listFavorites.mockResolvedValue([fav1, fav2])

      await loadFavorites()

      expect(get(favorites)).toEqual([fav1, fav2])
      expect(get(favoritesLoading)).toBe(false)
    })

    it('sets loading to false even on error', async () => {
      mockApi.listFavorites.mockRejectedValue(new Error('fail'))

      await expect(loadFavorites()).rejects.toThrow('fail')
      expect(get(favoritesLoading)).toBe(false)
    })

    it('sets loading to true during load', async () => {
      let loadingDuringCall = false
      mockApi.listFavorites.mockImplementation(async () => {
        loadingDuringCall = get(favoritesLoading)
        return []
      })

      await loadFavorites()

      expect(loadingDuringCall).toBe(true)
      expect(get(favoritesLoading)).toBe(false)
    })
  })

  describe('loadRecents', () => {
    it('loads recents from API', async () => {
      mockApi.listRecents.mockResolvedValue([rec1, rec2])

      await loadRecents()

      expect(get(recentFiles)).toEqual([rec1, rec2])
      expect(get(recentsLoading)).toBe(false)
    })

    it('sets loading to false even on error', async () => {
      mockApi.listRecents.mockRejectedValue(new Error('fail'))

      await expect(loadRecents()).rejects.toThrow('fail')
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
  })

  describe('toggleFavorite', () => {
    it('adds favorite when not exists', async () => {
      favorites.set([])
      mockApi.addFavorite.mockResolvedValue(undefined)
      mockApi.listFavorites.mockResolvedValue([fav1])

      await toggleFavorite('a', 'doc1.md')

      expect(mockApi.addFavorite).toHaveBeenCalledWith('a', 'doc1.md')
      expect(mockApi.removeFavorite).not.toHaveBeenCalled()
      expect(get(favorites)).toEqual([fav1])
    })

    it('removes favorite when exists', async () => {
      favorites.set([fav1, fav2])
      mockApi.removeFavorite.mockResolvedValue(undefined)
      mockApi.listFavorites.mockResolvedValue([fav2])

      await toggleFavorite('a', 'doc1.md')

      expect(mockApi.removeFavorite).toHaveBeenCalledWith('a', 'doc1.md')
      expect(mockApi.addFavorite).not.toHaveBeenCalled()
      expect(get(favorites)).toEqual([fav2])
    })

    it('reloads favorites after toggle', async () => {
      favorites.set([fav1])
      mockApi.addFavorite.mockResolvedValue(undefined)
      mockApi.listFavorites.mockResolvedValue([fav1, fav2])

      await toggleFavorite('a', 'doc2.md')

      expect(mockApi.listFavorites).toHaveBeenCalled()
      expect(get(favorites)).toEqual([fav1, fav2])
    })
  })

  describe('trackRecent', () => {
    it('calls addRecent without reloading (native menu handles display)', async () => {
      recentFiles.set([])
      mockApi.addRecent.mockResolvedValue(undefined)

      await trackRecent('a', 'doc1.md')

      expect(mockApi.addRecent).toHaveBeenCalledWith('a', 'doc1.md')
      expect(mockApi.listRecents).not.toHaveBeenCalled()
    })
  })

  describe('clearAllRecents', () => {
    it('clears recents and reloads', async () => {
      recentFiles.set([rec1, rec2])
      mockApi.clearRecents.mockResolvedValue(undefined)
      mockApi.listRecents.mockResolvedValue([])

      await clearAllRecents()

      expect(mockApi.clearRecents).toHaveBeenCalled()
      expect(mockApi.listRecents).toHaveBeenCalled()
      expect(get(recentFiles)).toEqual([])
    })
  })

  describe('isFavorited derived store', () => {
    it('returns true when file is favorited', () => {
      favorites.set([fav1, fav2])

      // Mock the activeCollectionId subscription
      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('a')
        return () => {}
      }

      // Mock the selectedFilePath subscription
      mockSelectedFilePath.subscribe = (fn: any) => {
        fn('doc1.md')
        return () => {}
      }

      expect(get(isFavorited)).toBe(true)
    })

    it('returns false when file is not favorited', () => {
      favorites.set([fav1])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('a')
        return () => {}
      }

      mockSelectedFilePath.subscribe = (fn: any) => {
        fn('doc-not-favorited.md')
        return () => {}
      }

      expect(get(isFavorited)).toBe(false)
    })

    it('returns false when no active collection', () => {
      favorites.set([fav1])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn(null)
        return () => {}
      }

      mockSelectedFilePath.subscribe = (fn: any) => {
        fn('doc1.md')
        return () => {}
      }

      expect(get(isFavorited)).toBe(false)
    })

    it('returns false when no selected file', () => {
      favorites.set([fav1])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('a')
        return () => {}
      }

      mockSelectedFilePath.subscribe = (fn: any) => {
        fn(null)
        return () => {}
      }

      expect(get(isFavorited)).toBe(false)
    })
  })

  describe('favoritesByCollection derived store', () => {
    it('filters favorites by active collection', () => {
      favorites.set([fav1, fav2, fav3])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('a')
        return () => {}
      }

      const result = get(favoritesByCollection)
      expect(result).toHaveLength(2)
      expect(result[0].collectionId).toBe('a')
      expect(result[1].collectionId).toBe('a')
    })

    it('sorts by most recently added first', () => {
      favorites.set([fav1, fav2])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('a')
        return () => {}
      }

      const result = get(favoritesByCollection)
      expect(result[0]).toEqual(fav2) // addedAt: 2000
      expect(result[1]).toEqual(fav1) // addedAt: 1000
    })

    it('returns empty array when no active collection', () => {
      favorites.set([fav1, fav2])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn(null)
        return () => {}
      }

      expect(get(favoritesByCollection)).toEqual([])
    })

    it('returns empty array when collection has no favorites', () => {
      favorites.set([fav1, fav2])

      const activeCollectionIdMock = vi.mocked(
        require('../../src/renderer/stores/collections').activeCollectionId
      )
      activeCollectionIdMock.subscribe = (fn: any) => {
        fn('c') // non-existent collection
        return () => {}
      }

      expect(get(favoritesByCollection)).toEqual([])
    })
  })

  describe('sortedRecents derived store', () => {
    it('sorts recents by most recently opened first', () => {
      recentFiles.set([rec1, rec2, rec3])

      const result = get(sortedRecents)
      expect(result[0]).toEqual(rec3) // openedAt: 3000
      expect(result[1]).toEqual(rec2) // openedAt: 2000
      expect(result[2]).toEqual(rec1) // openedAt: 1000
    })

    it('returns empty array when no recents', () => {
      recentFiles.set([])

      expect(get(sortedRecents)).toEqual([])
    })

    it('does not mutate original array', () => {
      const originalRecents = [rec1, rec2]
      recentFiles.set(originalRecents)

      const result = get(sortedRecents)

      // Modify result
      result.pop()

      // Original should be unchanged
      expect(get(recentFiles)).toHaveLength(2)
    })
  })
})
