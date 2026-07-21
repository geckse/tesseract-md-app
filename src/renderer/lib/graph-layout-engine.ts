import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force3D,
  type Simulation3D,
  type SimulationLinkDatum3D,
  type SimulationNodeDatum3D
} from 'd3-force-3d'
import {
  resolveGraphLayoutSettings,
  type GraphLayoutLinkInput,
  type GraphLayoutNodeInput,
  type GraphLayoutSettings
} from './graph-layout-protocol'

interface LayoutNode extends SimulationNodeDatum3D {
  id: string
  radius: number
  charge: number
  clusterId: string | number | null
}

interface LayoutLink extends SimulationLinkDatum3D<LayoutNode> {
  source: LayoutNode | string
  target: LayoutNode | string
  distance: number
  strength: number
}

export interface GraphLayoutEngineInput {
  nodes: readonly GraphLayoutNodeInput[]
  links: readonly GraphLayoutLinkInput[]
  settings?: Partial<GraphLayoutSettings>
  initialPositions?: Float32Array
}

function optionalFinite(value: number | undefined, name: string): number | undefined {
  if (value == null) return undefined
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite when supplied`)
  return value
}

function createClusterForce(strength: number): Force3D<LayoutNode> {
  let nodes: LayoutNode[] = []
  let nodeClusterSlots = new Int32Array()
  let sumsX = new Float64Array()
  let sumsY = new Float64Array()
  let sumsZ = new Float64Array()
  let anchorsX = new Float64Array()
  let anchorsY = new Float64Array()
  let anchorsZ = new Float64Array()
  let counts = new Uint32Array()
  let tick = 0

  const recomputeAnchors = () => {
    sumsX.fill(0)
    sumsY.fill(0)
    sumsZ.fill(0)
    counts.fill(0)

    for (let index = 0; index < nodes.length; index++) {
      const slot = nodeClusterSlots[index]
      if (slot < 0) continue
      const node = nodes[index]
      sumsX[slot] += node.x ?? 0
      sumsY[slot] += node.y ?? 0
      sumsZ[slot] += node.z ?? 0
      counts[slot]++
    }
    for (let slot = 0; slot < counts.length; slot++) {
      const count = counts[slot]
      if (count === 0) continue
      anchorsX[slot] = sumsX[slot] / count
      anchorsY[slot] = sumsY[slot] / count
      anchorsZ[slot] = sumsZ[slot] / count
    }
  }

  const force: Force3D<LayoutNode> = (alpha) => {
    if (strength <= 0 || counts.length === 0) return
    // The previous host renderer refreshed live cluster centroids every 30
    // simulation ticks. Recomputing them every tick lets linked clusters drift
    // together and changes the characteristic separated layout.
    if (tick > 0 && tick % 30 === 0) recomputeAnchors()
    tick++

    for (let index = 0; index < nodes.length; index++) {
      const slot = nodeClusterSlots[index]
      if (slot < 0) continue
      const count = counts[slot]
      if (count < 2) continue
      const node = nodes[index]
      const pull = alpha * strength
      node.vx = (node.vx ?? 0) + (anchorsX[slot] - (node.x ?? 0)) * pull
      node.vy = (node.vy ?? 0) + (anchorsY[slot] - (node.y ?? 0)) * pull
      node.vz = (node.vz ?? 0) + (anchorsZ[slot] - (node.z ?? 0)) * pull
    }
  }
  force.initialize = (nextNodes) => {
    nodes = nextNodes
    const slots = new Map<string | number, number>()
    nodeClusterSlots = new Int32Array(nodes.length)
    nodeClusterSlots.fill(-1)
    for (let index = 0; index < nodes.length; index++) {
      const clusterId = nodes[index].clusterId
      if (clusterId == null) continue
      let slot = slots.get(clusterId)
      if (slot === undefined) {
        slot = slots.size
        slots.set(clusterId, slot)
      }
      nodeClusterSlots[index] = slot
    }
    sumsX = new Float64Array(slots.size)
    sumsY = new Float64Array(slots.size)
    sumsZ = new Float64Array(slots.size)
    anchorsX = new Float64Array(slots.size)
    anchorsY = new Float64Array(slots.size)
    anchorsZ = new Float64Array(slots.size)
    counts = new Uint32Array(slots.size)
    tick = 0
    recomputeAnchors()
  }
  return force
}

/** Pure, manually-ticked force engine suitable for both Web Workers and unit tests. */
export class GraphLayoutEngine {
  readonly nodeIds: string[]
  readonly settings: GraphLayoutSettings
  private readonly nodeInputs: GraphLayoutNodeInput[]
  private readonly linkInputs: GraphLayoutLinkInput[]
  private readonly linkSourceIndices: Int32Array
  private readonly linkTargetIndices: Int32Array
  private nodes: LayoutNode[] = []
  private nodesById = new Map<string, LayoutNode>()
  private simulation: Simulation3D<LayoutNode>

  constructor(input: GraphLayoutEngineInput) {
    this.settings = resolveGraphLayoutSettings(input.settings)
    this.nodeInputs = input.nodes.map((node) => ({ ...node }))
    this.linkInputs = input.links.map((link) => ({ ...link }))
    this.nodeIds = this.nodeInputs.map((node) => node.id)
    this.validateInputs(input.initialPositions)
    const nodeIndices = new Map(this.nodeIds.map((nodeId, index) => [nodeId, index]))
    this.linkSourceIndices = new Int32Array(this.linkInputs.length)
    this.linkTargetIndices = new Int32Array(this.linkInputs.length)
    for (let index = 0; index < this.linkInputs.length; index++) {
      this.linkSourceIndices[index] = nodeIndices.get(this.linkInputs[index].source) ?? -1
      this.linkTargetIndices[index] = nodeIndices.get(this.linkInputs[index].target) ?? -1
    }
    this.simulation = this.buildSimulation(input.initialPositions)
  }

  get alpha(): number {
    return this.simulation.alpha()
  }

  get alphaTarget(): number {
    return this.simulation.alphaTarget()
  }

  get settled(): boolean {
    return this.alpha < this.settings.alphaMin
  }

  /** Advance the solver without allocating a position snapshot. */
  tick(iterations = 1): void {
    if (!Number.isInteger(iterations) || iterations < 1) {
      throw new Error('Graph layout tick iterations must be a positive integer')
    }
    this.simulation.tick(iterations)
  }

  positions(): Float32Array {
    const positions = new Float32Array(this.nodes.length * 3)
    this.nodes.forEach((node, index) => {
      positions[index * 3] = node.x ?? 0
      positions[index * 3 + 1] = node.y ?? 0
      positions[index * 3 + 2] = node.z ?? 0
    })
    return positions
  }

  /** Pack link endpoints beside the solver, keeping the O(E) walk off the renderer thread. */
  linkPositions(): Float32Array {
    const positions = new Float32Array(this.linkInputs.length * 6)
    for (let index = 0; index < this.linkInputs.length; index++) {
      const source = this.nodes[this.linkSourceIndices[index]]
      const target = this.nodes[this.linkTargetIndices[index]]
      const offset = index * 6
      positions[offset] = source?.x ?? 0
      positions[offset + 1] = source?.y ?? 0
      positions[offset + 2] = source?.z ?? 0
      positions[offset + 3] = target?.x ?? 0
      positions[offset + 4] = target?.y ?? 0
      positions[offset + 5] = target?.z ?? 0
    }
    return positions
  }

  reset(positions?: Float32Array): Float32Array {
    if (positions && positions.length !== this.nodeInputs.length * 3) {
      throw new Error('Graph layout reset positions must contain one x/y/z triple per node')
    }
    this.simulation.stop()
    this.simulation = this.buildSimulation(positions)
    return this.positions()
  }

  reheat(alpha = this.settings.alpha): void {
    if (!Number.isFinite(alpha) || alpha <= 0) {
      throw new Error('Graph layout reheat alpha must be a positive finite number')
    }
    this.simulation.alpha(alpha)
  }

  /** Hold the solver warm during an interactive gesture, or release it to cool. */
  setAlphaTarget(alpha: number): void {
    if (!Number.isFinite(alpha) || alpha < 0) {
      throw new Error('Graph layout alpha target must be a non-negative finite number')
    }
    this.simulation.alphaTarget(alpha)
  }

  pin(nodeId: string, x: number, y: number, z: number): void {
    const node = this.requireNode(nodeId)
    for (const [name, value] of [
      ['x', x],
      ['y', y],
      ['z', z]
    ] as const) {
      if (!Number.isFinite(value)) throw new Error(`Graph layout pin ${name} must be finite`)
    }
    node.fx = x
    node.fy = y
    node.fz = z
    node.x = x
    node.y = y
    node.z = z
    node.vx = 0
    node.vy = 0
    node.vz = 0
  }

  unpin(nodeId: string): void {
    const node = this.requireNode(nodeId)
    node.fx = null
    node.fy = null
    node.fz = null
  }

  dispose(): void {
    this.simulation.stop()
  }

  private validateInputs(initialPositions?: Float32Array): void {
    if (new Set(this.nodeIds).size !== this.nodeIds.length) {
      throw new Error('Graph layout node IDs must be unique')
    }
    if (initialPositions && initialPositions.length !== this.nodeIds.length * 3) {
      throw new Error('Graph layout initial positions must contain one x/y/z triple per node')
    }

    const knownNodes = new Set(this.nodeIds)
    for (const node of this.nodeInputs) {
      if (!node.id) throw new Error('Graph layout node ID must not be empty')
      optionalFinite(node.x, `Graph layout node ${node.id} x`)
      optionalFinite(node.y, `Graph layout node ${node.id} y`)
      optionalFinite(node.z, `Graph layout node ${node.id} z`)
      if (node.radius != null && (!Number.isFinite(node.radius) || node.radius < 0)) {
        throw new Error(`Graph layout node ${node.id} radius must be non-negative and finite`)
      }
      optionalFinite(node.charge, `Graph layout node ${node.id} charge`)
    }
    for (const link of this.linkInputs) {
      if (!knownNodes.has(link.source) || !knownNodes.has(link.target)) {
        throw new Error(
          `Graph layout link references unknown node: ${link.source} -> ${link.target}`
        )
      }
      if (link.distance != null && (!Number.isFinite(link.distance) || link.distance <= 0)) {
        throw new Error('Graph layout link distance must be positive and finite')
      }
      if (link.strength != null && (!Number.isFinite(link.strength) || link.strength < 0)) {
        throw new Error('Graph layout link strength must be non-negative and finite')
      }
    }
  }

  private buildSimulation(initialPositions?: Float32Array): Simulation3D<LayoutNode> {
    this.nodes = this.nodeInputs.map((input, index) => {
      const offset = index * 3
      const cachedX = initialPositions?.[offset]
      const cachedY = initialPositions?.[offset + 1]
      const cachedZ = initialPositions?.[offset + 2]
      return {
        id: input.id,
        radius: input.radius ?? 1,
        charge: input.charge ?? this.settings.chargeStrength,
        clusterId: input.clusterId ?? null,
        x: Number.isFinite(cachedX) ? cachedX : input.x,
        y: Number.isFinite(cachedY) ? cachedY : input.y,
        z: Number.isFinite(cachedZ) ? cachedZ : input.z
      }
    })
    this.nodesById = new Map(this.nodes.map((node) => [node.id, node]))
    const links: LayoutLink[] = this.linkInputs.map((link) => ({
      source: link.source,
      target: link.target,
      distance: link.distance ?? this.settings.linkDistance,
      strength: link.strength ?? this.settings.linkStrength
    }))

    const simulation = forceSimulation(this.nodes, 3).stop()
    simulation
      .alpha(this.settings.alpha)
      .alphaMin(this.settings.alphaMin)
      .alphaDecay(this.settings.alphaDecay)
      .alphaTarget(this.settings.alphaTarget)
      .velocityDecay(this.settings.velocityDecay)

    const charge = forceManyBody<LayoutNode>()
      .strength((node) => node.charge)
      .distanceMin(this.settings.chargeDistanceMin)
      .distanceMax(this.settings.chargeDistanceMax)
      .theta(this.settings.chargeTheta)
    const link = forceLink<LayoutNode, LayoutLink>(links)
      .id((node) => node.id)
      .distance((edge) => edge.distance)
      .strength((edge) => edge.strength)
      .iterations(this.settings.linkIterations)
    simulation.force('charge', charge)
    simulation.force('link', link)
    if (this.settings.collisionStrength > 0) {
      simulation.force(
        'collision',
        forceCollide<LayoutNode>((node) => node.radius + this.settings.collisionPadding)
          .strength(this.settings.collisionStrength)
          .iterations(this.settings.collisionIterations)
      )
    }
    if (this.settings.centerStrength > 0) {
      simulation.force(
        'center',
        forceCenter<LayoutNode>(0, 0, 0).strength(this.settings.centerStrength)
      )
    }
    if (this.settings.clusterStrength > 0) {
      simulation.force('cluster', createClusterForce(this.settings.clusterStrength))
    }
    return simulation
  }

  private requireNode(nodeId: string): LayoutNode {
    const node = this.nodesById.get(nodeId)
    if (!node) throw new Error(`Unknown graph layout node: ${nodeId}`)
    return node
  }
}
