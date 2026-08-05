/**
 * CSS Variable Applicator — mdvdb
 *
 * Applies primary accent color variants to the document root,
 * making all var(--color-primary) references react automatically.
 */

import type { PrimaryVariants } from './color-utils'
import { createValueColorPalette } from './value-colors'

export function applyAccentColor(variants: PrimaryVariants): void {
  const root = document.documentElement.style
  root.setProperty('--color-primary', variants.primary)
  root.setProperty('--color-primary-dark', variants.dark)
  root.setProperty('--color-primary-dim', variants.dim)
  root.setProperty('--color-primary-glow', variants.glow)
  root.setProperty('--color-edge-out', variants.primary)

  // Accent-harmonic slots used by colored text highlights (==...== marks).
  // Kept as global vars so existing <mark data-color> elements restyle live.
  createValueColorPalette(variants.primary).colors.forEach((color, slot) => {
    root.setProperty(`--highlight-color-${slot}`, color)
  })
}
