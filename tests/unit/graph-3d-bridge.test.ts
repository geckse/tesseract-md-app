import { describe, it, expect } from 'vitest'
import {
  buildGraph3DData,
  seedClusterPositions,
  nodeSizeValue,
  nodeTooltipHtml,
  edgeTooltipHtml,
  edgeArrowColor,
  computeDegreeMap,
} from '@renderer/lib/graph-3d-bridge'
import type {
  Graph3DNode,
  Graph3DLink,
  BuildGraph3DOptions,
} from '@renderer/lib/graph-3d-bridge'
import type { GraphData, GraphNode, GraphEdge, GraphCluster } from '@renderer/types/cli'

// ─── Test Helpers ───────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1',
    path: 'docs/readme.md',
    label: null,
    cluster_id: null,
    chunk_index: null,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    source: 'node-1',
    target: 'node-2',
    weight: 1,
    ...overrides,
  }
}

function makeCluster(overrides: Partial<GraphCluster> = {}): GraphCluster {
  return {
    id: 0,
    label: 'Cluster 0',
    keywords: ['test'],
    member_count: 3,
    ...overrides,
  }
}

function makeGraphData(overrides: Partial<GraphData> = {}): GraphData {
  return {
    nodes: [],
    edges: [],
    clusters: [],
    level: 'document',
    ...overrides,
  }
}

function defaultOptions(overrides: Partial<BuildGraph3DOptions> = {}): BuildGraph3DOptions {
  return {
    coloringMode: 'cluster',
    edgeFilter: null,
    weakThreshold: 0.3,
    level: 'document',
    ...overrides,
  }
}

// ─── computeDegreeMap ───────────────────────────────────────────────

describe('computeDegreeMap', () => {
  it('returns empty map for empty edges', () => {
    const map = computeDegreeMap([])
    expect(map.size).toBe(0)
  })

  it('counts both source and target for a single edge', () => {
    const map = computeDegreeMap([makeEdge({ source: 'a', target: 'b' })])
    expect(map.get('a')).toBe(1)
    expect(map.get('b')).toBe(1)
  })

  it('accumulates degree for nodes with multiple edges', () => {
    const edges = [
      makeEdge({ source: 'a', target: 'b' }),
      makeEdge({ source: 'a', target: 'c' }),
      makeEdge({ source: 'b', target: 'c' }),
    ]
    const map = computeDegreeMap(edges)
    expect(map.get('a')).toBe(2)
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(2)
  })

  it('counts self-loops as degree 2', () => {
    const map = computeDegreeMap([makeEdge({ source: 'a', target: 'a' })])
    expect(map.get('a')).toBe(2)
  })

  it('handles hub node with many connections', () => {
    const edges = [
      makeEdge({ source: 'hub', target: 'a' }),
      makeEdge({ source: 'hub', target: 'b' }),
      makeEdge({ source: 'hub', target: 'c' }),
      makeEdge({ source: 'hub', target: 'd' }),
      makeEdge({ source: 'hub', target: 'e' }),
    ]
    const map = computeDegreeMap(edges)
    expect(map.get('hub')).toBe(5)
  })
})

// ─── nodeSizeValue ──────────────────────────────────────────────────

describe('nodeSizeValue', () => {
  it('returns 1 + degree * 2 in document mode', () => {
    expect(nodeSizeValue('document', 0, 0, 100)).toBe(1)
    expect(nodeSizeValue('document', 1, 0, 100)).toBe(3)
    expect(nodeSizeValue('document', 5, 0, 100)).toBe(11)
    expect(nodeSizeValue('document', 10, 0, 100)).toBe(21)
  })

  it('ignores size and maxSize in document mode', () => {
    expect(nodeSizeValue('document', 3, 500, 1000)).toBe(7)
    expect(nodeSizeValue('document', 3, 0, 0)).toBe(7)
  })

  it('returns 1 + (size / maxSize) * 8 in chunk mode', () => {
    expect(nodeSizeValue('chunk', 0, 0, 100)).toBe(1)
    expect(nodeSizeValue('chunk', 0, 50, 100)).toBeCloseTo(5)
    expect(nodeSizeValue('chunk', 0, 100, 100)).toBeCloseTo(9)
  })

  it('ignores degree in chunk mode', () => {
    expect(nodeSizeValue('chunk', 10, 50, 100)).toBeCloseTo(5)
  })

  it('returns 1 when maxSize is 0 in chunk mode', () => {
    expect(nodeSizeValue('chunk', 5, 100, 0)).toBe(1)
  })

  it('returns 1 when maxSize is negative in chunk mode', () => {
    expect(nodeSizeValue('chunk', 0, 50, -10)).toBe(1)
  })

  it('returns at least 1 for all inputs', () => {
    expect(nodeSizeValue('document', 0, 0, 0)).toBeGreaterThanOrEqual(1)
    expect(nodeSizeValue('chunk', 0, 0, 0)).toBeGreaterThanOrEqual(1)
    expect(nodeSizeValue('chunk', 0, 0, 100)).toBeGreaterThanOrEqual(1)
  })
})

