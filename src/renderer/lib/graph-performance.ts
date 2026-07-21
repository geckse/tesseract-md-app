/**
 * Bounded, dependency-free performance instrumentation for the graph renderer.
 *
 * The collector deliberately does not emit logs or telemetry. Consumers can
 * inspect snapshots in development tools, tests, or a future diagnostics UI.
 */

export type GraphPerformanceMetadataValue = string | number | boolean | null
export type GraphPerformanceMetadata = Readonly<Record<string, GraphPerformanceMetadataValue>>

export interface GraphPerformanceClock {
  now(): number
}

export interface GraphPerformanceSpan {
  id: number
  name: string
  startedAt: number
  endedAt: number
  durationMs: number
  metadata: GraphPerformanceMetadata
}

export interface GraphPerformanceSpanHandle {
  readonly id: number
  readonly name: string
  end(metadata?: GraphPerformanceMetadata): GraphPerformanceSpan | null
}

export interface GraphRendererInfoLike {
  memory?: {
    geometries?: number
    textures?: number
  }
  render?: {
    frame?: number
    calls?: number
    triangles?: number
    points?: number
    lines?: number
  }
}

export interface GraphRendererSample {
  sampledAt: number
  frame: number
  calls: number
  triangles: number
  points: number
  lines: number
  geometries: number
  textures: number
}

export interface GraphLongTaskSample {
  startedAt: number
  durationMs: number
  name: string
}

export interface GraphFrameSummary {
  sampleCount: number
  fps: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  droppedFrames: number
}

export interface GraphPerformanceSnapshot {
  spans: GraphPerformanceSpan[]
  activeSpanCount: number
  frames: GraphFrameSummary
  rendererSamples: GraphRendererSample[]
  longTasks: GraphLongTaskSample[]
}

export interface GraphPerformanceCollectorOptions {
  clock?: GraphPerformanceClock
  maxSpans?: number
  maxFrameSamples?: number
  maxRendererSamples?: number
  maxLongTasks?: number
  targetFrameMs?: number
}

const DEFAULT_MAX_SPANS = 256
const DEFAULT_MAX_FRAME_SAMPLES = 300
const DEFAULT_MAX_RENDERER_SAMPLES = 120
const DEFAULT_MAX_LONG_TASKS = 64
const DEFAULT_TARGET_FRAME_MS = 1000 / 60

