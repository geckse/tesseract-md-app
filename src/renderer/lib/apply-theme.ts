/**
 * Theme Applicator — mdvdb
 *
 * Applies theme tokens as CSS custom properties on the document root,
 * and sets the data-theme attribute for CSS selector-based theming.
 */

import type { ThemeTokens, ResolvedTheme } from './theme-tokens'

export function applyTheme(tokens: ThemeTokens, mode: ResolvedTheme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', mode)
  root.style.setProperty('color-scheme', mode)

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value)
  }
}
