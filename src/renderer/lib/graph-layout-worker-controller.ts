import { GraphLayoutEngine } from './graph-layout-engine'
import type {
  GraphLayoutCommand,
  GraphLayoutEvent,
  GraphLayoutInitializeCommand,
  GraphLayoutSnapshotEvent,
  GraphLayoutWorkerState
} from './graph-layout-protocol'

export interface GraphLayoutWorkerPort {
  postMessage(message: GraphLayoutEvent, transfer?: Transferable[]): void
}

export interface GraphLayoutWorkerControllerOptions {
  now?: () => number
  /** Queue one slice and return a function that cancels it. */
  schedule?: (callback: () => void, delayMs?: number) => () => void
}

const DEFAULT_REHEAT_ALPHA = 0.3
const MAX_BATCHES_PER_SLICE = 16
const INTERACTIVE_FRAME_MS = 1_000 / 60

/** Stateful worker-side command handler, split out so it can be unit-tested without a real Worker. */
export class GraphLayoutWorkerController {
  private readonly port: GraphLayoutWorkerPort
  private readonly now: () => number
  private readonly schedule: (callback: () => void, delayMs?: number) => () => void
  private engine: GraphLayoutEngine | null = null
  private revision = ''
  private state: GraphLayoutWorkerState = 'uninitialized'
  private cancelScheduledSlice: (() => void) | null = null
  private sequence = 0
  private lastSnapshotAt = 0
  private snapshotInFlight: number | null = null
  private snapshotPending = false
  private readonly interactivePins = new Map<string, number>()
  private framePacedCooling = false

