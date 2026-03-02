import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { isDirty, wordCount, readingTime, countWords } from '../../src/renderer/stores/editor'

describe('editor stores', () => {
  beforeEach(() => {
    isDirty.set(false)
    wordCount.set(0)
  })

  describe('countWords', () => {
    it('returns 0 for empty string', () => {
      expect(countWords('')).toBe(0)
    })

    it('returns 2 for "hello world"', () => {
      expect(countWords('hello world')).toBe(2)
    })

    it('returns 0 for whitespace-only string', () => {
      expect(countWords('   \t\n  ')).toBe(0)
    })
  })

  describe('isDirty', () => {
    it('defaults to false', () => {
      expect(get(isDirty)).toBe(false)
    })

    it('can be set to true', () => {
      isDirty.set(true)
      expect(get(isDirty)).toBe(true)
    })
  })

  describe('wordCount', () => {
    it('defaults to 0', () => {
      expect(get(wordCount)).toBe(0)
    })

    it('can be updated', () => {
      wordCount.set(42)
      expect(get(wordCount)).toBe(42)
    })
  })

  describe('readingTime', () => {
    it('returns 0 when wordCount is 0', () => {
      wordCount.set(0)
      expect(get(readingTime)).toBe(0)
    })

    it('returns 1 for 250 words', () => {
      wordCount.set(250)
      expect(get(readingTime)).toBe(1)
    })

    it('returns 2 for 500 words', () => {
      wordCount.set(500)
      expect(get(readingTime)).toBe(2)
    })

    it('rounds up partial minutes', () => {
      wordCount.set(251)
      expect(get(readingTime)).toBe(2)
    })
  })
})