// ─── nodeTooltipHtml ────────────────────────────────────────────────

describe('nodeTooltipHtml', () => {
  it('contains the file path', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/readme.md', label: null,
      cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    expect(html).toContain('docs/readme.md')
    expect(html).toContain('graph-tooltip-title')
  })

  it('includes cluster label when provided', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/readme.md', label: null,
      cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node, 'Architecture')
    expect(html).toContain('Cluster: Architecture')
    expect(html).toContain('graph-tooltip-meta')
  })

  it('omits cluster label when null', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/readme.md', label: null,
      cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node, null)
    expect(html).not.toContain('Cluster:')
  })

  it('omits cluster label when undefined', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/readme.md', label: null,
      cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    expect(html).not.toContain('Cluster:')
  })

  it('includes chunk heading when chunk_index and label are present', () => {
    const node: Graph3DNode = {
      id: 'c1', path: 'docs/readme.md', label: '## Getting Started',
      cluster_id: null, chunk_index: 2, size: 100, val: 3, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    expect(html).toContain('## Getting Started')
  })

  it('omits chunk heading when chunk_index is null', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/readme.md', label: 'Some Label',
      cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    // label should not appear as a chunk heading line
    const metaDivs = html.match(/graph-tooltip-meta/g)
    expect(metaDivs).toBeNull()
  })

  it('omits chunk heading when label is null', () => {
    const node: Graph3DNode = {
      id: 'c1', path: 'docs/readme.md', label: null,
      cluster_id: null, chunk_index: 0, size: 50, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    expect(html).not.toContain('graph-tooltip-meta')
  })

  it('escapes HTML special characters in path', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'docs/<script>.md', label: null,
      cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('escapes HTML special characters in cluster label', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'test.md', label: null,
      cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff',
    }
    const html = nodeTooltipHtml(node, 'A & B <bold>')
    expect(html).toContain('A &amp; B &lt;bold&gt;')
  })
})

// ─── edgeTooltipHtml ────────────────────────────────────────────────

describe('edgeTooltipHtml', () => {
  it('includes relationship type when present', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: 'references',
      strength: 0.8, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('references')
    expect(html).toContain('graph-tooltip-title')
  })

  it('omits relationship type when null', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: 0.5, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).not.toContain('graph-tooltip-title')
  })

  it('includes strength as percentage', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: 0.75, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('Strength: 75%')
  })

  it('omits strength when null', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).not.toContain('Strength')
  })

  it('includes context text when present', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: 'Related to architecture decisions',
      edge_cluster_id: null, color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('Related to architecture decisions')
    expect(html).toContain('graph-tooltip-context')
  })

  it('truncates context text longer than 120 characters', () => {
    const longText = 'A'.repeat(150)
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: longText,
      edge_cluster_id: null, color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('A'.repeat(120))
    expect(html).toContain('\u2026') // ellipsis character
    expect(html).not.toContain('A'.repeat(121))
  })

  it('does not truncate context text at exactly 120 characters', () => {
    const exactText = 'B'.repeat(120)
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: exactText,
      edge_cluster_id: null, color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('B'.repeat(120))
    expect(html).not.toContain('\u2026')
  })

  it('returns empty string when all fields are null', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toBe('')
  })

  it('escapes HTML special characters in relationship type', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: '<script>alert("xss")</script>',
      strength: null, context_text: null, edge_cluster_id: null,
      color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('escapes HTML special characters in context text', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: null,
      strength: null, context_text: 'A & B "quoted"',
      edge_cluster_id: null, color: '#fff', width: 1,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('A &amp; B &quot;quoted&quot;')
  })

  it('includes all fields together', () => {
    const link: Graph3DLink = {
      source: 'a', target: 'b', relationship_type: 'extends',
      strength: 0.9, context_text: 'Module extends the base class',
      edge_cluster_id: 1, color: '#fff', width: 2,
    }
    const html = edgeTooltipHtml(link)
    expect(html).toContain('extends')
    expect(html).toContain('Strength: 90%')
    expect(html).toContain('Module extends the base class')
  })
})

