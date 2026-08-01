import type { GraphData, GraphLevel } from '../types/cli'
import type { Graph3DData, Graph3DNode } from './graph-3d-bridge'
import type {
  GraphLayoutLinkInput,
  GraphLayoutNodeInput,
  GraphLayoutSettings
} from './graph-layout-protocol'
import { graphGroupIdForMode, type GraphGroupingMode } from './graph-grouping'

export interface GraphLayoutInputBundle {
  nodes: GraphLayoutNodeInput[]
  links: GraphLayoutLinkInput[]
  settings: Partial<GraphLayoutSettings>
}

/** Renderer-owned position that must win over an in-flight worker snapshot. */
export interface GraphLayoutPositionOverride {
  nodeId: string
  x: number
  y: number
  z: number
}

function hashText(hash: number, value: string): number {
  let next = hash
  for (let index = 0; index < value.length; index++) {
    next ^= value.charCodeAt(index)
    next = Math.imul(next, 16777619)
  }
  return next >>> 0
}

function topologyItemHash(...parts: string[]): number {
  let hash = 2166136261
  for (const part of parts) {
    hash = hashText(hash, part)
    hash = hashText(hash, '\0')
  }
  return hash >>> 0
}

/**
 * Stable, order-independent layout revision. Only topology and the grouping
 * represented by the active view mode participate; visual metadata is ignored.
 */
export function graphTopologyRevision(
  data: GraphData,
  groupingMode: GraphGroupingMode = 'cluster',
  visualData?: Graph3DData
): string {
  let nodeSum = 0
  let nodeMix = 0
  const nodes = visualData?.nodes ?? data.nodes
  for (const node of nodes) {
    const hash = topologyItemHash(
      node.id,
      graphGroupIdForMode(node, groupingMode) ?? '',
      'kind' in node ? (node.kind ?? 'content') : 'content'
    )
    nodeSum = (nodeSum + hash) >>> 0
    nodeMix = (nodeMix ^ Math.imul(hash ^ 0x9e3779b9, 0x85ebca6b)) >>> 0
  }
  let edgeSum = 0
  let edgeMix = 0
  const edges = visualData?.links ?? data.edges
  for (const edge of edges) {
    const hash = topologyItemHash(
      String(edge.source),
      String(edge.target),
      'kind' in edge ? (edge.kind ?? 'content') : 'content'
    )
    edgeSum = (edgeSum + hash) >>> 0
    edgeMix = (edgeMix ^ Math.imul(hash ^ 0xc2b2ae35, 0x27d4eb2f)) >>> 0
  }
  const digest = [nodeSum, nodeMix, edgeSum, edgeMix]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')
  return `${data.level}:${groupingMode}:${nodes.length}:${edges.length}:${digest}`
}

export function graphLayoutSettings(level: GraphLevel): Partial<GraphLayoutSettings> {
  const documentLevel = level === 'document'
  return {
    alpha: 1,
    alphaMin: 0.001,
    alphaDecay: 0.02,
    velocityDecay: 0.4,
    chargeStrength: -100,
    chargeDistanceMin: 1,
    chargeDistanceMax: 400,
    chargeTheta: 0.9,
    linkDistance: documentLevel ? 80 : 50,
    linkStrength: documentLevel ? 0.2 : 0.15,
    collisionPadding: documentLevel ? 3 : 2,
    // Match the pre-worker force contract: repulsion and cluster anchors
    // provide separation; an added collision/center force contracts and
    // reshapes the established graph presentation.
    collisionStrength: 0,
    centerStrength: 0,
    clusterStrength: documentLevel ? 0.15 : 0.25,
    snapshotIntervalMs: 50,
    ticksPerSlice: documentLevel ? 3 : 2,
    sliceBudgetMs: 8
  }
}

/**
 * Keep semantic groups visually distinct before the force solver starts.
 * Cluster and Topic views need more room than ungrouped/folder layouts because
 * their enclosure hulls otherwise merge into one dense cloud.
 */
export function graphLayoutSeedRadius(level: GraphLevel, groupingMode: GraphGroupingMode): number {
  if (groupingMode === 'cluster' || groupingMode === 'custom-cluster') {
    return level === 'document' ? 260 : 380
  }
  return level === 'document' ? 200 : 300
}

/** Reduce renderer upload pressure as topology grows while retaining live layout updates. */
export function graphLayoutSnapshotIntervalMs(nodeCount: number, linkCount: number): number {
  const topologyItems = Math.max(0, nodeCount) + Math.max(0, linkCount)
  if (topologyItems <= 10_000) return 50
  return Math.min(150, 50 + Math.ceil((topologyItems - 10_000) / 15_000) * 15)
}

