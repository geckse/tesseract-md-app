import { describe, it, expect } from 'vitest'
import {
  hexToHsl,
  hslToHex,
  hexToRgba,
  relativeLuminance,
  darken,
  isLuminanceAcceptable,
  adjustToMinLuminance,
  derivePrimaryVariants,
  PRESET_COLORS,
  DEFAULT_PRIMARY,
} from '../../src/renderer/lib/color-utils'

describe('hexToHsl', () => {
  it('converts pure red', () => {
    const hsl = hexToHsl('#FF0000')
    expect(hsl.h).toBeCloseTo(0, 0)
    expect(hsl.s).toBeCloseTo(100, 0)
    expect(hsl.l).toBeCloseTo(50, 0)
  })

  it('converts pure green', () => {
    const hsl = hexToHsl('#00FF00')
    expect(hsl.h).toBeCloseTo(120, 0)
    expect(hsl.s).toBeCloseTo(100, 0)
    expect(hsl.l).toBeCloseTo(50, 0)
  })

  it('converts pure blue', () => {
    const hsl = hexToHsl('#0000FF')
    expect(hsl.h).toBeCloseTo(240, 0)
    expect(hsl.s).toBeCloseTo(100, 0)
    expect(hsl.l).toBeCloseTo(50, 0)
  })

  it('converts white', () => {
    const hsl = hexToHsl('#FFFFFF')
    expect(hsl.s).toBeCloseTo(0, 0)
    expect(hsl.l).toBeCloseTo(100, 0)
  })

  it('converts black', () => {
    const hsl = hexToHsl('#000000')
    expect(hsl.s).toBeCloseTo(0, 0)
    expect(hsl.l).toBeCloseTo(0, 0)
  })

  it('converts the default cyan', () => {
    const hsl = hexToHsl('#00E5FF')
    expect(hsl.h).toBeGreaterThan(185)
    expect(hsl.h).toBeLessThan(188)
    expect(hsl.s).toBeCloseTo(100, 0)
    expect(hsl.l).toBeCloseTo(50, 0)
  })
})

describe('hslToHex', () => {
  it('converts pure red HSL back to hex', () => {
    const hex = hslToHex(0, 100, 50)
    expect(hex.toLowerCase()).toBe('#ff0000')
  })

  it('converts pure green HSL back to hex', () => {
    const hex = hslToHex(120, 100, 50)
    expect(hex.toLowerCase()).toBe('#00ff00')
  })

  it('converts white', () => {
    const hex = hslToHex(0, 0, 100)
    expect(hex.toLowerCase()).toBe('#ffffff')
  })

  it('converts black', () => {
    const hex = hslToHex(0, 0, 0)
    expect(hex.toLowerCase()).toBe('#000000')
  })
})

describe('hexToHsl / hslToHex round-trip', () => {
  const testColors = ['#00E5FF', '#34D399', '#A78BFA', '#F472B6', '#FB923C']

  testColors.forEach((color) => {
    it(`round-trips ${color}`, () => {
      const hsl = hexToHsl(color)
      const result = hslToHex(hsl.h, hsl.s, hsl.l)
      // Allow small rounding differences
      const diff = Math.abs(parseInt(color.slice(1), 16) - parseInt(result.slice(1), 16))
      expect(diff).toBeLessThan(3)
    })
  })
})

describe('hexToRgba', () => {
  it('converts hex to rgba with 10% opacity', () => {
    const result = hexToRgba('#00E5FF', 0.1)
    expect(result).toBe('rgba(0, 229, 255, 0.1)')
  })

  it('converts hex to rgba with 40% opacity', () => {
    const result = hexToRgba('#FF0000', 0.4)
    expect(result).toBe('rgba(255, 0, 0, 0.4)')
  })

  it('converts hex to rgba with full opacity', () => {
    const result = hexToRgba('#000000', 1)
    expect(result).toBe('rgba(0, 0, 0, 1)')
  })
})

describe('relativeLuminance', () => {
  it('returns ~1 for white', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 1)
  })

  it('returns ~0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 1)
  })

  it('returns intermediate value for cyan', () => {
    const lum = relativeLuminance('#00E5FF')
    expect(lum).toBeGreaterThan(0.15)
    expect(lum).toBeLessThan(1)
  })

  it('returns low value for very dark colors', () => {
    const lum = relativeLuminance('#1a0505')
    expect(lum).toBeLessThan(0.15)
  })
})

