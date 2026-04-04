/**
 * Accent Color Store — mdvdb
 *
 * Manages the active primary accent color with global and per-collection overrides.
 * Resolves per-theme colors: the user's chosen color is kept for modes where it has
 * sufficient contrast, and independently adjusted only for the mode where it doesn't.
 */

import { writable, derived } from 'svelte/store'
import {
  derivePrimaryVariants,
  resolveThemeAwareAccent,
  DEFAULT_PRIMARY,
  type PrimaryVariants,
  type ThemeAwareAccent,
} from '../lib/color-utils'
import { resolvedTheme } from './theme'

/** The global primary color (null = default cyan) */
export const globalPrimaryColor = writable<string | null>(null)

/** Per-collection color override for the active collection (null = use global) */
export const collectionPrimaryColor = writable<string | null>(null)

/** Resolution: collection override > global > default */
export const effectivePrimaryColor = derived(
  [collectionPrimaryColor, globalPrimaryColor],
  ([$coll, $global]) => $coll ?? $global ?? DEFAULT_PRIMARY
)

/** Per-theme resolved accent: user's color + dark-mode color + light-mode color */
export const themeAwareAccent = derived<typeof effectivePrimaryColor, ThemeAwareAccent>(
  effectivePrimaryColor,
  ($color) => resolveThemeAwareAccent($color)
)

/**
 * CSS variable values for the current theme.
 * Picks the right per-theme color (dark or light) based on the resolved theme,
 * so the user's exact color is used when it works, and only the other mode gets adjusted.
 */
export const primaryVariants = derived<
  [typeof themeAwareAccent, typeof resolvedTheme],
  PrimaryVariants
>(
  [themeAwareAccent, resolvedTheme],
  ([$accent, $theme]) => {
    const color = $theme === 'light' ? $accent.lightColor : $accent.darkColor
    return derivePrimaryVariants(color)
  }
)

/** Load the global accent color from electron-store on startup */
export async function loadAccentColors(): Promise<void> {
  try {
    const color = await window.api.getPrimaryColor()
    globalPrimaryColor.set(color)
  } catch {
    // Ignore — will use default
  }
}

/** Load the per-collection accent color override when switching collections */
export async function loadCollectionAccentColor(collectionId: string | null): Promise<void> {
  if (!collectionId) {
    collectionPrimaryColor.set(null)
    return
  }
  try {
    const color = await window.api.getCollectionColor(collectionId)
    collectionPrimaryColor.set(color)
  } catch {
    collectionPrimaryColor.set(null)
  }
}

/** Set the global accent color and persist it */
export async function setGlobalAccentColor(hex: string | null): Promise<void> {
  globalPrimaryColor.set(hex)
  await window.api.setPrimaryColor(hex)
}

/** Set a per-collection accent color override and persist it */
export async function setCollectionAccentColor(
  collectionId: string,
  hex: string | null
): Promise<void> {
  collectionPrimaryColor.set(hex)
  await window.api.setCollectionColor(collectionId, hex)
}
