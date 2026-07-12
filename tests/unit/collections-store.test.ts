import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  doctor: vi.fn(),
  info: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  collections,
  activeCollectionId,
  activeCollection,
  collectionStatus,
  collectionInfo,
  infoModalOpen,
  infoLoading,
  infoError,
  infoScope,
  collectionsLoading,
  loadCollections,
  addCollection,
  removeCollection,
  setActiveCollection,
  openInfoModal,
  closeInfoModal,
  fetchCollectionInfo
} from '../../src/renderer/stores/collections'

beforeEach(() => {
  // Reset stores to defaults
  collections.set([])
  activeCollectionId.set(null)
  collectionStatus.set(null)
  collectionInfo.set(null)
  infoModalOpen.set(false)
  infoLoading.set(false)
  infoError.set(null)
  infoScope.set(null)
  collectionsLoading.set(false)

  // Reset mocks
  vi.resetAllMocks()
})

describe('collections store', () => {
  const col1 = { id: 'a', name: 'alpha', path: '/alpha', addedAt: 1, lastOpenedAt: 1 }
  const col2 = { id: 'b', name: 'beta', path: '/beta', addedAt: 2, lastOpenedAt: 2 }

  describe('loadCollections', () => {
    it('loads collections and active collection from API', async () => {
      mockApi.listCollections.mockResolvedValue([col1, col2])
      mockApi.getActiveCollection.mockResolvedValue(col1)

      await loadCollections()

      expect(get(collections)).toEqual([col1, col2])
      expect(get(activeCollectionId)).toBe('a')
      expect(get(collectionsLoading)).toBe(false)
    })

    it('sets activeCollectionId to null when no active collection', async () => {
      mockApi.listCollections.mockResolvedValue([col1])
      mockApi.getActiveCollection.mockResolvedValue(null)

      await loadCollections()

      expect(get(activeCollectionId)).toBeNull()
    })

    it('sets loading to false even on error', async () => {
      mockApi.listCollections.mockRejectedValue(new Error('fail'))

      await expect(loadCollections()).rejects.toThrow('fail')
      expect(get(collectionsLoading)).toBe(false)
    })
  })

  describe('addCollection', () => {
    it('adds returned collection to store', async () => {
      mockApi.addCollection.mockResolvedValue(col1)

      const result = await addCollection()

      expect(result).toEqual(col1)
      expect(get(collections)).toEqual([col1])
    })

    it('returns null and does not update store when picker canceled', async () => {
      mockApi.addCollection.mockResolvedValue(null)

      const result = await addCollection()

      expect(result).toBeNull()
      expect(get(collections)).toEqual([])
    })
  })

  describe('removeCollection', () => {
    it('removes collection from store', async () => {
      collections.set([col1, col2])
      activeCollectionId.set('b')
      mockApi.removeCollection.mockResolvedValue(undefined)

      await removeCollection('a')

      expect(get(collections)).toEqual([col2])
      expect(get(activeCollectionId)).toBe('b')
    })

    it('clears activeCollectionId when removing active collection', async () => {
      collections.set([col1, col2])
      activeCollectionId.set('a')
      mockApi.removeCollection.mockResolvedValue(undefined)

      await removeCollection('a')

      expect(get(activeCollectionId)).toBeNull()
      expect(get(collectionStatus)).toBeNull()
    })
  })

  describe('setActiveCollection', () => {
    it('sets active collection and fetches status', async () => {
      collections.set([col1])
      mockApi.setActiveCollection.mockResolvedValue(undefined)
      mockApi.status.mockResolvedValue({ document_count: 5 })

      await setActiveCollection('a')

      expect(get(activeCollectionId)).toBe('a')
      expect(mockApi.setActiveCollection).toHaveBeenCalledWith('a')
      expect(mockApi.status).toHaveBeenCalledWith('/alpha')
      expect(get(collectionStatus)).toEqual({ document_count: 5 })
    })

    it('sets status to null when status fetch fails', async () => {
      collections.set([col1])
      collectionStatus.set({ document_count: 10 } as never)
      mockApi.setActiveCollection.mockResolvedValue(undefined)
      mockApi.status.mockRejectedValue(new Error('fail'))

      await setActiveCollection('a')

      expect(get(collectionStatus)).toBeNull()
    })
  })

  describe('activeCollection derived store', () => {
    it('resolves active collection object', () => {
      collections.set([col1, col2])
      activeCollectionId.set('b')

      expect(get(activeCollection)).toEqual(col2)
    })

    it('returns null when no active collection', () => {
      collections.set([col1])
      activeCollectionId.set(null)

      expect(get(activeCollection)).toBeNull()
    })

    it('returns null when active ID does not match any collection', () => {
      collections.set([col1])
      activeCollectionId.set('nonexistent')

      expect(get(activeCollection)).toBeNull()
    })
  })

  describe('collection information', () => {
    it('opens whole-vault information and stores the result', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.info.mockResolvedValue({ scope: '.', file_count: 2 })

      openInfoModal()

      expect(get(infoModalOpen)).toBe(true)
      expect(get(infoScope)).toBeNull()
      await vi.waitFor(() => expect(get(collectionInfo)).toEqual({ scope: '.', file_count: 2 }))
      expect(mockApi.info).toHaveBeenCalledWith('/alpha', undefined)
      expect(get(infoLoading)).toBe(false)
    })

    it('passes a folder scope and closes without discarding the result', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.info.mockResolvedValue({ scope: 'notes/', file_count: 1 })

      openInfoModal('notes')

      expect(get(infoScope)).toBe('notes')
      await vi.waitFor(() => expect(mockApi.info).toHaveBeenCalledWith('/alpha', 'notes'))
      closeInfoModal()
      expect(get(infoModalOpen)).toBe(false)
      expect(get(collectionInfo)).toEqual({ scope: 'notes/', file_count: 1 })
    })

    it('exposes request failures for the modal retry state', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.info.mockRejectedValue(new Error('[CliExecutionError] unknown command info'))

      await fetchCollectionInfo()

      expect(get(collectionInfo)).toBeNull()
      expect(get(infoError)).toContain('unknown command info')
      expect(get(infoLoading)).toBe(false)
    })
  })
})
