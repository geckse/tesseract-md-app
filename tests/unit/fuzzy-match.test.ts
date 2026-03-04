import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyFilter } from '@renderer/lib/fuzzy-match'

describe('fuzzyMatch', () => {
  it('returns zero score and empty indices for empty query', () => {
    const result = fuzzyMatch('', 'test.md')
    expect(result).toEqual({ score: 0, indices: [] })
  })

  it('matches simple single character', () => {
    const result = fuzzyMatch('t', 'test.md')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThan(0)
    expect(result!.indices).toEqual([0])
  })

  it('matches all characters in order', () => {
    const result = fuzzyMatch('test', 'test.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0, 1, 2, 3])
  })

  it('matches non-consecutive characters', () => {
    const result = fuzzyMatch('tm', 'test.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toContain(0) // t
    expect(result!.indices).toContain(5) // m
  })

  it('returns null when characters are out of order', () => {
    const result = fuzzyMatch('tse', 'test.md')
    expect(result).toBeNull()
  })

  it('returns null when query has characters not in target', () => {
    const result = fuzzyMatch('xyz', 'test.md')
    expect(result).toBeNull()
  })

  it('is case-insensitive for matching', () => {
    const result = fuzzyMatch('TEST', 'test.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0, 1, 2, 3])
  })

  it('gives bonus for case-sensitive exact matches', () => {
    const lowerResult = fuzzyMatch('test', 'test.md')
    const upperResult = fuzzyMatch('test', 'TEST.md')

    expect(lowerResult!.score).toBeGreaterThan(upperResult!.score)
  })

  it('gives bonus for consecutive character matches', () => {
    const consecutiveResult = fuzzyMatch('tes', 'test.md')
    const nonConsecutiveResult = fuzzyMatch('tst', 'test.md')

    expect(consecutiveResult!.score).toBeGreaterThan(nonConsecutiveResult!.score)
  })

  it('gives bonus for matches at word boundaries after /', () => {
    const boundaryResult = fuzzyMatch('c', 'path/to/config.md')
    expect(boundaryResult).not.toBeNull()
    expect(boundaryResult!.indices).toContain(8) // c in config
  })

  it('gives bonus for matches at word boundaries after -', () => {
    const result = fuzzyMatch('b', 'test-bar.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toContain(5) // b in bar
  })

  it('gives bonus for matches at word boundaries after _', () => {
    const result = fuzzyMatch('f', 'test_file.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toContain(5) // f in file
  })

  it('gives bonus for matches at word boundaries after space', () => {
    const result = fuzzyMatch('w', 'hello world.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toContain(6) // w in world
  })

  it('gives bonus for match at start of string', () => {
    const startResult = fuzzyMatch('t', 'test.md')
    const middleResult = fuzzyMatch('s', 'test.md')

    expect(startResult!.score).toBeGreaterThan(middleResult!.score)
  })

  it('prefers shorter targets', () => {
    const shortResult = fuzzyMatch('test', 'test.md')
    const longResult = fuzzyMatch('test', 'very/long/path/to/test.md')

    expect(shortResult!.score).toBeGreaterThan(longResult!.score)
  })

  it('handles complex path matching', () => {
    const result = fuzzyMatch('prt', 'docs/project-readme.md')
    expect(result).not.toBeNull()
    expect(result!.indices.length).toBe(3)
  })

  it('matches abbreviated queries against full paths', () => {
    const result = fuzzyMatch('dpr', 'docs/projects/readme.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toContain(0) // d
    expect(result!.indices).toContain(5) // p
    expect(result!.indices).toContain(6) // r (matches first 'r' in 'projects')
  })

  it('gives higher scores to better matches', () => {
    const exactResult = fuzzyMatch('readme', 'readme.md')
    const partialResult = fuzzyMatch('readme', 'docs/old-readme-backup.md')

    expect(exactResult!.score).toBeGreaterThan(partialResult!.score)
  })

  it('handles single character targets', () => {
    const result = fuzzyMatch('a', 'a')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0])
  })

  it('handles unicode characters', () => {
    const result = fuzzyMatch('café', 'café.md')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0, 1, 2, 3])
  })

  it('returns null when query is longer than target', () => {
    const result = fuzzyMatch('verylongquery', 'short')
    expect(result).toBeNull()
  })
})

describe('fuzzyFilter', () => {
  const items = [
    { name: 'readme.md' },
    { name: 'docs/api-reference.md' },
    { name: 'src/components/Button.tsx' },
    { name: 'src/lib/fuzzy-match.ts' },
    { name: 'tests/unit/fuzzy-match.test.ts' }
  ]

  it('filters items by query', () => {
    const results = fuzzyFilter('readme', items, (item) => item.name)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item.name).toBe('readme.md')
  })

  it('returns empty array when no matches', () => {
    const results = fuzzyFilter('xyz', items, (item) => item.name)
    expect(results).toEqual([])
  })

  it('sorts results by score descending', () => {
    const results = fuzzyFilter('test', items, (item) => item.name)

    expect(results.length).toBeGreaterThan(0)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].match.score).toBeGreaterThanOrEqual(results[i + 1].match.score)
    }
  })

  it('includes match metadata in results', () => {
    const results = fuzzyFilter('fuzzy', items, (item) => item.name)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].match).toHaveProperty('score')
    expect(results[0].match).toHaveProperty('indices')
    expect(results[0].match.indices.length).toBeGreaterThan(0)
  })

  it('handles empty query by returning all items', () => {
    const results = fuzzyFilter('', items, (item) => item.name)

    expect(results).toHaveLength(items.length)
    expect(results.every((r) => r.match.score === 0)).toBe(true)
  })

  it('ranks exact matches higher', () => {
    const results = fuzzyFilter('readme', items, (item) => item.name)

    expect(results[0].item.name).toBe('readme.md')
  })

  it('uses custom getText function', () => {
    const itemsWithPath = [
      { id: 1, path: 'test.md' },
      { id: 2, path: 'docs/test.md' }
    ]

    const results = fuzzyFilter('test', itemsWithPath, (item) => item.path)

    expect(results.length).toBe(2)
    expect(results.every((r) => r.item.path.includes('test'))).toBe(true)
  })

  it('handles items with complex nested paths', () => {
    const nestedItems = [
      { file: 'src/components/ui/Button.tsx' },
      { file: 'src/components/Button.svelte' },
      { file: 'tests/unit/Button.test.ts' }
    ]

    const results = fuzzyFilter('btn', nestedItems, (item) => item.file)

    expect(results.length).toBeGreaterThan(0)
  })

  it('works with empty array', () => {
    const results = fuzzyFilter('test', [], (item: any) => item.name)
    expect(results).toEqual([])
  })

  it('ranks file in root higher than nested paths for same match', () => {
    const testItems = [
      { path: 'very/deep/nested/path/readme.md' },
      { path: 'readme.md' }
    ]

    const results = fuzzyFilter('readme', testItems, (item) => item.path)

    expect(results[0].item.path).toBe('readme.md')
  })

  it('ranks consecutive character matches higher', () => {
    const testItems = [
      { path: 'test-file.md' }, // 'test' is consecutive
      { path: 'path/testing.md' } // 'test' is consecutive in 'testing'
    ]

    const results = fuzzyFilter('test', testItems, (item) => item.path)

    // Both have consecutive matches, but shorter path ranks higher
    expect(results[0].item.path).toBe('test-file.md')
  })
})