/** Convert visual graph data into the worker's compact force input. */
export function buildGraphLayoutInputs(
  data: Graph3DData,
  degreeMap: ReadonlyMap<string, number>,
  level: GraphLevel,
  groupingMode: GraphGroupingMode = 'cluster'
): GraphLayoutInputBundle {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]))
  const groupsById = new Map(
    data.nodes.map((node) => [node.id, graphGroupIdForMode(node, groupingMode)])
  )
  const documentLevel = level === 'document'
  const nodes = data.nodes.map<GraphLayoutNodeInput>((node) => {
    const degree = degreeMap.get(node.id) ?? 0
    const folderNode = node.kind === 'folder'
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      radius: Math.max(0.8, Math.cbrt(Math.max(node.val, 0.001)) * 2),
      // Preserve the original degree-sensitive hub repulsion. This is what
      // creates the recognizable radial spacing in the established graph view.
      charge: folderNode
        ? -180 - Math.min(240, (node.folder_document_count ?? 0) * 3)
        : documentLevel
          ? -100 - degree * 10
          : -100,
      clusterId: groupsById.get(node.id) ?? null
    }
  })
  const links = data.links.map<GraphLayoutLinkInput>((link) => {
    const source = nodesById.get(link.source)
    const target = nodesById.get(link.target)
    const sourceGroup = source ? groupsById.get(source.id) : null
    const targetGroup = target ? groupsById.get(target.id) : null
    const sameCluster = sourceGroup != null && targetGroup != null && sourceGroup === targetGroup
    const crossCluster =
      (groupingMode === 'cluster' || groupingMode === 'custom-cluster') &&
      sourceGroup != null &&
      targetGroup != null &&
      sourceGroup !== targetGroup
    if (link.kind === 'hierarchy') {
      const folderToFolder = source?.kind === 'folder' && target?.kind === 'folder'
      return {
        source: link.source,
        target: link.target,
        distance: folderToFolder ? 82 : 44,
        strength: folderToFolder ? 0.82 : 0.68
      }
    }
    return {
      source: link.source,
      target: link.target,
      distance:
        groupingMode === 'folder'
          ? documentLevel
            ? sameCluster
              ? 90
              : 180
            : sameCluster
              ? 70
              : 190
          : documentLevel
            ? sameCluster
              ? 30
              : crossCluster
                ? 180
                : 120
            : sameCluster
              ? 20
              : crossCluster
                ? 220
                : 150,
      strength:
        groupingMode === 'folder'
          ? documentLevel
            ? 0.08
            : 0.06
          : crossCluster
            ? documentLevel
              ? 0.06
              : 0.04
            : documentLevel
              ? 0.2
              : 0.15
    }
  })
  const settings = graphLayoutSettings(level)
  if (groupingMode === 'folder') settings.clusterStrength = documentLevel ? 0.06 : 0.08
  settings.snapshotIntervalMs = graphLayoutSnapshotIntervalMs(nodes.length, links.length)
  return { nodes, links, settings }
}

export function packGraphNodePositions(nodes: readonly Graph3DNode[]): Float32Array {
  const positions = new Float32Array(nodes.length * 3)
  nodes.forEach((node, index) => {
    positions[index * 3] = node.x ?? Number.NaN
    positions[index * 3 + 1] = node.y ?? Number.NaN
    positions[index * 3 + 2] = node.z ?? Number.NaN
  })
  return positions
}

/** Apply a worker snapshot to stable visual node objects without allocation. */
export function applyGraphLayoutPositions(
  nodesById: ReadonlyMap<string, Graph3DNode>,
  nodeIds: readonly string[],
  positions: Float32Array,
  override?: GraphLayoutPositionOverride | null
): number {
  if (positions.length !== nodeIds.length * 3) return 0
  let applied = 0
  nodeIds.forEach((nodeId, index) => {
    const node = nodesById.get(nodeId)
    if (!node) return
    if (override?.nodeId === nodeId) {
      node.x = override.x
      node.y = override.y
      node.z = override.z
      applied++
      return
    }
    const x = positions[index * 3]
    const y = positions[index * 3 + 1]
    const z = positions[index * 3 + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    node.x = x
    node.y = y
    node.z = z
    applied++
  })
  return applied
}

/** Fast path when worker and visual node arrays share the same stable order. */
export function applyGraphLayoutPositionsInOrder(
  nodes: readonly Graph3DNode[],
  positions: Float32Array,
  override?: GraphLayoutPositionOverride | null
): number {
  if (positions.length !== nodes.length * 3) return 0
  for (let index = 0; index < nodes.length; index++) {
    const offset = index * 3
    const x = positions[offset]
    const y = positions[offset + 1]
    const z = positions[offset + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0
    const node = nodes[index]
    if (override?.nodeId === node.id) {
      node.x = override.x
      node.y = override.y
      node.z = override.z
      continue
    }
    node.x = x
    node.y = y
    node.z = z
  }
  return nodes.length
}

/** Quadratic-out progress for a visible transition between settled layouts. */
export function graphLayoutTransitionProgress(elapsedMs: number, durationMs: number): number {
  const linear = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, Math.max(0, elapsedMs) / durationMs))
  return linear * (2 - linear)
}

/** Interpolate stable visual nodes between two packed position snapshots. */
export function applyGraphLayoutTransitionInOrder(
  nodes: readonly Graph3DNode[],
  from: Float32Array,
  to: Float32Array,
  progress: number
): number {
  if (from.length !== nodes.length * 3 || to.length !== nodes.length * 3) return 0
  const amount = Math.min(1, Math.max(0, progress))
  for (let index = 0; index < nodes.length; index++) {
    const offset = index * 3
    const fromX = from[offset]
    const fromY = from[offset + 1]
    const fromZ = from[offset + 2]
    const toX = to[offset]
    const toY = to[offset + 1]
    const toZ = to[offset + 2]
    if (
      !Number.isFinite(fromX) ||
      !Number.isFinite(fromY) ||
      !Number.isFinite(fromZ) ||
      !Number.isFinite(toX) ||
      !Number.isFinite(toY) ||
      !Number.isFinite(toZ)
    ) {
      return 0
    }
    const node = nodes[index]
    node.x = fromX + (toX - fromX) * amount
    node.y = fromY + (toY - fromY) * amount
    node.z = fromZ + (toZ - fromZ) * amount
  }
  return nodes.length
}
