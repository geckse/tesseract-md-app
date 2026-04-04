/**
 * Color Utilities — mdvdb
 *
 * Pure functions for color manipulation, luminance checks,
 * and accent color variant derivation.
 */

/** HSL color representation */
export interface HslColor {
  h: number // 0-360
  s: number // 0-100
  l: number // 0-100
}

/** Derived primary color variants for CSS custom properties */
export interface PrimaryVariants {
  primary: string // hex
  dark: string // darkened hex
  dim: string // rgba at 10% opacity
  glow: string // rgba at 40% opacity
}

/** Parse a hex color string to RGB components (0-255) */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  }
}

/** Convert hex color to HSL */
export function hexToHsl(hex: string): HslColor {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255

  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h = 0
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6
  } else {
    h = ((rn - gn) / d + 4) / 6
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

/** Convert HSL to hex color string */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100

  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2

  let r = 0,
    g = 0,
    b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Convert hex color to rgba string */
export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Calculate WCAG relative luminance (0-1).
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)

  const linearize = (c: number) => {
    const srgb = c / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** Darken a hex color by a percentage (0-100) */
export function darken(hex: string, amount: number): string {
  const hsl = hexToHsl(hex)
  hsl.l = Math.max(0, hsl.l * (1 - amount / 100))
  return hslToHex(hsl.h, hsl.s, hsl.l)
}

/** Check if a color has sufficient luminance for visibility on dark backgrounds */
export function isLuminanceAcceptable(hex: string, minLuminance = 0.15): boolean {
  return relativeLuminance(hex) >= minLuminance
}

/** Adjust a color to meet minimum luminance by increasing lightness */
export function adjustToMinLuminance(hex: string, minLuminance = 0.15): string {
  if (isLuminanceAcceptable(hex, minLuminance)) return hex

  const hsl = hexToHsl(hex)
  // Incrementally increase lightness until luminance threshold is met
  while (hsl.l < 100) {
    hsl.l = Math.min(100, hsl.l + 2)
    const candidate = hslToHex(hsl.h, hsl.s, hsl.l)
    if (isLuminanceAcceptable(candidate, minLuminance)) {
      return candidate
    }
  }
  return hslToHex(hsl.h, hsl.s, hsl.l)
}

/** Derive all primary CSS variable values from a single hex color */
export function derivePrimaryVariants(hex: string): PrimaryVariants {
  return {
    primary: hex,
    dark: darken(hex, 20),
    dim: hexToRgba(hex, 0.1),
    glow: hexToRgba(hex, 0.4),
  }
}

/** Curated preset colors that maintain good contrast on dark backgrounds */
export const PRESET_COLORS: { name: string; hex: string }[] = [
  { name: 'Cyan', hex: '#00E5FF' },
  { name: 'Green', hex: '#34D399' },
  { name: 'Purple', hex: '#A78BFA' },
  { name: 'Pink', hex: '#F472B6' },
  { name: 'Orange', hex: '#FB923C' },
  { name: 'Yellow', hex: '#FBBF24' },
  { name: 'Blue', hex: '#60A5FA' },
  { name: 'Red', hex: '#F87171' },
  { name: 'Teal', hex: '#2DD4BF' },
  { name: 'Lime', hex: '#A3E635' },
]

/** The default primary color */
export const DEFAULT_PRIMARY = '#00E5FF'
