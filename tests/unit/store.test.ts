import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron-store
const mockGet = vi.fn()
const mockSet = vi.fn()
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args)
  }))
}))

// Mock crypto
const mockUUID = vi.fn()
vi.mock('node:crypto', () => ({
  randomUUID: () => mockUUID()
}))

import {
  initStore,
  getCollections,
  addCollection,
  removeCollection,
  setActiveCollection,
  getActiveCollection
} from '../../src/main/store'

beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
  mockUUID.mockReset()
})

describe('initStore', () => {
  it('returns a store instance', () => {
    const store = initStore()
    expect(store).toBeDefined()
    expect(store.get).toBeDefined()
    expect(store.set).toBeDefined()
  })
})

describe('getCollections', () => {
  it('returns collections from store', () => {
    const collections = [
      { id: '1', name: 'test', path: '/tmp/test', addedAt: 1000, lastOpenedAt: 1000 }
    ]
    mockGet.mockReturnValue(collections)

    const result = getCollections()
    expect(result).toEqual(collections)
    expect(mockGet).toHaveBeenCalledWith('collections', [])
  })

  it('returns empty array when no collections', () => {
    mockGet.mockReturnValue([])
    const result = getCollections()
    expect(result).toEqual([])
  })
})

describe('addCollection', () => {
  it('creates a new collection with correct fields', () => {
    mockGet.mockReturnValue([])
    mockUUID.mockReturnValue('test-uuid-123')

    const result = addCollection('/tmp/my-project')

    expect(result.id).toBe('test-uuid-123')
    expect(result.name).toBe('my-project')
    expect(result.path).toBe('/tmp/my-project')
    expect(result.addedAt).toBeGreaterThan(0)
    expect(result.lastOpenedAt).toBe(result.addedAt)
    expect(mockSet).toHaveBeenCalledWith('collections', [result])
  })

  it('throws on duplicate path', () => {
    mockGet.mockReturnValue([
      { id: '1', name: 'test', path: '/tmp/test', addedAt: 1000, lastOpenedAt: 1000 }
    ])

    expect(() => addCollection('/tmp/test')).toThrow('Collection already exists for path: /tmp/test')
  })

  it('appends to existing collections', () => {
    const existing = { id: '1', name: 'a', path: '/tmp/a', addedAt: 1000, lastOpenedAt: 1000 }
    mockGet.mockReturnValue([existing])
    mockUUID.mockReturnValue('uuid-2')

    addCollection('/tmp/b')

    const setCall = mockSet.mock.calls[0]
    expect(setCall[0]).toBe('collections')
    expect(setCall[1]).toHaveLength(2)
    expect(setCall[1][0]).toEqual(existing)
    expect(setCall[1][1].path).toBe('/tmp/b')
  })
})

describe('removeCollection', () => {
  it('removes collection by id', () => {
    const collections = [
      { id: '1', name: 'a', path: '/a', addedAt: 1, lastOpenedAt: 1 },
      { id: '2', name: 'b', path: '/b', addedAt: 2, lastOpenedAt: 2 }
    ]
    mockGet.mockImplementation((key: string) => {
      if (key === 'collections') return collections
      if (key === 'activeCollectionId') return null
      return undefined
    })

    removeCollection('1')

    expect(mockSet).toHaveBeenCalledWith('collections', [collections[1]])
  })

  it('clears activeCollectionId when removing active collection', () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'collections') return [{ id: '1', name: 'a', path: '/a', addedAt: 1, lastOpenedAt: 1 }]
      if (key === 'activeCollectionId') return '1'
      return undefined
    })

    removeCollection('1')

    expect(mockSet).toHaveBeenCalledWith('activeCollectionId', null)
  })

  it('does not clear activeCollectionId when removing non-active collection', () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'collections') return [{ id: '1' }, { id: '2' }]
      if (key === 'activeCollectionId') return '2'
      return undefined
    })

    removeCollection('1')

    const activeIdCalls = mockSet.mock.calls.filter((c: unknown[]) => c[0] === 'activeCollectionId')
    expect(activeIdCalls).toHaveLength(0)
  })
})

describe('setActiveCollection', () => {
  it('sets active collection and updates lastOpenedAt', () => {
    const collections = [
      { id: '1', name: 'a', path: '/a', addedAt: 1000, lastOpenedAt: 1000 }
    ]
    mockGet.mockImplementation((key: string) => {
      if (key === 'collections') return [...collections]
      return undefined
    })

    setActiveCollection('1')

    const setCollections = mockSet.mock.calls.find((c: unknown[]) => c[0] === 'collections')
    expect(setCollections![1][0].lastOpenedAt).toBeGreaterThan(1000)
    expect(mockSet).toHaveBeenCalledWith('activeCollectionId', '1')
  })

  it('throws when collection not found', () => {
    mockGet.mockReturnValue([])

    expect(() => setActiveCollection('nonexistent')).toThrow('Collection not found: nonexistent')
  })
})

describe('getActiveCollection', () => {
  it('returns active collection when set', () => {
    const collection = { id: '1', name: 'a', path: '/a', addedAt: 1, lastOpenedAt: 1 }
    mockGet.mockImplementation((key: string) => {
      if (key === 'activeCollectionId') return '1'
      if (key === 'collections') return [collection]
      return undefined
    })

    const result = getActiveCollection()
    expect(result).toEqual(collection)
  })

  it('returns null when no active collection', () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'activeCollectionId') return null
      return undefined
    })

    const result = getActiveCollection()
    expect(result).toBeNull()
  })

  it('returns null when active id points to removed collection', () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'activeCollectionId') return 'deleted-id'
      if (key === 'collections') return []
      return undefined
    })

    const result = getActiveCollection()
    expect(result).toBeNull()
  })
})
