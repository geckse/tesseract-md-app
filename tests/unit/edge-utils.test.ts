import { describe, it, expect } from 'vitest'
import {
  edgeClusterColor,
  isEdgeVisible,
  edgeLineWidth,
  isWeakEdge,
  edgeLinkWidth,
  edgeLinkColor,
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

describe('edgeLinkWidth', () => {
  it('returns 0.5 for strength 0', () => {
    expect(edgeLinkWidth(0)).toBeCloseTo(0.5)
  })

  it('returns 3.0 for strength 1', () => {
    expect(edgeLinkWidth(1)).toBeCloseTo(3.0)
  })

  it('maps strength 0.5 to 1.75', () => {
    expect(edgeLinkWidth(0.5)).toBeCloseTo(1.75)
  })

  it('clamps strength below 0', () => {
    expect(edgeLinkWidth(-1)).toBeCloseTo(0.5)
  })

  it('clamps strength above 1', () => {
    expect(edgeLinkWidth(2)).toBeCloseTo(3.0)
  })

  it('does not divide by zoom (unlike edgeLineWidth)', () => {
    // edgeLinkWidth has no zoom parameter — returns absolute width
    const w = edgeLinkWidth(0.5)
    expect(w).toBeCloseTo(1.75)
  })

  it('returns monotonically increasing values for increasing strength', () => {
    const w0 = edgeLinkWidth(0)
    const w25 = edgeLinkWidth(0.25)
    const w50 = edgeLinkWidth(0.5)
    const w75 = edgeLinkWidth(0.75)
    const w100 = edgeLinkWidth(1)
    expect(w25).toBeGreaterThan(w0)
    expect(w50).toBeGreaterThan(w25)
    expect(w75).toBeGreaterThan(w50)
    expect(w100).toBeGreaterThan(w75)
  })
})

describe('edgeLinkColor', () => {
  it('returns edge cluster color for valid cluster ID', () => {
    expect(edgeLinkColor(0, 0.8, 0.3)).toBe('#A78BFA')
    expect(edgeLinkColor(1, 0.8, 0.3)).toBe('#67E8F9')
  })

  it('returns fallback color #93C5FD for null cluster ID', () => {
    expect(edgeLinkColor(null, 0.8, 0.3)).toBe('#93C5FD')
  })

  it('returns fallback color #93C5FD for undefined cluster ID', () => {
    expect(edgeLinkColor(undefined, 0.8, 0.3)).toBe('#93C5FD')
  })

  it('appends hex alpha 40 for weak edges', () => {
    // strength 0.2 < threshold 0.5 → weak
    expect(edgeLinkColor(0, 0.2, 0.5)).toBe('#A78BFA40')
  })

  it('does not append alpha for strong edges', () => {
    // strength 0.7 >= threshold 0.5 → not weak
    expect(edgeLinkColor(0, 0.7, 0.5)).toBe('#A78BFA')
  })

  it('does not append alpha when strength equals threshold', () => {
    // strength 0.5 is NOT < threshold 0.5 → not weak
    expect(edgeLinkColor(0, 0.5, 0.5)).toBe('#A78BFA')
  })

  it('appends alpha for null cluster ID weak edges', () => {
    expect(edgeLinkColor(null, 0.1, 0.5)).toBe('#93C5FD40')
  })

  it('handles zero threshold (only negative strength is weak)', () => {
    expect(edgeLinkColor(0, 0, 0)).toBe('#A78BFA')
    expect(edgeLinkColor(0, -0.1, 0)).toBe('#A78BFA40')
  })

  it('cycles cluster colors via modulo for high cluster IDs', () => {
    expect(edgeLinkColor(8, 0.8, 0.3)).toBe(edgeLinkColor(0, 0.8, 0.3))
    expect(edgeLinkColor(16, 0.8, 0.3)).toBe(edgeLinkColor(0, 0.8, 0.3))
  })
})
