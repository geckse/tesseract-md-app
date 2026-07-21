import { describe, expect, it } from 'vitest'
import { GraphPerformanceCollector } from '@renderer/lib/graph-performance'

describe('GraphPerformanceCollector', () => {
  it('measures bounded lifecycle spans and safely ignores a second end', () => {
    let now = 10
    const collector = new GraphPerformanceCollector({
      clock: { now: () => now },
      maxSpans: 2
    })

    const first = collector.beginSpan('request', { nodes: 10 })
    now = 15
    expect(first.end({ outcome: 'success' })).toMatchObject({
      name: 'request',
      durationMs: 5,
      metadata: { nodes: 10, outcome: 'success' }
    })
    expect(first.end()).toBeNull()

    collector.measureSync('parse', () => {
      now = 18
    })
    collector.measureSync('scene', () => {
      now = 22
    })

    expect(collector.snapshot().spans.map((span) => span.name)).toEqual(['parse', 'scene'])
  })

  it('records errors without swallowing them', async () => {
    let now = 0
    const collector = new GraphPerformanceCollector({ clock: { now: () => now } })

    expect(() =>
      collector.measureSync('sync failure', () => {
        now = 4
        throw new Error('broken')
      })
    ).toThrow('broken')

    await expect(
      collector.measure('async failure', async () => {
        now = 9
        throw new Error('also broken')
      })
    ).rejects.toThrow('also broken')

    expect(collector.snapshot().spans.map((span) => span.metadata.outcome)).toEqual([
      'error',
      'error'
    ])
  })

  it('summarizes bounded frame pacing samples', () => {
    const collector = new GraphPerformanceCollector({
      maxFrameSamples: 3,
      targetFrameMs: 16
    })

    collector.recordFrame(0)
    collector.recordFrame(10)
    collector.recordFrame(30)
    collector.recordFrame(70)
    collector.recordFrame(80)

    const frames = collector.snapshot().frames
    expect(frames.sampleCount).toBe(3)
    expect(frames.meanMs).toBeCloseTo(70 / 3)
    expect(frames.p50Ms).toBe(20)
    expect(frames.p95Ms).toBe(40)
    expect(frames.maxMs).toBe(40)
    expect(frames.droppedFrames).toBe(1)
  })

  it('does not count time spent between sampling sessions as a dropped frame', () => {
    const collector = new GraphPerformanceCollector({ targetFrameMs: 16 })
    collector.recordFrame(0)
    collector.recordFrame(16)
    collector.resetFrameBaseline()
    collector.recordFrame(10_000)
    collector.recordFrame(10_016)

    expect(collector.snapshot().frames).toMatchObject({ sampleCount: 2, droppedFrames: 0 })
  })

  it('captures renderer counters and long tasks without retaining unbounded history', () => {
    let now = 40
    const collector = new GraphPerformanceCollector({
      clock: { now: () => now },
      maxRendererSamples: 1,
      maxLongTasks: 1
    })

    collector.recordRendererInfo({ render: { frame: 1, calls: 200 } })
    now = 50
    collector.recordRendererInfo({
      memory: { geometries: 6, textures: 2 },
      render: { frame: 2, calls: 12, triangles: 50, points: 3, lines: 20 }
    })
    collector.recordLongTask(60, 1)
    collector.recordLongTask(80, 2, 'layout')

    const snapshot = collector.snapshot()
    expect(snapshot.rendererSamples).toEqual([
      {
        sampledAt: 50,
        frame: 2,
        calls: 12,
        triangles: 50,
        points: 3,
        lines: 20,
        geometries: 6,
        textures: 2
      }
    ])
    expect(snapshot.longTasks).toEqual([{ durationMs: 80, startedAt: 2, name: 'layout' }])

    collector.reset()
    expect(collector.snapshot()).toMatchObject({
      spans: [],
      activeSpanCount: 0,
      rendererSamples: [],
      longTasks: [],
      frames: { sampleCount: 0 }
    })
  })

  it('rejects invalid bounds', () => {
    expect(() => new GraphPerformanceCollector({ maxSpans: 0 })).toThrow(
      'maxSpans must be a positive integer'
    )
    expect(() => new GraphPerformanceCollector({ targetFrameMs: Number.NaN })).toThrow(
      'targetFrameMs must be a positive finite number'
    )
  })
})
