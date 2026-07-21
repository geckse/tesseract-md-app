import { describe, expect, it } from 'vitest'
import { GraphLayoutEngine } from '@renderer/lib/graph-layout-engine'
import { GraphLayoutWorkerController } from '@renderer/lib/graph-layout-worker-controller'
import {
  resolveGraphLayoutSettings,
  type GraphLayoutEvent
} from '@renderer/lib/graph-layout-protocol'

describe('GraphLayoutEngine', () => {
  it('honors cached 3D positions before any ticks', () => {
    const engine = new GraphLayoutEngine({
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([1, 2, 3, 10, 20, 30])
    })

    expect(Array.from(engine.positions())).toEqual([1, 2, 3, 10, 20, 30])
    expect(Array.from(engine.linkPositions())).toEqual([1, 2, 3, 10, 20, 30])
    engine.dispose()
  })

  it('ticks a finite 3D layout and converges', () => {
    const engine = new GraphLayoutEngine({
      nodes: [
        { id: 'a', radius: 2 },
        { id: 'b', radius: 2 },
        { id: 'c', radius: 2 }
      ],
      links: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' }
      ]
    })

    engine.tick(400)
    const positions = engine.positions()
    expect(positions).toHaveLength(9)
    expect(Array.from(positions).every(Number.isFinite)).toBe(true)
    expect(engine.settled).toBe(true)
    engine.dispose()
  })

  it('keeps pinned nodes fixed, supports unpin, reheat, and reset', () => {
    const initial = new Float32Array([0, 0, 0, 20, 0, 0])
    const engine = new GraphLayoutEngine({
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: initial
    })

    engine.pin('a', 5, 6, 7)
    engine.tick(20)
    expect(Array.from(engine.positions().slice(0, 3))).toEqual([5, 6, 7])
    engine.unpin('a')
    engine.reheat(0.5)
    expect(engine.alpha).toBe(0.5)
    expect(Array.from(engine.reset(initial))).toEqual(Array.from(initial))
    engine.dispose()
  })

  it('holds interactive force alpha until a drag is released', () => {
    const engine = new GraphLayoutEngine({
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 100, 0, 0])
    })

    engine.pin('a', 25, 5, 0)
    engine.setAlphaTarget(0.3)
    engine.reheat(0.3)
    engine.tick(400)
    expect(engine.alphaTarget).toBe(0.3)
    expect(engine.alpha).toBeCloseTo(0.3)
    expect(Array.from(engine.positions().slice(0, 3))).toEqual([25, 5, 0])

    engine.unpin('a')
    engine.setAlphaTarget(0)
    engine.tick(400)
    expect(engine.settled).toBe(true)
    engine.dispose()
  })

  it('rejects malformed topology and position arrays', () => {
    expect(
      () =>
        new GraphLayoutEngine({
          nodes: [{ id: 'a' }],
          links: [{ source: 'a', target: 'missing' }]
        })
    ).toThrow('unknown node')
    expect(
      () =>
        new GraphLayoutEngine({
          nodes: [{ id: 'a' }],
          links: [],
          initialPositions: new Float32Array([1, 2])
        })
    ).toThrow('one x/y/z triple per node')
  })
})

describe('graph layout protocol', () => {
  it('resolves defaults and validates force settings', () => {
    expect(resolveGraphLayoutSettings({ chargeTheta: 1.2 }).chargeTheta).toBe(1.2)
    expect(() => resolveGraphLayoutSettings({ ticksPerSlice: 0 })).toThrow(
      'ticksPerSlice must be a positive finite number'
    )
    expect(() =>
      resolveGraphLayoutSettings({ chargeDistanceMin: 20, chargeDistanceMax: 10 })
    ).toThrow('chargeDistanceMax must be at least chargeDistanceMin')
  })
})

