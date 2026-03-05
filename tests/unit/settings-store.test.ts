import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  getUserConfig: vi.fn(),
  setUserConfig: vi.fn(),
  getCollectionConfig: vi.fn(),
  setCollectionConfig: vi.fn(),
  deleteUserConfig: vi.fn(),
  deleteCollectionConfig: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  userConfig,
  collectionConfig,
  configLoading,
  loadUserConfig,
  loadCollectionConfig,
  saveUserConfig,
  saveCollectionConfig,
  deleteUserConfigKey,
  deleteCollectionConfigKey
} from '../../src/renderer/stores/settings'

beforeEach(() => {
  userConfig.set({})
  collectionConfig.set({})
  configLoading.set(false)
  vi.resetAllMocks()
  vi.useFakeTimers()
})

describe('settings store', () => {
  describe('loadUserConfig', () => {
    it('calls window.api.getUserConfig and sets store', async () => {
      mockApi.getUserConfig.mockResolvedValue({ EMBEDDING_PROVIDER: 'openai' })

      await loadUserConfig()

      expect(mockApi.getUserConfig).toHaveBeenCalled()
      expect(get(userConfig)).toEqual({ EMBEDDING_PROVIDER: 'openai' })
    })

    it('sets configLoading to false after load', async () => {
      mockApi.getUserConfig.mockResolvedValue({})

      await loadUserConfig()

      expect(get(configLoading)).toBe(false)
    })

    it('sets configLoading to false even on error', async () => {
      mockApi.getUserConfig.mockRejectedValue(new Error('fail'))

      await expect(loadUserConfig()).rejects.toThrow('fail')
      expect(get(configLoading)).toBe(false)
    })
  })

  describe('loadCollectionConfig', () => {
    it('calls window.api.getCollectionConfig and sets store', async () => {
      mockApi.getCollectionConfig.mockResolvedValue({ CHUNK_MAX_TOKENS: '512' })

      await loadCollectionConfig('/my/project')

      expect(mockApi.getCollectionConfig).toHaveBeenCalledWith('/my/project')
      expect(get(collectionConfig)).toEqual({ CHUNK_MAX_TOKENS: '512' })
    })

    it('sets configLoading to false even on error', async () => {
      mockApi.getCollectionConfig.mockRejectedValue(new Error('fail'))

      await expect(loadCollectionConfig('/x')).rejects.toThrow('fail')
      expect(get(configLoading)).toBe(false)
    })
  })

  describe('saveUserConfig', () => {
    it('updates store immediately and calls API after debounce', async () => {
      mockApi.setUserConfig.mockResolvedValue(undefined)

      const promise = saveUserConfig('KEY', 'val')

      // Store updated immediately
      expect(get(userConfig)).toEqual({ KEY: 'val' })
      // API not called yet
      expect(mockApi.setUserConfig).not.toHaveBeenCalled()

      // Advance past debounce
      vi.advanceTimersByTime(300)
      await promise

      expect(mockApi.setUserConfig).toHaveBeenCalledWith('KEY', 'val')
    })

    it('debounces multiple rapid calls', async () => {
      mockApi.setUserConfig.mockResolvedValue(undefined)

      // First call — will be superseded
      const p1 = saveUserConfig('K', 'v1')
      vi.advanceTimersByTime(100)

      // Second call resets the timer
      const p2 = saveUserConfig('K', 'v2')
      vi.advanceTimersByTime(300)

      await p2

      // Only the second call's value should have been sent
      expect(mockApi.setUserConfig).toHaveBeenCalledTimes(1)
      expect(mockApi.setUserConfig).toHaveBeenCalledWith('K', 'v2')
      expect(get(userConfig)).toEqual({ K: 'v2' })
    })
  })

  describe('saveCollectionConfig', () => {
    it('updates store immediately and calls API after debounce', async () => {
      mockApi.setCollectionConfig.mockResolvedValue(undefined)

      const promise = saveCollectionConfig('/root', 'KEY', 'val')

      expect(get(collectionConfig)).toEqual({ KEY: 'val' })
      expect(mockApi.setCollectionConfig).not.toHaveBeenCalled()

      vi.advanceTimersByTime(300)
      await promise

      expect(mockApi.setCollectionConfig).toHaveBeenCalledWith('/root', 'KEY', 'val')
    })
  })

  describe('deleteUserConfigKey', () => {
    it('calls API and removes key from store', async () => {
      userConfig.set({ A: '1', B: '2' })
      mockApi.deleteUserConfig.mockResolvedValue(undefined)

      await deleteUserConfigKey('A')

      expect(mockApi.deleteUserConfig).toHaveBeenCalledWith('A')
      expect(get(userConfig)).toEqual({ B: '2' })
    })
  })

  describe('deleteCollectionConfigKey', () => {
    it('calls API and removes key from store', async () => {
      collectionConfig.set({ X: '10', Y: '20' })
      mockApi.deleteCollectionConfig.mockResolvedValue(undefined)

      await deleteCollectionConfigKey('/root', 'X')

      expect(mockApi.deleteCollectionConfig).toHaveBeenCalledWith('/root', 'X')
      expect(get(collectionConfig)).toEqual({ Y: '20' })
    })
  })

  describe('configLoading state', () => {
    it('toggles during loadUserConfig', async () => {
      let loadingDuringCall = false
      mockApi.getUserConfig.mockImplementation(async () => {
        loadingDuringCall = get(configLoading)
        return {}
      })

      await loadUserConfig()

      expect(loadingDuringCall).toBe(true)
      expect(get(configLoading)).toBe(false)
    })

    it('toggles during loadCollectionConfig', async () => {
      let loadingDuringCall = false
      mockApi.getCollectionConfig.mockImplementation(async () => {
        loadingDuringCall = get(configLoading)
        return {}
      })

      await loadCollectionConfig('/root')

      expect(loadingDuringCall).toBe(true)
      expect(get(configLoading)).toBe(false)
    })
  })
})
