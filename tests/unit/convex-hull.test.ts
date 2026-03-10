import { describe, it, expect } from 'vitest'
import { convexHull, padHull, centroid, polygonArea, hexToRgb } from '@renderer/lib/convex-hull'

describe('convexHull', () => {
  it('returns empty array for empty input', () => {
    const result = convexHull([])
    expect(result).toEqual([])
  })

  it('returns the single point for one-point input', () => {
    const result = convexHull([[5, 10]])
    expect(result).toEqual([[5, 10]])
  })

  it('returns both points for two-point input', () => {
    const result = convexHull([[0, 0], [3, 4]])
    expect(result).toHaveLength(2)
    expect(result).toContainEqual([0, 0])
    expect(result).toContainEqual([3, 4])
  })

  it('computes correct hull for a triangle', () => {
    const result = convexHull([[0, 0], [4, 0], [2, 3]])
    expect(result).toHaveLength(3)
    expect(result).toContainEqual([0, 0])
    expect(result).toContainEqual([4, 0])
    expect(result).toContainEqual([2, 3])
  })

  it('computes correct hull for a square', () => {
    const result = convexHull([[0, 0], [4, 0], [4, 4], [0, 4]])
    expect(result).toHaveLength(4)
    expect(result).toContainEqual([0, 0])
    expect(result).toContainEqual([4, 0])
    expect(result).toContainEqual([4, 4])
    expect(result).toContainEqual([0, 4])
  })

  it('excludes interior points from the hull', () => {
    // Square with an interior point
    const result = convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2]])
    expect(result).toHaveLength(4)
    expect(result).not.toContainEqual([2, 2])
  })

  it('handles collinear points by returning endpoints', () => {
    const result = convexHull([[0, 0], [1, 1], [2, 2], [3, 3]])
    // Collinear points produce a degenerate hull with just the endpoints
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result).toContainEqual([0, 0])
    expect(result).toContainEqual([3, 3])
  })

  it('handles duplicate points', () => {
    const result = convexHull([[1, 1], [1, 1], [1, 1]])
    // All same point — degenerate
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result).toContainEqual([1, 1])
  })

  it('handles duplicate points mixed with distinct points', () => {
    const result = convexHull([[0, 0], [0, 0], [4, 0], [4, 0], [2, 3]])
    expect(result).toHaveLength(3)
    expect(result).toContainEqual([0, 0])
    expect(result).toContainEqual([4, 0])
    expect(result).toContainEqual([2, 3])
  })

  it('returns vertices in counter-clockwise order', () => {
    const result = convexHull([[0, 0], [4, 0], [4, 4], [0, 4]])
    // Verify CCW by checking positive signed area
    let signedArea = 0
    for (let i = 0; i < result.length; i++) {
      const j = (i + 1) % result.length
      signedArea += result[i][0] * result[j][1]
      signedArea -= result[j][0] * result[i][1]
    }
    // CCW has positive signed area
    expect(signedArea).toBeGreaterThan(0)
  })

  it('does not mutate the input array', () => {
    const input: [number, number][] = [[3, 1], [1, 2], [2, 3]]
    const inputCopy = input.map((p) => [...p])
    convexHull(input)
    expect(input).toEqual(inputCopy)
  })

  it('handles negative coordinates', () => {
    const result = convexHull([[-1, -1], [1, -1], [1, 1], [-1, 1]])
    expect(result).toHaveLength(4)
    expect(result).toContainEqual([-1, -1])
    expect(result).toContainEqual([1, 1])
  })

  it('handles large point sets correctly', () => {
    // Pentagon with many interior points
    const points: [number, number][] = [
      [0, 2], [2, 4], [4, 2], [3, 0], [1, 0],  // pentagon vertices
      [2, 1], [2, 2], [2, 3], [1, 2], [3, 2],   // interior points
    ]
    const result = convexHull(points)
    expect(result).toHaveLength(5)
  })
})

