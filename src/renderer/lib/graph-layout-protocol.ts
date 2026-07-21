/** Typed messages shared by the graph renderer and its force-layout Web Worker. */

export interface GraphLayoutNodeInput {
  id: string
  x?: number
  y?: number
  z?: number
  radius?: number
  /** Per-node many-body strength. Defaults to settings.chargeStrength. */
  charge?: number
  clusterId?: string | number | null
}

export interface GraphLayoutLinkInput {
  source: string
  target: string
  distance?: number
  strength?: number
}

export interface GraphLayoutSettings {
  alpha: number
  alphaMin: number
  alphaDecay: number
  alphaTarget: number
  velocityDecay: number
  chargeStrength: number
  chargeDistanceMin: number
  chargeDistanceMax: number
  chargeTheta: number
  linkDistance: number
  linkStrength: number
  linkIterations: number
  collisionPadding: number
  collisionStrength: number
  collisionIterations: number
  centerStrength: number
  clusterStrength: number
  snapshotIntervalMs: number
  ticksPerSlice: number
  sliceBudgetMs: number
}

export const DEFAULT_GRAPH_LAYOUT_SETTINGS: Readonly<GraphLayoutSettings> = Object.freeze({
  alpha: 1,
  alphaMin: 0.001,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  alphaTarget: 0,
  velocityDecay: 0.4,
  chargeStrength: -80,
  chargeDistanceMin: 1,
  chargeDistanceMax: 400,
  chargeTheta: 1,
  linkDistance: 50,
  linkStrength: 1,
  linkIterations: 1,
  collisionPadding: 2,
  collisionStrength: 0.8,
  collisionIterations: 1,
  centerStrength: 1,
  clusterStrength: 0,
  snapshotIntervalMs: 50,
  ticksPerSlice: 2,
  sliceBudgetMs: 8
})

export interface GraphLayoutInitializeCommand {
  type: 'initialize'
  requestId: number
  revision: string
  nodes: GraphLayoutNodeInput[]
  links: GraphLayoutLinkInput[]
  settings?: Partial<GraphLayoutSettings>
  /** Packed x/y/z triples. NaN triples ask d3-force-3d to seed that node. */
  initialPositions?: Float32Array
  autoStart?: boolean
}

export interface GraphLayoutStartCommand {
  type: 'start'
  requestId: number
}

export interface GraphLayoutPauseCommand {
  type: 'pause'
  requestId: number
}

export interface GraphLayoutStepCommand {
  type: 'step'
  requestId: number
  iterations?: number
}

export interface GraphLayoutResetCommand {
  type: 'reset'
  requestId: number
  positions?: Float32Array
  autoStart?: boolean
}

export interface GraphLayoutReheatCommand {
  type: 'reheat'
  requestId: number
  alpha?: number
  autoStart?: boolean
}

export interface GraphLayoutPinCommand {
  type: 'pin'
  requestId: number
  nodeId: string
  x: number
  y: number
  z: number
  /** Non-zero alpha target held for the duration of the interactive pin. */
  alphaTarget?: number
}

export interface GraphLayoutUnpinCommand {
  type: 'unpin'
  requestId: number
  nodeId: string
  /** Continue ticking at visual-frame cadence while the released graph cools. */
  resume?: boolean
}

/** Renderer acknowledgement; the worker keeps at most one snapshot in flight. */
export interface GraphLayoutSnapshotAckCommand {
  type: 'snapshot-ack'
  requestId: number
  revision: string
  sequence: number
}

export interface GraphLayoutDisposeCommand {
  type: 'dispose'
  requestId: number
}

export type GraphLayoutCommand =
  | GraphLayoutInitializeCommand
  | GraphLayoutStartCommand
  | GraphLayoutPauseCommand
  | GraphLayoutStepCommand
  | GraphLayoutResetCommand
  | GraphLayoutReheatCommand
  | GraphLayoutPinCommand
  | GraphLayoutUnpinCommand
  | GraphLayoutSnapshotAckCommand
  | GraphLayoutDisposeCommand

