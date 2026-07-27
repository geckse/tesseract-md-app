import { derived, get, writable } from 'svelte/store'
import type { MdvdbApi } from '../../preload/api'
import {
  PROPERTY_VALUE_ACCENT_COLOR_COUNT,
  PROPERTY_VALUE_NEUTRAL_COLOR_COUNT,
  type PropertyValueColors,
  type PropertyValueColorSelection
} from '../../shared/value-colors'
import { createNeutralValueColorPalette, createValueColorPalette } from '../lib/value-colors'
import { primaryVariants } from './accent-color'
import { resolvedTheme } from './theme'

type ColorsByContext = Record<string, PropertyValueColors>

/** Loaded presentation overrides, keyed by collection/scope context → field → value. */
export const propertyValueColorOverrides = writable<ColorsByContext>({})

/** Suggested palette follows the resolved collection accent and theme. */
export const valueColorPalette = derived(primaryVariants, ($primary) =>
  createValueColorPalette($primary.primary)
)

/** Theme-aware, muted accent-tinted brightness steps. */
export const neutralValueColorPalette = derived(
  [primaryVariants, resolvedTheme],
  ([$primary, $theme]) => createNeutralValueColorPalette($primary.primary, $theme)
)

const loadedContexts = new Set<string>()
const pendingLoads = new Map<string, Promise<void>>()

function contextKey(collectionId: string, scope: string | null): string {
  return `${collectionId}\0${scope ?? ''}`
}

function optionalApi(): Partial<MdvdbApi> | null {
  if (typeof window === 'undefined' || !window.api) return null
  return window.api
}

function normalizedSelection(raw: unknown): PropertyValueColorSelection | null {
  // Older renderer mocks and app versions returned numeric accent slots.
  if (
    Number.isInteger(raw) &&
    (raw as number) >= 0 &&
    (raw as number) < PROPERTY_VALUE_ACCENT_COLOR_COUNT
  ) {
    return { palette: 'accent', slot: raw as number }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const { palette, slot } = raw as Record<string, unknown>
  const count =
    palette === 'accent'
      ? PROPERTY_VALUE_ACCENT_COLOR_COUNT
      : palette === 'neutral'
        ? PROPERTY_VALUE_NEUTRAL_COLOR_COUNT
        : 0
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= count) return null
  return { palette, slot: slot as number } as PropertyValueColorSelection
}

function sanitizedColors(colors: PropertyValueColors): PropertyValueColors {
  const result: PropertyValueColors = {}
  for (const [field, values] of Object.entries(colors ?? {})) {
    const validValues: Record<string, PropertyValueColorSelection> = {}
    for (const [value, rawSelection] of Object.entries(values ?? {})) {
      const selection = normalizedSelection(rawSelection)
      if (selection) validValues[value] = selection
    }
    if (Object.keys(validValues).length > 0) result[field] = validValues
  }
  return result
}

/** Load one schema scope once; multiple cells can safely request this concurrently. */
export function loadPropertyValueColors(
  collectionId: string | null | undefined,
  scope: string | null
): Promise<void> {
  if (!collectionId) return Promise.resolve()
  const key = contextKey(collectionId, scope)
  if (loadedContexts.has(key)) return Promise.resolve()

  const pending = pendingLoads.get(key)
  if (pending) return pending

  const api = optionalApi()
  if (!api?.getPropertyValueColors) {
    loadedContexts.add(key)
    return Promise.resolve()
  }

  const request = api
    .getPropertyValueColors(collectionId, scope)
    .then((colors) => {
      propertyValueColorOverrides.update((all) => ({
        ...all,
        [key]: sanitizedColors(colors)
      }))
      loadedContexts.add(key)
    })
    .catch(() => {
      // Presentation colors are optional; automatic colors remain available.
    })
    .finally(() => pendingLoads.delete(key))

  pendingLoads.set(key, request)
  return request
}

export function valueColorOverride(
  all: ColorsByContext,
  collectionId: string | null | undefined,
  scope: string | null,
  field: string,
  value: string
): PropertyValueColorSelection | null {
  if (!collectionId) return null
  return all[contextKey(collectionId, scope)]?.[field]?.[value] ?? null
}

/** Persist a chosen palette and slot; `null` restores automatic color assignment. */
export async function setPropertyValueColor(
  collectionId: string,
  scope: string | null,
  field: string,
  value: string,
  selection: PropertyValueColorSelection | null
): Promise<void> {
  const previous = get(propertyValueColorOverrides)
  const key = contextKey(collectionId, scope)
  const contextColors = { ...(previous[key] ?? {}) }
  const fieldColors = { ...(contextColors[field] ?? {}) }

  if (selection === null) delete fieldColors[value]
  else fieldColors[value] = selection

  if (Object.keys(fieldColors).length === 0) delete contextColors[field]
  else contextColors[field] = fieldColors

  propertyValueColorOverrides.set({
    ...previous,
    [key]: contextColors
  })
  loadedContexts.add(key)

  const api = optionalApi()
  if (!api?.setPropertyValueColor) return

  try {
    const resolved = await api.setPropertyValueColor(collectionId, scope, field, value, selection)
    propertyValueColorOverrides.update((all) => ({
      ...all,
      [key]: sanitizedColors(resolved)
    }))
  } catch (error) {
    propertyValueColorOverrides.set(previous)
    throw error
  }
}

/** Test-only reset for module-level load de-duplication state. */
export function resetPropertyValueColors(): void {
  propertyValueColorOverrides.set({})
  loadedContexts.clear()
  pendingLoads.clear()
}
