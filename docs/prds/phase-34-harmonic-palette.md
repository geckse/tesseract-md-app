# PRD: Harmonic Color Palette Generation

## Overview

Replace all hardcoded color palettes (cluster nodes, edge clusters, folder coloring, directional arrows) with a dynamically generated harmonic palette derived from the resolved primary accent color. Colors are computed by rotating hue around the color wheel while preserving the saturation and lightness of the theme-adjusted primary color, producing a visually cohesive palette that automatically adapts to any accent color and theme mode.

## Problem Statement

The app currently uses two hardcoded color arrays:

- **CLUSTER_COLORS** (12 colors) — used for cluster nodes, folder coloring, and hash-based file colors in GraphView.svelte and graph-3d-bridge.ts
- **EDGE_CLUSTER_COLORS** (8 colors) — used for semantic edge clusters in edge-utils.ts
- **Directional arrow colors** — hardcoded `#FF6B6B` (red/incoming), `#51CF66` (green/bidirectional), `#555555` (gray/default)

These palettes are fixed hex values chosen for dark mode. They don't adapt when the user changes their accent color, and they don't adjust for light mode contrast. This creates visual dissonance — the accent color can be warm orange while clusters are rendered in unrelated cool purples and cyans.

## Goals

- Generate N harmonically-spaced colors from the resolved primary color (post theme-adjustment, not the raw user pick)
- All generated colors share the same saturation and lightness as the primary, differing only in hue
- The primary color itself is always index 0 in the palette
- Palette recalculates reactively when accent color or theme mode changes
- Replace `CLUSTER_COLORS`, `EDGE_CLUSTER_COLORS`, and directional arrow colors with palette lookups
- Support generating arbitrary palette sizes (12 for clusters/folders, 8 for edge clusters, 3 for directional arrows)
- Maintain WCAG AA contrast against the current theme's background
- Cluster spheres, legends, and all other consumers automatically get harmonized colors

## Non-Goals

- **User-editable individual palette slots** — the palette is fully derived, not manually tweakable
- **Complementary/triadic/split-complementary schemes** — we use equidistant hue spacing only
- **Per-palette saturation/lightness tweaks** — all colors share the primary's S/L values
- **Gradient or multi-tone palettes** — solid colors only

## Design: Harmonic Palette Algorithm

### Core Concept

Given a base color in HSL, generate N colors by evenly distributing hue across the 360° color wheel:

```
hue[i] = (baseHue + i * (360 / N)) % 360
sat[i] = baseSaturation
lit[i] = baseLightness
```

This produces maximally-distinct colors that share the same visual "weight" (saturation + lightness), creating a harmonious set.

### Input: Resolved Primary Color

The base color is **not** the user's raw pick. It is the output of `resolveThemeAwareAccent()` for the current theme mode:

- Dark mode → `themeAwareAccent.darkColor`
- Light mode → `themeAwareAccent.lightColor`

This ensures the palette already meets contrast requirements against the active background.

### Palette Sizes

| Use Case | Size (N) | Current Source | Consumers |
|---|---|---|---|
| Cluster/folder nodes | 12 | `CLUSTER_COLORS` | GraphView.svelte, graph-3d-bridge.ts |
| Edge clusters | 8 | `EDGE_CLUSTER_COLORS` | edge-utils.ts |
| Directional arrows | 3 | Hardcoded hex | graph-3d-bridge.ts (outgoing=primary, incoming=palette[1], bidirectional=palette[2]) |

### Hue Offset Strategy

To avoid the primary color colliding with the first rotation step (which would look too similar for small N), the algorithm skips index 0 (which is the primary itself) and distributes the remaining N-1 colors:

```
palette[0] = primary (hue = baseHue)
palette[i] = hue rotated by i * (360 / N), for i = 1..N-1
```

For the directional arrows specifically (N=3):
- `palette[0]` = primary (outgoing edges) — replaces cyan arrow
- `palette[1]` = +120° rotation (incoming edges) — replaces red arrow
- `palette[2]` = +240° rotation (bidirectional edges) — replaces green arrow

### Edge Cases

- **Very low saturation primaries** (near gray): The hue rotation produces effectively identical colors. Detect when `saturation < 10` and apply a minimum saturation floor of 40 to the generated palette (not the primary itself).
- **Very high or low lightness** (near white/black): Hue rotation is imperceptible. Clamp lightness to 25–75 range for palette generation when the primary's lightness falls outside that range.
- **Default unselected arrow color**: Keep `#555555` (or theme-appropriate neutral) for edges when no node is selected — this is a UI state indicator, not a data color.

## Technical Design

### New: `src/renderer/lib/harmonic-palette.ts`

