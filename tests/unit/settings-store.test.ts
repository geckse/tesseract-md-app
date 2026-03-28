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
  userDraft,
  collectionDraft,
  collectionDeletions,
  isDirty,
  loadUserConfig,
  loadCollectionConfig,
  stageUserConfig,
  stageCollectionConfig,
  stageCollectionDelete,
  saveAllSettings,
  discardDraft,
  deleteUserConfigKey
} from '../../src/renderer/stores/settings'

beforeEach(() => {
  userConfig.set({})
  collectionConfig.set({})
  configLoading.set(false)
  userDraft.set({})
  collectionDraft.set({})
  collectionDeletions.set(new Set())
  vi.resetAllMocks()
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

  describe('stageUserConfig', () => {
    it('stages a user-level config edit in the draft', () => {
      stageUserConfig('KEY', 'val')

      expect(get(userDraft)).toEqual({ KEY: 'val' })
      // userConfig is NOT updated yet (draft only)
      expect(get(userConfig)).toEqual({})
    })

    it('marks store as dirty when draft has entries', () => {
      expect(get(isDirty)).toBe(false)

      stageUserConfig('K', 'v1')

      expect(get(isDirty)).toBe(true)
    })
  })

  describe('stageCollectionConfig', () => {
    it('stages a collection-level config edit in the draft', () => {
      stageCollectionConfig('KEY', 'val')

      expect(get(collectionDraft)).toEqual({ KEY: 'val' })
    })

    it('un-deletes a key if it was scheduled for deletion', () => {
      stageCollectionDelete('KEY')
      expect(get(collectionDeletions).has('KEY')).toBe(true)

      stageCollectionConfig('KEY', 'new-val')
      expect(get(collectionDeletions).has('KEY')).toBe(false)
      expect(get(collectionDraft)).toEqual({ KEY: 'new-val' })
    })
  })

  describe('stageCollectionDelete', () => {
    it('schedules a collection key for deletion', () => {
      stageCollectionDelete('KEY')

      expect(get(collectionDeletions).has('KEY')).toBe(true)
    })

    it('removes the key from collectionDraft', () => {
      stageCollectionConfig('KEY', 'val')
      expect(get(collectionDraft)).toEqual({ KEY: 'val' })

      stageCollectionDelete('KEY')
      expect(get(collectionDraft)).toEqual({})
    })
  })

  describe('saveAllSettings', () => {
    it('persists staged user config changes to API', async () => {
      mockApi.setUserConfig.mockResolvedValue(undefined)
      stageUserConfig('KEY', 'val')

      await saveAllSettings()

      expect(mockApi.setUserConfig).toHaveBeenCalledWith('KEY', 'val')
    })

    it('persists staged collection config changes to API', async () => {
      mockApi.setCollectionConfig.mockResolvedValue(undefined)
      stageCollectionConfig('KEY', 'val')

      await saveAllSettings('/root')

      expect(mockApi.setCollectionConfig).toHaveBeenCalledWith('/root', 'KEY', 'val')
    })

    it('persists collection deletions to API', async () => {
      mockApi.deleteCollectionConfig.mockResolvedValue(undefined)
      stageCollectionDelete('KEY')

      await saveAllSettings('/root')

      expect(mockApi.deleteCollectionConfig).toHaveBeenCalledWith('/root', 'KEY')
    })

    it('merges user draft into saved state after save', async () => {
      mockApi.setUserConfig.mockResolvedValue(undefined)
      userConfig.set({ EXISTING: 'yes' })
      stageUserConfig('NEW', 'val')

      await saveAllSettings()

      expect(get(userConfig)).toEqual({ EXISTING: 'yes', NEW: 'val' })
      expect(get(userDraft)).toEqual({})
    })

    it('clears all drafts after successful save', async () => {
      mockApi.setUserConfig.mockResolvedValue(undefined)
      mockApi.setCollectionConfig.mockResolvedValue(undefined)
      stageUserConfig('U', '1')
      stageCollectionConfig('C', '2')

      await saveAllSettings('/root')

      expect(get(userDraft)).toEqual({})
      expect(get(collectionDraft)).toEqual({})
      expect(get(collectionDeletions).size).toBe(0)
      expect(get(isDirty)).toBe(false)
    })
  })

  describe('discardDraft', () => {
    it('clears all unsaved draft changes', () => {
      stageUserConfig('U', '1')
      stageCollectionConfig('C', '2')
      stageCollectionDelete('D')

      discardDraft()

      expect(get(userDraft)).toEqual({})
      expect(get(collectionDraft)).toEqual({})
      expect(get(collectionDeletions).size).toBe(0)
      expect(get(isDirty)).toBe(false)
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
