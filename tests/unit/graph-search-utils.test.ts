import { describe, it, expect } from 'vitest'
import {
  getNodePath,
  buildSearchScoreMap,
  buildGraphContextMap,
  computeSearchNodeOpacity,
  computeEdgeSearchAlpha
} from '@renderer/lib/graph-search-utils'
import type { SearchResult, GraphContextItem } from '@renderer/types/cli'

// ─── Helper factories ────────────────────────────────────────────────

function makeResult(path: string, score: number): SearchResult {
  return {
    score,
    chunk: {
      chunk_id: `${path}#0`,
      heading_hierarchy: [],
      content: '',
      start_line: 0,
      end_line: 10
    },
    file: {
      path,
      frontmatter: null,
      file_size: 100,
      path_components: path.split('/'),
      modified_at: null
    }
  }
}

function makeContextItem(path: string, hopDistance: number): GraphContextItem {
  return {
    chunk: {
      chunk_id: `${path}#0`,
      heading_hierarchy: [],
      content: '',
      start_line: 0,
      end_line: 10
    },
    file: {
      path,
      frontmatter: null,
      file_size: 100,
      path_components: path.split('/'),
      modified_at: null
    },
    linked_from: 'other.md',
    hop_distance: hopDistance
  }
}

// ─── getNodePath ─────────────────────────────────────────────────────

describe('getNodePath', () => {
  it('extracts id from object endpoint', () => {
    expect(getNodePath({ id: 'docs/readme.md' })).toBe('docs/readme.md')
  })

  it('converts string endpoint', () => {
    expect(getNodePath('notes/todo.md')).toBe('notes/todo.md')
  })

  it('handles number endpoint', () => {
    expect(getNodePath(42)).toBe('42')
  })

  it('handles null', () => {
    expect(getNodePath(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(getNodePath(undefined)).toBe('undefined')
  })

  it('extracts id from object with extra properties', () => {
    expect(getNodePath({ id: 'test.md', x: 10, y: 20, color: '#fff' })).toBe('test.md')
  })
})

// ─── buildSearchScoreMap ─────────────────────────────────────────────

describe('buildSearchScoreMap', () => {
  it('returns empty map for empty results', () => {
    expect(buildSearchScoreMap([])).toEqual(new Map())
  })

  it('maps file path to score', () => {
    const map = buildSearchScoreMap([makeResult('a.md', 0.8)])
    expect(map.get('a.md')).toBe(0.8)
  })

  it('takes max score when multiple chunks match same file', () => {
    const map = buildSearchScoreMap([
      makeResult('a.md', 0.5),
      makeResult('a.md', 0.9),
      makeResult('a.md', 0.3)
    ])
    expect(map.get('a.md')).toBe(0.9)
  })

  it('handles multiple files', () => {
    const map = buildSearchScoreMap([
      makeResult('a.md', 0.8),
      makeResult('b.md', 0.6)
    ])
    expect(map.size).toBe(2)
    expect(map.get('a.md')).toBe(0.8)
    expect(map.get('b.md')).toBe(0.6)
  })

  it('handles zero scores', () => {
    const map = buildSearchScoreMap([makeResult('a.md', 0)])
    expect(map.get('a.md')).toBe(0)
  })

  it('single result maps correctly', () => {
    const map = buildSearchScoreMap([makeResult('solo.md', 0.42)])
    expect(map.size).toBe(1)
    expect(map.get('solo.md')).toBe(0.42)
  })
})

// ─── buildGraphContextMap ────────────────────────────────────────────

describe('buildGraphContextMap', () => {
  it('returns empty map for empty context', () => {
    expect(buildGraphContextMap([], new Map())).toEqual(new Map())
  })

  it('attenuates score by 0.4 / hop_distance', () => {
    const map = buildGraphContextMap([makeContextItem('linked.md', 1)], new Map())
    expect(map.get('linked.md')).toBeCloseTo(0.4)
  })

  it('attenuates more at hop distance 2', () => {
    const map = buildGraphContextMap([makeContextItem('far.md', 2)], new Map())
    expect(map.get('far.md')).toBeCloseTo(0.2)
  })

  it('skips paths already in direct match map', () => {
    const direct = new Map([['a.md', 0.9]])
    const map = buildGraphContextMap([makeContextItem('a.md', 1)], direct)
    expect(map.has('a.md')).toBe(false)
  })

  it('takes max attenuated score for duplicate paths', () => {
    const map = buildGraphContextMap(
      [makeContextItem('x.md', 2), makeContextItem('x.md', 1)],
      new Map()
    )
    expect(map.get('x.md')).toBeCloseTo(0.4)
  })

  it('attenuates at hop distance 3', () => {
    const map = buildGraphContextMap([makeContextItem('far.md', 3)], new Map())
    expect(map.get('far.md')).toBeCloseTo(0.4 / 3)
  })
})

// ─── computeSearchNodeOpacity ────────────────────────────────────────

describe('computeSearchNodeOpacity', () => {
  it('returns 0.05 for unmatched nodes', () => {
    expect(computeSearchNodeOpacity(undefined)).toBe(0.05)
  })

  it('returns 0.3 for score 0', () => {
    expect(computeSearchNodeOpacity(0)).toBeCloseTo(0.3)
  })

  it('returns 1.0 for score 1', () => {
    expect(computeSearchNodeOpacity(1)).toBeCloseTo(1.0)
  })

  it('returns 0.65 for score 0.5', () => {
    expect(computeSearchNodeOpacity(0.5)).toBeCloseTo(0.65)
  })

  it('increases monotonically with score', () => {
    const o1 = computeSearchNodeOpacity(0.2)
    const o2 = computeSearchNodeOpacity(0.5)
    const o3 = computeSearchNodeOpacity(0.8)
    expect(o1).toBeLessThan(o2)
    expect(o2).toBeLessThan(o3)
  })
})

// ─── computeEdgeSearchAlpha ──────────────────────────────────────────

describe('computeEdgeSearchAlpha', () => {
  it('returns 0.02 when neither endpoint matched', () => {
    expect(computeEdgeSearchAlpha(undefined, undefined)).toBe(0.02)
  })

  it('returns 0.08 when only source matched', () => {
    expect(computeEdgeSearchAlpha(0.9, undefined)).toBe(0.08)
  })

  it('returns 0.08 when only target matched', () => {
    expect(computeEdgeSearchAlpha(undefined, 0.5)).toBe(0.08)
  })

  it('returns 0.2 + 0.8 * min when both matched', () => {
    expect(computeEdgeSearchAlpha(0.8, 0.6)).toBeCloseTo(0.2 + 0.8 * 0.6)
  })

  it('returns 1.0 when both scores are 1.0', () => {
    expect(computeEdgeSearchAlpha(1.0, 1.0)).toBeCloseTo(1.0)
  })

  it('returns 0.2 when both scores are 0', () => {
    expect(computeEdgeSearchAlpha(0, 0)).toBeCloseTo(0.2)
  })

  it('is symmetric — swapping src/tgt gives same result', () => {
    expect(computeEdgeSearchAlpha(1.0, 0.5)).toBeCloseTo(computeEdgeSearchAlpha(0.5, 1.0))
  })
})
