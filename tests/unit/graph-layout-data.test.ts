import { describe, expect, it } from 'vitest'

import {
  applyGraphLayoutPositions,
  applyGraphLayoutPositionsInOrder,
  buildGraphLayoutInputs,
  graphLayoutSnapshotIntervalMs,
  graphTopologyRevision,
  packGraphNodePositions
} from '@renderer/lib/graph-layout-data'
import type { GraphData } from '@renderer/types/cli'
import type { Graph3DData } from '@renderer/lib/graph-3d-bridge'

const graphData: GraphData = {
  level: 'document',
  nodes: [
    {
      id: 'a',
      path: 'a.md',
      label: null,
      cluster_id: 1,
      custom_cluster_id: null,
      chunk_index: null
    },
    {
      id: 'b',
      path: 'b.md',
      label: null,
      cluster_id: 1,
      custom_cluster_id: null,
      chunk_index: null
    }
  ],
  edges: [{ source: 'a', target: 'b', weight: null, context_text: 'one', field: null }],
  clusters: []
}

const graph3DData: Graph3DData = {
  nodes: graphData.nodes.map((node, index) => ({
    ...node,
    custom_cluster_ids: [],
    custom_cluster_scores: [],
    size: null,
    val: index === 0 ? 8 : 1,
    color: '#ffffff',
    x: index,
    y: index + 1,
    z: index + 2
  })),
  links: [
    {
      source: 'a',
      target: 'b',
      relationship_type: null,
      strength: 0.8,
      context_text: 'one',
      edge_cluster_id: null,
      field: null,
      color: '#ffffff',
      width: 1
    }
  ]
}