Pure-data module with no side effects:

```typescript
import { hexToHsl, hslToHex } from './color-utils'

export interface HarmonicPalette {
  colors: string[]        // hex colors, length = N
  baseHue: number         // 0-360
  saturation: number      // 0-100 (effective, after clamping)
  lightness: number       // 0-100 (effective, after clamping)
}

/**
 * Generate N harmonically-spaced colors from a base hex color.
 * palette[0] is always the base color itself.
 */
export function generateHarmonicPalette(baseHex: string, count: number): HarmonicPalette

/**
 * Get a single color from a harmonic palette by index (wraps via modulo).
 * Convenience for `palette.colors[index % palette.colors.length]`.
 */
export function paletteColor(palette: HarmonicPalette, index: number): string
```

**Algorithm detail for `generateHarmonicPalette`:**

1. Convert `baseHex` to HSL via existing `hexToHsl()`
2. Compute effective saturation: `effectiveS = Math.max(baseS, 40)` if `baseS < 10`, else `baseS`
3. Compute effective lightness: `effectiveL = clamp(baseL, 25, 75)`
4. `colors[0]` = `baseHex` (the actual primary, not reconstructed)
5. For `i = 1` to `count - 1`: `colors[i] = hslToHex((baseH + i * 360/count) % 360, effectiveS, effectiveL)`
6. Return `{ colors, baseHue: baseH, saturation: effectiveS, lightness: effectiveL }`

### New Reactive Store: `src/renderer/stores/palette.ts`

```typescript
import { derived } from 'svelte/store'
import { primaryVariants } from './accent-color'
import { generateHarmonicPalette, type HarmonicPalette } from '../lib/harmonic-palette'

/** 12-color palette for clusters, folders, file hashes */
export const clusterPalette = derived(primaryVariants, ($v) =>
  generateHarmonicPalette($v.primary, 12)
)

/** 8-color palette for edge clusters */
export const edgePalette = derived(primaryVariants, ($v) =>
  generateHarmonicPalette($v.primary, 8)
)

/** 3-color palette for directional arrows */
export const arrowPalette = derived(primaryVariants, ($v) =>
  generateHarmonicPalette($v.primary, 3)
)
```

Since `primaryVariants` already resolves per-theme (dark/light adjusted color), all palettes automatically adapt.

### Migration: Remove Hardcoded Palettes

#### GraphView.svelte

**Remove:** `CLUSTER_COLORS` constant (lines 98-111) and `DEFAULT_NODE_COLOR` (line 114).

**Replace with:** Import and subscribe to `clusterPalette` from `stores/palette.ts`.

All call sites that reference `CLUSTER_COLORS[id % CLUSTER_COLORS.length]` become `paletteColor($clusterPalette, id)`:

| Function | Current | New |
|---|---|---|
| `getNodeColor()` (cluster mode) | `CLUSTER_COLORS[node.cluster_id % 12]` | `paletteColor($clusterPalette, node.cluster_id)` |
| `getNodeColor()` (folder mode) | `folderColorMap.get(folder)` | `folderColorMap` built from `$clusterPalette` |
| `fileHashColor()` | `CLUSTER_COLORS[hash % 12]` | `paletteColor($clusterPalette, hash)` |
| `getClusters()` legend | `CLUSTER_COLORS[c.id % 12]` | `paletteColor($clusterPalette, c.id)` |
| `getFolderLegendItems()` | `CLUSTER_COLORS[i % 12]` | `paletteColor($clusterPalette, i)` |
| Cluster spheres | `new THREE.Color(CLUSTER_COLORS[id % 12])` | `new THREE.Color(paletteColor($clusterPalette, id))` |
| `DEFAULT_NODE_COLOR` | `#E4E4E7` | Read from CSS `--color-text` (already has `getDefaultNodeColor()` function) |

#### graph-3d-bridge.ts

**Remove:** `CLUSTER_COLORS` constant (lines 12-25).

**Add:** Accept palette arrays as parameters in `init3DGraph()` options instead of using module-level constants.

```typescript
interface Graph3DOptions {
  // ... existing options
  clusterPalette: string[]     // 12 colors from store
  arrowPalette: string[]       // 3 colors from store
}
```

**Replace directional arrow colors:**

