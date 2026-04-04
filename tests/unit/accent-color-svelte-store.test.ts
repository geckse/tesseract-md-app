import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  getPrimaryColor: vi.fn(),
  setPrimaryColor: vi.fn(),
  getCollectionColor: vi.fn(),
  setCollectionColor: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  globalPrimaryColor,
  collectionPrimaryColor,
  effectivePrimaryColor,
  primaryVariants,
  loadAccentColors,
  loadCollectionAccentColor,
  setGlobalAccentColor,
  setCollectionAccentColor,
} from '../../src/renderer/stores/accent-color'

beforeEach(() => {
  vi.clearAllMocks()
  globalPrimaryColor.set(null)
  collectionPrimaryColor.set(null)
})

describe('effectivePrimaryColor', () => {
  it('returns default cyan when no colors set', () => {
    expect(get(effectivePrimaryColor)).toBe('#00E5FF')
  })

  it('returns global color when set', () => {
    globalPrimaryColor.set('#FF0000')
    expect(get(effectivePrimaryColor)).toBe('#FF0000')
  })

  it('collection overrides global', () => {
    globalPrimaryColor.set('#FF0000')
    collectionPrimaryColor.set('#00FF00')
    expect(get(effectivePrimaryColor)).toBe('#00FF00')
  })

  it('falls back to global when collection is null', () => {
    globalPrimaryColor.set('#FF0000')
    collectionPrimaryColor.set(null)
    expect(get(effectivePrimaryColor)).toBe('#FF0000')
  })
})

describe('primaryVariants', () => {
  it('derives variants from effective color', () => {
    globalPrimaryColor.set('#FF0000')
    const variants = get(primaryVariants)
    expect(variants.primary).toBe('#FF0000')
    expect(variants.dim).toBe('rgba(255, 0, 0, 0.1)')
    expect(variants.glow).toBe('rgba(255, 0, 0, 0.4)')
    expect(variants.dark).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('loadAccentColors', () => {
  it('loads global color from api', async () => {
    mockApi.getPrimaryColor.mockResolvedValue('#A78BFA')
    await loadAccentColors()
    expect(get(globalPrimaryColor)).toBe('#A78BFA')
  })

  it('handles api error gracefully', async () => {
    mockApi.getPrimaryColor.mockRejectedValue(new Error('fail'))
    await loadAccentColors()
    expect(get(globalPrimaryColor)).toBeNull()
  })
})

describe('loadCollectionAccentColor', () => {
  it('loads collection color from api', async () => {
    mockApi.getCollectionColor.mockResolvedValue('#FB923C')
    await loadCollectionAccentColor('col-1')
    expect(get(collectionPrimaryColor)).toBe('#FB923C')
  })

  it('clears collection color when id is null', async () => {
    collectionPrimaryColor.set('#FB923C')
    await loadCollectionAccentColor(null)
    expect(get(collectionPrimaryColor)).toBeNull()
  })

  it('handles api error gracefully', async () => {
    mockApi.getCollectionColor.mockRejectedValue(new Error('fail'))
    await loadCollectionAccentColor('col-1')
    expect(get(collectionPrimaryColor)).toBeNull()
  })
})

describe('setGlobalAccentColor', () => {
  it('updates store and persists via api', async () => {
    mockApi.setPrimaryColor.mockResolvedValue(undefined)
    await setGlobalAccentColor('#34D399')
    expect(get(globalPrimaryColor)).toBe('#34D399')
    expect(mockApi.setPrimaryColor).toHaveBeenCalledWith('#34D399')
  })

  it('handles null to reset', async () => {
    mockApi.setPrimaryColor.mockResolvedValue(undefined)
    await setGlobalAccentColor(null)
    expect(get(globalPrimaryColor)).toBeNull()
    expect(mockApi.setPrimaryColor).toHaveBeenCalledWith(null)
  })
})

describe('setCollectionAccentColor', () => {
  it('updates store and persists via api', async () => {
    mockApi.setCollectionColor.mockResolvedValue(undefined)
    await setCollectionAccentColor('col-1', '#F472B6')
    expect(get(collectionPrimaryColor)).toBe('#F472B6')
    expect(mockApi.setCollectionColor).toHaveBeenCalledWith('col-1', '#F472B6')
  })

  it('handles null to remove override', async () => {
    mockApi.setCollectionColor.mockResolvedValue(undefined)
    await setCollectionAccentColor('col-1', null)
    expect(get(collectionPrimaryColor)).toBeNull()
    expect(mockApi.setCollectionColor).toHaveBeenCalledWith('col-1', null)
  })
})
