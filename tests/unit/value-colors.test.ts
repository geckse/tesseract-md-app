import { describe, expect, it } from 'vitest'
import {
  automaticValueColorSlot,
  createNeutralValueColorPalette,
  createValueColorPalette,
  hashValueColorSlot,
  NEUTRAL_VALUE_COLOR_COUNT,
  VALUE_COLOR_COUNT,
  valueColorSelectionStyle,
  valueColorStyle
} from '../../src/renderer/lib/value-colors'
import { hexToHsl, relativeLuminance } from '../../src/renderer/lib/color-utils'

describe('value colors', () => {
  it('assigns Select colors in configured option order', () => {
    const options = ['draft', 'review', 'published']
    expect(automaticValueColorSlot('status', 'draft', options)).toBe(0)
    expect(automaticValueColorSlot('status', 'review', options)).toBe(1)
    expect(automaticValueColorSlot('status', 'published', options)).toBe(2)
  })

  it('assigns free-form Tags deterministically within palette bounds', () => {
    const first = hashValueColorSlot('tags', 'important')
    expect(hashValueColorSlot('tags', 'important')).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(VALUE_COLOR_COUNT)
  })

  it('regenerates a complete harmonic palette from the accent', () => {
    const cyan = createValueColorPalette('#00d4ff')
    const pink = createValueColorPalette('#f472b6')
    expect(VALUE_COLOR_COUNT).toBe(24)
    expect(cyan.colors).toHaveLength(VALUE_COLOR_COUNT)
    expect(pink.colors).toHaveLength(VALUE_COLOR_COUNT)
    expect(cyan.colors).not.toEqual(pink.colors)
  })

  it('emits theme-safe foreground and base chip variables', () => {
    const palette = createValueColorPalette('#00d4ff')
    expect(valueColorStyle(palette, 0, 'dark')).toMatch(
      /^--value-color: #[0-9a-f]{6}; --value-color-base: #[0-9a-f]{6};$/
    )
  })

  it('offers 12 muted accent-tinted brightness steps for each theme', () => {
    const dark = createNeutralValueColorPalette('#00d4ff', 'dark')
    const light = createNeutralValueColorPalette('#00d4ff', 'light')

    expect(NEUTRAL_VALUE_COLOR_COUNT).toBe(12)
    expect(dark.colors).toHaveLength(NEUTRAL_VALUE_COLOR_COUNT)
    expect(light.colors).toHaveLength(NEUTRAL_VALUE_COLOR_COUNT)
    expect(dark.saturation).toBeGreaterThan(0)
    expect(dark.saturation).toBeLessThanOrEqual(16)
    expect(light.saturation).toBe(dark.saturation)
    expect(hexToHsl(dark.colors[5]).s).toBeGreaterThan(0)
    expect(hexToHsl(dark.colors[5]).s).toBeLessThan(20)
    expect(relativeLuminance(dark.colors[0])).toBeLessThan(relativeLuminance(dark.colors[11]))
    expect(relativeLuminance(light.colors[0])).toBeGreaterThan(relativeLuminance(light.colors[11]))
  })

  it('styles a neutral selection from the neutral palette', () => {
    const accent = createValueColorPalette('#00d4ff')
    const neutral = createNeutralValueColorPalette('#00d4ff', 'dark')
    expect(
      valueColorSelectionStyle(accent, neutral, { palette: 'neutral', slot: 4 }, 'dark')
    ).toContain(`--value-color-base: ${neutral.colors[4]}`)
  })
})
