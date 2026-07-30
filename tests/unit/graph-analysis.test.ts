import { describe, expect, it } from 'vitest'

import {
  assertShardGraphAnalysis,
  graphAnalysisDisplayContext,
  graphAnalysisLegendHeading,
  graphAnalysisNotice,
  localGraphClusters,
  localUnassignedTopicCount
} from '../../src/renderer/lib/graph-analysis'
import type {
  GraphAnalysis,
  GraphCluster,
  GraphData,
  GraphNode
} from '../../src/renderer/types/cli'

const clusters: GraphCluster[] = [
  { id: 10, label: 'Local', keywords: [], member_count: 99 },
  { id: 20, label: 'Outside', keywords: [], member_count: 50 }
]

describe('Shard-local graph analysis presentation', () => {
  it('uses the locked local legend headings without changing folder copy', () => {
    expect(graphAnalysisLegendHeading('cluster', 'Research')).toBe('Research Shard Clusters')
    expect(graphAnalysisLegendHeading('custom-cluster', 'Research')).toBe('Research Shard Topics')
    expect(graphAnalysisLegendHeading('folder', 'Research')).toBe('Folders')
    expect(graphAnalysisLegendHeading('cluster')).toBe('Clusters')
  })

  it('derives legend provenance from the response rather than the active selection', () => {
    const activeShard = { id: 'research', name: 'Research' }
    const collectionAnalysis: GraphAnalysis = {
      context: 'collection',
      clusters: 'ready',
      topics: 'none'
    }
    const researchAnalysis: GraphAnalysis = {
      context: 'shard',
      shard_id: 'research',
      shard_path: 'work/research',
      clusters: 'ready',
      topics: 'none'
    }
    const archiveAnalysis: GraphAnalysis = {
      context: 'shard',
      shard_id: 'archive',
      shard_path: 'work/archive',
      clusters: 'ready',
      topics: 'none'
    }

    expect(graphAnalysisDisplayContext(collectionAnalysis, activeShard)).toEqual({
      contextName: 'Collection',
      shardName: null
    })
    expect(graphAnalysisDisplayContext(researchAnalysis, activeShard)).toEqual({
      contextName: 'Research Shard',
      shardName: 'Research'
    })
    expect(graphAnalysisDisplayContext(archiveAnalysis, activeShard)).toEqual({
      contextName: 'archive Shard',
      shardName: 'archive'
    })
  })

  it('requires exact response identity for a Shard graph', () => {
    const graph = {
      nodes: [],
      edges: [],
      clusters: [],
      level: 'document'
    } as GraphData

    expect(() => assertShardGraphAnalysis(graph, 'research')).toThrow('missing analysis metadata')
    expect(() =>
      assertShardGraphAnalysis(
        {
          ...graph,
          analysis: {
            context: 'collection',
            clusters: 'ready',
            topics: 'none'
          }
        },
        'research'
      )
    ).toThrow('returned Collection analysis')
    expect(() =>
      assertShardGraphAnalysis(
        {
          ...graph,
          analysis: {
            context: 'shard',
            shard_id: 'archive',
            clusters: 'ready',
            topics: 'none'
          }
        },
        'research'
      )
    ).toThrow('response mismatch')
  })

  it('recounts unique visible document memberships and omits outside-only metadata', () => {
    const nodes: GraphNode[] = [
      {
        id: 'docs/a.md#0',
        path: 'docs/a.md',
        label: null,
        cluster_id: 10,
        custom_cluster_id: 10,
        custom_cluster_ids: [10, 20],
        chunk_index: 0
      },
      {
        id: 'docs/a.md#1',
        path: 'docs/a.md',
        label: null,
        cluster_id: 10,
        custom_cluster_id: 10,
        custom_cluster_ids: [10, 20],
        chunk_index: 1
      },
      {
        id: 'docs/b.md#0',
        path: 'docs/b.md',
        label: null,
        cluster_id: 10,
        custom_cluster_id: null,
        custom_cluster_ids: [],
        chunk_index: 0
      }
    ]

    expect(localGraphClusters({ nodes }, clusters, 'cluster')).toEqual([
      { ...clusters[0], member_count: 2 }
    ])
    expect(localGraphClusters({ nodes }, clusters, 'topic')).toEqual([
      { ...clusters[0], member_count: 1 },
      { ...clusters[1], member_count: 1 }
    ])
    expect(localUnassignedTopicCount(nodes)).toBe(1)
  })

  it('distinguishes stale Shard Topics from an unconfigured Shard', () => {
    expect(
      graphAnalysisNotice(
        {
          context: 'shard',
          shard_id: 'research',
          shard_path: 'work/research',
          clusters: 'ready',
          topics: 'needs_ingest'
        },
        'Research Shard'
      )
    ).toEqual({
      message: 'Research Shard Topics need re-ingest.',
      tone: 'warning',
      canReingest: true,
      canManageTopics: false
    })

    expect(
      graphAnalysisNotice(
        {
          context: 'shard',
          shard_id: 'research',
          shard_path: 'work/research',
          clusters: 'ready',
          topics: 'none'
        },
        'Research Shard'
      )
    ).toEqual({
      message: 'No Topics configured for this Shard.',
      tone: 'info',
      canReingest: false,
      canManageTopics: true
    })
  })

  it('keeps collection no-topic metadata quiet and surfaces independent failures', () => {
    expect(
      graphAnalysisNotice(
        { context: 'collection', clusters: 'ready', topics: 'none' },
        'Collection'
      )
    ).toBeNull()

    expect(
      graphAnalysisNotice(
        {
          context: 'shard',
          clusters: 'too_small',
          topics: 'error',
          message: 'Topic centroid unavailable.'
        },
        'Research Shard'
      )
    ).toMatchObject({
      message:
        'Research Shard is too small for automatic clustering. Topic analysis failed for Research Shard. Topic centroid unavailable.',
      tone: 'error'
    })
  })
})
