import { describe, it, expect } from 'vitest'
import {
  edgeClusterColor,
  isEdgeVisible,
  edgeLineWidth,
  isWeakEdge,
  pointToSegmentDist,
} from '@renderer/lib/edge-utils'

describe('edgeClusterColor', () => {
  it('returns first color for cluster 0', () => {
    expect(edgeClusterColor(0)).toBe('#A78BFA')
  })

  it('returns correct color for each index 0-7', () => {
    const expected = [
      '#A78BFA', '#67E8F9', '#FCA5A1', '#86EFAC',
      '#FDE68A', '#F9A8D4', '#FDBA74', '#93C5FD',
    ]
    for (let i = 0; i < 8; i++) {
      expect(edgeClusterColor(i)).toBe(expected[i])
    }
  })

  it('cycles via modulo for IDs >= 8', () => {
    expect(edgeClusterColor(8)).toBe(edgeClusterColor(0))
    expect(edgeClusterColor(9)).toBe(edgeClusterColor(1))
    expect(edgeClusterColor(15)).toBe(edgeClusterColor(7))
    expect(edgeClusterColor(16)).toBe(edgeClusterColor(0))
  })

  it('handles negative IDs', () => {
    expect(edgeClusterColor(-1)).toBe(edgeClusterColor(7))
    expect(edgeClusterColor(-8)).toBe(edgeClusterColor(0))
    expect(edgeClusterColor(-3)).toBe(edgeClusterColor(5))
  })
})

describe('isEdgeVisible', () => {
  it('returns true when filter is null', () => {
    expect(isEdgeVisible({ edge_cluster_id: 3 }, null)).toBe(true)
  })

  it('returns true when edge has no cluster ID', () => {
    const filter = new Set([1, 2])
    expect(isEdgeVisible({}, filter)).toBe(true)
    expect(isEdgeVisible({ edge_cluster_id: null }, filter)).toBe(true)
    expect(isEdgeVisible({ edge_cluster_id: undefined }, filter)).toBe(true)
  })

  it('returns true when edge cluster ID is in the filter set', () => {
    const filter = new Set([1, 3, 5])
    expect(isEdgeVisible({ edge_cluster_id: 1 }, filter)).toBe(true)
    expect(isEdgeVisible({ edge_cluster_id: 3 }, filter)).toBe(true)
    expect(isEdgeVisible({ edge_cluster_id: 5 }, filter)).toBe(true)
  })

  it('returns false when edge cluster ID is not in the filter set', () => {
    const filter = new Set([1, 3])
    expect(isEdgeVisible({ edge_cluster_id: 2 }, filter)).toBe(false)
    expect(isEdgeVisible({ edge_cluster_id: 0 }, filter)).toBe(false)
  })

  it('returns false when filter is empty set and edge has cluster ID', () => {
    expect(isEdgeVisible({ edge_cluster_id: 0 }, new Set())).toBe(false)
  })
})

describe('edgeLineWidth', () => {
  it('returns 0.5/zoom for strength 0', () => {
    expect(edgeLineWidth(0, 1)).toBeCloseTo(0.5)
    expect(edgeLineWidth(0, 2)).toBeCloseTo(0.25)
  })

  it('returns 3.0/zoom for strength 1', () => {
    expect(edgeLineWidth(1, 1)).toBeCloseTo(3.0)
    expect(edgeLineWidth(1, 2)).toBeCloseTo(1.5)
  })

  it('maps strength 0.5 to 1.75/zoom', () => {
    expect(edgeLineWidth(0.5, 1)).toBeCloseTo(1.75)
  })

  it('clamps strength below 0', () => {
    expect(edgeLineWidth(-1, 1)).toBeCloseTo(0.5)
  })

  it('clamps strength above 1', () => {
    expect(edgeLineWidth(2, 1)).toBeCloseTo(3.0)
  })

  it('scales inversely with zoom', () => {
    const w1 = edgeLineWidth(0.5, 1)
    const w4 = edgeLineWidth(0.5, 4)
    expect(w1).toBeCloseTo(w4 * 4)
  })
})

describe('isWeakEdge', () => {
  it('returns true when strength is below threshold', () => {
    expect(isWeakEdge(0.3, 0.5)).toBe(true)
  })

  it('returns false when strength equals threshold', () => {
    expect(isWeakEdge(0.5, 0.5)).toBe(false)
  })

  it('returns false when strength is above threshold', () => {
    expect(isWeakEdge(0.7, 0.5)).toBe(false)
  })

  it('handles zero threshold', () => {
    expect(isWeakEdge(0, 0)).toBe(false)
    expect(isWeakEdge(-0.1, 0)).toBe(true)
  })
})

describe('pointToSegmentDist', () => {
  it('returns 0 when point is on the segment endpoint', () => {
    expect(pointToSegmentDist(0, 0, 0, 0, 4, 0)).toBeCloseTo(0)
    expect(pointToSegmentDist(4, 0, 0, 0, 4, 0)).toBeCloseTo(0)
  })

  it('returns 0 when point is on the segment midpoint', () => {
    expect(pointToSegmentDist(2, 0, 0, 0, 4, 0)).toBeCloseTo(0)
  })

  it('returns perpendicular distance for point above segment', () => {
    expect(pointToSegmentDist(2, 3, 0, 0, 4, 0)).toBeCloseTo(3)
  })

  it('returns distance to nearest endpoint when projection falls outside', () => {
    // Point is beyond the right end of a horizontal segment
    expect(pointToSegmentDist(6, 0, 0, 0, 4, 0)).toBeCloseTo(2)
    // Point is beyond the left end
    expect(pointToSegmentDist(-3, 0, 0, 0, 4, 0)).toBeCloseTo(3)
  })

  it('handles zero-length segment (degenerate case)', () => {
    expect(pointToSegmentDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)
  })

  it('handles diagonal segments', () => {
    // Segment from (0,0) to (4,4), point at (0,4) — distance is 2*sqrt(2)
    expect(pointToSegmentDist(0, 4, 0, 0, 4, 4)).toBeCloseTo(Math.sqrt(8))
  })

  it('handles negative coordinates', () => {
    expect(pointToSegmentDist(-1, -1, -1, -1, -1, -1)).toBeCloseTo(0)
    expect(pointToSegmentDist(0, 0, -3, 0, -1, 0)).toBeCloseTo(1)
  })
})
