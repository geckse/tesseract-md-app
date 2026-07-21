/**
 * Edge rendering utility functions for semantic graph visualization.
 * All functions are pure — no side effects or external dependencies.
 */

import { paletteColor, type HarmonicPalette } from './harmonic-palette'

/**
 * Return the color for a given edge cluster ID from the provided palette.
 * Cycles through the palette via modulo for IDs >= palette size.
 * Negative IDs are mapped to a valid index.
 */
export function edgeClusterColor(clusterId: number, palette: HarmonicPalette): string {
  return paletteColor(palette, clusterId)
}

/**
 * Determine if an edge is visible given the current edge filter.
 *
 * - If filter is null, all edges are visible (no filtering active).
 * - Edges without an edge_cluster_id are always visible.
 * - Otherwise, the edge is visible only if its cluster ID is in the filter set.
 */
export function isEdgeVisible(
  edge: { edge_cluster_id?: number | null },
  filter: Set<number> | null
): boolean {
  if (filter === null) return true
  if (edge.edge_cluster_id == null) return true
  return filter.has(edge.edge_cluster_id)
}

/**
 * Compute the canvas line width for an edge based on its strength and zoom level.
 *
 * Maps strength [0, 1] → line width [0.5, 3.0] in graph space, divided by zoom
 * for visual consistency across zoom levels. Clamps strength to [0, 1].
 */
export function edgeLineWidth(strength: number, zoom: number): number {
  const clamped = Math.max(0, Math.min(1, strength))
  const width = 0.5 + clamped * 2.5
  return width / zoom
}

/**
 * Determine if an edge is "weak" — i.e., its strength is strictly below the threshold.
 * Weak edges are rendered with dashed lines.
 */
export function isWeakEdge(strength: number, threshold: number): boolean {
  return strength < threshold
}

/**
 * Determine if an edge originates from a frontmatter relation (phase 42).
 * The CLI tags relation edges with their originating field; `null` = body or
 * similarity edge. The SINGLE source of truth for frontmatter-edge styling —
 * every renderer path must use this, never re-check `field` inline.
 */
export function isFrontmatterEdge(edge: { field?: string | null }): boolean {
  return edge.field != null
}

/**
 * Line color for frontmatter relation edges — a distinct violet hue so
 * relation edges read differently from body-link/semantic edges in every
 * coloring mode (relation edges carry no strength or edge cluster).
 */
export const FRONTMATTER_EDGE_COLOR = '#8b7cf6'

/** Neutral fallback for legacy/unclassified edges — never a semantic palette slot. */
export const UNCLUSTERED_EDGE_COLOR = '#687385'

/**
 * Compute the 3D link width for an edge based on its strength.
 *
 * Maps strength [0, 1] → line width [0.5, 3.0]. No zoom adjustment needed
 * in 3D since the camera handles perspective scaling. Clamps strength to [0, 1].
 */
export function edgeLinkWidth(strength: number): number {
  const clamped = Math.max(0, Math.min(1, strength))
  return 0.5 + clamped * 2.5
}

/**
 * Compute the 3D link color for an edge based on its semantic cluster ID.
 *
 * Returns the edge cluster palette color from `edgeClusterColor()`.
 * Edges with no cluster ID use a neutral fallback instead of borrowing an
 * arbitrary palette slot. Strength is deliberately handled separately by
 * `edgeStrengthOpacity()` so weak-edge alpha is not multiplied twice by the
 * batched renderer's idle opacity.
 */
export function edgeLinkColor(
  edgeClusterId: number | null | undefined,
  _strength: number,
  _weakThreshold: number,
  palette: HarmonicPalette
): string {
  return edgeClusterId != null ? edgeClusterColor(edgeClusterId, palette) : UNCLUSTERED_EDGE_COLOR
}

/**
 * Continuous strength visibility used on top of the graph's idle opacity.
 *
 * The floor guarantees that every filtered-in edge remains legible in an
 * overview. The user-configured weak threshold remains the visual knee, but
 * there is no abrupt pop and no edge reaches zero opacity.
 */
export function edgeStrengthOpacity(strength: number, weakThreshold: number): number {
  const safeStrength = Number.isFinite(strength) ? strength : 0.5
  const safeThreshold = Number.isFinite(weakThreshold) ? weakThreshold : 0.3
  const value = Math.max(0, Math.min(1, safeStrength))
  const threshold = Math.max(0, Math.min(1, safeThreshold))
  const floor = 0.58
  const knee = 0.78

  if (threshold <= 0) return knee + (1 - knee) * value
  if (value < threshold) return floor + (knee - floor) * (value / threshold)
  if (threshold >= 1) return knee
  return knee + (1 - knee) * ((value - threshold) / (1 - threshold))
}

/** Final idle alpha for a visible overview edge (before explicit UI dimming states). */
export function edgeIdleOpacity(
  strength: number,
  weakThreshold: number,
  chunkMode: boolean,
  semanticStyling: boolean = true
): number {
  const baseOpacity = chunkMode ? 0.1 : 0.17
  return semanticStyling ? baseOpacity * edgeStrengthOpacity(strength, weakThreshold) : baseOpacity
}

/** Map the stored semantic width to a restrained, CSS-pixel overview width. */
export function edgeScreenWidth(
  semanticWidth: number,
  semanticStyling: boolean,
  selectedIncident: boolean
): number {
  const width = Number.isFinite(semanticWidth) ? semanticWidth : 0.5
  const normalized = semanticStyling ? Math.max(0, Math.min(1, (width - 0.5) / 2.5)) : 0
  return selectedIncident ? 1.35 + normalized * 1.15 : 1 + normalized * 0.8
}

/** Keep idle direction subordinate; selected directions remain presentation-ready. */
export function edgeArrowOpacity(lineOpacity: number, hasSelection: boolean): number {
  if (hasSelection) return 0.95
  return Math.min(0.24, Math.max(0, lineOpacity) * 1.25)
}
