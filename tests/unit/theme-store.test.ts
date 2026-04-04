import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  getTheme: vi.fn(),
  setTheme: vi.fn(),
  getCollectionTheme: vi.fn(),
  setCollectionTheme: vi.fn(),
}

// Mock matchMedia
const mockMatchMedia = vi.fn().mockReturnValue({
  matches: true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi, matchMedia: mockMatchMedia },
  writable: true,
})

import {
  globalTheme,
  collectionTheme,
  systemPreference,
  resolvedTheme,
  themeTokens,
  loadTheme,
  loadCollectionTheme,
  setGlobalTheme,
  setCollectionThemeOverride,
} from '../../src/renderer/stores/theme'

import { DARK_TOKENS, LIGHT_TOKENS } from '../../src/renderer/lib/theme-tokens'

beforeEach(() => {
  vi.clearAllMocks()
  globalTheme.set('dark')
  collectionTheme.set(null)
  systemPreference.set('dark')
})

describe('resolvedTheme', () => {
  it('returns dark by default', () => {
    expect(get(resolvedTheme)).toBe('dark')
  })

  it('returns light when global is light', () => {
    globalTheme.set('light')
    expect(get(resolvedTheme)).toBe('light')
  })

  it('collection overrides global', () => {
    globalTheme.set('dark')
    collectionTheme.set('light')
    expect(get(resolvedTheme)).toBe('light')
  })

  it('auto resolves to system preference', () => {
    globalTheme.set('auto')
    systemPreference.set('light')
    expect(get(resolvedTheme)).toBe('light')
  })

  it('auto resolves to dark when system prefers dark', () => {
    globalTheme.set('auto')
    systemPreference.set('dark')
    expect(get(resolvedTheme)).toBe('dark')
  })

  it('collection auto overrides global dark', () => {
    globalTheme.set('dark')
    collectionTheme.set('auto')
    systemPreference.set('light')
    expect(get(resolvedTheme)).toBe('light')
  })

  it('null collection falls through to global', () => {
    globalTheme.set('light')
    collectionTheme.set(null)
    expect(get(resolvedTheme)).toBe('light')
  })
})

describe('themeTokens', () => {
  it('returns DARK_TOKENS when resolved is dark', () => {
    globalTheme.set('dark')
    expect(get(themeTokens)).toEqual(DARK_TOKENS)
  })

  it('returns LIGHT_TOKENS when resolved is light', () => {
    globalTheme.set('light')
    expect(get(themeTokens)).toEqual(LIGHT_TOKENS)
  })
})

describe('loadTheme', () => {
  it('loads theme from api', async () => {
    mockApi.getTheme.mockResolvedValue('light')
    await loadTheme()
    expect(get(globalTheme)).toBe('light')
  })

  it('handles api error gracefully', async () => {
    mockApi.getTheme.mockRejectedValue(new Error('fail'))
    await loadTheme()
    expect(get(globalTheme)).toBe('dark')
  })
})

describe('loadCollectionTheme', () => {
  it('loads collection theme from api', async () => {
    mockApi.getCollectionTheme.mockResolvedValue('light')
    await loadCollectionTheme('col-1')
    expect(get(collectionTheme)).toBe('light')
  })

  it('clears when id is null', async () => {
    collectionTheme.set('light')
    await loadCollectionTheme(null)
    expect(get(collectionTheme)).toBeNull()
  })

  it('handles api error gracefully', async () => {
    mockApi.getCollectionTheme.mockRejectedValue(new Error('fail'))
    await loadCollectionTheme('col-1')
    expect(get(collectionTheme)).toBeNull()
  })
})

describe('setGlobalTheme', () => {
  it('updates store and persists', async () => {
    mockApi.setTheme.mockResolvedValue(undefined)
    await setGlobalTheme('light')
    expect(get(globalTheme)).toBe('light')
    expect(mockApi.setTheme).toHaveBeenCalledWith('light')
  })
})

describe('setCollectionThemeOverride', () => {
  it('updates store and persists', async () => {
    mockApi.setCollectionTheme.mockResolvedValue(undefined)
    await setCollectionThemeOverride('col-1', 'light')
    expect(get(collectionTheme)).toBe('light')
    expect(mockApi.setCollectionTheme).toHaveBeenCalledWith('col-1', 'light')
  })

  it('handles null to remove override', async () => {
    mockApi.setCollectionTheme.mockResolvedValue(undefined)
    await setCollectionThemeOverride('col-1', null)
    expect(get(collectionTheme)).toBeNull()
    expect(mockApi.setCollectionTheme).toHaveBeenCalledWith('col-1', null)
  })
})
