/**
 * Theme Store — mdvdb
 *
 * Manages light/dark/auto theme mode with global and per-collection overrides.
 * Subscribing to `themeTokens` gives the active token set for CSS variable application.
 */

import { writable, derived } from 'svelte/store'
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  type ThemeMode,
  type ResolvedTheme,
  type ThemeTokens,
} from '../lib/theme-tokens'

/** The global theme mode */
export const globalTheme = writable<ThemeMode>('dark')

/** Per-collection theme override (null = use global) */
export const collectionTheme = writable<ThemeMode | null>(null)

/** OS preference detected via matchMedia */
export const systemPreference = writable<ResolvedTheme>('dark')

/** Resolved theme: collection > global, with auto resolved to system preference */
export const resolvedTheme = derived(
  [collectionTheme, globalTheme, systemPreference],
  ([$coll, $global, $system]): ResolvedTheme => {
    const mode = $coll ?? $global
    return mode === 'auto' ? $system : (mode as ResolvedTheme)
  }
)

/** The active token set based on resolved theme */
export const themeTokens = derived<typeof resolvedTheme, ThemeTokens>(
  resolvedTheme,
  ($theme) => ($theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS)
)

/** Load the global theme from electron-store on startup */
export async function loadTheme(): Promise<void> {
  try {
    const mode = await window.api.getTheme()
    globalTheme.set(mode as ThemeMode)
  } catch {
    // Ignore — will use default dark
  }
}

/** Load the per-collection theme override when switching collections */
export async function loadCollectionTheme(collectionId: string | null): Promise<void> {
  if (!collectionId) {
    collectionTheme.set(null)
    return
  }
  try {
    const mode = await window.api.getCollectionTheme(collectionId)
    collectionTheme.set(mode as ThemeMode | null)
  } catch {
    collectionTheme.set(null)
  }
}

/** Set the global theme and persist it */
export async function setGlobalTheme(mode: ThemeMode): Promise<void> {
  globalTheme.set(mode)
  await window.api.setTheme(mode)
}

/** Set a per-collection theme override and persist it */
export async function setCollectionThemeOverride(
  collectionId: string,
  mode: ThemeMode | null
): Promise<void> {
  collectionTheme.set(mode)
  await window.api.setCollectionTheme(collectionId, mode)
}

/** Initialize the system preference listener. Returns cleanup function. */
export function initSystemPreference(): () => void {
  if (typeof window === 'undefined') return () => {}

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => systemPreference.set(mq.matches ? 'dark' : 'light')
  update()
  mq.addEventListener('change', update)
  return () => mq.removeEventListener('change', update)
}