export type GraphLayoutWorkerState = 'uninitialized' | 'paused' | 'running' | 'settled'

export interface GraphLayoutReadyEvent {
  type: 'ready'
  requestId: number
  revision: string
  nodeIds: string[]
  positions: Float32Array
  /** Packed source/target xyz pairs in link-input order, produced off-thread. */
  linkPositions?: Float32Array
  alpha: number
}

export interface GraphLayoutSnapshotEvent {
  type: 'snapshot'
  revision: string
  sequence: number
  positions: Float32Array
  /** Packed source/target xyz pairs in link-input order, produced off-thread. */
  linkPositions?: Float32Array
  alpha: number
  settled: boolean
}

export interface GraphLayoutStateEvent {
  type: 'state'
  requestId: number
  state: GraphLayoutWorkerState
  alpha: number
}

export interface GraphLayoutErrorEvent {
  type: 'error'
  requestId: number | null
  message: string
}

export type GraphLayoutEvent =
  | GraphLayoutReadyEvent
  | GraphLayoutSnapshotEvent
  | GraphLayoutStateEvent
  | GraphLayoutErrorEvent

/** Merge and validate settings before they cross into the layout engine. */
export function resolveGraphLayoutSettings(
  settings: Partial<GraphLayoutSettings> = {}
): GraphLayoutSettings {
  const resolved = { ...DEFAULT_GRAPH_LAYOUT_SETTINGS, ...settings }
  const positive = [
    ['alpha', resolved.alpha],
    ['alphaMin', resolved.alphaMin],
    ['chargeDistanceMin', resolved.chargeDistanceMin],
    ['chargeDistanceMax', resolved.chargeDistanceMax],
    ['chargeTheta', resolved.chargeTheta],
    ['linkDistance', resolved.linkDistance],
    ['linkIterations', resolved.linkIterations],
    ['collisionIterations', resolved.collisionIterations],
    ['snapshotIntervalMs', resolved.snapshotIntervalMs],
    ['ticksPerSlice', resolved.ticksPerSlice],
    ['sliceBudgetMs', resolved.sliceBudgetMs]
  ] as const
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Graph layout ${name} must be a positive finite number`)
    }
  }
  if (resolved.chargeDistanceMax < resolved.chargeDistanceMin) {
    throw new Error('Graph layout chargeDistanceMax must be at least chargeDistanceMin')
  }

  const unitInterval = [
    ['alphaDecay', resolved.alphaDecay],
    ['velocityDecay', resolved.velocityDecay],
    ['collisionStrength', resolved.collisionStrength],
    ['centerStrength', resolved.centerStrength]
  ] as const
  for (const [name, value] of unitInterval) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Graph layout ${name} must be between 0 and 1`)
    }
  }

  if (!Number.isFinite(resolved.alphaTarget) || resolved.alphaTarget < 0) {
    throw new Error('Graph layout alphaTarget must be a non-negative finite number')
  }
  if (!Number.isFinite(resolved.chargeStrength)) {
    throw new Error('Graph layout chargeStrength must be finite')
  }
  if (!Number.isFinite(resolved.linkStrength) || resolved.linkStrength < 0) {
    throw new Error('Graph layout linkStrength must be a non-negative finite number')
  }
  if (!Number.isFinite(resolved.collisionPadding) || resolved.collisionPadding < 0) {
    throw new Error('Graph layout collisionPadding must be a non-negative finite number')
  }
  if (!Number.isFinite(resolved.clusterStrength) || resolved.clusterStrength < 0) {
    throw new Error('Graph layout clusterStrength must be a non-negative finite number')
  }

  resolved.linkIterations = Math.max(1, Math.floor(resolved.linkIterations))
  resolved.collisionIterations = Math.max(1, Math.floor(resolved.collisionIterations))
  resolved.ticksPerSlice = Math.max(1, Math.floor(resolved.ticksPerSlice))
  return resolved
}