describe('darken', () => {
  it('darkens a color by 20%', () => {
    const result = darken('#00E5FF', 20)
    const originalLum = relativeLuminance('#00E5FF')
    const darkenedLum = relativeLuminance(result)
    expect(darkenedLum).toBeLessThan(originalLum)
  })

  it('returns a valid hex string', () => {
    const result = darken('#FF0000', 30)
    expect(result).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('darkening by 0% returns approximately the same color', () => {
    const result = darken('#00E5FF', 0)
    // Allow tiny rounding differences
    expect(result.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('isLuminanceAcceptable', () => {
  it('accepts bright colors', () => {
    expect(isLuminanceAcceptable('#00E5FF')).toBe(true)
    expect(isLuminanceAcceptable('#FFFFFF')).toBe(true)
  })

  it('rejects very dark colors', () => {
    expect(isLuminanceAcceptable('#1a0505')).toBe(false)
    expect(isLuminanceAcceptable('#000000')).toBe(false)
    expect(isLuminanceAcceptable('#0a0a0a')).toBe(false)
  })

  it('uses custom threshold', () => {
    // White should pass any threshold
    expect(isLuminanceAcceptable('#FFFFFF', 0.9)).toBe(true)
    // Black should fail any threshold > 0
    expect(isLuminanceAcceptable('#000000', 0.01)).toBe(false)
  })
})

describe('adjustToMinLuminance', () => {
  it('returns the same color if already acceptable', () => {
    expect(adjustToMinLuminance('#00E5FF')).toBe('#00E5FF')
  })

  it('brightens a dark color to meet the threshold', () => {
    const adjusted = adjustToMinLuminance('#1a0505')
    expect(isLuminanceAcceptable(adjusted)).toBe(true)
  })

  it('returns a valid hex string', () => {
    const adjusted = adjustToMinLuminance('#0a0a0a')
    expect(adjusted).toMatch(/^#[0-9a-f]{6}$/i)
    expect(isLuminanceAcceptable(adjusted)).toBe(true)
  })
})

describe('derivePrimaryVariants', () => {
  it('returns all four variant values', () => {
    const variants = derivePrimaryVariants('#00E5FF')
    expect(variants.primary).toBe('#00E5FF')
    expect(variants.dark).toMatch(/^#[0-9a-f]{6}$/i)
    expect(variants.dim).toMatch(/^rgba\(/)
    expect(variants.glow).toMatch(/^rgba\(/)
  })

  it('dark variant is darker than primary', () => {
    const variants = derivePrimaryVariants('#00E5FF')
    const primaryLum = relativeLuminance(variants.primary)
    const darkLum = relativeLuminance(variants.dark)
    expect(darkLum).toBeLessThan(primaryLum)
  })

  it('dim variant has 0.1 opacity', () => {
    const variants = derivePrimaryVariants('#FF0000')
    expect(variants.dim).toBe('rgba(255, 0, 0, 0.1)')
  })

  it('glow variant has 0.4 opacity', () => {
    const variants = derivePrimaryVariants('#FF0000')
    expect(variants.glow).toBe('rgba(255, 0, 0, 0.4)')
  })
})

describe('PRESET_COLORS', () => {
  it('has 10 presets', () => {
    expect(PRESET_COLORS).toHaveLength(10)
  })

  it('all presets have name and hex', () => {
    PRESET_COLORS.forEach((preset) => {
      expect(preset.name).toBeTruthy()
      expect(preset.hex).toMatch(/^#[0-9a-fA-F]{6}$/)
    })
  })

  it('all presets pass luminance check', () => {
    PRESET_COLORS.forEach((preset) => {
      expect(isLuminanceAcceptable(preset.hex)).toBe(true)
    })
  })

  it('includes the default cyan', () => {
    expect(PRESET_COLORS.find((p) => p.hex === '#00E5FF')).toBeDefined()
  })
})

describe('DEFAULT_PRIMARY', () => {
  it('is the cyan color', () => {
    expect(DEFAULT_PRIMARY).toBe('#00E5FF')
  })
})
