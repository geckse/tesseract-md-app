/**
 * Accent Color Store — mdvdb
 *
 * Manages the active primary accent color with global and per-collection overrides.
 * Subscribing to `primaryVariants` gives derived CSS variable values that can be
 * applied to the document root.
 */

import { writable, derived } from 'svelte/store'
import { derivePrimaryVariants, DEFAULT_PRIMARY, type PrimaryVariants } from '../lib/color-utils'

/** The global primary color (null = default cyan) */
export const globalPrimaryColor = writable<string | null>(null)

/** Per-collection color override for the active collection (null = use global) */
export const collectionPrimaryColor = writable<string | null>(null)

/** Resolution: collection override > global > default */
export const effectivePrimaryColor = derived(
  [collectionPrimaryColor, globalPrimaryColor],
  ([$coll, $global]) => $coll ?? $global ?? DEFAULT_PRIMARY
)

/** Derived CSS variable values from the effective color */
export const primaryVariants = derived<typeof effectivePrimaryColor, PrimaryVariants>(
  effectivePrimaryColor,
  ($color) => derivePrimaryVariants($color)
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
