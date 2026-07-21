import { describe, expect, it } from 'vitest'
import {
  createGraphPositionCacheKey,
  deserializeGraphPositionSnapshot,
  GraphPositionCache,
  restoreGraphPositions,
  serializeGraphPositionSnapshot,
  type GraphPositionSnapshot,
  type GraphPositionStorage
} from '@renderer/lib/graph-position-cache'

class MemoryStorage implements GraphPositionStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function snapshot(nodeIds: string[], positions: number[], createdAt = 1): GraphPositionSnapshot {
  return {
    version: 1,
    nodeIds,
    positions: new Float32Array(positions),
    createdAt
  }
}

describe('graph position serialization', () => {
  it('builds stable keys from revision, scope, and sorted settings', () => {
    const first = createGraphPositionCacheKey({
      collectionId: 'collection',
      graphLevel: 'document',
      revision: 'r1',
      settings: { charge: -80, nested: { beta: true, alpha: 1 } }
    })
    const reordered = createGraphPositionCacheKey({
      collectionId: 'collection',
      graphLevel: 'document',
      revision: 'r1',
      settings: { nested: { alpha: 1, beta: true }, charge: -80 }
    })
    const changed = createGraphPositionCacheKey({
      collectionId: 'collection',
      graphLevel: 'document',
      revision: 'r2',
      settings: { charge: -80, nested: { beta: true, alpha: 1 } }
    })

    expect(reordered).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('round-trips Float32 positions without losing node order', () => {
    const original = snapshot(['a', 'b'], [1.25, -2.5, 3.75, 4, 5, 6], 123)
    const serialized = serializeGraphPositionSnapshot('key', original)
    const restored = deserializeGraphPositionSnapshot(serialized, 'key')

    expect(restored?.nodeIds).toEqual(['a', 'b'])
    expect(Array.from(restored?.positions ?? [])).toEqual(Array.from(original.positions))
    expect(restored?.createdAt).toBe(123)
    expect(deserializeGraphPositionSnapshot(serialized, 'other-key')).toBeNull()
  })

  it('rejects malformed snapshots', () => {
    expect(deserializeGraphPositionSnapshot('{broken')).toBeNull()
    expect(
      deserializeGraphPositionSnapshot(
        JSON.stringify({
          version: 1,
          key: 'key',
          nodeIds: ['a'],
          positionsBase64: btoa('short'),
          createdAt: 1
        })
      )
    ).toBeNull()
    expect(() =>
      serializeGraphPositionSnapshot('key', snapshot(['a'], [1, 2, Number.NaN]))
    ).toThrow('Graph positions must be finite')
  })

  it('remaps cached positions and leaves unseen nodes unseeded', () => {
    const result = restoreGraphPositions(
      ['b', 'new', 'a'],
      snapshot(['a', 'b'], [1, 2, 3, 4, 5, 6])
    )

    expect(result.matchedNodeCount).toBe(2)
    expect(Array.from(result.positions.slice(0, 3))).toEqual([4, 5, 6])
    expect(Number.isNaN(result.positions[3])).toBe(true)
    expect(Array.from(result.positions.slice(6))).toEqual([1, 2, 3])
  })
})

describe('GraphPositionCache', () => {
  it('evicts the least-recently-used entry at its bounded entry count', () => {
    const storage = new MemoryStorage()
    let now = 1
    const cache = new GraphPositionCache({
      storage,
      maxEntries: 2,
      maxBytes: 100_000,
      maxEntryBytes: 50_000,
      now: () => now++
    })

    expect(cache.set('a', snapshot(['a'], [1, 2, 3]))).toBe(true)
    expect(cache.set('b', snapshot(['b'], [4, 5, 6]))).toBe(true)
    expect(cache.get('a')?.nodeIds).toEqual(['a'])
    expect(cache.set('c', snapshot(['c'], [7, 8, 9]))).toBe(true)

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).not.toBeNull()
    expect(cache.get('c')).not.toBeNull()
    expect(cache.stats().entries).toBe(2)
  })

  it('rejects oversized entries without disturbing existing cache data', () => {
    const storage = new MemoryStorage()
    const cache = new GraphPositionCache({
      storage,
      maxEntries: 2,
      maxBytes: 100_000,
      maxEntryBytes: 300
    })
    expect(cache.set('small', snapshot(['a'], [1, 2, 3]))).toBe(true)

    const ids = Array.from({ length: 100 }, (_, index) => `node-${index}`)
    expect(cache.set('large', snapshot(ids, new Array(ids.length * 3).fill(1)))).toBe(false)
    expect(cache.get('small')).not.toBeNull()
  })

  it('deletes and clears persisted entries', () => {
    const storage = new MemoryStorage()
    const cache = new GraphPositionCache({ storage })
    cache.set('a', snapshot(['a'], [1, 2, 3]))
    cache.set('b', snapshot(['b'], [4, 5, 6]))

    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('missing')).toBe(false)
    cache.clear()
    expect(cache.stats()).toMatchObject({ entries: 0, estimatedBytes: 0 })
  })

  it('degrades gracefully when storage writes fail', () => {
    const storage: GraphPositionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined
    }
    const cache = new GraphPositionCache({ storage })
    expect(cache.set('a', snapshot(['a'], [1, 2, 3]))).toBe(false)
    expect(cache.get('a')).toBeNull()
  })
})