const defaultClock: GraphPerformanceClock = {
  now: () => globalThis.performance?.now() ?? Date.now()
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`)
  }
}

function appendBounded<T>(values: T[], value: T, capacity: number): void {
  values.push(value)
  if (values.length > capacity) values.splice(0, values.length - capacity)
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.max(0, index)]
}

function mergeMetadata(
  initial: GraphPerformanceMetadata,
  final?: GraphPerformanceMetadata
): GraphPerformanceMetadata {
  return final ? { ...initial, ...final } : { ...initial }
}

interface ActiveSpan {
  name: string
  startedAt: number
  metadata: GraphPerformanceMetadata
}

/** Collects graph lifecycle spans, frame pacing, renderer counters, and long tasks. */
export class GraphPerformanceCollector {
  private readonly clock: GraphPerformanceClock
  private readonly maxSpans: number
  private readonly maxFrameSamples: number
  private readonly maxRendererSamples: number
  private readonly maxLongTasks: number
  private readonly targetFrameMs: number
  private readonly activeSpans = new Map<number, ActiveSpan>()
  private readonly spans: GraphPerformanceSpan[] = []
  private readonly frameDurations: number[] = []
  private readonly rendererSamples: GraphRendererSample[] = []
  private readonly longTasks: GraphLongTaskSample[] = []
  private nextSpanId = 1
  private previousFrameAt: number | null = null

  constructor(options: GraphPerformanceCollectorOptions = {}) {
    this.clock = options.clock ?? defaultClock
    this.maxSpans = options.maxSpans ?? DEFAULT_MAX_SPANS
    this.maxFrameSamples = options.maxFrameSamples ?? DEFAULT_MAX_FRAME_SAMPLES
    this.maxRendererSamples = options.maxRendererSamples ?? DEFAULT_MAX_RENDERER_SAMPLES
    this.maxLongTasks = options.maxLongTasks ?? DEFAULT_MAX_LONG_TASKS
    this.targetFrameMs = options.targetFrameMs ?? DEFAULT_TARGET_FRAME_MS

    assertPositiveInteger(this.maxSpans, 'maxSpans')
    assertPositiveInteger(this.maxFrameSamples, 'maxFrameSamples')
    assertPositiveInteger(this.maxRendererSamples, 'maxRendererSamples')
    assertPositiveInteger(this.maxLongTasks, 'maxLongTasks')
    assertPositiveFinite(this.targetFrameMs, 'targetFrameMs')
  }

  /** Starts a named phase. Ending a handle twice is a safe no-op. */
  beginSpan(name: string, metadata: GraphPerformanceMetadata = {}): GraphPerformanceSpanHandle {
    if (!name.trim()) throw new Error('Graph performance span name must not be empty')

    const id = this.nextSpanId++
    this.activeSpans.set(id, {
      name,
      startedAt: this.clock.now(),
      metadata: { ...metadata }
    })

    let ended = false
    return {
      id,
      name,
      end: (finalMetadata) => {
        if (ended) return null
        ended = true
        return this.endSpan(id, finalMetadata)
      }
    }
  }

  /** Measures a synchronous operation and records failures as metadata. */
  measureSync<T>(name: string, operation: () => T, metadata: GraphPerformanceMetadata = {}): T {
    const span = this.beginSpan(name, metadata)
    try {
      const result = operation()
      span.end({ outcome: 'success' })
      return result
    } catch (error) {
      span.end({ outcome: 'error' })
      throw error
    }
  }

  /** Measures an asynchronous operation and records failures as metadata. */
  async measure<T>(
    name: string,
    operation: () => Promise<T>,
    metadata: GraphPerformanceMetadata = {}
  ): Promise<T> {
    const span = this.beginSpan(name, metadata)
    try {
      const result = await operation()
      span.end({ outcome: 'success' })
      return result
    } catch (error) {
      span.end({ outcome: 'error' })
      throw error
    }
  }

  /** Records one animation-frame timestamp. The first call establishes a baseline. */
  recordFrame(timestamp = this.clock.now()): void {
    if (!Number.isFinite(timestamp)) return
    if (this.previousFrameAt != null) {
      const duration = timestamp - this.previousFrameAt
      if (duration > 0 && Number.isFinite(duration)) {
        appendBounded(this.frameDurations, duration, this.maxFrameSamples)
      }
    }
    this.previousFrameAt = timestamp
  }

  /** End one sampling session without discarding the bounded frame history. */
  resetFrameBaseline(): void {
    this.previousFrameAt = null
  }

  /** Captures the stable subset of THREE.WebGLRenderer.info used by diagnostics. */
  recordRendererInfo(info: GraphRendererInfoLike): GraphRendererSample {
    const sample: GraphRendererSample = {
      sampledAt: this.clock.now(),
      frame: info.render?.frame ?? 0,
      calls: info.render?.calls ?? 0,
      triangles: info.render?.triangles ?? 0,
      points: info.render?.points ?? 0,
      lines: info.render?.lines ?? 0,
      geometries: info.memory?.geometries ?? 0,
      textures: info.memory?.textures ?? 0
    }
    appendBounded(this.rendererSamples, sample, this.maxRendererSamples)
    return { ...sample }
  }

  /** Records a PerformanceObserver long-task entry or an equivalent manual sample. */
  recordLongTask(durationMs: number, startedAt: number, name = 'longtask'): void {
    if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(startedAt)) return
    appendBounded(this.longTasks, { durationMs, startedAt, name }, this.maxLongTasks)
  }

  /**
   * Starts browser long-task observation when supported.
   * Returns a cleanup function and degrades to a no-op in unsupported runtimes.
   */
  observeLongTasks(): () => void {
    if (typeof PerformanceObserver === 'undefined') return () => undefined

    let observer: PerformanceObserver
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordLongTask(entry.duration, entry.startTime, entry.name || 'longtask')
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      return () => undefined
    }

    return () => observer.disconnect()
  }

  snapshot(): GraphPerformanceSnapshot {
    const durations = [...this.frameDurations].sort((left, right) => left - right)
    const total = durations.reduce((sum, duration) => sum + duration, 0)
    const meanMs = durations.length > 0 ? total / durations.length : 0
    const maxMs = durations.length > 0 ? durations[durations.length - 1] : 0

    return {
      spans: this.spans.map((span) => ({ ...span, metadata: { ...span.metadata } })),
      activeSpanCount: this.activeSpans.size,
      frames: {
        sampleCount: durations.length,
        fps: meanMs > 0 ? 1000 / meanMs : 0,
        meanMs,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs,
        droppedFrames: durations.filter((duration) => duration > this.targetFrameMs * 1.5).length
      },
      rendererSamples: this.rendererSamples.map((sample) => ({ ...sample })),
      longTasks: this.longTasks.map((sample) => ({ ...sample }))
    }
  }

  reset(): void {
    this.activeSpans.clear()
    this.spans.splice(0)
    this.frameDurations.splice(0)
    this.rendererSamples.splice(0)
    this.longTasks.splice(0)
    this.previousFrameAt = null
  }

  private endSpan(
    id: number,
    finalMetadata?: GraphPerformanceMetadata
  ): GraphPerformanceSpan | null {
    const active = this.activeSpans.get(id)
    if (!active) return null
    this.activeSpans.delete(id)

    const endedAt = this.clock.now()
    const span: GraphPerformanceSpan = {
      id,
      name: active.name,
      startedAt: active.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - active.startedAt),
      metadata: mergeMetadata(active.metadata, finalMetadata)
    }
    appendBounded(this.spans, span, this.maxSpans)
    return { ...span, metadata: { ...span.metadata } }
  }
}
