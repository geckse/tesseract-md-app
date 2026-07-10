import { describe, it, expect } from 'vitest'
import {
  diffGraphData,
  shouldPatch,
  isEmptyDelta,
  linkKey,
  GRAPH_PATCH_MAX_CHANGED
} from '../../src/renderer/lib/graph-delta'
import type { GraphData, GraphNode, GraphEdge } from '../../src/renderer/types/cli'

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    path: id,
    label: null,
    cluster_id: null,
    custom_cluster_id: null,
    chunk_index: null,
    ...extra
  }
}

function edge(source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { source, target, weight: null, ...extra }
}

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): GraphData {
  return { nodes, edges, clusters: [], level: 'document' }
}

describe('diffGraphData', () => {
  it('returns an empty delta for identical data', () => {
    const g = graph([node('a'), node('b')], [edge('a', 'b')])
    const delta = diffGraphData(g, g)
    expect(isEmptyDelta(delta)).toBe(true)
    expect(delta.changedNodeCount).toBe(0)
  })

  it('detects added and removed nodes', () => {
    const prev = graph([node('a'), node('b')])
    const next = graph([node('a'), node('c')])
    const delta = diffGraphData(prev, next)
    expect(delta.addedNodes.map((n) => n.id)).toEqual(['c'])
    expect([...delta.removedNodeIds]).toEqual(['b'])
    expect(delta.changedNodeCount).toBe(2)
  })

  it('detects updated nodes only when a rendered field changes', () => {
    const prev = graph([node('a', { cluster_id: 1, label: 'x', size: 10 })])
    const nextCluster = graph([node('a', { cluster_id: 2, label: 'x', size: 10 })])
    expect(diffGraphData(prev, nextCluster).updatedNodes.has('a')).toBe(true)

    const nextLabel = graph([node('a', { cluster_id: 1, label: 'y', size: 10 })])
    expect(diffGraphData(prev, nextLabel).updatedNodes.has('a')).toBe(true)

    const nextSize = graph([node('a', { cluster_id: 1, label: 'x', size: 20 })])
    expect(diffGraphData(prev, nextSize).updatedNodes.has('a')).toBe(true)

    // path change alone is not a visual change
    const nextPath = graph([{ ...node('a', { cluster_id: 1, label: 'x', size: 10 }), path: 'moved' }])
    expect(diffGraphData(prev, nextPath).updatedNodes.has('a')).toBe(false)
  })

  it('diffs links as a content-keyed multiset', () => {
    // two identical a→b edges in prev, one in next → one removal
    const prev = graph([node('a'), node('b')], [edge('a', 'b'), edge('a', 'b')])
    const next = graph([node('a'), node('b')], [edge('a', 'b')])
    const delta = diffGraphData(prev, next)
    expect(delta.addedLinks).toHaveLength(0)
    expect(delta.removedLinkKeys.get(linkKey(edge('a', 'b')))).toBe(1)
  })

  it('treats a metadata change on a link as remove + add', () => {
    const prev = graph([node('a'), node('b')], [edge('a', 'b', { strength: 0.5 })])
    const next = graph([node('a'), node('b')], [edge('a', 'b', { strength: 0.9 })])
    const delta = diffGraphData(prev, next)
    expect(delta.addedLinks).toHaveLength(1)
    expect(delta.removedLinkKeys.get(linkKey(edge('a', 'b', { strength: 0.5 })))).toBe(1)
  })

  it('removes links touching removed nodes', () => {
    const prev = graph([node('a'), node('b')], [edge('a', 'b')])
    const next = graph([node('a')])
    const delta = diffGraphData(prev, next)
    expect(delta.removedNodeIds.has('b')).toBe(true)
    expect(delta.removedLinkKeys.get(linkKey(edge('a', 'b')))).toBe(1)
  })

  it('honours the visibility predicate for link diffing', () => {
    const prev = graph([node('a'), node('b')], [edge('a', 'b', { edge_cluster_id: 1 })])
    const next = graph([node('a'), node('b')], [edge('a', 'b', { edge_cluster_id: 1 })])
    // Filtered out on both sides → no link change
    const delta = diffGraphData(prev, next, () => false)
    expect(delta.addedLinks).toHaveLength(0)
    expect(delta.removedLinkKeys.size).toBe(0)
  })

  it('flags cluster membership changes', () => {
    const prev: GraphData = {
      ...graph([node('a')]),
      clusters: [{ id: 1, label: 'One', keywords: [], member_count: 3 }]
    }
    const next: GraphData = {
      ...graph([node('a')]),
      clusters: [{ id: 1, label: 'Renamed', keywords: [], member_count: 3 }]
    }
    expect(diffGraphData(prev, next).clustersChanged).toBe(true)
  })
})

describe('shouldPatch', () => {
  it('patches small changes', () => {
    const delta = diffGraphData(
      graph(Array.from({ length: 100 }, (_, i) => node(`n${i}`))),
      graph([...Array.from({ length: 100 }, (_, i) => node(`n${i}`)), node('extra')])
    )
    expect(shouldPatch(delta, 100, 101)).toBe(true)
  })

  it('rejects when more than 30% of nodes changed', () => {
    const prev = graph(Array.from({ length: 100 }, (_, i) => node(`n${i}`)))
    const next = graph(Array.from({ length: 100 }, (_, i) => node(i < 50 ? `n${i}` : `m${i}`)))
    const delta = diffGraphData(prev, next)
    expect(delta.changedNodeCount).toBe(100) // 50 removed + 50 added
    expect(shouldPatch(delta, 100, 100)).toBe(false)
  })

  it('caps the absolute number of changes regardless of graph size', () => {
    const big = 5000
    const prev = graph(Array.from({ length: big }, (_, i) => node(`n${i}`)))
    // 201 additions → exceeds the 200 hard cap even though it is < 30%
    const next = graph([
      ...Array.from({ length: big }, (_, i) => node(`n${i}`)),
      ...Array.from({ length: GRAPH_PATCH_MAX_CHANGED + 1 }, (_, i) => node(`x${i}`))
    ])
    const delta = diffGraphData(prev, next)
    expect(shouldPatch(delta, big, big + GRAPH_PATCH_MAX_CHANGED + 1)).toBe(false)
  })
})
