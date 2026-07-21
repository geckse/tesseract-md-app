import type { GraphEdge, GraphNode } from '../types/cli'

export interface GraphPresentationStep {
  nodeId: string
  parentNodeId: string | null
  depth: number
  component: number
}

export interface GraphPresentationPoint {
  x: number
  y: number
  z: number
}

export interface GraphPresentationSpawn {
  position: GraphPresentationPoint
  velocity: GraphPresentationPoint
}

export interface GraphPresentationSpawnOptions {
  /** Settled parent position used only to choose the branch direction. */
  directionOrigin?: GraphPresentationPoint
  distance?: number
  impulse?: number
}

export interface GraphPresentationMotion {
  position: GraphPresentationPoint
  velocity: GraphPresentationPoint
  target: GraphPresentationPoint
}

export interface GraphPresentationMotionFrame extends GraphPresentationMotion {
  settled: boolean
}

export interface MutableGraphPresentationNode extends Partial<GraphPresentationPoint> {
  id: string
  vx?: number
  vy?: number
  vz?: number
  fx?: number
  fy?: number
  fz?: number
}

export interface GraphPresentationLayoutSnapshot {
  positions: Map<string, GraphPresentationPoint>
  fixedPositions: Map<
    string,
    { fx: number | undefined; fy: number | undefined; fz: number | undefined }
  >
}

interface NodeDegrees {
  incoming: number
  outgoing: number
}

/** Empty-space orbit gestures keep playback alive; node interaction may end it. */
export function shouldEndGraphPresentationForPointerTarget(
  presentationActive: boolean,
  hasNodeTarget: boolean
): boolean {
  return presentationActive && hasNodeTarget
}

const PRESENTATION_SPAWN_DISTANCE = 8
const PRESENTATION_SPAWN_IMPULSE = 24
const PRESENTATION_SPRING_STRENGTH = 85
const PRESENTATION_SPRING_DAMPING = 11
const PRESENTATION_MAX_FRAME_SECONDS = 1 / 30
const PRESENTATION_SETTLE_DISTANCE = 0.2
const PRESENTATION_SETTLE_SPEED = 0.5

/** Deterministic unit vector used when two connected nodes share a position. */
function fallbackDirection(nodeId: string): GraphPresentationPoint {
  let hash = 2166136261
  for (let i = 0; i < nodeId.length; i++) {
    hash ^= nodeId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  const first = (hash >>> 0) / 0xffffffff
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  const second = (hash >>> 0) / 0xffffffff
  const z = second * 2 - 1
  const radius = Math.sqrt(Math.max(0, 1 - z * z))
  const angle = first * Math.PI * 2

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z
  }
}

/**
 * Place a newly revealed node just beside its traversal parent and give it a
 * small velocity toward its settled position. The presentation spring takes
 * over from there, producing a short, repeatable burst instead of a teleport.
 */
export function createGraphPresentationSpawn(
  nodeId: string,
  parent: GraphPresentationPoint,
  target: GraphPresentationPoint,
  options: GraphPresentationSpawnOptions = {}
): GraphPresentationSpawn {
  const directionOrigin = options.directionOrigin ?? parent
  const dx = target.x - directionOrigin.x
  const dy = target.y - directionOrigin.y
  const dz = target.z - directionOrigin.z
  const distance = Math.hypot(dx, dy, dz)
  const direction =
    distance > 0.001
      ? { x: dx / distance, y: dy / distance, z: dz / distance }
      : fallbackDirection(nodeId)
  const spawnDistance = options.distance ?? PRESENTATION_SPAWN_DISTANCE
  const impulse = options.impulse ?? PRESENTATION_SPAWN_IMPULSE

  return {
    position: {
      x: parent.x + direction.x * spawnDistance,
      y: parent.y + direction.y * spawnDistance,
      z: parent.z + direction.z * spawnDistance
    },
    velocity: {
      x: direction.x * impulse,
      y: direction.y * impulse,
      z: direction.z * impulse
    }
  }
}

/** Give a disconnected/root node a short entrance close to its settled position. */
export function createGraphPresentationRootSpawn(
  nodeId: string,
  target: GraphPresentationPoint,
  distance = PRESENTATION_SPAWN_DISTANCE
): GraphPresentationSpawn {
  const direction = fallbackDirection(nodeId)
  return {
    position: {
      x: target.x - direction.x * distance,
      y: target.y - direction.y * distance,
      z: target.z - direction.z * distance
    },
    velocity: {
      x: direction.x * PRESENTATION_SPAWN_IMPULSE,
      y: direction.y * PRESENTATION_SPAWN_IMPULSE,
      z: direction.z * PRESENTATION_SPAWN_IMPULSE
    }
  }
}

/**
 * Advance a presentation-only damped spring toward the canonical settled
 * layout. The frame is capped so resuming a backgrounded window cannot launch
 * a node across the graph. Settled motions snap exactly to their target.
 */
export function advanceGraphPresentationMotion(
  motion: GraphPresentationMotion,
  elapsedMs: number
): GraphPresentationMotionFrame {
  const dt = Math.min(Math.max(elapsedMs, 0) / 1000, PRESENTATION_MAX_FRAME_SECONDS)
  const damping = Math.exp(-PRESENTATION_SPRING_DAMPING * dt)

  const velocity = {
    x:
      (motion.velocity.x +
        (motion.target.x - motion.position.x) * PRESENTATION_SPRING_STRENGTH * dt) *
      damping,
    y:
      (motion.velocity.y +
        (motion.target.y - motion.position.y) * PRESENTATION_SPRING_STRENGTH * dt) *
      damping,
    z:
      (motion.velocity.z +
        (motion.target.z - motion.position.z) * PRESENTATION_SPRING_STRENGTH * dt) *
      damping
  }
  const position = {
    x: motion.position.x + velocity.x * dt,
    y: motion.position.y + velocity.y * dt,
    z: motion.position.z + velocity.z * dt
  }

  const finite = [...Object.values(position), ...Object.values(velocity)].every(Number.isFinite)
  const remaining = Math.hypot(
    motion.target.x - position.x,
    motion.target.y - position.y,
    motion.target.z - position.z
  )
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
  const settled =
    !finite || (remaining <= PRESENTATION_SETTLE_DISTANCE && speed <= PRESENTATION_SETTLE_SPEED)

  return settled
    ? {
        position: { ...motion.target },
        velocity: { x: 0, y: 0, z: 0 },
        target: { ...motion.target },
        settled: true
      }
    : { position, velocity, target: motion.target, settled: false }
}

