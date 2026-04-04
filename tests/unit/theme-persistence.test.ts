import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron-store
const mockGet = vi.fn()
const mockSet = vi.fn()
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  })),
}))

// Mock crypto
vi.mock('node:crypto', () => {
  const mod = { randomUUID: () => 'test-uuid' }
  return { ...mod, default: mod }
})

import {
  getThemeMode,
  setThemeMode,
  getCollectionTheme,
  setCollectionTheme,
} from '../../src/main/store'

beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
})

describe('getThemeMode', () => {
  it('returns dark by default', () => {
    mockGet.mockReturnValue('dark')
    expect(getThemeMode()).toBe('dark')
    expect(mockGet).toHaveBeenCalledWith('themeMode', 'dark')
  })

  it('returns stored theme', () => {
    mockGet.mockReturnValue('light')
    expect(getThemeMode()).toBe('light')
  })
})

describe('setThemeMode', () => {
  it('stores the theme mode', () => {
    setThemeMode('light')
    expect(mockSet).toHaveBeenCalledWith('themeMode', 'light')
  })

  it('stores auto mode', () => {
    setThemeMode('auto')
    expect(mockSet).toHaveBeenCalledWith('themeMode', 'auto')
  })
})

describe('getCollectionTheme', () => {
  it('returns null when no override', () => {
    mockGet.mockReturnValue({})
    expect(getCollectionTheme('col-1')).toBeNull()
  })

  it('returns the collection theme', () => {
    mockGet.mockReturnValue({ 'col-1': 'light' })
    expect(getCollectionTheme('col-1')).toBe('light')
  })
})

describe('setCollectionTheme', () => {
  it('adds a collection theme override', () => {
    mockGet.mockReturnValue({})
    setCollectionTheme('col-1', 'light')
    expect(mockSet).toHaveBeenCalledWith('collectionThemes', { 'col-1': 'light' })
  })

  it('removes override when null', () => {
    mockGet.mockReturnValue({ 'col-1': 'light' })
    setCollectionTheme('col-1', null)
    expect(mockSet).toHaveBeenCalledWith('collectionThemes', {})
  })

  it('preserves other collection themes', () => {
    mockGet.mockReturnValue({ 'col-1': 'light' })
    setCollectionTheme('col-2', 'dark')
    expect(mockSet).toHaveBeenCalledWith('collectionThemes', {
      'col-1': 'light',
      'col-2': 'dark',
    })
  })
})
