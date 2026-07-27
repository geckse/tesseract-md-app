import {
  generateHarmonicPalette,
  paletteColor,
  paletteTextColor,
  type HarmonicPalette
} from './harmonic-palette'
import { hexToHsl, hslToHex, THEME_BACKGROUNDS } from './color-utils'
import type { ResolvedTheme } from './theme-tokens'
import {
  PROPERTY_VALUE_ACCENT_COLOR_COUNT,
  PROPERTY_VALUE_NEUTRAL_COLOR_COUNT,
  type PropertyValueColorSelection
} from '../../shared/value-colors'

export const VALUE_COLOR_COUNT = PROPERTY_VALUE_ACCENT_COLOR_COUNT
export const NEUTRAL_VALUE_COLOR_COUNT = PROPERTY_VALUE_NEUTRAL_COLOR_COUNT

/** Build the theme-aware value palette from the currently resolved accent. */
export function createValueColorPalette(accent: string): HarmonicPalette {
  return generateHarmonicPalette(accent, VALUE_COLOR_COUNT)
}

/**
 * Build a muted, accent-tinted neutral palette whose slots progress from
 * subtle to strong against the current surface. Reversing the brightness
 * direction per theme keeps the slot meaning stable across theme changes.
 */
export function createNeutralValueColorPalette(
  accent: string,
  theme: ResolvedTheme
): HarmonicPalette {
  const accentHsl = hexToHsl(accent)
  const saturation = Math.min(16, Math.max(8, accentHsl.s * 0.18))
  const start = theme === 'dark' ? 32 : 78
  const end = theme === 'dark' ? 92 : 18
  const colors = Array.from({ length: NEUTRAL_VALUE_COLOR_COUNT }, (_, slot) => {
    const progress = slot / Math.max(1, NEUTRAL_VALUE_COLOR_COUNT - 1)
    return hslToHex(accentHsl.h, saturation, start + (end - start) * progress)
  })
  return {
    colors,
    baseHue: accentHsl.h,
    saturation,
    lightness: start
  }
}

/** Stable FNV-1a hash so unconfigured tag values keep the same palette slot. */
export function hashValueColorSlot(field: string, value: string): number {
  const input = `${field}\0${value}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % VALUE_COLOR_COUNT
}

/**
 * Select options follow schema order; free-form Tags fall back to a stable hash.
 * This keeps configured option palettes intuitive while remaining deterministic.
 */
export function automaticValueColorSlot(
  field: string,
  value: string,
  allowedValues?: string[] | null
): number {
  const configuredIndex = allowedValues?.indexOf(value) ?? -1
  return configuredIndex >= 0
    ? configuredIndex % VALUE_COLOR_COUNT
    : hashValueColorSlot(field, value)
}

export function automaticValueColorSelection(
  field: string,
  value: string,
  allowedValues?: string[] | null
): PropertyValueColorSelection {
  return {
    palette: 'accent',
    slot: automaticValueColorSlot(field, value, allowedValues)
  }
}

export function valueColorSelectionColor(
  accentPalette: HarmonicPalette,
  neutralPalette: HarmonicPalette,
  selection: PropertyValueColorSelection
): string {
  return paletteColor(
    selection.palette === 'neutral' ? neutralPalette : accentPalette,
    selection.slot
  )
}

/** CSS custom properties used by value chips. */
export function valueColorStyle(
  palette: HarmonicPalette,
  slot: number,
  theme: ResolvedTheme
): string {
  const base = paletteColor(palette, slot)
  const foreground = paletteTextColor(palette, slot, THEME_BACKGROUNDS[theme])
  return `--value-color: ${foreground}; --value-color-base: ${base};`
}

/** CSS custom properties used by value chips for either synced palette. */
export function valueColorSelectionStyle(
  accentPalette: HarmonicPalette,
  neutralPalette: HarmonicPalette,
  selection: PropertyValueColorSelection,
  theme: ResolvedTheme
): string {
  const palette = selection.palette === 'neutral' ? neutralPalette : accentPalette
  return valueColorStyle(palette, selection.slot, theme)
}
