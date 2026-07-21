import type {
  GraphLayoutCommand,
  GraphLayoutEvent,
  GraphLayoutInitializeCommand,
  GraphLayoutLinkInput,
  GraphLayoutNodeInput,
  GraphLayoutSettings
} from './graph-layout-protocol'

export interface GraphLayoutClientInitializeOptions {
  revision: string
  nodes: GraphLayoutNodeInput[]
  links: GraphLayoutLinkInput[]
  settings?: Partial<GraphLayoutSettings>
  initialPositions?: Float32Array
  autoStart?: boolean
}

export type GraphLayoutEventListener = (event: GraphLayoutEvent) => void

/** Renderer-side facade for the force-layout worker. */
export class GraphLayoutWorkerClient {
  private readonly worker: Worker
  private readonly listeners = new Set<GraphLayoutEventListener>()
  private nextRequestId = 1
  private disposed = false

  constructor(
    worker: Worker = new Worker(new URL('../workers/graph-layout.worker.ts', import.meta.url), {
      type: 'module',
      name: 'tesseract-graph-layout'
    })
  ) {
    this.worker = worker
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
    this.worker.addEventListener('messageerror', this.handleMessageError)
  }

  subscribe(listener: GraphLayoutEventListener): () => void {
    this.assertActive()
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(options: GraphLayoutClientInitializeOptions): number {
    const requestId = this.requestId()
    const command: GraphLayoutInitializeCommand = { type: 'initialize', requestId, ...options }
    const transfer = options.initialPositions ? [options.initialPositions.buffer] : []
    this.post(command, transfer)
    return requestId
  }

  start(): number {
    return this.send({ type: 'start', requestId: this.requestId() })
  }

  pause(): number {
    return this.send({ type: 'pause', requestId: this.requestId() })
  }

  step(iterations = 1): number {
    return this.send({ type: 'step', requestId: this.requestId(), iterations })
  }

  reset(positions?: Float32Array, autoStart = false): number {
    const requestId = this.requestId()
    const command: GraphLayoutCommand = { type: 'reset', requestId, positions, autoStart }
    this.post(command, positions ? [positions.buffer] : [])
    return requestId
  }

  reheat(alpha?: number, autoStart = true): number {
    return this.send({ type: 'reheat', requestId: this.requestId(), alpha, autoStart })
  }

  pin(nodeId: string, x: number, y: number, z: number, alphaTarget?: number): number {
    return this.send({
      type: 'pin',
      requestId: this.requestId(),
      nodeId,
      x,
      y,
      z,
      alphaTarget
    })
  }

  unpin(nodeId: string, resume = false): number {
    return this.send({
      type: 'unpin',
      requestId: this.requestId(),
      nodeId,
      resume
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.removeEventListener('messageerror', this.handleMessageError)
    this.listeners.clear()
    this.worker.terminate()
  }

  private readonly handleMessage = (message: MessageEvent<GraphLayoutEvent>): void => {
    const event = message.data
    try {
      for (const listener of this.listeners) listener(event)
    } finally {
      // A renderer listener must never be able to strand the worker's single
      // in-flight snapshot and freeze all later force updates.
      if (event.type === 'snapshot' && !this.disposed) {
        this.send({
          type: 'snapshot-ack',
          requestId: this.requestId(),
          revision: event.revision,
          sequence: event.sequence
        })
      }
    }
  }

  private readonly handleError = (event: ErrorEvent): void => {
    this.emitError(event.message || 'The graph layout worker stopped unexpectedly.')
  }

  private readonly handleMessageError = (): void => {
    this.emitError('The graph layout worker returned an unreadable message.')
  }

  private emitError(message: string): void {
    const event: GraphLayoutEvent = { type: 'error', requestId: null, message }
    for (const listener of this.listeners) listener(event)
  }

  private requestId(): number {
    this.assertActive()
    return this.nextRequestId++
  }

  private send(command: GraphLayoutCommand): number {
    this.post(command)
    return command.requestId
  }

  private post(command: GraphLayoutCommand, transfer: Transferable[] = []): void {
    this.assertActive()
    this.worker.postMessage(command, transfer)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Graph layout worker client has been disposed')
  }
}