// ─── edgeArrowColor ─────────────────────────────────────────────────

describe('edgeArrowColor', () => {
  it('returns gray when no node is selected', () => {
    expect(edgeArrowColor('a', 'b', null, false)).toBe('#555555')
  })

  it('returns cyan for outgoing edge from selected node', () => {
    expect(edgeArrowColor('selected', 'other', 'selected', false)).toBe('#00E5FF')
  })

  it('returns red for incoming edge to selected node', () => {
    expect(edgeArrowColor('other', 'selected', 'selected', false)).toBe('#FF6B6B')
  })

  it('returns green for bidirectional edge (source is selected)', () => {
    expect(edgeArrowColor('selected', 'other', 'selected', true)).toBe('#51CF66')
  })

  it('returns green for bidirectional edge (target is selected)', () => {
    expect(edgeArrowColor('other', 'selected', 'selected', true)).toBe('#51CF66')
  })

  it('returns gray for non-neighbor edge when selection exists', () => {
    expect(edgeArrowColor('a', 'b', 'selected', false)).toBe('#555555')
  })

  it('returns gray for non-neighbor bidirectional edge', () => {
    expect(edgeArrowColor('a', 'b', 'selected', true)).toBe('#555555')
  })

  it('prioritizes bidirectional green over cyan/red', () => {
    // When source is selected and edge is bidirectional, should be green
    const color = edgeArrowColor('selected', 'b', 'selected', true)
    expect(color).toBe('#51CF66')
  })
})

// ─── seedClusterPositions ───────────────────────────────────────────