describe('padHull', () => {
  it('returns empty array for empty input', () => {
    const result = padHull([], 10)
    expect(result).toEqual([])
  })

  it('returns original point for single-point input', () => {
    const result = padHull([[5, 5]], 10)
    expect(result).toEqual([[5, 5]])
  })

  it('expands hull outward from centroid', () => {
    const hull: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const padded = padHull(hull, 2)

    // Centroid is at (2, 2). Each vertex should be further from centroid.
    const c = centroid(hull)
    for (let i = 0; i < hull.length; i++) {
      const origDist = Math.sqrt(
        (hull[i][0] - c.x) ** 2 + (hull[i][1] - c.y) ** 2
      )
      const paddedDist = Math.sqrt(
        (padded[i][0] - c.x) ** 2 + (padded[i][1] - c.y) ** 2
      )
      expect(paddedDist).toBeGreaterThan(origDist)
      expect(paddedDist).toBeCloseTo(origDist + 2, 5)
    }
  })

  it('preserves the direction from centroid to each vertex', () => {
    const hull: [number, number][] = [[0, 0], [6, 0], [3, 6]]
    const padded = padHull(hull, 5)
    const c = centroid(hull)

    for (let i = 0; i < hull.length; i++) {
      const origAngle = Math.atan2(hull[i][1] - c.y, hull[i][0] - c.x)
      const paddedAngle = Math.atan2(padded[i][1] - c.y, padded[i][0] - c.x)
      expect(paddedAngle).toBeCloseTo(origAngle, 5)
    }
  })

  it('increases the polygon area', () => {
    const hull: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const padded = padHull(hull, 5)

    expect(polygonArea(padded)).toBeGreaterThan(polygonArea(hull))
  })

  it('does not mutate the input array', () => {
    const hull: [number, number][] = [[0, 0], [4, 0], [2, 3]]
    const hullCopy = hull.map((p) => [...p])
    padHull(hull, 10)
    expect(hull).toEqual(hullCopy)
  })
})

describe('centroid', () => {
  it('returns origin for empty input', () => {
    const result = centroid([])
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('returns the point itself for a single point', () => {
    const result = centroid([[7, 3]])
    expect(result).toEqual({ x: 7, y: 3 })
  })

  it('returns midpoint for two points', () => {
    const result = centroid([[0, 0], [10, 6]])
    expect(result).toEqual({ x: 5, y: 3 })
  })

  it('computes average of triangle vertices', () => {
    const result = centroid([[0, 0], [6, 0], [3, 9]])
    expect(result).toEqual({ x: 3, y: 3 })
  })

  it('computes average of square vertices', () => {
    const result = centroid([[0, 0], [4, 0], [4, 4], [0, 4]])
    expect(result).toEqual({ x: 2, y: 2 })
  })

  it('handles negative coordinates', () => {
    const result = centroid([[-2, -2], [2, 2]])
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('handles floating point coordinates', () => {
    const result = centroid([[0.5, 1.5], [2.5, 3.5]])
    expect(result.x).toBeCloseTo(1.5)
    expect(result.y).toBeCloseTo(2.5)
  })
})

describe('polygonArea', () => {
  it('returns 0 for empty input', () => {
    expect(polygonArea([])).toBe(0)
  })

  it('returns 0 for a single point', () => {
    expect(polygonArea([[5, 5]])).toBe(0)
  })

  it('returns 0 for two points (line segment)', () => {
    expect(polygonArea([[0, 0], [5, 5]])).toBe(0)
  })

  it('computes correct area for a unit square', () => {
    const result = polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(result).toBeCloseTo(1)
  })

  it('computes correct area for a 4x4 square', () => {
    const result = polygonArea([[0, 0], [4, 0], [4, 4], [0, 4]])
    expect(result).toBeCloseTo(16)
  })

  it('computes correct area for a right triangle', () => {
    // Triangle with base 4, height 3 → area = 6
    const result = polygonArea([[0, 0], [4, 0], [0, 3]])
    expect(result).toBeCloseTo(6)
  })

  it('returns positive area regardless of vertex order', () => {
    // Clockwise order
    const cw = polygonArea([[0, 0], [0, 4], [4, 4], [4, 0]])
    // Counter-clockwise order
    const ccw = polygonArea([[0, 0], [4, 0], [4, 4], [0, 4]])

    expect(cw).toBeCloseTo(16)
    expect(ccw).toBeCloseTo(16)
  })

  it('computes correct area for an irregular polygon', () => {
    // Pentagon with vertices at (0,2), (2,4), (4,2), (3,0), (1,0)
    // Shoelace: |0*4-2*2 + 2*2-4*4 + 4*0-2*3 + 3*0-0*1 + 1*2-0*0| / 2
    //         = |-4 + -12 + -6 + 0 + 2| / 2 = |-20| / 2 = 10
    const result = polygonArea([[0, 2], [2, 4], [4, 2], [3, 0], [1, 0]])
    expect(result).toBeCloseTo(10)
  })
})

describe('hexToRgb', () => {
  it('parses #RRGGBB format correctly', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 })
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('parses without hash prefix', () => {
    expect(hexToRgb('ff8800')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('parses black and white', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('parses mixed case hex values', () => {
    expect(hexToRgb('#FF8800')).toEqual({ r: 255, g: 136, b: 0 })
    expect(hexToRgb('#aaBBcc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('parses arbitrary hex colors', () => {
    expect(hexToRgb('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 })
  })

  it('returns zeros for empty string', () => {
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('returns zeros for invalid length', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#fffffff')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('returns zeros for non-hex characters', () => {
    expect(hexToRgb('#gggggg')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0 })
  })
})