/** Capture the settled graph as canonical and pin it against hidden d3 forces. */
export function captureGraphPresentationLayout(
  nodes: MutableGraphPresentationNode[]
): GraphPresentationLayoutSnapshot {
  const positions = new Map<string, GraphPresentationPoint>()
  const fixedPositions = new Map<
    string,
    { fx: number | undefined; fy: number | undefined; fz: number | undefined }
  >()

  for (const node of nodes) {
    const position = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }
    positions.set(node.id, position)
    fixedPositions.set(node.id, { fx: node.fx, fy: node.fy, fz: node.fz })
    node.x = node.fx = position.x
    node.y = node.fy = position.y
    node.z = node.fz = position.z
    node.vx = node.vy = node.vz = 0
  }

  return { positions, fixedPositions }
}

/** Restore exact settled coordinates and each node's pre-presentation pin state. */
export function restoreGraphPresentationLayout(
  nodes: MutableGraphPresentationNode[],
  snapshot: GraphPresentationLayoutSnapshot
): void {
  for (const node of nodes) {
    const position = snapshot.positions.get(node.id)
    if (position) {
      node.x = position.x
      node.y = position.y
      node.z = position.z
    }
    node.vx = node.vy = node.vz = 0

    const fixed = snapshot.fixedPositions.get(node.id)
    if (fixed?.fx === undefined) delete node.fx
    else node.fx = fixed.fx
    if (fixed?.fy === undefined) delete node.fy
    else node.fy = fixed.fy
    if (fixed?.fz === undefined) delete node.fz
    else node.fz = fixed.fz
  }
}

/**
 * Pick a deterministic presentation root from the remaining nodes.
 * Connected zero-in-degree nodes win first, followed by the lowest in-degree
 * and highest out-degree. Isolated nodes are left until connected components
 * have been presented.
 */
function compareRootCandidates(a: string, b: string, degrees: Map<string, NodeDegrees>): number {
  const da = degrees.get(a) ?? { incoming: 0, outgoing: 0 }
  const db = degrees.get(b) ?? { incoming: 0, outgoing: 0 }
  const totalA = da.incoming + da.outgoing
  const totalB = db.incoming + db.outgoing

  if (totalA > 0 !== totalB > 0) return totalA > 0 ? -1 : 1
  if ((da.incoming === 0) !== (db.incoming === 0)) return da.incoming === 0 ? -1 : 1
  if (da.incoming !== db.incoming) return da.incoming - db.incoming
  if (da.outgoing !== db.outgoing) return db.outgoing - da.outgoing
  if (totalA !== totalB) return totalB - totalA
  return a.localeCompare(b)
}

/**
 * Build a breadth-first reveal order for graph presentation mode.
 *
 * Traversal treats links as connections in either direction, but visits
 * outgoing neighbors first so directed graphs visually flow away from their
 * root. Disconnected components continue from their own best root.
 */
export function buildGraphPresentationOrder(
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedNodeId?: string | null
): GraphPresentationStep[] {
  if (nodes.length === 0) return []

  const nodeIds = new Set(nodes.map((node) => node.id))
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  const degrees = new Map<string, NodeDegrees>()

  for (const id of nodeIds) {
    outgoing.set(id, new Set())
    incoming.set(id, new Set())
    degrees.set(id, { incoming: 0, outgoing: 0 })
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    outgoing.get(edge.source)?.add(edge.target)
    incoming.get(edge.target)?.add(edge.source)
    const sourceDegrees = degrees.get(edge.source)!
    const targetDegrees = degrees.get(edge.target)!
    sourceDegrees.outgoing++
    targetDegrees.incoming++
  }

  const remaining = new Set(nodeIds)
  const rankedRoots = [...nodeIds].sort((a, b) => compareRootCandidates(a, b, degrees))
  const result: GraphPresentationStep[] = []
  let component = 0
  let rootCursor = 0
  let preferredStart = selectedNodeId && remaining.has(selectedNodeId) ? selectedNodeId : null

  while (remaining.size > 0) {
    while (rootCursor < rankedRoots.length && !remaining.has(rankedRoots[rootCursor])) rootCursor++
    const root = preferredStart ?? rankedRoots[rootCursor]
    preferredStart = null
    remaining.delete(root)

    const queue: Array<{ nodeId: string; parentNodeId: string | null; depth: number }> = [
      { nodeId: root, parentNodeId: null, depth: 0 }
    ]
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]
      result.push({ ...current, component })

      const outgoingNeighbors = [...(outgoing.get(current.nodeId) ?? [])].sort()
      const incomingNeighbors = [...(incoming.get(current.nodeId) ?? [])].sort()
      for (const neighbor of [...outgoingNeighbors, ...incomingNeighbors]) {
        if (!remaining.delete(neighbor)) continue
        queue.push({ nodeId: neighbor, parentNodeId: current.nodeId, depth: current.depth + 1 })
      }
    }

    component++
  }

  return result
}
