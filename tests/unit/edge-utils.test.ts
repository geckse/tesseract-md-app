import { describe, it, expect } from 'vitest'
import {
  edgeClusterColor,
  isEdgeVisible,
  edgeLineWidth,
  isWeakEdge,
  edgeLinkWidth,
  edgeLinkColor,
  edgeStrengthOpacity,
  edgeIdleOpacity,
  edgeScreenWidth,
  edgeArrowOpacity,
  UNCLUSTERED_EDGE_COLOR
} from '@renderer/lib/edge-utils'
import { generateHarmonicPalette } from '@renderer/lib/harmonic-palette'

/** Test palette with 8 colors for edge clusters */
const testPalette = generateHarmonicPalette('#00E5FF', 8)

describe('edgeClusterColor', () => {
  it('returns first palette color for cluster 0', () => {
    expect(edgeClusterColor(0, testPalette)).toBe(testPalette.colors[0])
  })

  it('returns correct color for each index 0-7', () => {
    for (let i = 0; i < 8; i++) {
      expect(edgeClusterColor(i, testPalette)).toBe(testPalette.colors[i])
    }
  })

  it('cycles via modulo for IDs >= 8', () => {
    expect(edgeClusterColor(8, testPalette)).toBe(edgeClusterColor(0, testPalette))
    expect(edgeClusterColor(9, testPalette)).toBe(edgeClusterColor(1, testPalette))
    expect(edgeClusterColor(15, testPalette)).toBe(edgeClusterColor(7, testPalette))
    expect(edgeClusterColor(16, testPalette)).toBe(edgeClusterColor(0, testPalette))
  })

  it('handles negative IDs', () => {
    expect(edgeClusterColor(-1, testPalette)).toBe(edgeClusterColor(7, testPalette))
    expect(edgeClusterColor(-8, testPalette)).toBe(edgeClusterColor(0, testPalette))
    expect(edgeClusterColor(-3, testPalette)).toBe(edgeClusterColor(5, testPalette))
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
    expect(edgeLinkColor(0, 0.8, 0.3, testPalette)).toBe(testPalette.colors[0])
    expect(edgeLinkColor(1, 0.8, 0.3, testPalette)).toBe(testPalette.colors[1])
  })

  it('returns a neutral color for null cluster ID', () => {
    expect(edgeLinkColor(null, 0.8, 0.3, testPalette)).toBe(UNCLUSTERED_EDGE_COLOR)
    expect(edgeLinkColor(null, 0.8, 0.3, testPalette)).not.toBe(
      testPalette.colors[testPalette.colors.length - 1]
    )
  })

  it('returns a neutral color for undefined cluster ID', () => {
    expect(edgeLinkColor(undefined, 0.8, 0.3, testPalette)).toBe(UNCLUSTERED_EDGE_COLOR)
  })

  it('keeps weak-edge hue opaque so opacity is applied exactly once by the renderer', () => {
    expect(edgeLinkColor(0, 0.2, 0.5, testPalette)).toBe(testPalette.colors[0])
  })

  it('does not add opacity for strong edges', () => {
    const result = edgeLinkColor(0, 0.7, 0.5, testPalette)
    expect(result).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('does not add opacity when strength equals threshold', () => {
    const result = edgeLinkColor(0, 0.5, 0.5, testPalette)
    expect(result).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('keeps null weak edges neutral', () => {
    expect(edgeLinkColor(null, 0.1, 0.5, testPalette)).toBe(UNCLUSTERED_EDGE_COLOR)
  })

  it('does not mix threshold state into the semantic color', () => {
    expect(edgeLinkColor(0, 0, 0, testPalette)).toBe(testPalette.colors[0])
    expect(edgeLinkColor(0, -0.1, 0, testPalette)).toBe(testPalette.colors[0])
  })

  it('cycles cluster colors via modulo for high cluster IDs', () => {
    expect(edgeLinkColor(8, 0.8, 0.3, testPalette)).toBe(edgeLinkColor(0, 0.8, 0.3, testPalette))
    expect(edgeLinkColor(16, 0.8, 0.3, testPalette)).toBe(edgeLinkColor(0, 0.8, 0.3, testPalette))
  })
})

describe('edgeStrengthOpacity', () => {
  it('keeps every strength above a visible nonzero floor', () => {
    expect(edgeStrengthOpacity(0, 0.3)).toBeGreaterThanOrEqual(0.58)
    expect(edgeStrengthOpacity(-10, 0.3)).toBeGreaterThanOrEqual(0.58)
  })

  it('is continuous and increases through the weak threshold', () => {
    const values = [0, 0.15, 0.2999, 0.3, 0.6, 1].map((strength) =>
      edgeStrengthOpacity(strength, 0.3)
    )
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1])
    }
    expect(values[2]).toBeCloseTo(values[3], 3)
    expect(values.at(-1)).toBe(1)
  })

  it('clamps invalid inputs to stable visible defaults', () => {
    expect(edgeStrengthOpacity(Number.NaN, Number.NaN)).toBeGreaterThan(0)
    expect(edgeStrengthOpacity(10, 10)).toBeLessThanOrEqual(1)
  })
})

describe('overview edge presentation', () => {
  it('keeps document and chunk edges above a nonzero overview floor', () => {
    expect(edgeIdleOpacity(0, 0.3, false)).toBeGreaterThanOrEqual(0.09)
    expect(edgeIdleOpacity(0, 0.3, true)).toBeGreaterThanOrEqual(0.05)
    expect(edgeIdleOpacity(1, 0.3, false)).toBeCloseTo(0.17)
  })

  it('uses CSS-pixel width with a one-pixel overview floor', () => {
    expect(edgeScreenWidth(0.5, true, false)).toBe(1)
    expect(edgeScreenWidth(3, true, false)).toBeCloseTo(1.8)
    expect(edgeScreenWidth(3, true, true)).toBeCloseTo(2.5)
    expect(edgeScreenWidth(3, false, false)).toBe(1)
  })

  it('keeps idle arrows subordinate and selected arrows prominent', () => {
    expect(edgeArrowOpacity(0.17, false)).toBeCloseTo(0.2125)
    expect(edgeArrowOpacity(1, false)).toBe(0.24)
    expect(edgeArrowOpacity(0.01, true)).toBe(0.95)
  })
})
