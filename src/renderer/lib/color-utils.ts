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

/** Per-theme resolved accent colors: the user's choice + adjusted versions for each mode */
export interface ThemeAwareAccent {
  userColor: string // the user's original choice
  darkColor: string // color used in dark mode (user's if it fits, adjusted if not)
  lightColor: string // color used in light mode (user's if it fits, adjusted if not)
  darkAdjusted: boolean // true if dark mode needed adjustment
  lightAdjusted: boolean // true if light mode needed adjustment
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

/**
 * Calculate WCAG contrast ratio between two colors.
 * Returns a value between 1 (no contrast) and 21 (max contrast).
 * WCAG AA requires 4.5:1 for normal text, 3:1 for large text.
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Background colors for each theme mode */
export const THEME_BACKGROUNDS = {
  dark: '#0f0f10',
  light: '#f6f6f6',
} as const

/** Check if a color has sufficient luminance for visibility on dark backgrounds */
export function isLuminanceAcceptable(hex: string, minLuminance = 0.15): boolean {
  return relativeLuminance(hex) >= minLuminance
}

/**
 * Check if an accent color has acceptable contrast against a specific background.
 * Uses WCAG AA large-text threshold (3:1) since accent colors are used for
 * UI elements, icons, and interactive controls — not body text.
 */
export function isContrastAcceptable(
  accentHex: string,
  backgroundHex: string,
  minRatio = 3.0
): boolean {
  return contrastRatio(accentHex, backgroundHex) >= minRatio
}

/**
 * Check accent color visibility for both theme modes.
 * Returns which modes have insufficient contrast.
 */
export function checkAccentContrast(hex: string): {
  darkOk: boolean
  lightOk: boolean
  darkRatio: number
  lightRatio: number
} {
  const darkRatio = contrastRatio(hex, THEME_BACKGROUNDS.dark)
  const lightRatio = contrastRatio(hex, THEME_BACKGROUNDS.light)
  return {
    darkOk: darkRatio >= 3.0,
    lightOk: lightRatio >= 3.0,
    darkRatio: Math.round(darkRatio * 10) / 10,
    lightRatio: Math.round(lightRatio * 10) / 10,
  }
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

/**
 * Adjust a color to meet contrast requirements against a specific background.
 * Brightens for dark backgrounds, darkens for light backgrounds.
 */
export function adjustForContrast(
  hex: string,
  backgroundHex: string,
  minRatio = 3.0
): string {
  if (isContrastAcceptable(hex, backgroundHex, minRatio)) return hex

  const bgLum = relativeLuminance(backgroundHex)
  const hsl = hexToHsl(hex)
  const shouldBrighten = bgLum < 0.5

  for (let i = 0; i < 50; i++) {
    hsl.l = shouldBrighten ? Math.min(100, hsl.l + 2) : Math.max(0, hsl.l - 2)
    const candidate = hslToHex(hsl.h, hsl.s, hsl.l)
    if (isContrastAcceptable(candidate, backgroundHex, minRatio)) {
      return candidate
    }
  }
  return hslToHex(hsl.h, hsl.s, hsl.l)
}

/**
 * Suggest the best version of a color for a given background.
 * If the color already works, returns it unchanged.
 */
export function suggestAccentForBackground(
  hex: string,
  backgroundHex: string
): { color: string; adjusted: boolean } {
  if (isContrastAcceptable(hex, backgroundHex)) {
    return { color: hex, adjusted: false }
  }
  return { color: adjustForContrast(hex, backgroundHex), adjusted: true }
}

/**
 * Resolve a user's accent color into per-theme variants.
 * Keeps the user's exact color for any mode where it already has sufficient contrast,
 * and only adjusts independently for the mode where it doesn't.
 */
export function resolveThemeAwareAccent(hex: string, minRatio = 3.0): ThemeAwareAccent {
  const darkBg = THEME_BACKGROUNDS.dark
  const lightBg = THEME_BACKGROUNDS.light
  const darkOk = isContrastAcceptable(hex, darkBg, minRatio)
  const lightOk = isContrastAcceptable(hex, lightBg, minRatio)
  return {
    userColor: hex,
    darkColor: darkOk ? hex : adjustForContrast(hex, darkBg, minRatio),
    lightColor: lightOk ? hex : adjustForContrast(hex, lightBg, minRatio),
    darkAdjusted: !darkOk,
    lightAdjusted: !lightOk,
  }
}

/** Derive CSS variable values from a hex color */
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
