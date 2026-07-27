export type PropertyValueColorPalette = 'accent' | 'neutral'

export interface PropertyValueColorSelection {
  palette: PropertyValueColorPalette
  slot: number
}

/** Synced selections, keyed by frontmatter field then value. */
export type PropertyValueColors = Record<string, Record<string, PropertyValueColorSelection>>

/** Harmonic theme/accent colors. */
export const PROPERTY_VALUE_ACCENT_COLOR_COUNT = 24

/** Theme-aware grayscale brightness steps. */
export const PROPERTY_VALUE_NEUTRAL_COLOR_COUNT = 12

/** Backward-compatible alias for the original accent palette count. */
export const PROPERTY_VALUE_COLOR_COUNT = PROPERTY_VALUE_ACCENT_COLOR_COUNT
