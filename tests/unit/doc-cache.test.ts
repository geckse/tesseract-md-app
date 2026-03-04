import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentCache, type CachedDocument } from '@renderer/lib/doc-cache'

describe('DocumentCache', () => {
  let cache: DocumentCache

  beforeEach(() => {
    cache = new DocumentCache(5)
  })

  const createDoc = (content: string): CachedDocument => ({
    content,
    cursor: { line: 1, column: 0 },
    scrollTop: 0,
    cachedAt: Date.now()
  })

  describe('constructor', () => {
    it('creates cache with default max size 5', () => {
      const defaultCache = new DocumentCache()
      expect(defaultCache.getMaxSize()).toBe(5)
      expect(defaultCache.size).toBe(0)
    })

    it('creates cache with custom max size', () => {
      const customCache = new DocumentCache(10)
      expect(customCache.getMaxSize()).toBe(10)
    })

    it('throws error for max size less than 1', () => {
      expect(() => new DocumentCache(0)).toThrow('DocumentCache maxSize must be at least 1')
      expect(() => new DocumentCache(-1)).toThrow('DocumentCache maxSize must be at least 1')
    })
  })

  describe('set and get', () => {
    it('stores and retrieves a document', () => {
      const doc = createDoc('# Hello')
      cache.set('README.md', doc)

      const retrieved = cache.get('README.md')
      expect(retrieved).toEqual(doc)
    })

    it('returns undefined for non-existent document', () => {
      const result = cache.get('nonexistent.md')
      expect(result).toBeUndefined()
    })

    it('updates existing document', () => {
      const doc1 = createDoc('# First')
      const doc2 = createDoc('# Second')

      cache.set('file.md', doc1)
      cache.set('file.md', doc2)

      expect(cache.get('file.md')).toEqual(doc2)
      expect(cache.size).toBe(1)
    })

    it('get marks document as recently used', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))

      // Access 'a' to make it most recently used
      cache.get('a.md')

      const keys = cache.keys()
      // 'a' should be last (most recently used)
      expect(keys[keys.length - 1]).toBe('a.md')
    })
  })

  describe('has', () => {
    it('returns true for cached document', () => {
      cache.set('file.md', createDoc('content'))
      expect(cache.has('file.md')).toBe(true)
    })

    it('returns false for non-cached document', () => {
      expect(cache.has('missing.md')).toBe(false)
    })

    it('does not mark document as recently used', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))

      // has should not change LRU order
      cache.has('a.md')

      const keys = cache.keys()
      expect(keys[0]).toBe('a.md') // Still least recently used
    })
  })

  describe('delete', () => {
    it('removes document from cache', () => {
      cache.set('file.md', createDoc('content'))
      expect(cache.has('file.md')).toBe(true)

      const deleted = cache.delete('file.md')
      expect(deleted).toBe(true)
      expect(cache.has('file.md')).toBe(false)
      expect(cache.size).toBe(0)
    })

    it('returns false when deleting non-existent document', () => {
      const deleted = cache.delete('missing.md')
      expect(deleted).toBe(false)
    })

    it('decreases size correctly', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      expect(cache.size).toBe(2)

      cache.delete('a.md')
      expect(cache.size).toBe(1)
    })
  })

  describe('clear', () => {
    it('removes all documents from cache', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))
      expect(cache.size).toBe(3)

      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.has('a.md')).toBe(false)
      expect(cache.has('b.md')).toBe(false)
      expect(cache.has('c.md')).toBe(false)
    })

    it('works on empty cache', () => {
      expect(() => cache.clear()).not.toThrow()
      expect(cache.size).toBe(0)
    })
  })

  describe('LRU eviction', () => {
    it('evicts least recently used item when cache is full', () => {
      const smallCache = new DocumentCache(3)

      smallCache.set('a.md', createDoc('a'))
      smallCache.set('b.md', createDoc('b'))
      smallCache.set('c.md', createDoc('c'))
      expect(smallCache.size).toBe(3)

      // This should evict 'a.md'
      smallCache.set('d.md', createDoc('d'))

      expect(smallCache.size).toBe(3)
      expect(smallCache.has('a.md')).toBe(false)
      expect(smallCache.has('b.md')).toBe(true)
      expect(smallCache.has('c.md')).toBe(true)
      expect(smallCache.has('d.md')).toBe(true)
    })

    it('evicts correct item after access changes LRU order', () => {
      const smallCache = new DocumentCache(3)

      smallCache.set('a.md', createDoc('a'))
      smallCache.set('b.md', createDoc('b'))
      smallCache.set('c.md', createDoc('c'))

      // Access 'a' to make it recently used
      smallCache.get('a.md')

      // Now 'b' should be least recently used
      smallCache.set('d.md', createDoc('d'))

      expect(smallCache.has('a.md')).toBe(true)
      expect(smallCache.has('b.md')).toBe(false) // Evicted
      expect(smallCache.has('c.md')).toBe(true)
      expect(smallCache.has('d.md')).toBe(true)
    })

    it('handles eviction with size 1 cache', () => {
      const tinyCache = new DocumentCache(1)

      tinyCache.set('a.md', createDoc('a'))
      expect(tinyCache.size).toBe(1)

      tinyCache.set('b.md', createDoc('b'))
      expect(tinyCache.size).toBe(1)
      expect(tinyCache.has('a.md')).toBe(false)
      expect(tinyCache.has('b.md')).toBe(true)
    })

    it('updating existing item does not trigger eviction', () => {
      const smallCache = new DocumentCache(2)

      smallCache.set('a.md', createDoc('a'))
      smallCache.set('b.md', createDoc('b'))
      expect(smallCache.size).toBe(2)

      // Update 'a' with new content
      smallCache.set('a.md', createDoc('updated a'))
      expect(smallCache.size).toBe(2)
      expect(smallCache.has('a.md')).toBe(true)
      expect(smallCache.has('b.md')).toBe(true)
    })
  })

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      expect(cache.size).toBe(0)
    })

    it('returns correct size after adding items', () => {
      cache.set('a.md', createDoc('a'))
      expect(cache.size).toBe(1)

      cache.set('b.md', createDoc('b'))
      expect(cache.size).toBe(2)
    })

    it('returns correct size after removing items', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      expect(cache.size).toBe(2)

      cache.delete('a.md')
      expect(cache.size).toBe(1)
    })
  })

  describe('keys', () => {
    it('returns empty array for empty cache', () => {
      expect(cache.keys()).toEqual([])
    })

    it('returns all keys in LRU order', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))

      const keys = cache.keys()
      expect(keys).toEqual(['a.md', 'b.md', 'c.md'])
    })

    it('reflects LRU order after access', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))

      // Access 'a' to move it to end
      cache.get('a.md')

      const keys = cache.keys()
      expect(keys).toEqual(['b.md', 'c.md', 'a.md'])
    })
  })

  describe('entries', () => {
    it('returns empty array for empty cache', () => {
      expect(cache.entries()).toEqual([])
    })

    it('returns all entries in LRU order', () => {
      const docA = createDoc('a')
      const docB = createDoc('b')

      cache.set('a.md', docA)
      cache.set('b.md', docB)

      const entries = cache.entries()
      expect(entries).toEqual([
        ['a.md', docA],
        ['b.md', docB]
      ])
    })

    it('reflects LRU order after access', () => {
      const docA = createDoc('a')
      const docB = createDoc('b')

      cache.set('a.md', docA)
      cache.set('b.md', docB)

      cache.get('a.md')

      const entries = cache.entries()
      expect(entries[0][0]).toBe('b.md')
      expect(entries[1][0]).toBe('a.md')
    })
  })

  describe('getMaxSize', () => {
    it('returns the maximum cache size', () => {
      const cache3 = new DocumentCache(3)
      const cache10 = new DocumentCache(10)

      expect(cache3.getMaxSize()).toBe(3)
      expect(cache10.getMaxSize()).toBe(10)
    })
  })

  describe('updateCursor', () => {
    it('updates cursor position for existing document', () => {
      const doc = createDoc('content')
      cache.set('file.md', doc)

      const updated = cache.updateCursor('file.md', { line: 5, column: 10 })
      expect(updated).toBe(true)

      const retrieved = cache.get('file.md')
      expect(retrieved?.cursor).toEqual({ line: 5, column: 10 })
    })

    it('returns false for non-existent document', () => {
      const updated = cache.updateCursor('missing.md', { line: 1, column: 0 })
      expect(updated).toBe(false)
    })

    it('does not change LRU order', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))

      // Update cursor for 'a' (oldest)
      cache.updateCursor('a.md', { line: 10, column: 5 })

      const keys = cache.keys()
      expect(keys[0]).toBe('a.md') // Still least recently used
    })

    it('preserves other document properties', () => {
      const doc = createDoc('# Content')
      doc.scrollTop = 100
      cache.set('file.md', doc)

      cache.updateCursor('file.md', { line: 5, column: 10 })

      const retrieved = cache.get('file.md')
      expect(retrieved?.content).toBe('# Content')
      expect(retrieved?.scrollTop).toBe(100)
      expect(retrieved?.cachedAt).toBe(doc.cachedAt)
    })
  })

  describe('updateScrollTop', () => {
    it('updates scroll position for existing document', () => {
      const doc = createDoc('content')
      cache.set('file.md', doc)

      const updated = cache.updateScrollTop('file.md', 250)
      expect(updated).toBe(true)

      const retrieved = cache.get('file.md')
      expect(retrieved?.scrollTop).toBe(250)
    })

    it('returns false for non-existent document', () => {
      const updated = cache.updateScrollTop('missing.md', 100)
      expect(updated).toBe(false)
    })

    it('does not change LRU order', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))
      cache.set('c.md', createDoc('c'))

      // Update scroll for 'a' (oldest)
      cache.updateScrollTop('a.md', 300)

      const keys = cache.keys()
      expect(keys[0]).toBe('a.md') // Still least recently used
    })

    it('preserves other document properties', () => {
      const doc = createDoc('# Content')
      doc.cursor = { line: 5, column: 10 }
      cache.set('file.md', doc)

      cache.updateScrollTop('file.md', 200)

      const retrieved = cache.get('file.md')
      expect(retrieved?.content).toBe('# Content')
      expect(retrieved?.cursor).toEqual({ line: 5, column: 10 })
      expect(retrieved?.cachedAt).toBe(doc.cachedAt)
    })
  })

  describe('complex LRU scenarios', () => {
    it('maintains correct order through mixed operations', () => {
      const smallCache = new DocumentCache(4)

      smallCache.set('a.md', createDoc('a'))
      smallCache.set('b.md', createDoc('b'))
      smallCache.set('c.md', createDoc('c'))
      smallCache.set('d.md', createDoc('d'))

      // Access b and c
      smallCache.get('b.md')
      smallCache.get('c.md')

      // Order should now be: a, d, b, c
      expect(smallCache.keys()).toEqual(['a.md', 'd.md', 'b.md', 'c.md'])

      // Add new item, should evict 'a'
      smallCache.set('e.md', createDoc('e'))
      expect(smallCache.has('a.md')).toBe(false)
      expect(smallCache.keys()).toEqual(['d.md', 'b.md', 'c.md', 'e.md'])
    })

    it('handles repeated access of same item', () => {
      cache.set('a.md', createDoc('a'))
      cache.set('b.md', createDoc('b'))

      cache.get('a.md')
      cache.get('a.md')
      cache.get('a.md')

      // 'a' should still be most recently used (last in order)
      const keys = cache.keys()
      expect(keys[keys.length - 1]).toBe('a.md')
    })

    it('handles alternating set and get operations', () => {
      const smallCache = new DocumentCache(3)

      smallCache.set('a.md', createDoc('a'))  // [a]
      smallCache.get('a.md')                   // [a]
      smallCache.set('b.md', createDoc('b'))  // [a, b]
      smallCache.get('a.md')                   // [b, a] - a moved to end
      smallCache.set('c.md', createDoc('c'))  // [b, a, c]
      smallCache.get('b.md')                   // [a, c, b] - b moved to end
      smallCache.set('d.md', createDoc('d'))  // [c, b, d] - a evicted

      // After operations, 'a' is least recently used and gets evicted
      expect(smallCache.has('a.md')).toBe(false) // Evicted
      expect(smallCache.has('b.md')).toBe(true)
      expect(smallCache.has('c.md')).toBe(true)
      expect(smallCache.has('d.md')).toBe(true)
    })
  })
})
