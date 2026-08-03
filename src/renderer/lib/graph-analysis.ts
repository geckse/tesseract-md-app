import type { GraphAnalysis, GraphCluster, GraphData, GraphNode } from '../types/cli'

export type GraphAnalysisNoticeTone = 'info' | 'warning' | 'error'

export interface GraphAnalysisNotice {
  message: string
  tone: GraphAnalysisNoticeTone
  canReingest: boolean
}

export interface GraphAnalysisDisplayContext {
  contextName: string
  shardName: string | null
}

interface ShardDisplayIdentity {
  id: string
  name: string
}

type MembershipKind = 'cluster' | 'topic'
type AnalysisLegendMode = 'cluster' | 'custom-cluster' | 'folder'

function membershipIds(node: GraphNode, kind: MembershipKind): number[] {
  if (kind === 'cluster') return node.cluster_id == null ? [] : [node.cluster_id]

  const ids = new Set(node.custom_cluster_ids ?? [])
  if (node.custom_cluster_id != null) ids.add(node.custom_cluster_id)
  return [...ids]
}

/**
 * Recount response metadata from visible memberships.
 *
 * A chunk graph can contain several nodes for one document, so counts are
 * unique root-relative document paths in both levels. Metadata with no local
 * members is omitted defensively even when an older CLI returns global rows.
 */
export function localGraphClusters(
  data: Pick<GraphData, 'nodes'>,
  clusters: readonly GraphCluster[],
  kind: MembershipKind
): GraphCluster[] {
  const pathsById = new Map<number, Set<string>>()
  for (const node of data.nodes) {
    for (const id of membershipIds(node, kind)) {
      let paths = pathsById.get(id)
      if (!paths) {
        paths = new Set()
        pathsById.set(id, paths)
      }
      paths.add(node.path)
    }
  }

  return clusters.flatMap((cluster) => {
    const count = pathsById.get(cluster.id)?.size ?? 0
    return count > 0 ? [{ ...cluster, member_count: count }] : []
  })
}

/** Unique visible documents that have no automatic Topic membership. */
export function localUnassignedTopicCount(nodes: readonly GraphNode[]): number {
  const assignedByPath = new Map<string, boolean>()
  for (const node of nodes) {
    const assigned = membershipIds(node, 'topic').length > 0
    assignedByPath.set(node.path, (assignedByPath.get(node.path) ?? false) || assigned)
  }
  let count = 0
  for (const assigned of assignedByPath.values()) {
    if (!assigned) count++
  }
  return count
}

/** Stable heading copy for collection-wide and Shard-local graph legends. */
export function graphAnalysisLegendHeading(mode: AnalysisLegendMode, shardName?: string): string {
  if (mode === 'folder') return 'Folders'
  const subject = mode === 'cluster' ? 'Clusters' : 'Topics'
  return shardName ? `${shardName} Shard ${subject}` : subject
}

/**
 * Resolve graph copy from the response that produced the visible graph.
 *
 * The active selection is only allowed to contribute the friendly display
 * name when its immutable id matches the response. This prevents an old
 * Collection payload (or a payload for another Shard) from being relabelled
 * as the newly selected Shard while a context load is changing.
 */
export function graphAnalysisDisplayContext(
  analysis: GraphAnalysis | undefined,
  activeShard: ShardDisplayIdentity | null
): GraphAnalysisDisplayContext {
  if (analysis?.context !== 'shard') {
    return { contextName: 'Collection', shardName: null }
  }

  const shardName =
    activeShard && activeShard.id === analysis.shard_id
      ? activeShard.name
      : (analysis.shard_id ?? null)
  return {
    contextName: shardName ? `${shardName} Shard` : 'Shard',
    shardName
  }
}

/**
 * Verify that a Shard request produced analysis for that exact immutable id.
 *
 * Compact graph metadata is additive for Collection requests, but it is
 * mandatory when `--shard` was requested: without it the renderer cannot
 * safely distinguish a local analysis payload from a legacy Collection one.
 */
export function assertShardGraphAnalysis(data: GraphData, expectedShardId: string): void {
  const analysis = data.analysis
  if (!analysis) {
    throw new Error(`Shard graph response for "${expectedShardId}" is missing analysis metadata.`)
  }
  if (analysis.context !== 'shard') {
    throw new Error(`Shard graph response for "${expectedShardId}" returned Collection analysis.`)
  }
  if (analysis.shard_id !== expectedShardId) {
    throw new Error(
      `Shard graph response mismatch: requested "${expectedShardId}", received "${
        analysis.shard_id ?? 'unknown'
      }".`
    )
  }
}

/**
 * Turn additive analysis status into one compact, actionable graph notice.
 * Ready analysis and expected empty states stay quiet.
 */
export function graphAnalysisNotice(
  analysis: GraphAnalysis | undefined,
  contextName: string
): GraphAnalysisNotice | null {
  if (!analysis) return null

  const messages: string[] = []
  let tone: GraphAnalysisNoticeTone = 'info'
  const canReingest = analysis.topics === 'needs_ingest'

  if (analysis.clusters === 'disabled') {
    messages.push(`Automatic clustering is disabled for ${contextName}.`)
  } else if (analysis.clusters === 'error') {
    messages.push(`Automatic clustering failed for ${contextName}.`)
    tone = 'error'
  }

  if (analysis.topics === 'needs_ingest') {
    messages.push(`${contextName} Topics need re-ingest.`)
    if (tone !== 'error') tone = 'warning'
  } else if (analysis.topics === 'error') {
    messages.push(`Topic analysis failed for ${contextName}.`)
    tone = 'error'
  }

  const diagnostic = analysis.message?.trim()
  if (diagnostic) messages.push(diagnostic)
  if (messages.length === 0) return null

  return { message: messages.join(' '), tone, canReingest }
}
