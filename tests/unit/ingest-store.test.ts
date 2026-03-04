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
  search: vi.fn(),
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  getWatcherStatus: vi.fn(),
  onWatcherEvent: vi.fn(),
  removeWatcherEventListener: vi.fn(),
  fileTree: vi.fn(),
  ingest: vi.fn(),
  ingestPreview: vi.fn(),
  cancelIngest: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  ingestState,
  ingestRunning,
  ingestIsReindex,
  ingestElapsed,
  ingestResult,
  ingestError,
  ingestModalOpen,
  ingestPreviewResult,
  ingestPreviewLoading,
  runPreview,
  runIngest,
  cancelIngest,
  closeIngestModal,
} from '../../src/renderer/stores/ingest'

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'

const col1 = { id: 'a', name: 'alpha', path: '/alpha', addedAt: 1, lastOpenedAt: 1 }

function resetStores() {
  ingestState.set('idle')
  ingestRunning.set(false)
  ingestIsReindex.set(false)
  ingestElapsed.set(0)
  ingestResult.set(null)
  ingestError.set(null)
  ingestModalOpen.set(false)
  ingestPreviewResult.set(null)
  ingestPreviewLoading.set(false)
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('ingest store', () => {
  describe('runPreview', () => {
    it('fetches preview and opens modal', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      const preview = { files: ['a.md'], total: 1 }
      mockApi.ingestPreview.mockResolvedValue(preview)

      await runPreview()

      expect(mockApi.ingestPreview).toHaveBeenCalledWith('/alpha')
      expect(get(ingestPreviewResult)).toEqual(preview)
      expect(get(ingestModalOpen)).toBe(true)
      expect(get(ingestPreviewLoading)).toBe(false)
      expect(get(ingestState)).toBe('idle')
    })

    it('does nothing without active collection', async () => {
      await runPreview()

      expect(mockApi.ingestPreview).not.toHaveBeenCalled()
    })

    it('does nothing when ingesting', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      ingestState.set('ingesting')

      await runPreview()

      expect(mockApi.ingestPreview).not.toHaveBeenCalled()
    })

    it('allows preview from done state', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      ingestState.set('done')
      mockApi.ingestPreview.mockResolvedValue({ files: [] })

      await runPreview()

      expect(mockApi.ingestPreview).toHaveBeenCalled()
    })

    it('sets error state on failure', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.ingestPreview.mockRejectedValue(new Error('preview fail'))

      await runPreview()

      expect(get(ingestError)).toBe('preview fail')
      expect(get(ingestState)).toBe('error')
      expect(get(ingestPreviewLoading)).toBe(false)
    })
  })

  describe('runIngest', () => {
    it('runs incremental ingest by default', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      const result = { files_processed: 5, chunks_created: 10 }
      mockApi.ingest.mockResolvedValue(result)
      mockApi.status.mockResolvedValue({ document_count: 5 })
      mockApi.fileTree.mockResolvedValue(null)

      await runIngest()

      expect(mockApi.ingest).toHaveBeenCalledWith('/alpha', { reindex: false })
      expect(get(ingestResult)).toEqual(result)
      expect(get(ingestState)).toBe('done')
      expect(get(ingestRunning)).toBe(false)
      expect(get(ingestIsReindex)).toBe(false)
      expect(get(ingestModalOpen)).toBe(true)
    })

    it('runs full reindex when requested', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.ingest.mockResolvedValue({ files_processed: 1 })
      mockApi.status.mockResolvedValue({ document_count: 1 })
      mockApi.fileTree.mockResolvedValue(null)

      await runIngest(true)

      expect(mockApi.ingest).toHaveBeenCalledWith('/alpha', { reindex: true })
      expect(get(ingestIsReindex)).toBe(true)
    })

    it('does nothing without active collection', async () => {
      await runIngest()

      expect(mockApi.ingest).not.toHaveBeenCalled()
    })

    it('does nothing when already running', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      ingestRunning.set(true)

      await runIngest()

      expect(mockApi.ingest).not.toHaveBeenCalled()
    })

    it('sets error state on failure', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.ingest.mockRejectedValue(new Error('ingest fail'))
      mockApi.fileTree.mockResolvedValue(null)
      mockApi.status.mockResolvedValue({})

      await runIngest()

      expect(get(ingestError)).toBe('ingest fail')
      expect(get(ingestState)).toBe('error')
      expect(get(ingestRunning)).toBe(false)
    })

    it('tracks elapsed time with timer', async () => {
      vi.useFakeTimers()
      collections.set([col1])
      activeCollectionId.set('a')

      let resolveIngest: (v: unknown) => void
      mockApi.ingest.mockReturnValue(new Promise((r) => { resolveIngest = r }))
      mockApi.status.mockResolvedValue({})
      mockApi.fileTree.mockResolvedValue(null)

      const promise = runIngest()

      // Timer should be running
      vi.advanceTimersByTime(3000)
      expect(get(ingestElapsed)).toBe(3)

      resolveIngest!({ files_processed: 1 })
      await vi.advanceTimersByTimeAsync(0)
      await promise

      // Timer should be stopped
      const elapsed = get(ingestElapsed)
      vi.advanceTimersByTime(2000)
      expect(get(ingestElapsed)).toBe(elapsed)
    })
  })

  describe('cancelIngest', () => {
    it('calls API when running', async () => {
      ingestRunning.set(true)
      mockApi.cancelIngest.mockResolvedValue(undefined)

      await cancelIngest()

      expect(mockApi.cancelIngest).toHaveBeenCalled()
    })

    it('does nothing when not running', async () => {
      await cancelIngest()

      expect(mockApi.cancelIngest).not.toHaveBeenCalled()
    })

    it('sets error if cancel fails', async () => {
      ingestRunning.set(true)
      mockApi.cancelIngest.mockRejectedValue(new Error('cancel fail'))

      await cancelIngest()

      expect(get(ingestError)).toBe('cancel fail')
    })
  })

  describe('closeIngestModal', () => {
    it('closes modal and resets state when not running', () => {
      ingestModalOpen.set(true)
      ingestState.set('done')
      ingestPreviewResult.set({ files: [] } as never)

      closeIngestModal()

      expect(get(ingestModalOpen)).toBe(false)
      expect(get(ingestState)).toBe('idle')
      expect(get(ingestPreviewResult)).toBeNull()
    })

    it('does not close when running', () => {
      ingestRunning.set(true)
      ingestModalOpen.set(true)

      closeIngestModal()

      expect(get(ingestModalOpen)).toBe(true)
    })
  })
})
