import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  GraphSpatialPicker,
  graphPickNodeRadius,
  type GraphSpatialVisibility
} from '@renderer/lib/graph-spatial-picker'
import type { Graph3DData, Graph3DLink, Graph3DNode } from '@renderer/lib/graph-3d-bridge'

const VISIBLE: GraphSpatialVisibility = {
  nodeVisible: () => true,
  linkVisible: () => true
}

function node(id: string, x: number, y: number, z: number, val = 1): Graph3DNode {
  return {
    id,
    path: `${id}.md`,
    label: null,
    cluster_id: null,
    custom_cluster_id: null,
    custom_cluster_ids: [],
    custom_cluster_scores: [],
    chunk_index: null,
    size: null,
    val,
    color: '#ffffff',
    x,
    y,
    z
  }
}

function link(source: string, target: string): Graph3DLink {
  return {
    source,
    target,
    relationship_type: 'references',
    strength: 1,
    context_text: null,
    edge_cluster_id: null,
    field: null,
    color: '#ffffff',
    width: 1
  }
}

function raycaster(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  lineThreshold = 2
): THREE.Raycaster {
  const picker = new THREE.Raycaster(origin, direction.normalize())
  picker.params.Line = { threshold: lineThreshold }
  return picker
}

describe('GraphSpatialPicker', () => {
  it('returns the nearest visible node using the same radius as the batched spheres', () => {
    const data: Graph3DData = {
      nodes: [node('near', 0, 0, 10), node('far', 0, 0, 30), node('aside', 8, 0, 5)],
      links: []
    }
    const picker = new GraphSpatialPicker()
    picker.setData(data)
    picker.rebuild(VISIBLE)

    expect(graphPickNodeRadius(data.nodes[0])).toBe(2)
    expect(
      picker.pickNode(raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)))?.id
    ).toBe('near')
  })

  it('rebuilds visibility without retaining hidden node or link candidates', () => {
    const data: Graph3DData = {
      nodes: [node('a', 0, 0, 10), node('b', 0, 0, 20)],
      links: [link('a', 'b')]
    }
    const picker = new GraphSpatialPicker()
    picker.setData(data)
    picker.rebuild({
      nodeVisible: (item) => item.id !== 'a',
      linkVisible: () => false
    })
    const ray = raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1))

    expect(picker.pickNode(ray)?.id).toBe('b')
    expect(picker.pickLink(ray)).toBeNull()
    expect(picker.stats.visibleNodes).toBe(1)
    expect(picker.stats.visibleLinks).toBe(0)

    picker.rebuild({
      nodeVisible: () => true,
      linkVisible: () => true
    })
    expect(picker.pickNode(ray)?.id).toBe('a')
    expect(picker.pickLink(ray)).toBe(data.links[0])
  })

  it('finds the closest link near the ray and rejects segments outside the line threshold', () => {
    const data: Graph3DData = {
      nodes: [
        node('near-a', 1, -5, 10),
        node('near-b', 1, 5, 10),
        node('far-a', 5, -5, 6),
        node('far-b', 5, 5, 6)
      ],
      links: [link('far-a', 'far-b'), link('near-a', 'near-b')]
    }
    const picker = new GraphSpatialPicker()
    picker.setData(data)
    picker.rebuild(VISIBLE)

    expect(
      picker.pickLink(raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 2))
    ).toBe(data.links[1])
    expect(
      picker.pickLink(raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 0.5))
    ).toBeNull()
  })

  it('reuses broad-phase storage while worker snapshots move nodes', () => {
    const data: Graph3DData = {
      nodes: [node('a', -10, 0, 10), node('b', 10, 0, 10)],
      links: [link('a', 'b')]
    }
    const picker = new GraphSpatialPicker()
    picker.setData(data)
    picker.rebuild(VISIBLE)
    const storageGrowths = picker.stats.storageGrowths

    data.nodes[0].x = -11
    data.nodes[1].x = 11
    data.nodes[0].z = 20
    data.nodes[1].z = 20
    const rebuilds = picker.stats.rebuilds
    picker.invalidate(VISIBLE)

    expect(picker.stats.storageGrowths).toBe(storageGrowths)
    expect(picker.stats.rebuilds).toBe(rebuilds)
    expect(picker.pickLink(raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)))).toBe(
      data.links[0]
    )
    expect(picker.stats.rebuilds).toBe(rebuilds + 1)
    expect(picker.stats.storageGrowths).toBe(storageGrowths)
  })

  it('collects every visible node inside the radius, including its exact boundary', () => {
    const data: Graph3DData = {
      nodes: [
        node('center', 0, 0, 0),
        node('inside', 349.9, 0, 0),
        node('boundary', 0, -350, 0),
        node('outside', 0, 0, 350.01),
        node('hidden', 1, 1, 1)
      ],
      links: []
    }
    const picker = new GraphSpatialPicker()
    picker.setData(data)
    picker.invalidate({
      nodeVisible: (item) => item.id !== 'hidden',
      linkVisible: () => true
    })
    const result = [node('stale', 0, 0, 0)]

    expect(picker.collectNodesWithinRadius(new THREE.Vector3(), 350, result)).toBe(3)
    expect(new Set(result.map((item) => item.id))).toEqual(
      new Set(['center', 'inside', 'boundary'])
    )
  })

  it('does not rebuild or evaluate links for a node-radius query', () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => node(`${index}`, index * 2, 0, 0))
    const links = nodes.slice(1).map((item, index) => link(nodes[index].id, item.id))
    let linkVisibilityCalls = 0
    const picker = new GraphSpatialPicker()
    picker.setData({ nodes, links })
    picker.invalidate({
      nodeVisible: () => true,
      linkVisible: () => {
        linkVisibilityCalls++
        return true
      }
    })
    const nearby: Graph3DNode[] = []

    picker.collectNodesWithinRadius({ x: 1_000, y: 0, z: 0 }, 350, nearby)

    expect(nearby).toHaveLength(351)
    expect(picker.stats.lastRadiusCandidates).toBeLessThan(nodes.length)
    expect(linkVisibilityCalls).toBe(0)
    expect(picker.stats.linkRebuilds).toBe(0)
    expect(picker.stats.linkReferences).toBe(0)

    picker.pickLink(raycaster(new THREE.Vector3(1_000, 0, -10), new THREE.Vector3(0, 0, 1)))
    expect(linkVisibilityCalls).toBe(links.length)
    expect(picker.stats.linkRebuilds).toBe(1)
    expect(picker.stats.linkReferences).toBeGreaterThan(0)
  })

  it('limits exact tests to a small subset on a 9k-node graph', () => {
    const nodes: Graph3DNode[] = []
    const links: Graph3DLink[] = []
    const sizeX = 30
    const sizeY = 20
    const sizeZ = 15
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          const id = `${x}:${y}:${z}`
          nodes.push(node(id, x * 10, y * 10, z * 10))
          if (x > 0) links.push(link(`${x - 1}:${y}:${z}`, id))
        }
      }
    }
    const picker = new GraphSpatialPicker()
    picker.setData({ nodes, links })
    picker.rebuild(VISIBLE)

    const ray = raycaster(new THREE.Vector3(0, 0, -30), new THREE.Vector3(0, 0, 1), 2)
    expect(picker.pickNode(ray)?.id).toBe('0:0:0')
    expect(picker.pickLink(ray)).not.toBeNull()

    expect(nodes).toHaveLength(9_000)
    expect(picker.stats.lastNodeCandidates).toBeLessThan(nodes.length / 4)
    expect(picker.stats.lastLinkCandidates).toBeLessThan(links.length / 4)
    // The retained broad-phase data stays proportional to topology rather
    // than expanding to an all-pairs or per-frame object representation.
    expect(picker.stats.linkReferences).toBeLessThan(links.length * 8)
  })
})
