import { describe, expect, it } from 'vitest'

import {
  advanceGraphPresentationMotion,
  buildGraphPresentationOrder,
  captureGraphPresentationLayout,
  createGraphPresentationRootSpawn,
  createGraphPresentationSpawn,
  restoreGraphPresentationLayout,
  shouldEndGraphPresentationForPointerTarget
} from '@renderer/lib/graph-presentation'
import type { GraphEdge, GraphNode } from '@renderer/types/cli'

function node(id: string): GraphNode {
  return {
    id,
    path: `${id}.md`,
    label: null,
    cluster_id: null,
    custom_cluster_id: null,
    chunk_index: null
  }
}

function edge(source: string, target: string): GraphEdge {
  return { source, target, weight: 1 }
}

describe('buildGraphPresentationOrder', () => {
  it('starts at a connected zero-in-degree root and reveals breadth-first', () => {
    const nodes = ['root', 'a', 'b', 'leaf', 'orphan'].map(node)
    const edges = [edge('root', 'b'), edge('root', 'a'), edge('a', 'leaf')]

    const order = buildGraphPresentationOrder(nodes, edges)

    expect(order.map((step) => step.nodeId)).toEqual(['root', 'a', 'b', 'leaf', 'orphan'])
    expect(order.slice(0, 4).map((step) => step.depth)).toEqual([0, 1, 1, 2])
    expect(order.map((step) => step.parentNodeId)).toEqual([null, 'root', 'root', 'a', null])
  })

  it('starts from the selected node and traverses incoming connections too', () => {
    const nodes = ['root', 'middle', 'leaf'].map(node)
    const edges = [edge('root', 'middle'), edge('middle', 'leaf')]

    const order = buildGraphPresentationOrder(nodes, edges, 'leaf')

    expect(order.map((step) => step.nodeId)).toEqual(['leaf', 'middle', 'root'])
    expect(order.map((step) => step.depth)).toEqual([0, 1, 2])
    expect(order.map((step) => step.parentNodeId)).toEqual([null, 'leaf', 'middle'])
  })

  it('continues through disconnected components with deterministic roots', () => {
    const nodes = ['alpha', 'a-leaf', 'beta', 'b-leaf'].map(node)
    const edges = [edge('alpha', 'a-leaf'), edge('beta', 'b-leaf')]

    const order = buildGraphPresentationOrder(nodes, edges)

    expect(order.map((step) => step.nodeId)).toEqual(['alpha', 'a-leaf', 'beta', 'b-leaf'])
    expect(order.map((step) => step.component)).toEqual([0, 0, 1, 1])
    expect(order.map((step) => step.parentNodeId)).toEqual([null, 'alpha', null, 'beta'])
  })

  it('falls back deterministically for cyclic graphs', () => {
    const nodes = ['b', 'a', 'c'].map(node)
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]

    expect(buildGraphPresentationOrder(nodes, edges).map((step) => step.nodeId)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('ignores an unknown selected node and edges outside the graph', () => {
    const nodes = ['root', 'leaf'].map(node)
    const edges = [edge('root', 'leaf'), edge('missing', 'root')]

    expect(buildGraphPresentationOrder(nodes, edges, 'missing').map((step) => step.nodeId)).toEqual(
      ['root', 'leaf']
    )
  })
})

describe('presentation pointer ownership', () => {
  it('keeps playback alive for empty-space camera gestures', () => {
    expect(shouldEndGraphPresentationForPointerTarget(true, false)).toBe(false)
    expect(shouldEndGraphPresentationForPointerTarget(true, true)).toBe(true)
    expect(shouldEndGraphPresentationForPointerTarget(false, true)).toBe(false)
  })
})

describe('createGraphPresentationSpawn', () => {
  it('places a node near its parent with an outward impulse', () => {
    const spawn = createGraphPresentationSpawn('child', { x: 1, y: 2, z: 3 }, { x: 25, y: 2, z: 3 })

    expect(spawn.position).toEqual({ x: 9, y: 2, z: 3 })
    expect(spawn.velocity).toEqual({ x: 24, y: 0, z: 0 })
  })

  it('uses settled parent geometry for direction while spawning beside its live parent', () => {
    const spawn = createGraphPresentationSpawn(
      'child',
      { x: 100, y: 100, z: 0 },
      { x: 0, y: 50, z: 0 },
      { directionOrigin: { x: 0, y: 0, z: 0 } }
    )

    expect(spawn.position).toEqual({ x: 100, y: 108, z: 0 })
    expect(spawn.velocity).toEqual({ x: 0, y: 24, z: 0 })
  })

  it('uses a finite deterministic direction for coincident positions', () => {
    const parent = { x: 5, y: -2, z: 7 }
    const first = createGraphPresentationSpawn('same-place', parent, parent)
    const second = createGraphPresentationSpawn('same-place', parent, parent)
    const spawnDistance = Math.hypot(
      first.position.x - parent.x,
      first.position.y - parent.y,
      first.position.z - parent.z
    )

    expect(first).toEqual(second)
    expect(Object.values(first.position).every(Number.isFinite)).toBe(true)
    expect(Object.values(first.velocity).every(Number.isFinite)).toBe(true)
    expect(spawnDistance).toBeCloseTo(8)
  })

  it('gives disconnected roots a short force-like entrance near their settled position', () => {
    const target = { x: 40, y: -20, z: 5 }
    const spawn = createGraphPresentationRootSpawn('root', target)
    const offset = {
      x: target.x - spawn.position.x,
      y: target.y - spawn.position.y,
      z: target.z - spawn.position.z
    }

    expect(Math.hypot(offset.x, offset.y, offset.z)).toBeCloseTo(8)
    expect(
      offset.x * spawn.velocity.x + offset.y * spawn.velocity.y + offset.z * spawn.velocity.z
    ).toBeGreaterThan(0)
  })
})

describe('advanceGraphPresentationMotion', () => {
  it('settles a spawned node exactly onto the canonical graph layout', () => {
    let frame = advanceGraphPresentationMotion(
      {
        position: { x: 8, y: 0, z: 0 },
        velocity: { x: 24, y: 0, z: 0 },
        target: { x: 100, y: 30, z: -20 }
      },
      16
    )

    for (let tick = 0; tick < 300 && !frame.settled; tick++) {
      frame = advanceGraphPresentationMotion(frame, 16)
    }

    expect(frame.settled).toBe(true)
    expect(frame.position).toEqual({ x: 100, y: 30, z: -20 })
    expect(frame.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('caps long frames and never emits invalid coordinates', () => {
    const frame = advanceGraphPresentationMotion(
      {
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 24, y: -12, z: 6 },
        target: { x: 500, y: -300, z: 100 }
      },
      60_000
    )

    expect(Object.values(frame.position).every(Number.isFinite)).toBe(true)
    expect(Object.values(frame.velocity).every(Number.isFinite)).toBe(true)
    expect(Math.hypot(frame.position.x, frame.position.y, frame.position.z)).toBeLessThan(100)
  })
})

describe('presentation layout snapshots', () => {
  it('pins hidden physics, then restores exact coordinates and the original pin state', () => {
    const nodes = [
      { id: 'free', x: 10, y: 20, z: 30, vx: 4, vy: 5, vz: 6 },
      { id: 'fixed', x: -5, y: -6, z: -7, fx: -5, fy: -6, fz: -7 }
    ]
    const snapshot = captureGraphPresentationLayout(nodes)

    expect(nodes[0]).toMatchObject({ fx: 10, fy: 20, fz: 30, vx: 0, vy: 0, vz: 0 })
    expect(nodes[1]).toMatchObject({ fx: -5, fy: -6, fz: -7 })

    Object.assign(nodes[0], { x: 99, y: 98, z: 97, fx: 99, fy: 98, fz: 97, vx: 10 })
    Object.assign(nodes[1], { x: 1, y: 2, z: 3, fx: 1, fy: 2, fz: 3 })
    restoreGraphPresentationLayout(nodes, snapshot)

    expect(nodes[0]).toMatchObject({ x: 10, y: 20, z: 30, vx: 0, vy: 0, vz: 0 })
    expect(nodes[0]).not.toHaveProperty('fx')
    expect(nodes[0]).not.toHaveProperty('fy')
    expect(nodes[0]).not.toHaveProperty('fz')
    expect(nodes[1]).toMatchObject({
      x: -5,
      y: -6,
      z: -7,
      fx: -5,
      fy: -6,
      fz: -7,
      vx: 0,
      vy: 0,
      vz: 0
    })
  })
})