describe('graph layout data bridge', () => {
  it('hashes topology but ignores context-only changes', () => {
    const first = graphTopologyRevision(graphData)
    const contextChanged = structuredClone(graphData)
    contextChanged.edges[0].context_text = 'different'
    expect(graphTopologyRevision(contextChanged)).toBe(first)

    const topologyChanged = structuredClone(graphData)
    topologyChanged.edges[0].target = 'a'
    expect(graphTopologyRevision(topologyChanged)).not.toBe(first)
  })

  it('makes revisions mode- and active-membership-aware', () => {
    const data = structuredClone(graphData)
    data.nodes[0].path = 'docs/a.md'
    data.nodes[0].custom_cluster_id = 4
    data.nodes[0].custom_cluster_ids = [4, 9]

    const clusterRevision = graphTopologyRevision(data, 'cluster')
    const topicRevision = graphTopologyRevision(data, 'custom-cluster')
    const folderRevision = graphTopologyRevision(data, 'folder')
    const noneRevision = graphTopologyRevision(data, 'none')

    expect(new Set([clusterRevision, topicRevision, folderRevision, noneRevision]).size).toBe(4)

    const secondaryTopicChanged = structuredClone(data)
    secondaryTopicChanged.nodes[0].custom_cluster_ids = [4, 12]
    expect(graphTopologyRevision(secondaryTopicChanged, 'custom-cluster')).toBe(topicRevision)

    const primaryTopicChanged = structuredClone(data)
    primaryTopicChanged.nodes[0].custom_cluster_id = 9
    expect(graphTopologyRevision(primaryTopicChanged, 'custom-cluster')).not.toBe(topicRevision)
  })

  it('keeps settled-position revisions stable when payload ordering changes', () => {
    const reordered = structuredClone(graphData)
    reordered.nodes.reverse()
    reordered.edges = [
      { source: 'b', target: 'a', weight: null, context_text: null, field: null },
      ...reordered.edges
    ]
    const first = graphTopologyRevision(reordered)
    reordered.edges.reverse()
    expect(graphTopologyRevision(reordered)).toBe(first)
  })

  it('preserves the established hub repulsion and cluster-aware force contract', () => {
    const inputs = buildGraphLayoutInputs(graph3DData, new Map([['a', 945]]), 'document')
    expect(inputs.nodes[0].charge).toBe(-9550)
    expect(inputs.links[0].distance).toBe(30)
    expect(inputs.settings).toMatchObject({
      alphaMin: 0.001,
      alphaDecay: 0.02,
      chargeTheta: 0.9,
      collisionStrength: 0,
      centerStrength: 0
    })
  })

  it('builds force groups and link distances from the selected view mode', () => {
    const data = structuredClone(graph3DData)
    data.nodes[0].path = 'docs/a.md'
    data.nodes[1].path = 'docs/b.md'
    data.nodes[0].custom_cluster_id = 7
    data.nodes[0].custom_cluster_ids = [7, 8]
    data.nodes[1].custom_cluster_id = 7
    data.nodes[1].custom_cluster_ids = [7]

    const topics = buildGraphLayoutInputs(data, new Map(), 'document', 'custom-cluster')
    expect(topics.nodes.map((node) => node.clusterId)).toEqual(['topic:7', 'topic:7'])
    expect(topics.links[0].distance).toBe(30)

    data.nodes[1].custom_cluster_id = 8
    const splitTopics = buildGraphLayoutInputs(data, new Map(), 'document', 'custom-cluster')
    expect(splitTopics.nodes.map((node) => node.clusterId)).toEqual(['topic:7', 'topic:8'])
    expect(splitTopics.links[0].distance).toBe(120)

    const folders = buildGraphLayoutInputs(data, new Map(), 'chunk', 'folder')
    expect(folders.nodes.map((node) => node.clusterId)).toEqual(['folder:docs', 'folder:docs'])
    expect(folders.links[0].distance).toBe(20)

    const ungrouped = buildGraphLayoutInputs(data, new Map(), 'document', 'none')
    expect(ungrouped.nodes.map((node) => node.clusterId)).toEqual([null, null])
    expect(ungrouped.links[0].distance).toBe(120)
  })

  it('packs and applies transferable position triples by stable node id', () => {
    const packed = packGraphNodePositions(graph3DData.nodes)
    expect([...packed]).toEqual([0, 1, 2, 1, 2, 3])

    expect(
      applyGraphLayoutPositions(
        new Map(graph3DData.nodes.map((node) => [node.id, node])),
        ['b', 'a'],
        new Float32Array([9, 8, 7, 6, 5, 4])
      )
    ).toBe(2)
    expect(graph3DData.nodes[0]).toMatchObject({ x: 6, y: 5, z: 4 })
    expect(graph3DData.nodes[1]).toMatchObject({ x: 9, y: 8, z: 7 })
  })

  it('applies aligned worker positions without id lookups and adapts snapshot cadence', () => {
    expect(
      applyGraphLayoutPositionsInOrder(graph3DData.nodes, new Float32Array([9, 8, 7, 6, 5, 4]))
    ).toBe(2)
    expect(graph3DData.nodes[0]).toMatchObject({ x: 9, y: 8, z: 7 })
    expect(graphLayoutSnapshotIntervalMs(2_000, 4_000)).toBe(50)
    expect(graphLayoutSnapshotIntervalMs(9_000, 30_000)).toBe(80)
    expect(graphLayoutSnapshotIntervalMs(100_000, 100_000)).toBe(150)
  })

  it('updates force-driven neighbors without overwriting a renderer-owned drag position', () => {
    const nodes = structuredClone(graph3DData.nodes)
    const nodesById = new Map(nodes.map((node) => [node.id, node]))

    expect(
      applyGraphLayoutPositions(nodesById, ['b', 'a'], new Float32Array([20, 21, 22, 10, 11, 12]), {
        nodeId: 'a',
        x: 100,
        y: 101,
        z: 102
      })
    ).toBe(2)
    expect(nodesById.get('a')).toMatchObject({ x: 100, y: 101, z: 102 })
    expect(nodesById.get('b')).toMatchObject({ x: 20, y: 21, z: 22 })

    expect(
      applyGraphLayoutPositionsInOrder(nodes, new Float32Array([30, 31, 32, 40, 41, 42]), {
        nodeId: 'b',
        x: 200,
        y: 201,
        z: 202
      })
    ).toBe(2)
    expect(nodesById.get('a')).toMatchObject({ x: 30, y: 31, z: 32 })
    expect(nodesById.get('b')).toMatchObject({ x: 200, y: 201, z: 202 })
  })
})
