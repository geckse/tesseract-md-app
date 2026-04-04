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
  getPrimaryColor,
  setPrimaryColor,
  getCollectionColor,
  setCollectionColor,
  getCollectionColors,
} from '../../src/main/store'

beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
})

describe('getPrimaryColor', () => {
  it('returns null when no color is set', () => {
    mockGet.mockReturnValue(null)
    expect(getPrimaryColor()).toBeNull()
    expect(mockGet).toHaveBeenCalledWith('primaryColor', null)
  })

  it('returns the stored hex color', () => {
    mockGet.mockReturnValue('#FF0000')
    expect(getPrimaryColor()).toBe('#FF0000')
  })
})

describe('setPrimaryColor', () => {
  it('stores a hex color', () => {
    setPrimaryColor('#34D399')
    expect(mockSet).toHaveBeenCalledWith('primaryColor', '#34D399')
  })

  it('stores null to reset to default', () => {
    setPrimaryColor(null)
    expect(mockSet).toHaveBeenCalledWith('primaryColor', null)
  })
})

describe('getCollectionColor', () => {
  it('returns null when no override exists', () => {
    mockGet.mockReturnValue({})
    expect(getCollectionColor('collection-1')).toBeNull()
  })

  it('returns the collection-specific color', () => {
    mockGet.mockReturnValue({ 'collection-1': '#A78BFA' })
    expect(getCollectionColor('collection-1')).toBe('#A78BFA')
  })

  it('returns null for unrelated collection', () => {
    mockGet.mockReturnValue({ 'collection-1': '#A78BFA' })
    expect(getCollectionColor('collection-2')).toBeNull()
  })
})

describe('setCollectionColor', () => {
  it('adds a collection color override', () => {
    mockGet.mockReturnValue({})
    setCollectionColor('collection-1', '#FB923C')
    expect(mockSet).toHaveBeenCalledWith('collectionColors', { 'collection-1': '#FB923C' })
  })

  it('removes the override when hex is null', () => {
    mockGet.mockReturnValue({ 'collection-1': '#FB923C' })
    setCollectionColor('collection-1', null)
    expect(mockSet).toHaveBeenCalledWith('collectionColors', {})
  })

  it('preserves other collection colors', () => {
    mockGet.mockReturnValue({ 'collection-1': '#FB923C' })
    setCollectionColor('collection-2', '#A78BFA')
    expect(mockSet).toHaveBeenCalledWith('collectionColors', {
      'collection-1': '#FB923C',
      'collection-2': '#A78BFA',
    })
  })
})

describe('getCollectionColors', () => {
  it('returns empty object when no colors set', () => {
    mockGet.mockReturnValue({})
    expect(getCollectionColors()).toEqual({})
  })

  it('returns all collection colors', () => {
    const colors = { 'c1': '#FF0000', 'c2': '#00FF00' }
    mockGet.mockReturnValue(colors)
    expect(getCollectionColors()).toEqual(colors)
  })
})
