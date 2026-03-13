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
  '#93C5FD',
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
 * Compute the shortest distance from a point (px, py) to the line segment (ax, ay)–(bx, by).
 *
 * Handles degenerate case where the segment has zero length (returns distance to the point).
 */
export function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    // Zero-length segment — distance to the single point
    const ex = px - ax
    const ey = py - ay
    return Math.sqrt(ex * ex + ey * ey)
  }

  // Project point onto the line, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))

  const closestX = ax + t * dx
  const closestY = ay + t * dy
  const ex = px - closestX
  const ey = py - closestY
  return Math.sqrt(ex * ex + ey * ey)
}
