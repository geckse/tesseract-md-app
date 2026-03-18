/**
 * Edge rendering utility functions for semantic graph visualization.
 * All functions are pure — no side effects or external dependencies.
 */

/**
 * 8 pastel colors for edge clusters, matching --color-edge-cluster-N CSS tokens.
 * IDs >= 8 cycle via modulo.
 */
const EDGE_CLUSTER_COLORS: string[] = [
  '#A78BFA',
  '#67E8F9',
  '#FCA5A1',
  '#86EFAC',
  '#FDE68A',
  '#F9A8D4',
  '#FDBA74',
  '#93C5FD'
]

/**
 * Return the pastel color for a given edge cluster ID.
 * Cycles through the 8-color palette via modulo for IDs >= 8.
 * Negative IDs are mapped to a valid index using absolute value.
 */
export function edgeClusterColor(clusterId: number): string {
  const idx = ((clusterId % 8) + 8) % 8
  return EDGE_CLUSTER_COLORS[idx]
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
 * Compute the 3D link color for an edge based on its cluster ID and weakness.
 *
 * Returns the edge cluster palette color from `edgeClusterColor()`.
 * For edges with no cluster ID, returns the last palette color (#93C5FD).
 * For weak edges (strength below threshold), appends hex alpha `40` (~25% opacity)
 * to visually de-emphasize them in the 3D scene.
 */
export function edgeLinkColor(
  edgeClusterId: number | null | undefined,
  strength: number,
  weakThreshold: number
): string {
  const baseColor = edgeClusterId != null ? edgeClusterColor(edgeClusterId) : '#93C5FD'

  if (strength < weakThreshold) {
    return baseColor + '40'
  }

  return baseColor
}
