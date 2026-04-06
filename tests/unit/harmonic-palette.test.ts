import { describe, it, expect } from 'vitest'
import {
  generateHarmonicPalette,
  paletteColor,
  paletteTextColor,
  type HarmonicPalette
} from '@renderer/lib/harmonic-palette'
import { hexToHsl, contrastRatio } from '@renderer/lib/color-utils'

describe('generateHarmonicPalette', () => {
  it('returns the correct number of colors', () => {
    expect(generateHarmonicPalette('#00E5FF', 12).colors).toHaveLength(12)
    expect(generateHarmonicPalette('#00E5FF', 8).colors).toHaveLength(8)
    expect(generateHarmonicPalette('#00E5FF', 3).colors).toHaveLength(3)
    expect(generateHarmonicPalette('#00E5FF', 1).colors).toHaveLength(1)
  })

  it('palette[0] is at the base hue when offset is 0', () => {
    const palette = generateHarmonicPalette('#FF6B6B', 6)
    const baseHsl = hexToHsl('#FF6B6B')
    const firstHsl = hexToHsl(palette.colors[0])
    const diff = Math.abs(firstHsl.h - baseHsl.h)
    expect(Math.min(diff, 360 - diff)).toBeLessThan(3)
  })

  it('palette[0] is offset from the base hue when offset > 0', () => {
    const palette = generateHarmonicPalette('#FF0000', 6, 3)
    const baseHsl = hexToHsl('#FF0000')
    const firstHsl = hexToHsl(palette.colors[0])
    // offset=3 means first color is at baseHue + 3 * goldenAngle
    const goldenAngle = 360 * (1 - 1 / ((1 + Math.sqrt(5)) / 2))
    const expectedHue = (baseHsl.h + 3 * goldenAngle) % 360
    const diff = Math.abs(firstHsl.h - expectedHue)
    expect(Math.min(diff, 360 - diff)).toBeLessThan(3)
  })

  it('all colors are valid hex strings', () => {
    const palette = generateHarmonicPalette('#A78BFA', 12)
    for (const color of palette.colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('uses golden angle spacing (~137.5°) for maximal consecutive distinction', () => {
    const palette = generateHarmonicPalette('#00E5FF', 4)
    const hues = palette.colors.map((c) => hexToHsl(c).h)
    const baseHue = hexToHsl('#00E5FF').h
    const goldenAngle = 360 * (1 - 1 / ((1 + Math.sqrt(5)) / 2))

    for (let i = 0; i < 4; i++) {
      const expectedHue = (baseHue + i * goldenAngle) % 360
      const diff = Math.abs(hues[i] - expectedHue)
      const wrappedDiff = Math.min(diff, 360 - diff)
      expect(wrappedDiff).toBeLessThan(3)
    }
  })

  it('offset shifts all colors by offset * golden angle', () => {
    const noOffset = generateHarmonicPalette('#00E5FF', 4, 0)
    const withOffset = generateHarmonicPalette('#00E5FF', 4, 3)
    // withOffset[0] should match what noOffset[3] would be
    const noOffsetHue3 = hexToHsl(noOffset.colors[3]).h
    const withOffsetHue0 = hexToHsl(withOffset.colors[0]).h
    const diff = Math.abs(noOffsetHue3 - withOffsetHue0)
    expect(Math.min(diff, 360 - diff)).toBeLessThan(3)
  })

  it('consecutive colors have large hue differences', () => {
    const palette = generateHarmonicPalette('#00E5FF', 12)
    const hues = palette.colors.map((c) => hexToHsl(c).h)

    // Check that adjacent indices are at least 90° apart (golden angle ≈ 137.5°)
    for (let i = 0; i < hues.length - 1; i++) {
      const diff = Math.abs(hues[i + 1] - hues[i])
      const wrappedDiff = Math.min(diff, 360 - diff)
      expect(wrappedDiff).toBeGreaterThan(90)
    }
  })

  it('generated colors share the same saturation and lightness', () => {
    const palette = generateHarmonicPalette('#E879F9', 6)
    const hslValues = palette.colors.slice(1).map((c) => hexToHsl(c))

    for (const hsl of hslValues) {
      expect(hsl.s).toBeCloseTo(palette.saturation, 0)
      expect(hsl.l).toBeCloseTo(palette.lightness, 0)
    }
  })

  it('applies saturation floor for near-gray colors', () => {
    const grayPalette = generateHarmonicPalette('#808080', 4)
    // Saturation should be lifted to 40 for generated colors
    expect(grayPalette.saturation).toBe(40)
    // Generated colors (not the base) should have visible saturation
    for (let i = 1; i < 4; i++) {
      const hsl = hexToHsl(grayPalette.colors[i])
      expect(hsl.s).toBeGreaterThan(10)
    }
  })

  it('does not apply saturation floor when saturation >= 10', () => {
    const palette = generateHarmonicPalette('#FF6B6B', 4)
    const baseSat = hexToHsl('#FF6B6B').s
    expect(palette.saturation).toBeCloseTo(baseSat, 0)
  })

  it('clamps lightness for very dark colors', () => {
    const darkPalette = generateHarmonicPalette('#0a0a0a', 4)
    expect(darkPalette.lightness).toBe(25)
  })

  it('clamps lightness for very light colors', () => {
    const lightPalette = generateHarmonicPalette('#fafafa', 4)
    expect(lightPalette.lightness).toBe(75)
  })

  it('does not clamp lightness when within range', () => {
    const palette = generateHarmonicPalette('#E879F9', 4)
    const baseL = hexToHsl('#E879F9').l
    expect(palette.lightness).toBeCloseTo(baseL, 0)
  })

  it('exposes baseHue from the input color', () => {
    const palette = generateHarmonicPalette('#00E5FF', 3)
    const expectedHue = hexToHsl('#00E5FF').h
    expect(palette.baseHue).toBeCloseTo(expectedHue, 0)
  })

  it('all 12 colors are distinct for a saturated base', () => {
    const palette = generateHarmonicPalette('#00E5FF', 12)
    const unique = new Set(palette.colors)
    expect(unique.size).toBe(12)
  })

  it('handles single-color palette', () => {
    const palette = generateHarmonicPalette('#FF0000', 1)
    expect(palette.colors).toHaveLength(1)
    // Round-trip through HSL may lowercase — check hue matches
    const hsl = hexToHsl(palette.colors[0])
    expect(hsl.h).toBeCloseTo(0, 0)
  })
})

describe('paletteColor', () => {
  const palette: HarmonicPalette = {
    colors: ['#AA0000', '#00AA00', '#0000AA'],
    baseHue: 0,
    saturation: 100,
    lightness: 33
  }

  it('returns the correct color for valid indices', () => {
    expect(paletteColor(palette, 0)).toBe('#AA0000')
    expect(paletteColor(palette, 1)).toBe('#00AA00')
    expect(paletteColor(palette, 2)).toBe('#0000AA')
  })

  it('wraps via modulo for indices >= palette size', () => {
    expect(paletteColor(palette, 3)).toBe('#AA0000')
    expect(paletteColor(palette, 4)).toBe('#00AA00')
    expect(paletteColor(palette, 5)).toBe('#0000AA')
    expect(paletteColor(palette, 12)).toBe('#AA0000')
  })

  it('handles negative indices via safe modulo', () => {
    expect(paletteColor(palette, -1)).toBe('#0000AA')
    expect(paletteColor(palette, -2)).toBe('#00AA00')
    expect(paletteColor(palette, -3)).toBe('#AA0000')
  })

  it('handles zero index', () => {
    expect(paletteColor(palette, 0)).toBe('#AA0000')
  })
})

describe('paletteTextColor', () => {
  const darkBg = '#0f0f10'
  const lightBg = '#f5f0eb'

  it('returns the original color when it already has sufficient contrast', () => {
    // Bright cyan on dark bg should pass as-is
    const palette = generateHarmonicPalette('#00E5FF', 3)
    const result = paletteTextColor(palette, 0, darkBg)
    expect(contrastRatio(result, darkBg)).toBeGreaterThanOrEqual(3.0)
  })

  it('lightens dark colors on dark backgrounds to meet 3:1 contrast', () => {
    // Force a very dark blue palette color
    const palette: HarmonicPalette = {
      colors: ['#1a1a80'],
      baseHue: 240,
      saturation: 70,
      lightness: 30
    }
    const result = paletteTextColor(palette, 0, darkBg)
    expect(contrastRatio(result, darkBg)).toBeGreaterThanOrEqual(3.0)
    // Result should be lighter than the input
    const inputL = hexToHsl('#1a1a80').l
    const resultL = hexToHsl(result).l
    expect(resultL).toBeGreaterThan(inputL)
  })

  it('darkens light colors on light backgrounds to meet 3:1 contrast', () => {
    const palette: HarmonicPalette = {
      colors: ['#e0e0ff'],
      baseHue: 240,
      saturation: 100,
      lightness: 94
    }
    const result = paletteTextColor(palette, 0, lightBg)
    expect(contrastRatio(result, lightBg)).toBeGreaterThanOrEqual(3.0)
    const resultL = hexToHsl(result).l
    const inputL = hexToHsl('#e0e0ff').l
    expect(resultL).toBeLessThan(inputL)
  })

  it('preserves hue when adjusting', () => {
    const palette: HarmonicPalette = {
      colors: ['#1a1a80'],
      baseHue: 240,
      saturation: 70,
      lightness: 30
    }
    const result = paletteTextColor(palette, 0, darkBg)
    const originalHue = hexToHsl('#1a1a80').h
    const resultHue = hexToHsl(result).h
    const diff = Math.abs(resultHue - originalHue)
    expect(Math.min(diff, 360 - diff)).toBeLessThan(5)
  })

  it('all 12 cluster colors are readable on dark background', () => {
    const palette = generateHarmonicPalette('#00E5FF', 12, 3)
    for (let i = 0; i < 12; i++) {
      const text = paletteTextColor(palette, i, darkBg)
      expect(contrastRatio(text, darkBg)).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('all 12 cluster colors are readable on light background', () => {
    const palette = generateHarmonicPalette('#00E5FF', 12, 3)
    for (let i = 0; i < 12; i++) {
      const text = paletteTextColor(palette, i, lightBg)
      expect(contrastRatio(text, lightBg)).toBeGreaterThanOrEqual(3.0)
    }
  })
})
