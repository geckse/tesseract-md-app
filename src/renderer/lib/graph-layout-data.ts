import type { GraphData, GraphLevel } from '../types/cli'
import type { Graph3DData, Graph3DNode } from './graph-3d-bridge'
import type {
  GraphLayoutLinkInput,
  GraphLayoutNodeInput,
  GraphLayoutSettings
} from './graph-layout-protocol'

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

/** Stable, order-independent topology revision; metadata/context changes are ignored. */
export function graphTopologyRevision(data: GraphData): string {
  let nodeSum = 0
  let nodeMix = 0
  for (const node of data.nodes) {
    const hash = topologyItemHash(node.id, String(node.cluster_id ?? ''))
    nodeSum = (nodeSum + hash) >>> 0
    nodeMix = (nodeMix ^ Math.imul(hash ^ 0x9e3779b9, 0x85ebca6b)) >>> 0
  }
  let edgeSum = 0
  let edgeMix = 0
  for (const edge of data.edges) {
    const hash = topologyItemHash(edge.source, edge.target)
    edgeSum = (edgeSum + hash) >>> 0
    edgeMix = (edgeMix ^ Math.imul(hash ^ 0xc2b2ae35, 0x27d4eb2f)) >>> 0
  }
  const digest = [nodeSum, nodeMix, edgeSum, edgeMix]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')
  return `${data.level}:${data.nodes.length}:${data.edges.length}:${digest}`
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
  level: GraphLevel
): GraphLayoutInputBundle {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]))
  const documentLevel = level === 'document'
  const nodes = data.nodes.map<GraphLayoutNodeInput>((node) => {
    const degree = degreeMap.get(node.id) ?? 0
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      radius: Math.max(0.8, Math.cbrt(Math.max(node.val, 0.001)) * 2),
      // Preserve the original degree-sensitive hub repulsion. This is what
      // creates the recognizable radial spacing in the established graph view.
      charge: documentLevel ? -100 - degree * 10 : -100,
      clusterId: node.cluster_id
    }
  })
  const links = data.links.map<GraphLayoutLinkInput>((link) => {
    const source = nodesById.get(link.source)
    const target = nodesById.get(link.target)
    const sameCluster =
      source?.cluster_id != null &&
      target?.cluster_id != null &&
      source.cluster_id === target.cluster_id
    return {
      source: link.source,
      target: link.target,
      distance: documentLevel ? (sameCluster ? 30 : 120) : sameCluster ? 20 : 150,
      strength: documentLevel ? 0.2 : 0.15
    }
  })
  const settings = graphLayoutSettings(level)
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
