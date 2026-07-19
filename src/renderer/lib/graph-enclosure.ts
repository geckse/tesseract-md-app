export interface GraphEnclosurePoint {
  x: number
  y: number
  z: number
}

const GEOMETRY_EPSILON = 1e-3
const MAX_DEGENERATE_BASE_POINTS = 64
const TETRAHEDRON_DIRECTIONS: readonly GraphEnclosurePoint[] = [
  { x: 1, y: 1, z: 1 },
  { x: -1, y: -1, z: 1 },
  { x: -1, y: 1, z: -1 },
  { x: 1, y: -1, z: -1 }
].map(({ x, y, z }) => {
  const length = Math.sqrt(3)
  return { x: x / length, y: y / length, z: z / length }
})

function finiteUniquePoints(points: GraphEnclosurePoint[]): GraphEnclosurePoint[] {
  const seen = new Set<string>()
  const result: GraphEnclosurePoint[] = []
  for (const point of points) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) continue
    const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.z.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...point })
  }
  return result
}

/** Whether a point set has enough 3D volume for Three.js ConvexGeometry. */
export function hasNonCoplanarGraphPoints(points: GraphEnclosurePoint[]): boolean {
  const unique = finiteUniquePoints(points)
  if (unique.length < 4) return false

  const origin = unique[0]
  const second = unique.find(
    (point) =>
      Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) > GEOMETRY_EPSILON
  )
  if (!second) return false

  const ax = second.x - origin.x
  const ay = second.y - origin.y
  const az = second.z - origin.z
  let normal: GraphEnclosurePoint | null = null
  for (const point of unique) {
    const bx = point.x - origin.x
    const by = point.y - origin.y
    const bz = point.z - origin.z
    const candidate = {
      x: ay * bz - az * by,
      y: az * bx - ax * bz,
      z: ax * by - ay * bx
    }
    if (Math.hypot(candidate.x, candidate.y, candidate.z) > GEOMETRY_EPSILON) {
      normal = candidate
      break
    }
  }
  if (!normal) return false

  const normalLength = Math.hypot(normal.x, normal.y, normal.z)
  return unique.some((point) => {
    const distance =
      Math.abs(
        normal!.x * (point.x - origin.x) +
          normal!.y * (point.y - origin.y) +
          normal!.z * (point.z - origin.z)
      ) / normalLength
    return distance > GEOMETRY_EPSILON
  })
}

/**
 * Build a finite, volumetric point cloud for a faceted cluster enclosure.
 * Normal 3D groups retain the existing radial padding. Degenerate groups
 * (one point, lines, planes, duplicates) receive a small tetrahedral thickness
 * so the renderer never has to substitute circular SphereGeometry blobs.
 */
export function buildGraphEnclosurePointCloud(
  points: GraphEnclosurePoint[],
  scale: number,
  fixedPadding: number
): GraphEnclosurePoint[] {
  const unique = finiteUniquePoints(points)
  if (unique.length === 0) return []

  const center = unique.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }),
    { x: 0, y: 0, z: 0 }
  )
  center.x /= unique.length
  center.y /= unique.length
  center.z /= unique.length

  if (hasNonCoplanarGraphPoints(unique)) {
    return unique.map((point) => {
      const dx = point.x - center.x
      const dy = point.y - center.y
      const dz = point.z - center.z
      const length = Math.hypot(dx, dy, dz)
      if (length <= GEOMETRY_EPSILON) return { x: point.x + fixedPadding, y: point.y, z: point.z }
      const paddedLength = length * scale + fixedPadding
      return {
        x: center.x + (dx / length) * paddedLength,
        y: center.y + (dy / length) * paddedLength,
        z: center.z + (dz / length) * paddedLength
      }
    })
  }

  const sampleStride = Math.max(1, Math.ceil(unique.length / MAX_DEGENERATE_BASE_POINTS))
  const sampled = unique.filter((_point, index) => index % sampleStride === 0)
  // Sparse groups need much less padding than a mature cluster; the old
  // minimum-radius spheres made the first few reveals dominate the scene.
  const sparsePaddingScale = unique.length === 1 ? 0.45 : unique.length === 2 ? 0.6 : 0.75
  const facetedPadding = fixedPadding * sparsePaddingScale
  const halfPadding = facetedPadding / 2
  const pointCloud: GraphEnclosurePoint[] = []

  for (const point of sampled) {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const dz = point.z - center.z
    const length = Math.hypot(dx, dy, dz)
    const radialLength = length * scale + (length > GEOMETRY_EPSILON ? halfPadding : 0)
    const base =
      length > GEOMETRY_EPSILON
        ? {
            x: center.x + (dx / length) * radialLength,
            y: center.y + (dy / length) * radialLength,
            z: center.z + (dz / length) * radialLength
          }
        : { ...center }

    for (const direction of TETRAHEDRON_DIRECTIONS) {
      pointCloud.push({
        x: base.x + direction.x * facetedPadding,
        y: base.y + direction.y * facetedPadding,
        z: base.z + direction.z * facetedPadding
      })
    }
  }

  return pointCloud
}