| Current | New |
|---|---|
| `ARROW_CYAN` (outgoing, from `--color-primary`) | `arrowPalette[0]` (same — it's the primary) |
| `ARROW_RED = '#FF6B6B'` (incoming) | `arrowPalette[1]` |
| `ARROW_GREEN = '#51CF66'` (bidirectional) | `arrowPalette[2]` |
| `ARROW_GRAY = '#555555'` (no selection) | Keep as-is, or read from `--color-text-dim` |

#### edge-utils.ts

**Remove:** `EDGE_CLUSTER_COLORS` constant (lines 10-19).

**Replace:** `edgeClusterColor(clusterId)` reads from the passed-in or imported edge palette:

```typescript
export function edgeClusterColor(palette: string[], clusterId: number): string {
  return palette[((clusterId % palette.length) + palette.length) % palette.length]
}
```

Or import `edgePalette` store and subscribe.

### Reactive Updates

When the accent color or theme changes:

1. `primaryVariants` recalculates (existing)
2. `clusterPalette`, `edgePalette`, `arrowPalette` recalculate (new derived stores)
3. GraphView.svelte re-renders nodes/edges/spheres with new colors (existing reactivity)
4. graph-3d-bridge.ts needs a `updatePalette()` call or re-init (same pattern as existing `reinitMermaid()` on theme change)

### Graph Bridge Palette Update

The 3D graph bridge currently re-initializes on theme change. Extend this to also update when palette changes. In GraphView.svelte, add a subscription to `clusterPalette` that triggers a graph refresh (re-color nodes/edges without full re-init if possible, or full re-init if needed).

The lightweight approach: expose a `recolorGraph()` function in graph-3d-bridge.ts that iterates existing nodes and updates their colors from the new palette without rebuilding the force layout.

## Implementation Order

| Step | Description | Files | Depends On |
|---|---|---|---|
| 1 | `generateHarmonicPalette()` + `paletteColor()` | `lib/harmonic-palette.ts` (new) | Existing `color-utils.ts` |
| 2 | Palette stores | `stores/palette.ts` (new) | Step 1, existing `accent-color.ts` |
| 3 | Remove `CLUSTER_COLORS` from GraphView, use palette store | `components/GraphView.svelte` | Step 2 |
| 4 | Remove `CLUSTER_COLORS` + arrow constants from bridge, accept palette via options | `lib/graph-3d-bridge.ts` | Step 2 |
| 5 | Remove `EDGE_CLUSTER_COLORS`, refactor `edgeClusterColor()` | `lib/edge-utils.ts` | Step 2 |
| 6 | Wire palette subscriptions for reactive recoloring | `GraphView.svelte`, `graph-3d-bridge.ts` | Steps 3-5 |
| 7 | Update legend rendering to use palette | `GraphView.svelte` (getClusters, getFolderLegendItems, getEdgeClusters) | Step 3 |

## Verification

- Change accent color to red → all cluster nodes, edge clusters, folder colors, and directional arrows shift to red-based harmonics
- Change accent color to cyan (default) → palette resembles the old hardcoded colors in hue spread but with consistent saturation/lightness
- Switch to light mode → palette recalculates with the light-adjusted primary, all colors visible against light background
- Switch to dark mode → palette recalculates with dark-adjusted primary
- Pick a near-gray accent (e.g. `#808080`) → palette still produces distinguishable colors (saturation floor kicks in)
- Pick a near-white accent in dark mode → lightness clamping ensures palette colors are visible
- 12+ clusters → colors wrap via modulo, no index-out-of-bounds
- Folder mode with many top-level folders → each gets a distinct harmonic color
- Edge clusters → 8-color harmonic palette, visually distinct
- Select a node → directional arrows use harmonic colors (outgoing=primary hue, incoming=+120°, bidi=+240°)
- No node selected → arrows remain neutral gray
- Cluster spheres → semi-transparent shells use harmonized colors

## Testing

- **Unit tests** for `generateHarmonicPalette()`:
  - Returns correct count of colors
  - `palette[0]` is always the base color
  - All colors are valid hex
  - Hue spacing is approximately `360/N` degrees between consecutive colors
  - Low-saturation input triggers saturation floor
  - Extreme lightness triggers lightness clamping
  - `paletteColor()` wraps correctly for index >= N and negative modulo
- **Unit tests** for palette stores: derived values update when `primaryVariants` changes
- **Unit tests** for `edgeClusterColor()` with new signature
- **Visual regression**: manual check of graph in cluster, folder, and none modes with different accent colors in both themes

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Some hue rotations produce similar-looking colors for small N | N=3 gives 120° spacing (maximally distinct). N=8 and N=12 also produce large angular gaps. |
| Near-gray primaries make hue rotation useless | Saturation floor of 40 ensures distinguishable colors |
| Very bright/dark primaries reduce visibility | Lightness clamped to 25-75 range for generated colors |
| Palette recomputation on every accent change triggers graph flicker | Debounce or batch the recolor call; or recolor is fast enough (just updating material colors) |
| Breaking change for graph-3d-bridge API | Options-based palette passing is additive; default to generated palette if not provided |
