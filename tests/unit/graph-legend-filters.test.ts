import { describe, expect, it } from 'vitest'

import {
  graphLegendLinkMatch,
  graphNodeBelongsToFolder,
  graphNodeMatchesLegendHighlight,
  toggleVisibleEdgeCluster
} from '@renderer/lib/graph-legend-filters'

const node = (path: string, clusterId: number | null = null, topicIds: number[] = []) => ({
  path,
  cluster_id: clusterId,
  custom_cluster_ids: topicIds
})

describe('graph legend node filters', () => {
  it('matches folders on path boundaries and normalizes separators', () => {
    expect(graphNodeBelongsToFolder('docs/guide.md', '/docs/')).toBe(true)
    expect(graphNodeBelongsToFolder('docs\\nested\\guide.md', 'docs/nested')).toBe(true)
    expect(graphNodeBelongsToFolder('docs-old/guide.md', 'docs')).toBe(false)
    expect(graphNodeBelongsToFolder('readme.md', '(root)')).toBe(true)
    expect(graphNodeBelongsToFolder('docs/readme.md', '(root)')).toBe(false)
  })

  it('matches automatic clusters, secondary topics, and folders', () => {
    const candidate = node('docs/guide.md', 3, [5, 8])
    expect(graphNodeMatchesLegendHighlight(candidate, { kind: 'cluster', id: 3 })).toBe(true)
    expect(graphNodeMatchesLegendHighlight(candidate, { kind: 'topic', id: 8 })).toBe(true)
    expect(graphNodeMatchesLegendHighlight(candidate, { kind: 'topic', id: 3 })).toBe(false)
    expect(graphNodeMatchesLegendHighlight(candidate, { kind: 'folder', path: 'docs' })).toBe(true)
  })

  it('classifies internal, incident, and unrelated group links', () => {
    const highlight = { kind: 'cluster' as const, id: 2 }
    expect(graphLegendLinkMatch(node('a.md', 2), node('b.md', 2), highlight)).toBe('both')
    expect(graphLegendLinkMatch(node('a.md', 2), node('b.md', 4), highlight)).toBe('incident')
    expect(graphLegendLinkMatch(node('a.md', 1), node('b.md', 4), highlight)).toBe('none')
  })
})

describe('toggleVisibleEdgeCluster', () => {
  const available = [1, 2, 3]

  it('hides the clicked type from the initial all-visible state', () => {
    expect(toggleVisibleEdgeCluster(null, available, 2)).toEqual(new Set([1, 3]))
  })

  it('can hide every type and restore them one at a time', () => {
    let filter = toggleVisibleEdgeCluster(null, available, 1)
    filter = toggleVisibleEdgeCluster(filter, available, 2)
    filter = toggleVisibleEdgeCluster(filter, available, 3)
    expect(filter).toEqual(new Set())

    filter = toggleVisibleEdgeCluster(filter, available, 2)
    expect(filter).toEqual(new Set([2]))
  })

  it('collapses a fully restored filter back to all-visible null', () => {
    expect(toggleVisibleEdgeCluster(new Set([1, 3]), available, 2)).toBeNull()
  })
})
