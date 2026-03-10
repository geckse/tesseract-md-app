/**
 * Convex hull and geometry utility functions for graph cluster overlays.
 * All functions are pure — no side effects or external dependencies.
 */

/**
 * Compute the convex hull of a set of 2D points using Andrew's monotone chain algorithm.
 * Time complexity: O(n log n).
 *
 * Handles degenerate cases:
 * - 0 points: returns []
 * - 1 point: returns that single point
 * - 2 points: returns both points
 * - Collinear points: returns the two endpoints
 *
 * Returns vertices in counter-clockwise order.
 */
export function convexHull(points: [number, number][]): [number, number][] {
  const n = points.length
  if (n <= 2) return points.slice()

  // Sort by x, then by y
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])

  // Cross product of vectors OA and OB where O is origin
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number]
  ): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  // Build lower hull
  const lower: [number, number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  // Build upper hull
  const upper: [number, number][] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Remove last point of each half because it's repeated
  lower.pop()
  upper.pop()

  const hull = lower.concat(upper)

  // Degenerate case: all points are collinear — hull may have only 2 unique points
  if (hull.length < 2) return hull

  return hull
}

/**
 * Expand hull vertices outward from the centroid by a padding distance.
 * Each vertex is moved along the direction from centroid to vertex.
 *
 * Returns empty array for empty input.
 * For a single point, returns that point unchanged.
 */
export function padHull(hull: [number, number][], padding: number): [number, number][] {
  if (hull.length === 0) return []
  if (hull.length === 1) return hull.slice()

  const c = centroid(hull)

  return hull.map((vertex) => {
    const dx = vertex[0] - c.x
    const dy = vertex[1] - c.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist === 0) return vertex

    const scale = (dist + padding) / dist
    return [c.x + dx * scale, c.y + dy * scale] as [number, number]
  })
}

/**
 * Compute the centroid (average x/y) of a set of polygon vertices.
 *
 * Returns { x: 0, y: 0 } for empty input.
 */
export function centroid(points: [number, number][]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }

  let sumX = 0
  let sumY = 0
  for (const p of points) {
    sumX += p[0]
    sumY += p[1]
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length,
  }
}

/**
 * Compute the area of a polygon using the shoelace formula.
 * Returns the absolute area (always non-negative).
 *
 * Returns 0 for fewer than 3 points.
 */
export function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0

  let area = 0
  const n = points.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i][0] * points[j][1]
    area -= points[j][0] * points[i][1]
  }

  return Math.abs(area) / 2
}

/**
 * Parse a #RRGGBB hex color string to its RGB components.
 * Accepts both '#RRGGBB' and 'RRGGBB' formats.
 *
 * Returns { r: 0, g: 0, b: 0 } for invalid input.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex

  if (cleaned.length !== 6) return { r: 0, g: 0, b: 0 }

  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)

  if (isNaN(r) || isNaN(g) || isNaN(b)) return { r: 0, g: 0, b: 0 }

  return { r, g, b }
}