  constructor(port: GraphLayoutWorkerPort, options: GraphLayoutWorkerControllerOptions = {}) {
    this.port = port
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now())
    this.schedule =
      options.schedule ??
      ((callback, delayMs = 0) => {
        const handle = globalThis.setTimeout(callback, delayMs)
        return () => globalThis.clearTimeout(handle)
      })
  }

  handle(command: GraphLayoutCommand): void {
    try {
      switch (command.type) {
        case 'initialize':
          this.initialize(command)
          break
        case 'start':
          this.start(command.requestId)
          break
        case 'pause':
          this.pause(command.requestId)
          break
        case 'step':
          this.step(command.requestId, command.iterations ?? 1)
          break
        case 'reset':
          this.reset(command.requestId, command.positions, command.autoStart ?? false)
          break
        case 'reheat':
          this.reheat(command.requestId, command.alpha, command.autoStart ?? true)
          break
        case 'pin':
          this.requireEngine().pin(command.nodeId, command.x, command.y, command.z)
          if (command.alphaTarget != null) {
            const engine = this.requireEngine()
            this.framePacedCooling = false
            this.interactivePins.set(command.nodeId, command.alphaTarget)
            engine.setAlphaTarget(Math.max(...this.interactivePins.values()))
            // d3's native drag ramps alpha toward the target. Jumping directly
            // to 0.3 makes dense graphs kick and oscillate on first movement.
            if (this.state !== 'running') this.start(command.requestId, true)
          } else {
            this.emitState(command.requestId)
          }
          break
        case 'unpin': {
          this.requireEngine().unpin(command.nodeId)
          const wasInteractive = this.interactivePins.delete(command.nodeId)
          this.requireEngine().setAlphaTarget(
            this.interactivePins.size > 0 ? Math.max(...this.interactivePins.values()) : 0
          )
          if (command.resume || wasInteractive) {
            // Continue with visible one-tick frames until alpha settles. Bulk
            // convergence here hides intermediate motion and looks like a snap.
            this.framePacedCooling = this.interactivePins.size === 0
            this.start(command.requestId, true)
          } else {
            this.emitState(command.requestId)
          }
          break
        }
        case 'snapshot-ack':
          this.acknowledgeSnapshot(command.revision, command.sequence)
          break
        case 'dispose':
          this.dispose()
          this.emitState(command.requestId)
          break
      }
    } catch (error) {
      this.port.postMessage({
        type: 'error',
        requestId: command.requestId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  dispose(): void {
    this.stopTimer()
    this.engine?.dispose()
    this.engine = null
    this.revision = ''
    this.state = 'uninitialized'
    this.snapshotInFlight = null
    this.snapshotPending = false
    this.interactivePins.clear()
    this.framePacedCooling = false
  }

  private initialize(command: GraphLayoutInitializeCommand): void {
    this.dispose()
    this.engine = new GraphLayoutEngine({
      nodes: command.nodes,
      links: command.links,
      settings: command.settings,
      initialPositions: command.initialPositions
    })
    this.revision = command.revision
    this.sequence = 0
    this.lastSnapshotAt = this.now()
    this.state = 'paused'

    const positions = this.engine.positions()
    const linkPositions = this.engine.linkPositions()
    this.port.postMessage(
      {
        type: 'ready',
        requestId: command.requestId,
        revision: this.revision,
        nodeIds: [...this.engine.nodeIds],
        positions,
        linkPositions,
        alpha: this.engine.alpha
      },
      [positions.buffer, linkPositions.buffer]
    )
    if (command.autoStart ?? true) this.start(command.requestId)
    else this.emitState(command.requestId)
  }

  private start(requestId: number, immediateFrame = false): void {
    const engine = this.requireEngine()
    if (engine.settled && !this.isFramePaced()) engine.reheat(DEFAULT_REHEAT_ALPHA)
    this.state = 'running'
    this.emitState(requestId)
    if (immediateFrame) this.scheduleSlice(0)
    else this.scheduleSlice()
  }

  private pause(requestId: number): void {
    this.requireEngine()
    this.stopTimer()
    this.state = 'paused'
    this.emitSnapshot(false)
    this.emitState(requestId)
  }

  private step(requestId: number, iterations: number): void {
    const engine = this.requireEngine()
    this.stopTimer()
    engine.tick(iterations)
    this.state = engine.settled ? 'settled' : 'paused'
    this.emitSnapshot(engine.settled)
    this.emitState(requestId)
  }

  private reset(requestId: number, positions: Float32Array | undefined, autoStart: boolean): void {
    const engine = this.requireEngine()
    this.stopTimer()
    this.interactivePins.clear()
    this.framePacedCooling = false
    engine.reset(positions)
    this.sequence = 0
    this.lastSnapshotAt = this.now()
    this.state = 'paused'
    this.emitSnapshot(false)
    if (autoStart) this.start(requestId)
    else this.emitState(requestId)
  }

  private reheat(requestId: number, alpha: number | undefined, autoStart: boolean): void {
    const engine = this.requireEngine()
    engine.reheat(alpha ?? DEFAULT_REHEAT_ALPHA)
    this.state = 'paused'
    if (autoStart) this.start(requestId)
    else this.emitState(requestId)
  }

  private isFramePaced(): boolean {
    return this.interactivePins.size > 0 || this.framePacedCooling
  }

  private scheduleSlice(delayMs = this.isFramePaced() ? INTERACTIVE_FRAME_MS : 0): void {
    if (this.cancelScheduledSlice != null || this.state !== 'running') return
    this.cancelScheduledSlice = this.schedule(() => {
      this.cancelScheduledSlice = null
      this.runSlice()
    }, delayMs)
  }

  private runSlice(): void {
    const engine = this.requireEngine()
    const startedAt = this.now()
    let batches = 0
    const framePaced = this.isFramePaced()
    if (framePaced && this.snapshotInFlight !== null) {
      // Keep force time coupled to displayed time. Advancing while the
      // renderer still owns the prior snapshot would combine unseen ticks into
      // a later jump, which feels like jitter even at a steady render FPS.
      const sliceElapsedMs = Math.max(0, this.now() - startedAt)
      if (this.state === 'running') {
        this.scheduleSlice(Math.max(0, INTERACTIVE_FRAME_MS - sliceElapsedMs))
      }
      return
    }
    if (framePaced) {
      // Dragging and post-release cooling track display frames instead of
      // hiding many force ticks inside a single worker slice.
      engine.tick(1)
    } else {
      while (
        !engine.settled &&
        batches < MAX_BATCHES_PER_SLICE &&
        this.now() - startedAt < engine.settings.sliceBudgetMs
      ) {
        engine.tick(engine.settings.ticksPerSlice)
        batches += 1
      }
    }

    const settled = engine.settled
    if (
      settled ||
      framePaced ||
      this.now() - this.lastSnapshotAt >= engine.settings.snapshotIntervalMs
    ) {
      this.emitSnapshot(settled)
    }
    const sliceElapsedMs = Math.max(0, this.now() - startedAt)
    if (settled) {
      this.framePacedCooling = false
      this.state = 'settled'
      this.emitState(0)
      return
    }
    if (this.state === 'running') {
      this.scheduleSlice(framePaced ? Math.max(0, INTERACTIVE_FRAME_MS - sliceElapsedMs) : 0)
    }
  }

  private emitSnapshot(settled: boolean): void {
    const engine = this.requireEngine()
    if (this.snapshotInFlight !== null) {
      this.snapshotPending = true
      return
    }
    const positions = engine.positions()
    const linkPositions = engine.linkPositions()
    const sequence = this.sequence++
    const event: GraphLayoutSnapshotEvent = {
      type: 'snapshot',
      revision: this.revision,
      sequence,
      positions,
      linkPositions,
      alpha: engine.alpha,
      settled
    }
    this.lastSnapshotAt = this.now()
    this.snapshotInFlight = sequence
    this.port.postMessage(event, [positions.buffer, linkPositions.buffer])
  }

  private acknowledgeSnapshot(revision: string, sequence: number): void {
    if (revision !== this.revision || sequence !== this.snapshotInFlight) return
    this.snapshotInFlight = null
    if (!this.snapshotPending || !this.engine) return
    this.snapshotPending = false
    // During drag/cooling, let the already-scheduled visual frame publish the
    // newest state. Emitting immediately from ACK creates irregular off-frame
    // bursts whenever the renderer briefly falls behind. A settled engine has
    // no next frame, so its final coalesced snapshot still flushes here.
    if (this.state === 'running' && this.isFramePaced() && !this.engine.settled) return
    this.emitSnapshot(this.engine.settled)
  }

  private emitState(requestId: number): void {
    this.port.postMessage({
      type: 'state',
      requestId,
      state: this.state,
      alpha: this.engine?.alpha ?? 0
    })
  }

  private stopTimer(): void {
    if (this.cancelScheduledSlice == null) return
    this.cancelScheduledSlice()
    this.cancelScheduledSlice = null
  }

  private requireEngine(): GraphLayoutEngine {
    if (!this.engine) throw new Error('Graph layout worker has not been initialized')
    return this.engine
  }
}
