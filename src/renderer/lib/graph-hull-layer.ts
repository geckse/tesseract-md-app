import * as THREE from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'

import { buildGraphEnclosurePointCloud, type GraphEnclosurePoint } from './graph-enclosure'

export type GraphHullId = number | string

export interface GraphHullDefinition {
  id: GraphHullId
  label: string
  color: string
  points: Array<GraphEnclosurePoint & { nodeId: string }>
}

export interface GraphHullUpdateOptions {
  force?: boolean
  movementThreshold?: number
  /** Update only supplied clusters, leaving all other stable entries untouched. */
  partial?: boolean
}

export interface GraphHullCentroid {
  id: GraphHullId
  label: string
  x: number
  y: number
  z: number
}

interface HullEntry {
  group: THREE.Group
  color: string
  positions: Map<string, GraphEnclosurePoint>
  centroid: GraphHullCentroid
}

const HULL_SHELL_OPACITIES = [0.07, 0.045, 0.025] as const
const MUTED_HULL_OPACITY_FACTOR = 0.12

function centroidOf(definition: GraphHullDefinition): GraphHullCentroid {
  let x = 0
  let y = 0
  let z = 0
  for (const point of definition.points) {
    x += point.x
    y += point.y
    z += point.z
  }
  const divisor = Math.max(definition.points.length, 1)
  return {
    id: definition.id,
    label: definition.label,
    x: x / divisor,
    y: y / divisor,
    z: z / divisor
  }
}

function enclosureGeometry(
  definition: GraphHullDefinition,
  scale: number,
  padding: number
): ConvexGeometry {
  const points = buildGraphEnclosurePointCloud(definition.points, scale, padding).map(
    (point) => new THREE.Vector3(point.x, point.y, point.z)
  )
  return new ConvexGeometry(points)
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
}

/**
 * Stable, dirty-cluster-only enclosure layer.
 *
 * Each dirty cluster rebuilds its three exact convex shells. Unchanged
 * clusters keep their GPU objects, so QuickHull stays off the steady-state
 * render path without changing the established enclosure silhouettes.
 */
export class GraphHullLayer {
  readonly group = new THREE.Group()

  private entries = new Map<GraphHullId, HullEntry>()
  private highlightedGroupId: GraphHullId | null = null

  constructor() {
    this.group.name = 'clusterEnclosures'
  }

  get size(): number {
    return this.entries.size
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  /** Emphasize one legend-selected hull without rebuilding any geometry. */
  setHighlightedGroup(groupId: GraphHullId | null): void {
    this.highlightedGroupId = groupId
    for (const [id, entry] of this.entries) this.applyEntryEmphasis(id, entry)
  }

  centroids(): GraphHullCentroid[] {
    return [...this.entries.values()].map((entry) => entry.centroid)
  }

  update(definitions: GraphHullDefinition[], options: GraphHullUpdateOptions = {}): number {
    if (!options.partial) {
      const desiredIds = new Set(definitions.map((definition) => definition.id))
      for (const [id, entry] of this.entries) {
        if (desiredIds.has(id)) continue
        this.group.remove(entry.group)
        disposeObject(entry.group)
        this.entries.delete(id)
      }
    }

    let rebuilt = 0
    const movementThreshold = options.movementThreshold ?? 6
    for (const definition of definitions) {
      if (definition.points.length === 0) continue
      const existing = this.entries.get(definition.id)
      const nextCentroid = centroidOf(definition)
      let dirty = options.force || !existing || existing.positions.size !== definition.points.length

      if (existing) {
        // Labels follow sub-threshold movement without forcing new geometry.
        // Keep the position baseline unchanged so movement still accumulates
        // until it reaches the dirty-cluster rebuild threshold.
        Object.assign(existing.centroid, nextCentroid)
        if (existing.color !== definition.color) {
          const color = new THREE.Color(definition.color)
          existing.group.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
              child.material.color.copy(color)
            }
          })
          existing.color = definition.color
        }
      }

      if (!dirty && existing) {
        for (const point of definition.points) {
          const previous = existing.positions.get(point.nodeId)
          if (
            !previous ||
            Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) >=
              movementThreshold
          ) {
            dirty = true
            break
          }
        }
      }

      if (!dirty && existing) continue
      if (existing) {
        this.group.remove(existing.group)
        disposeObject(existing.group)
      }

      const entry = this.buildEntry(definition, nextCentroid)
      this.entries.set(definition.id, entry)
      this.group.add(entry.group)
      this.applyEntryEmphasis(definition.id, entry)
      rebuilt++
    }
    return rebuilt
  }

  clear(): void {
    for (const entry of this.entries.values()) disposeObject(entry.group)
    this.entries.clear()
    this.group.clear()
  }

  dispose(): void {
    this.clear()
    this.group.removeFromParent()
  }

  private buildEntry(
    definition: GraphHullDefinition,
    centroid = centroidOf(definition)
  ): HullEntry {
    // Preserve the original renderer's exact silhouette for every shell.
    // Additive padding can change the convex topology (especially for sparse,
    // coplanar, or uneven clusters), so cloning the outer hull and scaling it
    // is not geometrically equivalent. Dirty-cluster caching keeps these three
    // QuickHull calls off the steady-state render path.
    const coreGeometry = enclosureGeometry(definition, 0.5, 5)
    const middleGeometry = enclosureGeometry(definition, 0.9, 10)
    const outerGeometry = enclosureGeometry(definition, 1, 25)

    const color = new THREE.Color(definition.color)
    const group = new THREE.Group()
    group.name = `clusterEnclosure:${definition.id}`
    const shells = [
      { geometry: coreGeometry, opacity: HULL_SHELL_OPACITIES[0] },
      { geometry: middleGeometry, opacity: HULL_SHELL_OPACITIES[1] },
      { geometry: outerGeometry, opacity: HULL_SHELL_OPACITIES[2] }
    ]
    for (const shell of shells) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: shell.opacity,
        side: THREE.BackSide,
        depthWrite: false
      })
      group.add(new THREE.Mesh(shell.geometry, material))
    }

    return {
      group,
      color: definition.color,
      positions: new Map(
        definition.points.map((point) => [point.nodeId, { x: point.x, y: point.y, z: point.z }])
      ),
      centroid
    }
  }

  private applyEntryEmphasis(id: GraphHullId, entry: HullEntry): void {
    const factor =
      this.highlightedGroupId === null || this.highlightedGroupId === id
        ? 1
        : MUTED_HULL_OPACITY_FACTOR
    entry.group.children.forEach((child, index) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = (HULL_SHELL_OPACITIES[index] ?? 0) * factor
      }
    })
  }
}
