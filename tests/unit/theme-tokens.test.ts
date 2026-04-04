import { describe, it, expect } from 'vitest'
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  TOKEN_KEYS,
} from '../../src/renderer/lib/theme-tokens'

describe('DARK_TOKENS', () => {
  it('has all required token keys', () => {
    for (const key of TOKEN_KEYS) {
      expect(DARK_TOKENS[key]).toBeDefined()
      expect(DARK_TOKENS[key]).not.toBe('')
    }
  })

  it('has dark background values', () => {
    expect(DARK_TOKENS['color-bg']).toBe('#0f0f10')
    expect(DARK_TOKENS['color-surface']).toBe('#161617')
  })

  it('has light text values', () => {
    expect(DARK_TOKENS['color-text']).toBe('#e4e4e7')
    expect(DARK_TOKENS['color-text-white']).toBe('#ffffff')
  })

  it('has white overlay values', () => {
    expect(DARK_TOKENS['overlay-hover']).toContain('255, 255, 255')
    expect(DARK_TOKENS['overlay-active']).toContain('255, 255, 255')
    expect(DARK_TOKENS['overlay-border']).toContain('255, 255, 255')
  })
})

describe('LIGHT_TOKENS', () => {
  it('has all required token keys', () => {
    for (const key of TOKEN_KEYS) {
      expect(LIGHT_TOKENS[key]).toBeDefined()
      expect(LIGHT_TOKENS[key]).not.toBe('')
    }
  })

  it('has same keys as DARK_TOKENS', () => {
    const darkKeys = Object.keys(DARK_TOKENS).sort()
    const lightKeys = Object.keys(LIGHT_TOKENS).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('has light background values with white canvas', () => {
    // bg and surface should be light grays, canvas should be white
    expect(LIGHT_TOKENS['color-canvas']).toBe('#ffffff')
    // bg/surface should be lighter than dark mode
    expect(LIGHT_TOKENS['color-bg']).not.toBe(DARK_TOKENS['color-bg'])
    expect(LIGHT_TOKENS['color-surface']).not.toBe(DARK_TOKENS['color-surface'])
  })

  it('has dark text values', () => {
    expect(LIGHT_TOKENS['color-text']).toBe('#2c2c2e')
    expect(LIGHT_TOKENS['color-text-white']).toBe('#1a1a1c')
  })

  it('has black overlay values (inverted from dark mode)', () => {
    expect(LIGHT_TOKENS['overlay-hover']).toContain('0, 0, 0')
    expect(LIGHT_TOKENS['overlay-active']).toContain('0, 0, 0')
    expect(LIGHT_TOKENS['overlay-border']).toContain('0, 0, 0')
  })

  it('light values differ from dark values for all color tokens', () => {
    const colorKeys = TOKEN_KEYS.filter(
      (k) => k.startsWith('color-') || k.startsWith('overlay-') || k.startsWith('scrollbar-')
    )
    for (const key of colorKeys) {
      expect(LIGHT_TOKENS[key]).not.toBe(DARK_TOKENS[key])
    }
  })
})

describe('TOKEN_KEYS', () => {
  it('lists all keys from DARK_TOKENS', () => {
    expect(TOKEN_KEYS).toHaveLength(Object.keys(DARK_TOKENS).length)
  })
})
