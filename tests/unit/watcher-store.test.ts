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
  watcherState,
  watcherEvents,
  watcherError,
  watcherToggling,
  startWatcher,
  stopWatcher,
  toggleWatcher,
  fetchWatcherStatus,
  handleWatcherEvent,
  setupWatcherListener,
  teardownWatcherListener,
  clearWatcherEvents,
} from '../../src/renderer/stores/watcher'

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'

const col1 = { id: 'a', name: 'alpha', path: '/alpha', addedAt: 1, lastOpenedAt: 1 }

function resetStores() {
  watcherState.set('stopped')
  watcherEvents.set([])
  watcherError.set(null)
  watcherToggling.set(false)
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
})

describe('watcher store', () => {
  describe('startWatcher', () => {
    it('calls API and sets state to starting', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.startWatcher.mockResolvedValue(undefined)

      await startWatcher()

      expect(mockApi.startWatcher).toHaveBeenCalledWith('/alpha')
      expect(get(watcherState)).toBe('starting')
      expect(get(watcherToggling)).toBe(false)
    })

    it('does nothing when no active collection', async () => {
      await startWatcher()

      expect(mockApi.startWatcher).not.toHaveBeenCalled()
    })

    it('does nothing when already toggling', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      watcherToggling.set(true)

      await startWatcher()

      expect(mockApi.startWatcher).not.toHaveBeenCalled()
    })

    it('sets error state on failure', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.startWatcher.mockRejectedValue(new Error('fail'))

      await startWatcher()

      expect(get(watcherError)).toBe('fail')
      expect(get(watcherState)).toBe('error')
      expect(get(watcherToggling)).toBe(false)
    })
  })

  describe('stopWatcher', () => {
    it('calls API and sets state to stopped', async () => {
      watcherState.set('running')
      mockApi.stopWatcher.mockResolvedValue(undefined)

      await stopWatcher()

      expect(mockApi.stopWatcher).toHaveBeenCalled()
      expect(get(watcherState)).toBe('stopped')
      expect(get(watcherToggling)).toBe(false)
    })

    it('does nothing when already toggling', async () => {
      watcherToggling.set(true)

      await stopWatcher()

      expect(mockApi.stopWatcher).not.toHaveBeenCalled()
    })

    it('sets error on failure', async () => {
      mockApi.stopWatcher.mockRejectedValue(new Error('stop fail'))

      await stopWatcher()

      expect(get(watcherError)).toBe('stop fail')
      expect(get(watcherToggling)).toBe(false)
    })
  })

  describe('toggleWatcher', () => {
    it('stops watcher when running', async () => {
      watcherState.set('running')
      mockApi.stopWatcher.mockResolvedValue(undefined)

      await toggleWatcher()

      expect(mockApi.stopWatcher).toHaveBeenCalled()
      expect(get(watcherState)).toBe('stopped')
    })

    it('starts watcher when stopped', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      watcherState.set('stopped')
      mockApi.startWatcher.mockResolvedValue(undefined)

      await toggleWatcher()

      expect(mockApi.startWatcher).toHaveBeenCalledWith('/alpha')
    })

    it('starts watcher when in error state', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      watcherState.set('error')
      mockApi.startWatcher.mockResolvedValue(undefined)

      await toggleWatcher()

      expect(mockApi.startWatcher).toHaveBeenCalled()
    })

    it('does nothing when in starting state', async () => {
      watcherState.set('starting')

      await toggleWatcher()

      expect(mockApi.startWatcher).not.toHaveBeenCalled()
      expect(mockApi.stopWatcher).not.toHaveBeenCalled()
    })
  })

  describe('fetchWatcherStatus', () => {
    it('updates watcherState from API', async () => {
      mockApi.getWatcherStatus.mockResolvedValue({ state: 'running', root: '/alpha' })

      await fetchWatcherStatus()

      expect(get(watcherState)).toBe('running')
    })

    it('silently handles errors', async () => {
      mockApi.getWatcherStatus.mockRejectedValue(new Error('fail'))

      await fetchWatcherStatus()

      expect(get(watcherState)).toBe('stopped')
    })
  })

  describe('handleWatcherEvent', () => {
    it('pushes event to ring buffer', () => {
      const event = { type: 'watch-event' as const, data: { path: 'test.md' } }

      handleWatcherEvent(event)

      expect(get(watcherEvents)).toHaveLength(1)
      expect(get(watcherEvents)[0]).toEqual(event)
    })

    it('caps events at 50', () => {
      for (let i = 0; i < 55; i++) {
        handleWatcherEvent({ type: 'watch-event', data: { index: i } })
      }

      expect(get(watcherEvents)).toHaveLength(50)
      // newest first
      expect((get(watcherEvents)[0].data as { index: number }).index).toBe(54)
    })

    it('updates state on state-change event', () => {
      handleWatcherEvent({ type: 'state-change', data: 'running' })

      expect(get(watcherState)).toBe('running')
    })

    it('sets error on state-change to error', () => {
      handleWatcherEvent({ type: 'state-change', data: 'error' })

      expect(get(watcherState)).toBe('error')
      expect(get(watcherError)).toBe('Watcher encountered an error')
    })

    it('sets error on error event', () => {
      handleWatcherEvent({ type: 'error', data: { message: 'disk full' } })

      expect(get(watcherError)).toBe('disk full')
      expect(get(watcherState)).toBe('error')
    })

    it('uses fallback message when error has no message', () => {
      handleWatcherEvent({ type: 'error', data: {} })

      expect(get(watcherError)).toBe('Unknown watcher error')
    })
  })

  describe('setupWatcherListener / teardownWatcherListener', () => {
    it('registers event listener', () => {
      setupWatcherListener()

      expect(mockApi.onWatcherEvent).toHaveBeenCalledWith(handleWatcherEvent)
    })

    it('removes event listener', () => {
      teardownWatcherListener()

      expect(mockApi.removeWatcherEventListener).toHaveBeenCalled()
    })
  })

  describe('clearWatcherEvents', () => {
    it('empties the events buffer', () => {
      handleWatcherEvent({ type: 'watch-event', data: {} })
      expect(get(watcherEvents)).toHaveLength(1)

      clearWatcherEvents()

      expect(get(watcherEvents)).toHaveLength(0)
    })
  })
})
