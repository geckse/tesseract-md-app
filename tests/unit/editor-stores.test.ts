import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { isDirty, wordCount, tokenCount, countWords, countTokens } from '../../src/renderer/stores/editor'

describe('editor stores', () => {
  beforeEach(() => {
    isDirty.set(false)
    wordCount.set(0)
    tokenCount.set(0)
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

  describe('countTokens', () => {
    it('returns 0 for empty string', () => {
      expect(countTokens('')).toBe(0)
    })

    it('returns a positive number for non-empty text', () => {
      expect(countTokens('hello world')).toBeGreaterThan(0)
    })

    it('returns more tokens for longer text', () => {
      const short = countTokens('hello')
      const long = countTokens('hello world this is a longer sentence')
      expect(long).toBeGreaterThan(short)
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

  describe('tokenCount', () => {
    it('defaults to 0', () => {
      expect(get(tokenCount)).toBe(0)
    })

    it('can be updated', () => {
      tokenCount.set(100)
      expect(get(tokenCount)).toBe(100)
    })
  })
})
