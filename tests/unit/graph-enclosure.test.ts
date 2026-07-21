import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Vector3 } from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'

import {
  buildGraphEnclosurePointCloud,
  hasNonCoplanarGraphPoints
} from '@renderer/lib/graph-enclosure'

describe('hasNonCoplanarGraphPoints', () => {
  it('distinguishes volumetric points from a planar polygon', () => {
    expect(
      hasNonCoplanarGraphPoints([
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 10, z: 0 },
        { x: 0, y: 0, z: 10 }
      ])
    ).toBe(true)
    expect(
      hasNonCoplanarGraphPoints([
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
        { x: 0, y: 10, z: 0 }
      ])
    ).toBe(false)
  })
})

describe('buildGraphEnclosurePointCloud', () => {
  it('turns a single revealed node into a finite faceted tetrahedron', () => {
    const cloud = buildGraphEnclosurePointCloud([{ x: 5, y: -2, z: 7 }], 1, 10)

    expect(cloud).toHaveLength(4)
    expect(hasNonCoplanarGraphPoints(cloud)).toBe(true)
    expect(cloud.flatMap((point) => [point.x, point.y, point.z]).every(Number.isFinite)).toBe(true)
    expect(
      Math.max(...cloud.map((point) => Math.hypot(point.x - 5, point.y + 2, point.z - 7)))
    ).toBeLessThan(10)
  })

  it('creates a volumetric, elongated enclosure for a two-node connection', () => {
    const cloud = buildGraphEnclosurePointCloud(
      [
        { x: -20, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 }
      ],
      1,
      8
    )
    const xExtent =
      Math.max(...cloud.map((point) => point.x)) - Math.min(...cloud.map((point) => point.x))
    const yExtent =
      Math.max(...cloud.map((point) => point.y)) - Math.min(...cloud.map((point) => point.y))

    expect(cloud).toHaveLength(8)
    expect(hasNonCoplanarGraphPoints(cloud)).toBe(true)
    expect(xExtent).toBeGreaterThan(yExtent)
  })

  it('keeps an already volumetric cluster on the normal radial hull path', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
      { x: 0, y: 20, z: 0 },
      { x: 0, y: 0, z: 20 }
    ]
    const cloud = buildGraphEnclosurePointCloud(points, 1, 5)

    expect(cloud).toHaveLength(points.length)
    expect(hasNonCoplanarGraphPoints(cloud)).toBe(true)
  })

  it('handles duplicate, coplanar, and invalid input without an unbounded hull', () => {
    const points = Array.from({ length: 100 }, (_value, index) => ({
      x: index,
      y: index % 7,
      z: 0
    }))
    points.push({ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 0 })

    const cloud = buildGraphEnclosurePointCloud(points, 1, 12)

    expect(cloud.length).toBeGreaterThanOrEqual(4)
    expect(cloud.length).toBeLessThanOrEqual(256)
    expect(hasNonCoplanarGraphPoints(cloud)).toBe(true)
    expect(cloud.flatMap((point) => [point.x, point.y, point.z]).every(Number.isFinite)).toBe(true)
  })

  it('constructs valid Three.js geometry for sparse and degenerate reveal steps', () => {
    const groups = [
      [{ x: 0, y: 0, z: 0 }],
      [
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 10, z: 0 }
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
        { x: 0, y: 10, z: 0 }
      ]
    ]

    for (const group of groups) {
      const geometry = new ConvexGeometry(
        buildGraphEnclosurePointCloud(group, 1, 10).map(
          (point) => new Vector3(point.x, point.y, point.z)
        )
      )
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
      geometry.dispose()
    }
  })
})

describe('GraphView enclosure integration', () => {
  it('routes normal and presentation shells through the stable hull layer', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/renderer/components/GraphView.svelte'),
      'utf8'
    )
    const start = source.indexOf('function updateClusterSpheres(')
    const end = source.indexOf('function projectToScreen', start)
    const enclosureBuilder = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(enclosureBuilder).toContain('visiblePresentationNodes(allNodes)')
    expect(enclosureBuilder).toContain('clusterHullLayer.update')
    expect(enclosureBuilder).not.toContain('SphereGeometry')
    expect(source).toContain("from '../lib/graph-hull-layer'")
  })
})
