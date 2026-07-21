import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'

import {
  GraphHullLayer,
  type GraphHullDefinition,
  type GraphHullId
} from '@renderer/lib/graph-hull-layer'
import { buildGraphEnclosurePointCloud } from '@renderer/lib/graph-enclosure'

function cluster(id: GraphHullId, offset = 0): GraphHullDefinition {
  return {
    id,
    label: `Cluster ${id}`,
    color: id === 1 ? '#ff0000' : '#00ff00',
    points: [
      { nodeId: `${id}:a`, x: offset, y: 0, z: 0 },
      { nodeId: `${id}:b`, x: offset + 20, y: 0, z: 0 },
      { nodeId: `${id}:c`, x: offset, y: 20, z: 0 },
      { nodeId: `${id}:d`, x: offset, y: 0, z: 20 }
    ]
  }
}

describe('GraphHullLayer', () => {
  it('keeps unchanged cluster meshes and rebuilds only dirty clusters', () => {
    const layer = new GraphHullLayer()
    expect(layer.update([cluster(1), cluster(2, 100)])).toBe(2)
    expect(layer.group.children).toHaveLength(2)
    const first = layer.group.children[0]

    expect(layer.update([cluster(1), cluster(2, 100)])).toBe(0)
    expect(layer.group.children[0]).toBe(first)

    const moved = cluster(2, 100)
    moved.points[0].x += 10
    expect(layer.update([cluster(1), moved])).toBe(1)
    expect(layer.group.children[0]).toBe(first)
    layer.dispose()
  })

  it('derives all three shells from one stable cluster entry', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster(1)])

    const entry = layer.group.children[0]
    expect(entry.children).toHaveLength(3)
    expect(layer.centroids()).toEqual([{ id: 1, label: 'Cluster 1', x: 5, y: 5, z: 5 }])
    layer.dispose()
  })

  it('matches the original independently-built convex shells for sparse clusters', () => {
    const layer = new GraphHullLayer()
    const sparse: GraphHullDefinition = {
      id: 7,
      label: 'Sparse',
      color: '#22cc88',
      points: [{ nodeId: 'only', x: 12, y: -4, z: 8 }]
    }
    layer.update([sparse])

    const entry = layer.group.children[0] as THREE.Group
    const specifications = [
      { scale: 0.5, padding: 5, opacity: 0.07 },
      { scale: 0.9, padding: 10, opacity: 0.045 },
      { scale: 1, padding: 25, opacity: 0.025 }
    ]
    specifications.forEach(({ scale, padding, opacity }, index) => {
      const expected = new ConvexGeometry(
        buildGraphEnclosurePointCloud(sparse.points, scale, padding).map(
          (point) => new THREE.Vector3(point.x, point.y, point.z)
        )
      )
      const actual = (entry.children[index] as THREE.Mesh).geometry
      expected.computeBoundingSphere()
      actual.computeBoundingSphere()
      expect(actual.getAttribute('position').count).toBe(expected.getAttribute('position').count)
      expect(actual.boundingSphere?.radius).toBeCloseTo(expected.boundingSphere?.radius ?? 0)

      const material = (entry.children[index] as THREE.Mesh).material as THREE.MeshBasicMaterial
      expect(material.opacity).toBe(opacity)
      expect(material.side).toBe(THREE.BackSide)
      expect(material.depthWrite).toBe(false)
      expected.dispose()
    })
    layer.dispose()
  })

  it('removes clusters that are no longer visible during presentation', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster(1), cluster(2, 100)])
    expect(layer.update([cluster(2, 100)])).toBe(0)
    expect(layer.size).toBe(1)
    expect(layer.group.children[0].name).toBe('clusterEnclosure:2')
    layer.dispose()
  })

  it('supports forced exact rebuilds for simulation stop and screenshots', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster(1)])
    expect(layer.update([cluster(1)], { force: true })).toBe(1)
    layer.dispose()
  })

  it('emphasizes a selected legend group without rebuilding hull geometry', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster(1), cluster(2, 100)])
    const first = layer.group.getObjectByName('clusterEnclosure:1') as THREE.Group
    const second = layer.group.getObjectByName('clusterEnclosure:2') as THREE.Group

    layer.setHighlightedGroup(2)

    expect(
      ((first.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity
    ).toBeCloseTo(0.07 * 0.12)
    expect(
      ((second.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity
    ).toBeCloseTo(0.07)
    expect(layer.group.getObjectByName('clusterEnclosure:1')).toBe(first)
    expect(layer.group.getObjectByName('clusterEnclosure:2')).toBe(second)

    layer.setHighlightedGroup(null)
    expect(
      ((first.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity
    ).toBeCloseTo(0.07)
    layer.dispose()
  })

  it('supports named folder hulls and legend emphasis', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster('docs'), cluster('(root)', 100)])

    expect(layer.centroids().map((centroid) => centroid.id)).toEqual(['docs', '(root)'])
    const docs = layer.group.getObjectByName('clusterEnclosure:docs') as THREE.Group
    const root = layer.group.getObjectByName('clusterEnclosure:(root)') as THREE.Group

    layer.setHighlightedGroup('docs')
    expect(
      ((docs.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity
    ).toBeCloseTo(0.07)
    expect(
      ((root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity
    ).toBeCloseTo(0.07 * 0.12)
    layer.dispose()
  })

  it('updates labels without rebuilding unchanged hull geometry', () => {
    const layer = new GraphHullLayer()
    const definition = cluster(1)
    layer.update([definition])
    const object = layer.group.children[0]

    expect(layer.update([{ ...definition, label: 'Renamed cluster' }])).toBe(0)
    expect(layer.group.children[0]).toBe(object)
    expect(layer.centroids()[0].label).toBe('Renamed cluster')
    layer.dispose()
  })

  it('updates label centroids for sub-threshold movement without rebuilding geometry', () => {
    const layer = new GraphHullLayer()
    const definition = cluster(1)
    layer.update([definition])
    const object = layer.group.children[0]
    definition.points[0].x += 1

    expect(layer.update([definition], { movementThreshold: 6 })).toBe(0)
    expect(layer.group.children[0]).toBe(object)
    expect(layer.centroids()[0].x).toBeCloseTo(5.25)
    layer.dispose()
  })

  it('supports presentation updates for only the affected cluster', () => {
    const layer = new GraphHullLayer()
    layer.update([cluster(1), cluster(2, 100)])
    const second = layer.group.getObjectByName('clusterEnclosure:2')
    const moved = cluster(1)
    moved.points[0].x += 12

    expect(layer.update([moved], { partial: true })).toBe(1)
    expect(layer.size).toBe(2)
    expect(layer.group.getObjectByName('clusterEnclosure:2')).toBe(second)
    layer.dispose()
  })
})