describe('GraphLayoutWorkerController', () => {
  it('emits transferable ready/snapshot events and handles pauseable manual steps', () => {
    const events: GraphLayoutEvent[] = []
    const transfers: Transferable[][] = []
    let now = 1
    const controller = new GraphLayoutWorkerController(
      {
        postMessage: (message, transfer = []) => {
          events.push(message)
          transfers.push(transfer)
        }
      },
      {
        now: () => now++,
        schedule: () => () => undefined
      }
    )

    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'revision-1',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 10, 0, 0]),
      autoStart: false
    })
    controller.handle({ type: 'step', requestId: 2, iterations: 3 })
    controller.handle({ type: 'pause', requestId: 3 })

    expect(events[0]).toMatchObject({
      type: 'ready',
      requestId: 1,
      revision: 'revision-1',
      nodeIds: ['a', 'b']
    })
    expect(transfers[0]).toHaveLength(2)
    expect(events[0]).toMatchObject({ linkPositions: new Float32Array([0, 0, 0, 10, 0, 0]) })
    expect(events.some((event) => event.type === 'snapshot')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 3, state: 'paused' })
    controller.dispose()
  })

  it('returns typed errors instead of throwing across the worker boundary', () => {
    const events: GraphLayoutEvent[] = []
    const controller = new GraphLayoutWorkerController({
      postMessage: (message) => events.push(message)
    })

    controller.handle({ type: 'start', requestId: 8 })
    expect(events).toEqual([
      {
        type: 'error',
        requestId: 8,
        message: 'Graph layout worker has not been initialized'
      }
    ])
  })

  it('wakes and paces force work while a dragged node stays pinned', () => {
    const events: GraphLayoutEvent[] = []
    const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
    let now = 0
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => ++now,
        schedule: (callback, delayMs = 0) => {
          const entry = { callback, delayMs, cancelled: false }
          scheduled.push(entry)
          return () => {
            entry.cancelled = true
          }
        }
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'drag',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 120, 0, 0]),
      // Interactive drag snapshots bypass the normal settled-layout cadence.
      settings: { alpha: 0.0005, snapshotIntervalMs: 1_000 },
      autoStart: false
    })
    events.length = 0

    controller.handle({
      type: 'pin',
      requestId: 2,
      nodeId: 'a',
      x: 40,
      y: 5,
      z: 2,
      alphaTarget: 0.3
    })
    expect(events.some((event) => event.type === 'snapshot')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 2, state: 'running' })
    expect(scheduled[0]?.delayMs).toBe(0)

    scheduled.shift()?.callback()
    const snapshot = events.find((event) => event.type === 'snapshot')
    if (!snapshot || snapshot.type !== 'snapshot') throw new Error('expected drag snapshot')
    expect(snapshot.alpha).toBeGreaterThan(0.0005)
    expect(snapshot.alpha).toBeLessThan(0.02)
    expect(Array.from(snapshot.positions.slice(0, 3))).toEqual([40, 5, 2])
    expect(Array.from(snapshot.positions.slice(3, 6))).not.toEqual([120, 0, 0])
    expect(scheduled[0]?.delayMs).toBeLessThan(1_000 / 60)

    controller.handle({
      type: 'snapshot-ack',
      requestId: 3,
      revision: snapshot.revision,
      sequence: snapshot.sequence
    })
    controller.handle({
      type: 'pin',
      requestId: 4,
      nodeId: 'a',
      x: 50,
      y: 6,
      z: 3,
      alphaTarget: 0.3
    })
    scheduled.shift()?.callback()
    const dragSnapshots = events.filter((event) => event.type === 'snapshot')
    expect(dragSnapshots).toHaveLength(2)
    const latestSnapshot = dragSnapshots.at(-1)
    if (!latestSnapshot || latestSnapshot.type !== 'snapshot') {
      throw new Error('expected latest drag snapshot')
    }
    expect(latestSnapshot.sequence).toBe(snapshot.sequence + 1)
    expect(Array.from(latestSnapshot.positions.slice(0, 3))).toEqual([50, 6, 3])

    controller.handle({
      type: 'snapshot-ack',
      requestId: 5,
      revision: latestSnapshot.revision,
      sequence: latestSnapshot.sequence
    })

    controller.handle({
      type: 'unpin',
      requestId: 6,
      nodeId: 'a',
      resume: true
    })
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 6, state: 'running' })

    scheduled.shift()?.callback()
    const coolingSnapshots = events.filter((event) => event.type === 'snapshot')
    expect(coolingSnapshots).toHaveLength(3)
    const coolingSnapshot = coolingSnapshots.at(-1)
    if (!coolingSnapshot || coolingSnapshot.type !== 'snapshot') {
      throw new Error('expected cooling snapshot')
    }
    expect(coolingSnapshot.alpha).toBeLessThan(latestSnapshot.alpha)
    expect(scheduled[0]?.delayMs).toBeGreaterThan(0)
    controller.dispose()
  })

  it('renders every post-release cooling tick before settling', () => {
    const events: GraphLayoutEvent[] = []
    const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => 0,
        schedule: (callback, delayMs = 0) => {
          const entry = { callback, delayMs, cancelled: false }
          scheduled.push(entry)
          return () => {
            entry.cancelled = true
          }
        }
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'cooling',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 120, 0, 0]),
      settings: {
        alpha: 0.3,
        alphaDecay: 0.5,
        alphaMin: 0.01,
        snapshotIntervalMs: 1_000,
        ticksPerSlice: 3
      },
      autoStart: false
    })
    events.length = 0
    controller.handle({
      type: 'pin',
      requestId: 2,
      nodeId: 'a',
      x: 40,
      y: 0,
      z: 0,
      alphaTarget: 0.3
    })
    controller.handle({ type: 'unpin', requestId: 3, nodeId: 'a', resume: true })
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 3, state: 'running' })

    const observedAlpha: number[] = []
    for (let frame = 0; frame < 5; frame++) {
      const next = scheduled.shift()
      expect(next?.delayMs).toBeCloseTo(frame === 0 ? 0 : 1_000 / 60)
      next?.callback()
      const snapshot = events.filter((event) => event.type === 'snapshot').at(-1)
      if (!snapshot || snapshot.type !== 'snapshot') throw new Error('expected cooling snapshot')
      observedAlpha.push(snapshot.alpha)
      if (!snapshot.settled) {
        controller.handle({
          type: 'snapshot-ack',
          requestId: 10 + frame,
          revision: snapshot.revision,
          sequence: snapshot.sequence
        })
      }
    }

    expect(observedAlpha).toEqual([0.15, 0.075, 0.0375, 0.01875, 0.009375])
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 0, state: 'settled' })
    expect(scheduled).toHaveLength(0)
    controller.dispose()
  })

  it('coalesces delayed drag frames without emitting an off-frame ACK burst', () => {
    const events: GraphLayoutEvent[] = []
    const scheduled: Array<() => void> = []
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => 0,
        schedule: (callback) => {
          scheduled.push(callback)
          return () => undefined
        }
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'drag-backpressure',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 100, 0, 0]),
      settings: { alpha: 0.1, alphaDecay: 0.1 },
      autoStart: false
    })
    events.length = 0
    controller.handle({
      type: 'pin',
      requestId: 2,
      nodeId: 'a',
      x: 20,
      y: 0,
      z: 0,
      alphaTarget: 0.3
    })

    scheduled.shift()?.()
    const first = events.find((event) => event.type === 'snapshot')
    if (!first || first.type !== 'snapshot') throw new Error('expected first drag snapshot')
    expect(first.alpha).toBeCloseTo(0.12)
    scheduled.shift()?.()
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)

    controller.handle({
      type: 'snapshot-ack',
      requestId: 3,
      revision: first.revision,
      sequence: first.sequence
    })
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)

    scheduled.shift()?.()
    const snapshots = events.filter((event) => event.type === 'snapshot')
    expect(snapshots).toHaveLength(2)
    expect(snapshots.at(-1)).toMatchObject({ alpha: expect.closeTo(0.138) })
    controller.dispose()
  })

  it('does not advance cooling physics ahead of an unacknowledged frame', () => {
    const events: GraphLayoutEvent[] = []
    const scheduled: Array<() => void> = []
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => 0,
        schedule: (callback) => {
          scheduled.push(callback)
          return () => undefined
        }
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'cooling-final',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      initialPositions: new Float32Array([0, 0, 0, 100, 0, 0]),
      settings: { alpha: 0.03, alphaDecay: 0.5, alphaMin: 0.01 },
      autoStart: false
    })
    events.length = 0
    controller.handle({
      type: 'pin',
      requestId: 2,
      nodeId: 'a',
      x: 20,
      y: 0,
      z: 0,
      alphaTarget: 0.3
    })
    controller.handle({ type: 'unpin', requestId: 3, nodeId: 'a', resume: true })

    scheduled.shift()?.()
    const first = events.find((event) => event.type === 'snapshot')
    if (!first || first.type !== 'snapshot') throw new Error('expected first cooling snapshot')
    expect(first).toMatchObject({ alpha: 0.015, settled: false })

    scheduled.shift()?.()
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)
    expect(events.some((event) => event.type === 'state' && event.state === 'settled')).toBe(false)

    controller.handle({
      type: 'snapshot-ack',
      requestId: 4,
      revision: first.revision,
      sequence: first.sequence
    })
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)

    scheduled.shift()?.()
    const snapshots = events.filter((event) => event.type === 'snapshot')
    expect(snapshots).toHaveLength(2)
    expect(snapshots.at(-1)).toMatchObject({ alpha: 0.0075, settled: true })
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'settled' })
    controller.dispose()
  })

  it('flushes a pending frame when frame-paced cooling is paused', () => {
    const events: GraphLayoutEvent[] = []
    const scheduled: Array<() => void> = []
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => 0,
        schedule: (callback) => {
          scheduled.push(callback)
          return () => undefined
        }
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'cooling-pause',
      nodes: [{ id: 'a' }],
      links: [],
      settings: { alpha: 0.3 },
      autoStart: false
    })
    events.length = 0
    controller.handle({
      type: 'pin',
      requestId: 2,
      nodeId: 'a',
      x: 20,
      y: 0,
      z: 0,
      alphaTarget: 0.3
    })
    scheduled.shift()?.()
    const first = events.find((event) => event.type === 'snapshot')
    if (!first || first.type !== 'snapshot') throw new Error('expected drag snapshot')

    controller.handle({ type: 'pause', requestId: 3 })
    expect(events.at(-1)).toMatchObject({ type: 'state', requestId: 3, state: 'paused' })
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)

    controller.handle({
      type: 'snapshot-ack',
      requestId: 4,
      revision: first.revision,
      sequence: first.sequence
    })
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(2)
    controller.dispose()
  })

  it('coalesces snapshots until the renderer acknowledges the in-flight transfer', () => {
    const events: GraphLayoutEvent[] = []
    let now = 0
    const controller = new GraphLayoutWorkerController(
      { postMessage: (message) => events.push(message) },
      {
        now: () => (now += 100),
        schedule: () => () => undefined
      }
    )
    controller.handle({
      type: 'initialize',
      requestId: 1,
      revision: 'backpressure',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
      autoStart: false
    })
    controller.handle({ type: 'step', requestId: 2, iterations: 1 })
    controller.handle({ type: 'step', requestId: 3, iterations: 1 })
    controller.handle({ type: 'step', requestId: 4, iterations: 1 })

    const snapshots = events.filter((event) => event.type === 'snapshot')
    expect(snapshots).toHaveLength(1)
    const first = snapshots[0]
    if (first.type !== 'snapshot') throw new Error('expected snapshot')
    controller.handle({
      type: 'snapshot-ack',
      requestId: 5,
      revision: first.revision,
      sequence: first.sequence
    })
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(2)
    controller.dispose()
  })
})
