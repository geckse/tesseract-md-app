import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { GraphBatchedLayer } from '@renderer/lib/graph-batched-layer'
import type { Graph3DData } from '@renderer/lib/graph-3d-bridge'

function fixture(): Graph3DData {
  return {
    nodes: [
      {
        id: 'a',
        path: 'a.md',
        label: null,
        cluster_id: 1,
        custom_cluster_id: null,
        custom_cluster_ids: [],
        custom_cluster_scores: [],
        chunk_index: null,
        size: null,
        val: 8,
        color: '#ff0000',
        x: 1,
        y: 2,
        z: 3
      },
      {
        id: 'b',
        path: 'b.md',
        label: null,
        cluster_id: 1,
        custom_cluster_id: null,
        custom_cluster_ids: [],
        custom_cluster_scores: [],
        chunk_index: null,
        size: null,
        val: 1,
        color: '#00ff00',
        x: 11,
        y: 12,
        z: 13
      }
    ],
    links: [
      {
        source: 'a',
        target: 'b',
        relationship_type: 'references',
        strength: 0.8,
        context_text: null,
        edge_cluster_id: 2,
        field: null,
        color: '#00aaff',
        width: 1
      }
    ]
  }
}

describe('GraphBatchedLayer', () => {
  it('packs a graph into a constant number of shared drawables', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())

    expect(layer.stats).toEqual({ nodes: 2, links: 1, drawables: 4 })
    expect(layer.group.getObjectByName('graphNodes')).toBeInstanceOf(THREE.InstancedMesh)
    expect(layer.group.getObjectByName('graphLinks')).toBeInstanceOf(THREE.Mesh)
    expect(layer.group.getObjectByName('graphArrows')).toBeInstanceOf(THREE.InstancedMesh)

    layer.dispose()
  })

  it('renders per-link widths in CSS pixels and updates viewport resolution in place', () => {
    const data = fixture()
    data.links[0].width = 0.5
    data.links.push({ ...data.links[0], source: 'b', target: 'a', width: 3 })
    const layer = new GraphBatchedLayer()
    layer.setViewport(800, 600)
    layer.setData(data)

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >
    const widths = links.geometry.getAttribute('instanceWidth') as THREE.BufferAttribute
    const opacities = links.geometry.getAttribute('instanceOpacity') as THREE.BufferAttribute
    expect([widths.getX(0), widths.getX(1)]).toEqual([1, 3])
    expect(opacities.getX(0)).toBeGreaterThan(0)
    expect(links.material.uniforms.resolution.value.toArray()).toEqual([800, 600])

    layer.setViewport(1234, 567)
    expect(links.material.uniforms.resolution.value.toArray()).toEqual([1234, 567])
    expect(layer.stats.drawables).toBe(4)
    layer.dispose()
  })

  it('packs clamped directional reveal progress without changing graph geometry', () => {
    const data = fixture()
    data.links.push(
      { ...data.links[0], source: 'b', target: 'a' },
      { ...data.links[0] },
      { ...data.links[0], source: 'b', target: 'a' }
    )
    const layer = new GraphBatchedLayer()
    layer.setData(data, {
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkVisible: () => true,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => true
    })

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >
    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const arrows = layer.group.getObjectByName('graphArrows') as THREE.InstancedMesh
    const reveals = links.geometry.getAttribute('instanceReveal') as THREE.BufferAttribute
    const revealDirections = links.geometry.getAttribute(
      'instanceRevealDirection'
    ) as THREE.BufferAttribute
    expect(Array.from((reveals.array as Float32Array).slice(0, 4))).toEqual([1, 1, 1, 1])
    expect(Array.from((revealDirections.array as Float32Array).slice(0, 4))).toEqual([1, 1, 1, 1])

    const endpoints = (
      links.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    ).data
    const endpointArray = endpoints.array
    const nodeMatrixArray = nodes.instanceMatrix.array
    const arrowMatrixArray = arrows.instanceMatrix.array
    const endpointsBefore = Array.from(endpointArray)
    const nodeMatricesBefore = Array.from(nodeMatrixArray)
    const arrowMatricesBefore = Array.from(arrowMatrixArray)
    const progress = new Map([
      [data.links[0], -0.5],
      [data.links[1], 0.35],
      [data.links[2], 1.5],
      [data.links[3], Number.NaN]
    ])
    const directions = new Map([
      [data.links[0], 1],
      [data.links[1], -1],
      [data.links[2], -9],
      [data.links[3], Number.NaN]
    ])

    layer.updateVisuals({
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkReveal: (link) => progress.get(link) ?? 1,
      linkRevealDirection: (link) => directions.get(link) as 1 | -1,
      linkVisible: () => true,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => true
    })

    expect(reveals.getX(0)).toBe(0)
    expect(reveals.getX(1)).toBeCloseTo(0.35)
    expect(reveals.getX(2)).toBe(1)
    expect(reveals.getX(3)).toBe(1)
    expect(Array.from((revealDirections.array as Float32Array).slice(0, 4))).toEqual([1, -1, -1, 1])
    expect(links.material.vertexShader).toContain('attribute float instanceReveal;')
    expect(links.material.fragmentShader).toContain('if (progress <= 0.0) discard;')
    expect(links.material.fragmentShader).toContain('if (progress < 1.0)')
    expect(links.material.fragmentShader).toContain(
      'vLinkRevealDirection < 0.0 ? 1.0 - vLinkAlong : vLinkAlong'
    )

    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphArrows')).toBe(arrows)
    expect(layer.stats.drawables).toBe(4)
    expect(endpoints.array).toBe(endpointArray)
    expect(nodes.instanceMatrix.array).toBe(nodeMatrixArray)
    expect(arrows.instanceMatrix.array).toBe(arrowMatrixArray)
    expect(Array.from(endpoints.array)).toEqual(endpointsBefore)
    expect(Array.from(nodes.instanceMatrix.array)).toEqual(nodeMatricesBefore)
    expect(Array.from(arrows.instanceMatrix.array)).toEqual(arrowMatricesBefore)
    layer.dispose()
  })

  it('updates reveal attributes for incident links through the partial visual path', () => {
    const data = fixture()
    data.nodes.push({
      ...data.nodes[1],
      id: 'c',
      path: 'c.md',
      x: 21,
      y: 22,
      z: 23
    })
    data.links.push({ ...data.links[0], source: 'b', target: 'c' })
    const layer = new GraphBatchedLayer()
    layer.setData(data)

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >
    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const arrows = layer.group.getObjectByName('graphArrows') as THREE.InstancedMesh
    const reveals = links.geometry.getAttribute('instanceReveal') as THREE.InstancedBufferAttribute
    const revealDirections = links.geometry.getAttribute(
      'instanceRevealDirection'
    ) as THREE.InstancedBufferAttribute
    reveals.clearUpdateRanges()
    revealDirections.clearUpdateRanges()
    const endpoints = (
      links.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    ).data
    const endpointsBefore = Array.from(endpoints.array)
    const nodeMatricesBefore = Array.from(nodes.instanceMatrix.array)
    const arrowMatricesBefore = Array.from(arrows.instanceMatrix.array)

    layer.updateVisualsForNodes(['a'], {
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkReveal: (link) => (link === data.links[0] ? 0.42 : 0.75),
      linkRevealDirection: () => -1,
      linkVisible: () => true,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => true
    })

    expect(reveals.getX(0)).toBeCloseTo(0.42)
    expect(reveals.getX(1)).toBe(1)
    expect(revealDirections.getX(0)).toBe(-1)
    expect(revealDirections.getX(1)).toBe(1)
    expect(reveals.updateRanges).toEqual([{ start: 0, count: 1 }])
    expect(revealDirections.updateRanges).toEqual([{ start: 0, count: 1 }])
    expect(Array.from(endpoints.array)).toEqual(endpointsBefore)
    expect(Array.from(nodes.instanceMatrix.array)).toEqual(nodeMatricesBefore)
    expect(Array.from(arrows.instanceMatrix.array)).toEqual(arrowMatricesBefore)
    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphArrows')).toBe(arrows)
    expect(layer.stats.drawables).toBe(4)
    layer.dispose()
  })

  it('uses instance colors without multiplying them by a missing vertex-color attribute', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())

    for (const name of ['graphNodes', 'graphNodeHalos', 'graphArrows']) {
      const mesh = layer.group.getObjectByName(name) as THREE.InstancedMesh
      const material = mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial
      expect(mesh.geometry.hasAttribute('color')).toBe(false)
      expect(material.vertexColors).toBe(false)
    }

    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const first = new THREE.Color()
    const second = new THREE.Color()
    nodes.getColorAt(0, first)
    nodes.getColorAt(1, second)
    expect(first.getHex()).toBe(new THREE.Color('#ff0000').getHex())
    expect(second.getHex()).toBe(new THREE.Color('#00ff00').getHex())
    expect(first.getHex()).not.toBe(second.getHex())

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >
    expect(links.geometry.hasAttribute('instanceColor')).toBe(true)
    expect(links.geometry.hasAttribute('instanceOpacity')).toBe(true)
    expect(links.geometry.hasAttribute('instanceWidth')).toBe(true)
    expect(links.material).toBeInstanceOf(THREE.ShaderMaterial)
    layer.dispose()
  })

  it('preserves distinct idle edge colors across in-place palette refreshes', () => {
    const data = fixture()
    data.links.push({
      ...data.links[0],
      source: 'b',
      target: 'a',
      color: '#ff00aa'
    })
    const layer = new GraphBatchedLayer()
    layer.setData(data)
    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh

    const assertInstanceColor = (instance: number, expected: string) => {
      const colors = links.geometry.getAttribute('instanceColor') as THREE.BufferAttribute
      const color = new THREE.Color(expected)
      expect(colors.getX(instance)).toBeCloseTo(color.r)
      expect(colors.getY(instance)).toBeCloseTo(color.g)
      expect(colors.getZ(instance)).toBeCloseTo(color.b)
    }
    assertInstanceColor(0, '#00aaff')
    assertInstanceColor(1, '#ff00aa')

    const refreshedColors = new Map([
      [data.links[0], '#ffaa00'],
      [data.links[1], '#7755ff']
    ])
    layer.updateVisuals({
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => refreshedColors.get(link) ?? link.color,
      linkOpacity: () => 0.15,
      linkWidth: (link) => link.width,
      linkVisible: () => true,
      arrowColor: (link) => refreshedColors.get(link) ?? link.color,
      arrowOpacity: () => 0.45,
      arrowVisible: () => true
    })

    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    expect(layer.stats.drawables).toBe(4)
    assertInstanceColor(0, '#ffaa00')
    assertInstanceColor(1, '#7755ff')
    layer.dispose()
  })

  it('updates shared node and link buffers from mutable layout positions', () => {
    const data = fixture()
    const layer = new GraphBatchedLayer()
    layer.setData(data)
    data.nodes[0].x = 7
    data.nodes[0].y = 8
    data.nodes[0].z = 9
    layer.syncPositions()

    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    nodes.getMatrixAt(0, matrix)
    matrix.decompose(position, rotation, scale)
    expect(position.toArray()).toEqual([7, 8, 9])

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const linkStarts = links.geometry.getAttribute('instanceStart') as THREE.BufferAttribute
    const linkEnds = links.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute
    expect([linkStarts.getX(0), linkStarts.getY(0), linkStarts.getZ(0)]).toEqual([7, 8, 9])
    expect([linkEnds.getX(0), linkEnds.getY(0), linkEnds.getZ(0)]).toEqual([11, 12, 13])

    layer.dispose()
  })

  it('can throttle expensive arrow transforms while keeping nodes and lines current', () => {
    const data = fixture()
    const layer = new GraphBatchedLayer()
    layer.setData(data)
    const arrows = layer.group.getObjectByName('graphArrows') as THREE.InstancedMesh
    const before = new THREE.Matrix4()
    const throttled = new THREE.Matrix4()
    const refreshed = new THREE.Matrix4()
    arrows.getMatrixAt(0, before)

    data.nodes[1].x = 30
    data.nodes[1].y = -10
    layer.syncPositions(false)
    arrows.getMatrixAt(0, throttled)
    expect(throttled.toArray()).toEqual(before.toArray())
    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const ends = links.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute
    expect([ends.getX(0), ends.getY(0)]).toEqual([30, -10])

    layer.syncPositions(true)
    arrows.getMatrixAt(0, refreshed)
    expect(refreshed.toArray()).not.toEqual(before.toArray())
    layer.dispose()
  })

  it('uploads worker-packed link endpoints without a per-link renderer walk', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture(), {
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkVisible: () => true,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => false
    })
    expect(layer.hasVisibleArrows).toBe(false)

    layer.syncPositions(true, new Float32Array([4, 5, 6, 40, 50, 60]))
    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const starts = links.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    expect(Array.from((starts.array as Float32Array).slice(0, 6))).toEqual([4, 5, 6, 40, 50, 60])
    layer.dispose()
  })

  it('keeps full node uploads from being narrowed by drag-only update ranges', () => {
    const data = fixture()
    const layer = new GraphBatchedLayer()
    layer.setData(data)
    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const halos = layer.group.getObjectByName('graphNodeHalos') as THREE.InstancedMesh
    // Simulate Three consuming the initial full upload before the gesture.
    nodes.instanceMatrix.clearUpdateRanges()
    halos.instanceMatrix.clearUpdateRanges()

    data.nodes[0].x = 7
    layer.syncNodePositionsById(['a'])
    expect(nodes.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])
    expect(halos.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])

    data.nodes[1].x = 70
    layer.syncPositions(false, new Float32Array([1, 2, 3, 70, 12, 13]))
    expect(nodes.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }])
    expect(halos.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }])
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    nodes.getMatrixAt(1, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBe(70)

    // Correcting the protected node's packed edge endpoint must remain
    // link-only, otherwise it would narrow the pending full matrix upload.
    data.nodes[0].x = 8
    layer.syncIncidentLinkPositionsByNodeIds(['a'])
    expect(nodes.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }])
    expect(halos.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }])
    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const starts = links.geometry.getAttribute('instanceStart') as THREE.BufferAttribute
    const ends = links.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute
    expect(starts.getX(0)).toBe(8)
    expect(ends.getX(0)).toBe(70)
    layer.dispose()
  })

  it('reuses GPU drawables when an incremental patch keeps cardinality stable', () => {
    const layer = new GraphBatchedLayer()
    const data = fixture()
    layer.setData(data)
    const nodes = layer.group.getObjectByName('graphNodes')
    const links = layer.group.getObjectByName('graphLinks')
    const updated = fixture()
    updated.nodes[0].x = 25

    expect(layer.replaceData(updated)).toBe(true)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    layer.dispose()
  })

  it('reuses capacity-managed drawables while active node and link counts grow and shrink', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())
    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const halos = layer.group.getObjectByName('graphNodeHalos') as THREE.InstancedMesh
    const links = layer.group.getObjectByName(
      'graphLinks'
    ) as THREE.Mesh<THREE.InstancedBufferGeometry>
    const arrows = layer.group.getObjectByName('graphArrows') as THREE.InstancedMesh

    const expanded = fixture()
    expanded.nodes.push({
      ...expanded.nodes[1],
      id: 'c',
      path: 'c.md',
      x: 21,
      y: 22,
      z: 23
    })
    expanded.links.push({
      ...expanded.links[0],
      source: 'b',
      target: 'c'
    })

    expect(layer.replaceData(expanded)).toBe(true)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphNodeHalos')).toBe(halos)
    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    expect(layer.group.getObjectByName('graphArrows')).toBe(arrows)
    expect(layer.stats).toEqual({ nodes: 3, links: 2, drawables: 4 })
    expect(nodes.count).toBe(3)
    expect(halos.count).toBe(3)
    expect(arrows.count).toBe(2)
    expect(links.geometry.instanceCount).toBe(2)

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    nodes.getMatrixAt(2, matrix)
    matrix.decompose(position, rotation, scale)
    expect(position.toArray()).toEqual([21, 22, 23])
    const linkStarts = links.geometry.getAttribute('instanceStart') as THREE.BufferAttribute
    const linkEnds = links.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute
    expect([linkStarts.getX(1), linkEnds.getX(1)]).toEqual([11, 21])

    const reduced: Graph3DData = { nodes: expanded.nodes.slice(0, 1), links: [] }
    expect(layer.replaceData(reduced)).toBe(true)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphNodeHalos')).toBe(halos)
    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    expect(layer.group.getObjectByName('graphArrows')).toBe(arrows)
    expect(layer.stats).toEqual({ nodes: 1, links: 0, drawables: 4 })
    expect(nodes.count).toBe(1)
    expect(halos.count).toBe(1)
    expect(arrows.count).toBe(0)
    expect(links.geometry.instanceCount).toBe(0)

    layer.dispose()
  })

  it('applies visibility through instance and segment buffers without rebuilding topology', () => {
    const layer = new GraphBatchedLayer()
    const data = fixture()
    layer.setData(data)
    layer.updateVisuals({
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: (node) => node.id !== 'b',
      nodeHalo: (node) => node.id === 'a',
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkVisible: () => false,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => false
    })

    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    nodes.getMatrixAt(1, matrix)
    matrix.decompose(position, rotation, scale)
    expect(Math.max(...scale.toArray())).toBeLessThan(1e-5)

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const starts = links.geometry.getAttribute('instanceStart') as THREE.BufferAttribute
    const ends = links.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute
    expect([starts.getX(0), starts.getY(0), starts.getZ(0)]).toEqual([
      ends.getX(0),
      ends.getY(0),
      ends.getZ(0)
    ])

    layer.dispose()
  })

  it('reveals a presentation batch without rebuilding shared drawables', () => {
    const layer = new GraphBatchedLayer()
    const data = fixture()
    const visible = new Set<string>()
    const state = {
      nodeColor: (node: (typeof data.nodes)[number]) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: (node: (typeof data.nodes)[number]) => visible.has(node.id),
      nodeHalo: () => false,
      linkColor: (link: (typeof data.links)[number]) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link: (typeof data.links)[number]) => link.width,
      linkVisible: (link: (typeof data.links)[number]) =>
        visible.has(link.source) && visible.has(link.target),
      arrowColor: (link: (typeof data.links)[number]) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: (link: (typeof data.links)[number]) =>
        visible.has(link.source) && visible.has(link.target)
    }
    layer.setData(data, state)
    const nodes = layer.group.getObjectByName('graphNodes')
    const links = layer.group.getObjectByName('graphLinks')

    visible.add('a')
    layer.updateVisualsForNodes(['a'], state)
    const nodeMesh = nodes as THREE.InstancedMesh
    const nodeAlpha = nodeMesh.geometry.getAttribute('graphOpacity') as THREE.BufferAttribute
    expect(nodeAlpha.getX(0)).toBe(1)
    expect(nodeAlpha.getX(1)).toBe(0)

    visible.add('b')
    layer.updateVisualsForNodes(['b'], state)
    const lineAlpha = (links as THREE.Mesh).geometry.getAttribute(
      'instanceOpacity'
    ) as THREE.BufferAttribute
    expect(lineAlpha.getX(0)).toBe(1)
    expect(layer.group.getObjectByName('graphNodes')).toBe(nodes)
    expect(layer.group.getObjectByName('graphLinks')).toBe(links)
    layer.dispose()
  })

  it('uses a single point batch for selected-edge presentation particles', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())
    layer.setParticleLinks('a')

    expect(layer.group.getObjectByName('graphParticles')).toBeInstanceOf(THREE.Points)
    expect(layer.stats.drawables).toBe(5)
    expect(layer.hasActiveParticles).toBe(true)
    layer.advanceParticles(0.1)

    layer.setLinesVisible(false)
    expect(layer.hasActiveParticles).toBe(false)

    layer.dispose()
  })

  it('stores true per-instance and per-link alpha without darkening RGB colors', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())
    layer.updateVisuals({
      nodeColor: () => '#ff0000',
      nodeOpacity: () => 0.1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: () => 'rgba(0, 170, 255, 0.2)',
      linkOpacity: () => 0.5,
      linkWidth: () => 0.5,
      linkVisible: () => true,
      arrowColor: () => '#00aaff',
      arrowOpacity: () => 0.45,
      arrowVisible: () => true
    })

    const nodes = layer.group.getObjectByName('graphNodes') as THREE.InstancedMesh
    const nodeAlpha = nodes.geometry.getAttribute('graphOpacity') as THREE.BufferAttribute
    const color = new THREE.Color()
    nodes.getColorAt(0, color)
    expect(color.r).toBeCloseTo(1)
    expect(nodeAlpha.getX(0)).toBeCloseTo(0.1)

    const links = layer.group.getObjectByName('graphLinks') as THREE.Mesh
    const linkAlpha = links.geometry.getAttribute('instanceOpacity') as THREE.BufferAttribute
    const linkColor = links.geometry.getAttribute('instanceColor') as THREE.BufferAttribute
    const expectedLinkColor = new THREE.Color().setStyle('rgb(0, 170, 255)')
    expect(linkAlpha.getX(0)).toBeCloseTo(0.1)
    expect(linkAlpha.getX(0)).toBeGreaterThan(0)
    expect(linkColor.getX(0)).toBeCloseTo(expectedLinkColor.r)
    expect(linkColor.getY(0)).toBeCloseTo(expectedLinkColor.g)
    expect(linkColor.getZ(0)).toBeCloseTo(expectedLinkColor.b)

    const arrows = layer.group.getObjectByName('graphArrows') as THREE.InstancedMesh
    const arrowAlpha = arrows.geometry.getAttribute('graphOpacity') as THREE.BufferAttribute
    expect(arrowAlpha.getX(0)).toBeCloseTo(0.45)
    layer.dispose()
  })

  it('collects visible nodes in a world-space radius through the spatial index', () => {
    const data = fixture()
    const layer = new GraphBatchedLayer()
    layer.setData(data)
    const nearby = [data.nodes[1]]

    expect(layer.collectNodesWithinRadius(new THREE.Vector3(1, 2, 3), 2, nearby)).toBe(1)
    expect(nearby).toEqual([data.nodes[0]])

    layer.updateVisuals({
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: (node) => node.id !== 'a',
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkVisible: () => true,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => true
    })
    expect(layer.collectNodesWithinRadius(new THREE.Vector3(1, 2, 3), 2, nearby)).toBe(0)
    expect(nearby).toEqual([])
    layer.dispose()
  })

  it('preserves particle phase across layout snapshots and omits hidden links', () => {
    const layer = new GraphBatchedLayer()
    layer.setData(fixture())
    layer.setParticleLinks('a')
    layer.advanceParticles(0.2)
    const particles = layer.group.getObjectByName('graphParticles') as THREE.Points
    const before = (particles.geometry.getAttribute('position') as THREE.BufferAttribute).getX(0)
    layer.syncPositions()
    const after = (particles.geometry.getAttribute('position') as THREE.BufferAttribute).getX(0)
    expect(after).toBeCloseTo(before)

    layer.updateVisuals({
      nodeColor: (node) => node.color,
      nodeOpacity: () => 1,
      nodeVisible: () => true,
      nodeHalo: () => false,
      linkColor: (link) => link.color,
      linkOpacity: () => 1,
      linkWidth: (link) => link.width,
      linkVisible: () => false,
      arrowColor: (link) => link.color,
      arrowOpacity: () => 1,
      arrowVisible: () => false
    })
    expect(layer.group.getObjectByName('graphParticles')).toBeUndefined()
    layer.dispose()
  })
})