describe('seedClusterPositions', () => {
  it('does nothing for empty nodes array', () => {
    const nodes: Graph3DNode[] = []
    seedClusterPositions(nodes, [])
    expect(nodes).toHaveLength(0)
  })

  it('places unclustered nodes near origin with jitter', () => {
    const nodes: Graph3DNode[] = [
      { id: 'n1', path: 'a.md', label: null, cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n2', path: 'b.md', label: null, cluster_id: null, chunk_index: null, size: null, val: 1, color: '#fff' },
    ]
    seedClusterPositions(nodes, [])

    for (const node of nodes) {
      expect(node.x).toBeDefined()
      expect(node.y).toBeDefined()
      expect(node.z).toBeDefined()
      // Near origin: within jitterScale = 200 * 0.15 = 30
      const dist = Math.sqrt(node.x! ** 2 + node.y! ** 2 + node.z! ** 2)
      expect(dist).toBeLessThan(30)
    }
  })

  it('places clustered nodes near their cluster centroids', () => {
    const nodes: Graph3DNode[] = [
      { id: 'n1', path: 'a.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n2', path: 'b.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n3', path: 'c.md', label: null, cluster_id: 1, chunk_index: null, size: null, val: 1, color: '#fff' },
    ]
    const clusters: GraphCluster[] = [
      makeCluster({ id: 0, label: 'Cluster A' }),
      makeCluster({ id: 1, label: 'Cluster B' }),
    ]
    seedClusterPositions(nodes, clusters, 200)

    // Nodes in the same cluster should be near each other
    const dist01 = Math.sqrt(
      (nodes[0].x! - nodes[1].x!) ** 2 +
      (nodes[0].y! - nodes[1].y!) ** 2 +
      (nodes[0].z! - nodes[1].z!) ** 2,
    )
    // Jitter is ±15 each axis, so max dist between same-cluster nodes ≈ 30*sqrt(3) ≈ 52
    expect(dist01).toBeLessThan(55)

    // All nodes should have positions set
    for (const node of nodes) {
      expect(node.x).toBeDefined()
      expect(node.y).toBeDefined()
      expect(node.z).toBeDefined()
    }
  })

  it('distributes cluster centroids at spreadRadius distance from origin', () => {
    const nodes: Graph3DNode[] = [
      { id: 'n1', path: 'a.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n2', path: 'b.md', label: null, cluster_id: 1, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n3', path: 'c.md', label: null, cluster_id: 2, chunk_index: null, size: null, val: 1, color: '#fff' },
    ]
    const clusters: GraphCluster[] = [
      makeCluster({ id: 0 }),
      makeCluster({ id: 1 }),
      makeCluster({ id: 2 }),
    ]
    const spreadRadius = 300
    seedClusterPositions(nodes, clusters, spreadRadius)

    // Each node should be approximately spreadRadius from origin (±jitter)
    for (const node of nodes) {
      const dist = Math.sqrt(node.x! ** 2 + node.y! ** 2 + node.z! ** 2)
      // spreadRadius ± jitter (300 * 0.15 / 2 * sqrt(3) ≈ 39)
      expect(dist).toBeGreaterThan(spreadRadius * 0.7)
      expect(dist).toBeLessThan(spreadRadius * 1.3)
    }
  })

  it('handles single cluster correctly', () => {
    const nodes: Graph3DNode[] = [
      { id: 'n1', path: 'a.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
      { id: 'n2', path: 'b.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
    ]
    const clusters = [makeCluster({ id: 0 })]
    seedClusterPositions(nodes, clusters, 200)

    // Both nodes should be near each other (same cluster centroid + jitter)
    for (const node of nodes) {
      expect(node.x).toBeDefined()
      expect(node.y).toBeDefined()
      expect(node.z).toBeDefined()
    }
  })

  it('separates different clusters in space', () => {
    // Create many nodes per cluster to get average positions
    const nodesA: Graph3DNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`, path: `a${i}.md`, label: null, cluster_id: 0,
      chunk_index: null, size: null, val: 1, color: '#fff',
    }))
    const nodesB: Graph3DNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`, path: `b${i}.md`, label: null, cluster_id: 1,
      chunk_index: null, size: null, val: 1, color: '#fff',
    }))
    const allNodes = [...nodesA, ...nodesB]
    const clusters = [makeCluster({ id: 0 }), makeCluster({ id: 1 })]
    seedClusterPositions(allNodes, clusters, 200)

    // Compute average position for each cluster
    const avgA = { x: 0, y: 0, z: 0 }
    for (const n of nodesA) { avgA.x += n.x!; avgA.y += n.y!; avgA.z += n.z! }
    avgA.x /= nodesA.length; avgA.y /= nodesA.length; avgA.z /= nodesA.length

    const avgB = { x: 0, y: 0, z: 0 }
    for (const n of nodesB) { avgB.x += n.x!; avgB.y += n.y!; avgB.z += n.z! }
    avgB.x /= nodesB.length; avgB.y /= nodesB.length; avgB.z /= nodesB.length

    // Clusters should be well-separated
    const interClusterDist = Math.sqrt(
      (avgA.x - avgB.x) ** 2 + (avgA.y - avgB.y) ** 2 + (avgA.z - avgB.z) ** 2,
    )
    expect(interClusterDist).toBeGreaterThan(100)
  })

  it('mutates nodes in place', () => {
    const node: Graph3DNode = {
      id: 'n1', path: 'a.md', label: null, cluster_id: null,
      chunk_index: null, size: null, val: 1, color: '#fff',
    }
    expect(node.x).toBeUndefined()
    seedClusterPositions([node], [])
    expect(node.x).toBeDefined()
    expect(node.y).toBeDefined()
    expect(node.z).toBeDefined()
  })

  it('uses default spreadRadius of 200', () => {
    const nodes: Graph3DNode[] = [
      { id: 'n1', path: 'a.md', label: null, cluster_id: 0, chunk_index: null, size: null, val: 1, color: '#fff' },
    ]
    const clusters = [makeCluster({ id: 0 })]
    seedClusterPositions(nodes, clusters)

    const dist = Math.sqrt(nodes[0].x! ** 2 + nodes[0].y! ** 2 + nodes[0].z! ** 2)
    // Near spreadRadius 200 ± jitter
    expect(dist).toBeGreaterThan(150)
    expect(dist).toBeLessThan(250)
  })
})

// ─── buildGraph3DData ───────────────────────────────────────────────

describe('buildGraph3DData', () => {
  it('returns empty arrays for empty graph data', () => {
    const data = makeGraphData({ nodes: [], edges: [] })
    const result = buildGraph3DData(data, defaultOptions())
    expect(result.nodes).toEqual([])
    expect(result.links).toEqual([])
  })

  it('maps node fields correctly', () => {
    const data = makeGraphData({
      nodes: [makeNode({ id: 'n1', path: 'docs/api.md', label: 'API Reference', cluster_id: 2, chunk_index: null })],
      edges: [],
    })
    const result = buildGraph3DData(data, defaultOptions())
    expect(result.nodes).toHaveLength(1)

    const node = result.nodes[0]
    expect(node.id).toBe('n1')
    expect(node.path).toBe('docs/api.md')
    expect(node.label).toBe('API Reference')
    expect(node.cluster_id).toBe(2)
    expect(node.chunk_index).toBeNull()
    expect(node.val).toBeGreaterThanOrEqual(1)
    expect(node.color).toBeDefined()
  })

  it('maps edge fields correctly', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
      ],
      edges: [makeEdge({
        source: 'a', target: 'b',
        relationship_type: 'references', strength: 0.8,
        context_text: 'See also', edge_cluster_id: 1,
      })],
    })
    const result = buildGraph3DData(data, defaultOptions())
    expect(result.links).toHaveLength(1)

    const link = result.links[0]
    expect(link.source).toBe('a')
    expect(link.target).toBe('b')
    expect(link.relationship_type).toBe('references')
    expect(link.strength).toBe(0.8)
    expect(link.context_text).toBe('See also')
    expect(link.edge_cluster_id).toBe(1)
    expect(link.color).toBeDefined()
    expect(link.width).toBeGreaterThan(0)
  })

  it('filters edges by edge cluster filter', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
        makeNode({ id: 'c', path: 'c.md' }),
      ],
      edges: [
        makeEdge({ source: 'a', target: 'b', edge_cluster_id: 0 }),
        makeEdge({ source: 'b', target: 'c', edge_cluster_id: 1 }),
        makeEdge({ source: 'a', target: 'c', edge_cluster_id: 2 }),
      ],
    })

    // Only show edge cluster 0 and 2
    const result = buildGraph3DData(data, defaultOptions({ edgeFilter: new Set([0, 2]) }))
    expect(result.links).toHaveLength(2)
    expect(result.links.map((l) => l.edge_cluster_id)).toEqual([0, 2])
  })

  it('includes all edges when filter is null', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
      ],
      edges: [
        makeEdge({ source: 'a', target: 'b', edge_cluster_id: 0 }),
        makeEdge({ source: 'b', target: 'a', edge_cluster_id: 1 }),
      ],
    })
    const result = buildGraph3DData(data, defaultOptions({ edgeFilter: null }))
    expect(result.links).toHaveLength(2)
  })

  it('uses degree-based sizing in document mode', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'hub', path: 'hub.md' }),
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
        makeNode({ id: 'leaf', path: 'leaf.md' }),
      ],
      edges: [
        makeEdge({ source: 'hub', target: 'a' }),
        makeEdge({ source: 'hub', target: 'b' }),
        makeEdge({ source: 'hub', target: 'leaf' }),
      ],
    })
    const result = buildGraph3DData(data, defaultOptions({ level: 'document' }))

    const hubNode = result.nodes.find((n) => n.id === 'hub')!
    const leafNode = result.nodes.find((n) => n.id === 'leaf')!

    // Hub has degree 3 → val = 1 + 3*2 = 7
    expect(hubNode.val).toBe(7)
    // Leaf has degree 1 → val = 1 + 1*2 = 3
    expect(leafNode.val).toBe(3)
  })

  it('uses size-based sizing in chunk mode', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'big', path: 'big.md', size: 1000 }),
        makeNode({ id: 'small', path: 'small.md', size: 100 }),
        makeNode({ id: 'zero', path: 'zero.md', size: 0 }),
      ],
      edges: [],
    })
    const result = buildGraph3DData(data, defaultOptions({ level: 'chunk' }))

    const bigNode = result.nodes.find((n) => n.id === 'big')!
    const smallNode = result.nodes.find((n) => n.id === 'small')!
    const zeroNode = result.nodes.find((n) => n.id === 'zero')!

    // big: 1 + (1000/1000)*8 = 9
    expect(bigNode.val).toBeCloseTo(9)
    // small: 1 + (100/1000)*8 = 1.8
    expect(smallNode.val).toBeCloseTo(1.8)
    // zero: 1 + (0/1000)*8 = 1
    expect(zeroNode.val).toBeCloseTo(1)
  })

  it('applies cluster coloring in cluster mode', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'n0', path: 'a.md', cluster_id: 0 }),
        makeNode({ id: 'n1', path: 'b.md', cluster_id: 1 }),
        makeNode({ id: 'nu', path: 'c.md', cluster_id: null }),
      ],
      edges: [],
    })
    const result = buildGraph3DData(data, defaultOptions({ coloringMode: 'cluster' }))

    // Clustered nodes get distinct cluster colors
    const n0 = result.nodes.find((n) => n.id === 'n0')!
    const n1 = result.nodes.find((n) => n.id === 'n1')!
    const nu = result.nodes.find((n) => n.id === 'nu')!

    expect(n0.color).not.toBe(n1.color) // Different clusters → different colors
    expect(nu.color).toBe('#E4E4E7') // Unclustered in document mode → default color
  })

  it('applies folder coloring in folder mode', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'n1', path: 'docs/readme.md' }),
        makeNode({ id: 'n2', path: 'docs/guide.md' }),
        makeNode({ id: 'n3', path: 'src/main.md' }),
      ],
      edges: [],
    })
    const result = buildGraph3DData(data, defaultOptions({ coloringMode: 'folder' }))

    const n1 = result.nodes.find((n) => n.id === 'n1')!
    const n2 = result.nodes.find((n) => n.id === 'n2')!
    const n3 = result.nodes.find((n) => n.id === 'n3')!

    // Same folder → same color
    expect(n1.color).toBe(n2.color)
    // Different folder → different color
    expect(n1.color).not.toBe(n3.color)
  })

  it('handles edges with null optional fields', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
      ],
      edges: [makeEdge({
        source: 'a', target: 'b',
        relationship_type: undefined, strength: undefined,
        context_text: undefined, edge_cluster_id: undefined,
      })],
    })
    const result = buildGraph3DData(data, defaultOptions())
    expect(result.links).toHaveLength(1)

    const link = result.links[0]
    expect(link.relationship_type).toBeNull()
    expect(link.strength).toBeNull()
    expect(link.context_text).toBeNull()
    expect(link.edge_cluster_id).toBeNull()
  })

  it('computes edge width from strength', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
      ],
      edges: [
        makeEdge({ source: 'a', target: 'b', strength: 0 }),
        makeEdge({ source: 'b', target: 'a', strength: 1 }),
      ],
    })
    const result = buildGraph3DData(data, defaultOptions())

    const weakLink = result.links.find((l) => l.source === 'a')!
    const strongLink = result.links.find((l) => l.source === 'b')!

    expect(weakLink.width).toBeCloseTo(0.5)
    expect(strongLink.width).toBeCloseTo(3.0)
  })

  it('preserves all nodes even when no edges reference them', () => {
    const data = makeGraphData({
      nodes: [
        makeNode({ id: 'orphan', path: 'orphan.md' }),
        makeNode({ id: 'a', path: 'a.md' }),
        makeNode({ id: 'b', path: 'b.md' }),
      ],
      edges: [makeEdge({ source: 'a', target: 'b' })],
    })
    const result = buildGraph3DData(data, defaultOptions())
    expect(result.nodes).toHaveLength(3)
    expect(result.nodes.find((n) => n.id === 'orphan')).toBeDefined()
  })

  it('handles node with null size in chunk mode', () => {
    const data = makeGraphData({
      nodes: [makeNode({ id: 'n1', path: 'a.md', size: undefined })],
      edges: [],
    })
    const result = buildGraph3DData(data, defaultOptions({ level: 'chunk' }))
    expect(result.nodes[0].val).toBeGreaterThanOrEqual(1)
    expect(result.nodes[0].size).toBeNull()
  })
})
