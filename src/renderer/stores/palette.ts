/**
 * Palette Store — mdvdb
 *
 * Derived Svelte stores providing harmonically-generated color palettes
 * based on the resolved primary accent color. Automatically recalculates
 * when accent color or theme mode changes.
 */

import { derived } from 'svelte/store'
import { primaryVariants } from './accent-color'
import { generateHarmonicPalette, type HarmonicPalette } from '../lib/harmonic-palette'

/**
 * 12-color palette for cluster nodes, folder coloring, and file hash colors.
 * Offset by 3 to skip the hue slots used by the arrow palette,
 * ensuring cluster colors don't collide with directional arrow colors.
 */
export const clusterPalette = derived<typeof primaryVariants, HarmonicPalette>(
  primaryVariants,
  ($v) => generateHarmonicPalette($v.primary, 12, 3)
)

/**
 * 12-color palette for custom (user-defined) cluster nodes.
 * Offset by 9 so custom cluster colors are visually distinct from auto-cluster
 * colors (which start at offset 3).
 */
export const customClusterPalette = derived<typeof primaryVariants, HarmonicPalette>(
  primaryVariants,
  ($v) => generateHarmonicPalette($v.primary, 12, 9)
)

/**
 * 8-color palette for edge clusters.
 * Offset by 3 to skip the arrow palette slots.
 */
export const edgePalette = derived<typeof primaryVariants, HarmonicPalette>(
  primaryVariants,
  ($v) => generateHarmonicPalette($v.primary, 8, 3)
)

/** 3-color palette for directional arrows (outgoing, incoming, bidirectional) */
export const arrowPalette = derived<typeof primaryVariants, HarmonicPalette>(
  primaryVariants,
  ($v) => generateHarmonicPalette($v.primary, 3)
)
