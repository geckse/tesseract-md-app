import * as THREE from 'three'

import type { Graph3DData, Graph3DLink, Graph3DNode } from './graph-3d-bridge'

export interface GraphSpatialVisibility {
  nodeVisible(node: Graph3DNode): boolean
  linkVisible(link: Graph3DLink): boolean
}

export interface GraphSpatialPickerStats {
  cells: number
  visibleNodes: number
  visibleLinks: number
  linkReferences: number
  rebuilds: number
  linkRebuilds: number
  storageGrowths: number
  lastNodeCandidates: number
  lastLinkCandidates: number
  lastRadiusCandidates: number
}

const EMPTY_DATA: Graph3DData = { nodes: [], links: [] }
const ALL_VISIBLE: GraphSpatialVisibility = {
  nodeVisible: () => true,
  linkVisible: () => true
}
const MIN_CELL_SIZE = 4
const GRID_PADDING = 16
const TARGET_NODE_OCCUPANCY = 6
const MAX_GRID_AXIS = 48
const INITIAL_LINK_REFERENCE_CAPACITY = 256
const STAMP_LIMIT = 0xffff_fffe
const GRID_EPSILON = 1e-6

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0
}

/** Must stay congruent with the radius used by GraphBatchedLayer's instances. */
export function graphPickNodeRadius(node: Graph3DNode): number {
  return Math.max(0.8, Math.cbrt(Math.max(node.val, 0.001)) * 2)
}

function nextCapacity(required: number, current: number): number {
  let capacity = Math.max(current, INITIAL_LINK_REFERENCE_CAPACITY)
  while (capacity < required) capacity *= 2
  return capacity
}

/**
 * Allocation-conscious broad phase for the batched global graph.
 *
 * Layout snapshots move essentially every node, which makes an incrementally
 * maintained tree expensive. A flat uniform grid is rebuilt in O(V + E*k),
 * where k is the number of cells crossed by a link. Its typed buffers are
 * retained between snapshots, so steady-state rebuilds allocate no objects.
 * Exact ray/sphere and ray/segment tests run only for candidates in cells near
 * the ray.
 */
export class GraphSpatialPicker {
  readonly stats: GraphSpatialPickerStats = {
    cells: 0,
    visibleNodes: 0,
    visibleLinks: 0,
    linkReferences: 0,
    rebuilds: 0,
    linkRebuilds: 0,
    storageGrowths: 0,
    lastNodeCandidates: 0,
    lastLinkCandidates: 0,
    lastRadiusCandidates: 0
  }

  private data: Graph3DData = EMPTY_DATA
  private visibility: GraphSpatialVisibility = ALL_VISIBLE
  private nodeDirty = false
  private linkDirty = false
  private linkSourceIndices = new Int32Array(0)
  private linkTargetIndices = new Int32Array(0)
  private nodeVisibility = new Uint8Array(0)
  private linkVisibility = new Uint8Array(0)
  private nodeRadii = new Float64Array(0)

  private nodeHeads = new Int32Array(0)
  private linkHeads = new Int32Array(0)
  private nodeNext = new Int32Array(0)
  private linkReferenceLinks = new Int32Array(0)
  private linkReferenceNext = new Int32Array(0)
  private linkReferenceCount = 0

  private nodeMarks = new Uint32Array(0)
  private linkMarks = new Uint32Array(0)
  private cellMarks = new Uint32Array(0)
  private nodeCandidateIndices = new Int32Array(0)
  private linkCandidateIndices = new Int32Array(0)
  private nodeCandidateCount = 0
  private linkCandidateCount = 0
  private queryStamp = 0

  private minX = 0
  private minY = 0
  private minZ = 0
  private maxX = 0
  private maxY = 0
  private maxZ = 0
  private cellsX = 0
  private cellsY = 0
  private cellsZ = 0
  private cellSize = MIN_CELL_SIZE
  private maxNodeRadius = 0

  private rayEntry = 0
  private rayExit = 0
  private readonly segmentStart = new THREE.Vector3()
  private readonly segmentEnd = new THREE.Vector3()
  private readonly pointOnRay = new THREE.Vector3()

  setData(data: Graph3DData): void {
    this.data = data
    const nodeLookup = new Map(data.nodes.map((node, index) => [node.id, index]))

    const nodeCount = data.nodes.length
    const linkCount = data.links.length
    this.linkSourceIndices = new Int32Array(linkCount)
    this.linkTargetIndices = new Int32Array(linkCount)
    for (let index = 0; index < linkCount; index++) {
      this.linkSourceIndices[index] = nodeLookup.get(data.links[index].source) ?? -1
      this.linkTargetIndices[index] = nodeLookup.get(data.links[index].target) ?? -1
    }

    this.nodeVisibility = new Uint8Array(nodeCount)
    this.linkVisibility = new Uint8Array(linkCount)
    this.nodeRadii = new Float64Array(nodeCount)
    this.nodeNext = new Int32Array(nodeCount)
    this.nodeMarks = new Uint32Array(nodeCount)
    this.linkMarks = new Uint32Array(linkCount)
    this.nodeCandidateIndices = new Int32Array(nodeCount)
    this.linkCandidateIndices = new Int32Array(linkCount)
    this.clearGrid()
    this.nodeDirty = true
    this.linkDirty = true
  }

  /**
   * Mark layout coordinates or visual visibility as changed. The O(V + E*k)
   * rebuild is deferred until the next pointer query, so background worker
   * snapshots add only an O(1) invalidation while the pointer is idle.
   */
  invalidate(visibility: GraphSpatialVisibility): void {
    this.visibility = visibility
    this.nodeDirty = true
    this.linkDirty = true
    this.stats.visibleLinks = 0
    this.stats.linkReferences = 0
    this.stats.lastLinkCandidates = 0
  }

  /** Eagerly rebuild, primarily useful for diagnostics and deterministic tests. */
  rebuild(visibility: GraphSpatialVisibility): void {
    this.visibility = visibility
    this.nodeDirty = true
    this.linkDirty = true
    this.ensureNodeGrid()
    this.ensureLinkGrid()
  }

  /**
   * Append every currently visible node inside a world-space sphere to target.
   * Target is cleared and reused; results are never capped.
   */
  collectNodesWithinRadius(
    center: { readonly x: number; readonly y: number; readonly z: number },
    radius: number,
    target: Graph3DNode[]
  ): number {
    this.ensureNodeGrid()
    target.length = 0
    this.stats.lastRadiusCandidates = 0
    if (this.stats.visibleNodes === 0 || this.cellsX === 0) return 0

    const safeRadius = Math.max(0, radius)
    const minX = center.x - safeRadius
    const minY = center.y - safeRadius
    const minZ = center.z - safeRadius
    const maxX = center.x + safeRadius
    const maxY = center.y + safeRadius
    const maxZ = center.z + safeRadius
    if (
      maxX < this.minX ||
      minX > this.maxX ||
      maxY < this.minY ||
      minY > this.maxY ||
      maxZ < this.minZ ||
      minZ > this.maxZ
    ) {
      return 0
    }

    const cellMinX = this.cellCoordinate(minX, this.minX, this.cellsX)
    const cellMinY = this.cellCoordinate(minY, this.minY, this.cellsY)
    const cellMinZ = this.cellCoordinate(minZ, this.minZ, this.cellsZ)
    const cellMaxX = this.cellCoordinate(maxX, this.minX, this.cellsX)
    const cellMaxY = this.cellCoordinate(maxY, this.minY, this.cellsY)
    const cellMaxZ = this.cellCoordinate(maxZ, this.minZ, this.cellsZ)
    const radiusSquared = safeRadius * safeRadius

    for (let z = cellMinZ; z <= cellMaxZ; z++) {
      for (let y = cellMinY; y <= cellMaxY; y++) {
        for (let x = cellMinX; x <= cellMaxX; x++) {
          const cell = x + this.cellsX * (y + this.cellsY * z)
          for (let index = this.nodeHeads[cell]; index >= 0; index = this.nodeNext[index]) {
            this.stats.lastRadiusCandidates++
            if (this.nodeVisibility[index] === 0) continue
            const node = this.data.nodes[index]
            const dx = center.x - finiteCoordinate(node.x)
            const dy = center.y - finiteCoordinate(node.y)
            const dz = center.z - finiteCoordinate(node.z)
            if (dx * dx + dy * dy + dz * dz <= radiusSquared) target.push(node)
          }
        }
      }
    }
    return target.length
  }

  private ensureNodeGrid(): void {
    if (!this.nodeDirty) return
    this.nodeDirty = false
    this.linkDirty = true
    this.stats.rebuilds++
    const nodes = this.data.nodes
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let visibleNodes = 0
    let maxNodeRadius = 0

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      const visible = this.visibility.nodeVisible(node)
      this.nodeVisibility[index] = visible ? 1 : 0
      const radius = graphPickNodeRadius(node)
      this.nodeRadii[index] = radius
      const x = finiteCoordinate(node.x)
      const y = finiteCoordinate(node.y)
      const z = finiteCoordinate(node.z)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
      if (!visible) continue
      visibleNodes++
      maxNodeRadius = Math.max(maxNodeRadius, radius)
    }

    this.stats.visibleNodes = visibleNodes
    this.stats.visibleLinks = 0
    this.stats.linkReferences = 0
    this.stats.lastNodeCandidates = 0
    this.stats.lastLinkCandidates = 0
    this.stats.lastRadiusCandidates = 0
    this.maxNodeRadius = maxNodeRadius

    if (nodes.length === 0) {
      this.resetGridStats()
      return
    }

    const spanX = Math.max(0, maxX - minX)
    const spanY = Math.max(0, maxY - minY)
    const spanZ = Math.max(0, maxZ - minZ)
    const longestSpan = Math.max(spanX, spanY, spanZ)
    const targetAxis = Math.min(
      MAX_GRID_AXIS,
      Math.max(4, Math.cbrt(Math.max(1, nodes.length) / TARGET_NODE_OCCUPANCY))
    )
    this.cellSize = Math.max(
      MIN_CELL_SIZE,
      maxNodeRadius,
      longestSpan > GRID_EPSILON ? longestSpan / targetAxis : MIN_CELL_SIZE
    )

    const padding = Math.max(GRID_PADDING, maxNodeRadius) + GRID_EPSILON
    this.minX = minX - padding
    this.minY = minY - padding
    this.minZ = minZ - padding
    this.cellsX = Math.max(1, Math.ceil((spanX + padding * 2) / this.cellSize))
    this.cellsY = Math.max(1, Math.ceil((spanY + padding * 2) / this.cellSize))
    this.cellsZ = Math.max(1, Math.ceil((spanZ + padding * 2) / this.cellSize))
    this.maxX = this.minX + this.cellsX * this.cellSize
    this.maxY = this.minY + this.cellsY * this.cellSize
    this.maxZ = this.minZ + this.cellsZ * this.cellSize

    const cellCount = this.cellsX * this.cellsY * this.cellsZ
    if (this.nodeHeads.length < cellCount) {
      const capacity = nextCapacity(cellCount, this.nodeHeads.length)
      this.nodeHeads = new Int32Array(capacity)
      this.linkHeads = new Int32Array(capacity)
      this.cellMarks = new Uint32Array(capacity)
      this.stats.storageGrowths++
    }
    this.nodeHeads.fill(-1, 0, cellCount)
    this.linkReferenceCount = 0

    for (let index = 0; index < nodes.length; index++) {
      if (this.nodeVisibility[index] === 0) continue
      const node = nodes[index]
      const cell = this.cellIndexForPosition(
        finiteCoordinate(node.x),
        finiteCoordinate(node.y),
        finiteCoordinate(node.z)
      )
      this.nodeNext[index] = this.nodeHeads[cell]
      this.nodeHeads[cell] = index
    }

    this.stats.cells = cellCount
  }

  private ensureLinkGrid(): void {
    this.ensureNodeGrid()
    if (!this.linkDirty) return
    this.linkDirty = false
    this.stats.linkRebuilds++
    const links = this.data.links
    const nodes = this.data.nodes
    const cellCount = this.cellsX * this.cellsY * this.cellsZ
    this.linkReferenceCount = 0
    this.stats.lastLinkCandidates = 0
    if (cellCount === 0) {
      this.stats.visibleLinks = 0
      this.stats.linkReferences = 0
      return
    }
    this.linkHeads.fill(-1, 0, cellCount)

    let visibleLinks = 0
    for (let index = 0; index < links.length; index++) {
      const sourceIndex = this.linkSourceIndices[index]
      const targetIndex = this.linkTargetIndices[index]
      const visible =
        sourceIndex >= 0 && targetIndex >= 0 && this.visibility.linkVisible(links[index])
      this.linkVisibility[index] = visible ? 1 : 0
      if (!visible) continue

      visibleLinks++
      const source = nodes[sourceIndex]
      const target = nodes[targetIndex]
      this.insertLinkIntoGrid(
        index,
        finiteCoordinate(source.x),
        finiteCoordinate(source.y),
        finiteCoordinate(source.z),
        finiteCoordinate(target.x),
        finiteCoordinate(target.y),
        finiteCoordinate(target.z)
      )
    }
    this.stats.visibleLinks = visibleLinks
    this.stats.linkReferences = this.linkReferenceCount
  }

  pickNode(raycaster: THREE.Raycaster): Graph3DNode | null {
    this.ensureNodeGrid()
    if (this.stats.visibleNodes === 0 || !this.collectNodeCandidates(raycaster.ray)) {
      this.stats.lastNodeCandidates = 0
      return null
    }

    this.stats.lastNodeCandidates = this.nodeCandidateCount
    const ray = raycaster.ray
    const directionLengthSquared = ray.direction.lengthSq()
    if (directionLengthSquared <= Number.EPSILON) return null

    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let item = 0; item < this.nodeCandidateCount; item++) {
      const index = this.nodeCandidateIndices[item]
      if (this.nodeVisibility[index] === 0) continue
      const node = this.data.nodes[index]
      const dx = ray.origin.x - finiteCoordinate(node.x)
      const dy = ray.origin.y - finiteCoordinate(node.y)
      const dz = ray.origin.z - finiteCoordinate(node.z)
      const halfB = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z
      const radius = this.nodeRadii[index]
      const discriminant =
        halfB * halfB - directionLengthSquared * (dx * dx + dy * dy + dz * dz - radius * radius)
      if (discriminant < 0) continue

      const root = Math.sqrt(discriminant)
      let distance = (-halfB - root) / directionLengthSquared
      if (distance < 0) distance = (-halfB + root) / directionLengthSquared
      if (distance < 0 || distance >= nearestDistance) continue
      nearestDistance = distance
      nearestIndex = index
    }

    return nearestIndex < 0 ? null : this.data.nodes[nearestIndex]
  }

  pickLink(raycaster: THREE.Raycaster): Graph3DLink | null {
    this.ensureLinkGrid()
    const threshold = Math.max(0, raycaster.params.Line?.threshold ?? 1)
    if (this.stats.visibleLinks === 0 || !this.collectLinkCandidates(raycaster.ray, threshold)) {
      this.stats.lastLinkCandidates = 0
      return null
    }

    this.stats.lastLinkCandidates = this.linkCandidateCount
    const ray = raycaster.ray
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    let nearestDistanceSquared = Number.POSITIVE_INFINITY
    const thresholdSquared = threshold * threshold

    for (let item = 0; item < this.linkCandidateCount; item++) {
      const index = this.linkCandidateIndices[item]
      if (this.linkVisibility[index] === 0) continue
      const source = this.data.nodes[this.linkSourceIndices[index]]
      const target = this.data.nodes[this.linkTargetIndices[index]]
      this.segmentStart.set(
        finiteCoordinate(source.x),
        finiteCoordinate(source.y),
        finiteCoordinate(source.z)
      )
      this.segmentEnd.set(
        finiteCoordinate(target.x),
        finiteCoordinate(target.y),
        finiteCoordinate(target.z)
      )
      const distanceSquared = ray.distanceSqToSegment(
        this.segmentStart,
        this.segmentEnd,
        this.pointOnRay
      )
      if (distanceSquared > thresholdSquared) continue

      const distance = this.pointOnRay.distanceToSquared(ray.origin)
      if (
        distance > nearestDistance ||
        (distance === nearestDistance && distanceSquared >= nearestDistanceSquared)
      ) {
        continue
      }
      nearestDistance = distance
      nearestDistanceSquared = distanceSquared
      nearestIndex = index
    }

    return nearestIndex < 0 ? null : this.data.links[nearestIndex]
  }

  clear(): void {
    this.data = EMPTY_DATA
    this.visibility = ALL_VISIBLE
    this.nodeDirty = false
    this.linkDirty = false
    this.linkSourceIndices = new Int32Array(0)
    this.linkTargetIndices = new Int32Array(0)
    this.nodeVisibility = new Uint8Array(0)
    this.linkVisibility = new Uint8Array(0)
    this.nodeRadii = new Float64Array(0)
    this.nodeNext = new Int32Array(0)
    this.nodeMarks = new Uint32Array(0)
    this.linkMarks = new Uint32Array(0)
    this.nodeCandidateIndices = new Int32Array(0)
    this.linkCandidateIndices = new Int32Array(0)
    this.clearGrid()
  }

  private clearGrid(): void {
    this.nodeHeads = new Int32Array(0)
    this.linkHeads = new Int32Array(0)
    this.cellMarks = new Uint32Array(0)
    this.linkReferenceCount = 0
    this.resetGridStats()
  }

  private resetGridStats(): void {
    this.cellsX = 0
    this.cellsY = 0
    this.cellsZ = 0
    this.stats.cells = 0
    this.stats.linkReferences = 0
    this.stats.visibleNodes = 0
    this.stats.visibleLinks = 0
    this.stats.lastNodeCandidates = 0
    this.stats.lastLinkCandidates = 0
    this.stats.lastRadiusCandidates = 0
  }

  private cellIndexForPosition(x: number, y: number, z: number): number {
    const cellX = this.cellCoordinate(x, this.minX, this.cellsX)
    const cellY = this.cellCoordinate(y, this.minY, this.cellsY)
    const cellZ = this.cellCoordinate(z, this.minZ, this.cellsZ)
    return cellX + this.cellsX * (cellY + this.cellsY * cellZ)
  }

  private cellCoordinate(value: number, minimum: number, cells: number): number {
    return Math.min(cells - 1, Math.max(0, Math.floor((value - minimum) / this.cellSize)))
  }

  private insertLinkIntoGrid(
    linkIndex: number,
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number
  ): void {
    let cellX = Math.min(this.cellsX - 1, Math.max(0, Math.floor((sx - this.minX) / this.cellSize)))
    let cellY = Math.min(this.cellsY - 1, Math.max(0, Math.floor((sy - this.minY) / this.cellSize)))
    let cellZ = Math.min(this.cellsZ - 1, Math.max(0, Math.floor((sz - this.minZ) / this.cellSize)))
    const targetX = Math.min(
      this.cellsX - 1,
      Math.max(0, Math.floor((tx - this.minX) / this.cellSize))
    )
    const targetY = Math.min(
      this.cellsY - 1,
      Math.max(0, Math.floor((ty - this.minY) / this.cellSize))
    )
    const targetZ = Math.min(
      this.cellsZ - 1,
      Math.max(0, Math.floor((tz - this.minZ) / this.cellSize))
    )
    const dx = tx - sx
    const dy = ty - sy
    const dz = tz - sz
    const stepX = Math.sign(dx)
    const stepY = Math.sign(dy)
    const stepZ = Math.sign(dz)
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(dx)
    const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(dy)
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(dz)
    let nextX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : (this.minX + (cellX + (stepX > 0 ? 1 : 0)) * this.cellSize - sx) / dx
    let nextY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : (this.minY + (cellY + (stepY > 0 ? 1 : 0)) * this.cellSize - sy) / dy
    let nextZ =
      stepZ === 0
        ? Number.POSITIVE_INFINITY
        : (this.minZ + (cellZ + (stepZ > 0 ? 1 : 0)) * this.cellSize - sz) / dz

    const maxSteps = this.cellsX + this.cellsY + this.cellsZ + 3
    for (let step = 0; step < maxSteps; step++) {
      this.appendLinkReference(cellX + this.cellsX * (cellY + this.cellsY * cellZ), linkIndex)
      if (cellX === targetX && cellY === targetY && cellZ === targetZ) return

      if (nextX <= nextY && nextX <= nextZ) {
        cellX += stepX
        nextX += deltaX
      } else if (nextY <= nextZ) {
        cellY += stepY
        nextY += deltaY
      } else {
        cellZ += stepZ
        nextZ += deltaZ
      }

      if (
        cellX < 0 ||
        cellX >= this.cellsX ||
        cellY < 0 ||
        cellY >= this.cellsY ||
        cellZ < 0 ||
        cellZ >= this.cellsZ
      ) {
        return
      }
    }
  }

  private appendLinkReference(cell: number, linkIndex: number): void {
    const required = this.linkReferenceCount + 1
    if (required > this.linkReferenceLinks.length) {
      const capacity = nextCapacity(required, this.linkReferenceLinks.length)
      const links = new Int32Array(capacity)
      const next = new Int32Array(capacity)
      links.set(this.linkReferenceLinks)
      next.set(this.linkReferenceNext)
      this.linkReferenceLinks = links
      this.linkReferenceNext = next
      this.stats.storageGrowths++
    }
    const reference = this.linkReferenceCount++
    this.linkReferenceLinks[reference] = linkIndex
    this.linkReferenceNext[reference] = this.linkHeads[cell]
    this.linkHeads[cell] = reference
  }

  private collectNodeCandidates(ray: THREE.Ray): boolean {
    this.nodeCandidateCount = 0
    if (!this.intersectGrid(ray)) return false
    const stamp = this.nextQueryStamp()
    const neighborCells = Math.ceil(this.maxNodeRadius / this.cellSize) + 1
    this.walkRayCells(ray, neighborCells, stamp, true)
    return this.nodeCandidateCount > 0
  }

  private collectLinkCandidates(ray: THREE.Ray, threshold: number): boolean {
    this.linkCandidateCount = 0
    // The normal UI threshold is two world units. Preserve correctness for an
    // unusually large caller-provided threshold even though it cannot benefit
    // from the grid's fixed empty-space padding.
    if (threshold > GRID_PADDING) {
      for (let index = 0; index < this.data.links.length; index++) {
        if (this.linkVisibility[index] !== 0) {
          this.linkCandidateIndices[this.linkCandidateCount++] = index
        }
      }
      return this.linkCandidateCount > 0
    }
    if (!this.intersectGrid(ray)) return false
    const stamp = this.nextQueryStamp()
    const neighborCells = Math.ceil(threshold / this.cellSize) + 1
    this.walkRayCells(ray, neighborCells, stamp, false)
    return this.linkCandidateCount > 0
  }

  private intersectGrid(ray: THREE.Ray): boolean {
    this.rayEntry = 0
    this.rayExit = Number.POSITIVE_INFINITY
    if (!this.intersectGridAxis(ray.origin.x, ray.direction.x, this.minX, this.maxX)) {
      return false
    }
    if (!this.intersectGridAxis(ray.origin.y, ray.direction.y, this.minY, this.maxY)) {
      return false
    }
    if (!this.intersectGridAxis(ray.origin.z, ray.direction.z, this.minZ, this.maxZ)) {
      return false
    }
    if (this.rayExit < 0) return false
    this.rayEntry = Math.max(0, this.rayEntry)
    return true
  }

  private intersectGridAxis(
    origin: number,
    direction: number,
    minimum: number,
    maximum: number
  ): boolean {
    if (Math.abs(direction) <= Number.EPSILON) {
      return origin >= minimum && origin <= maximum
    }
    let near = (minimum - origin) / direction
    let far = (maximum - origin) / direction
    if (near > far) {
      const swap = near
      near = far
      far = swap
    }
    this.rayEntry = Math.max(this.rayEntry, near)
    this.rayExit = Math.min(this.rayExit, far)
    return this.rayExit >= this.rayEntry
  }

  private walkRayCells(ray: THREE.Ray, neighborCells: number, stamp: number, nodes: boolean): void {
    const startDistance = Math.min(this.rayExit, this.rayEntry + GRID_EPSILON)
    const startX = ray.origin.x + ray.direction.x * startDistance
    const startY = ray.origin.y + ray.direction.y * startDistance
    const startZ = ray.origin.z + ray.direction.z * startDistance
    let cellX = Math.min(
      this.cellsX - 1,
      Math.max(0, Math.floor((startX - this.minX) / this.cellSize))
    )
    let cellY = Math.min(
      this.cellsY - 1,
      Math.max(0, Math.floor((startY - this.minY) / this.cellSize))
    )
    let cellZ = Math.min(
      this.cellsZ - 1,
      Math.max(0, Math.floor((startZ - this.minZ) / this.cellSize))
    )
    const stepX = Math.sign(ray.direction.x)
    const stepY = Math.sign(ray.direction.y)
    const stepZ = Math.sign(ray.direction.z)
    const deltaX =
      stepX === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(ray.direction.x)
    const deltaY =
      stepY === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(ray.direction.y)
    const deltaZ =
      stepZ === 0 ? Number.POSITIVE_INFINITY : this.cellSize / Math.abs(ray.direction.z)
    let nextX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : startDistance +
          (this.minX + (cellX + (stepX > 0 ? 1 : 0)) * this.cellSize - startX) / ray.direction.x
    let nextY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : startDistance +
          (this.minY + (cellY + (stepY > 0 ? 1 : 0)) * this.cellSize - startY) / ray.direction.y
    let nextZ =
      stepZ === 0
        ? Number.POSITIVE_INFINITY
        : startDistance +
          (this.minZ + (cellZ + (stepZ > 0 ? 1 : 0)) * this.cellSize - startZ) / ray.direction.z

    const maxSteps = this.cellsX + this.cellsY + this.cellsZ + 3
    for (let step = 0; step < maxSteps; step++) {
      this.collectCellNeighborhood(cellX, cellY, cellZ, neighborCells, stamp, nodes)
      const nextDistance = Math.min(nextX, nextY, nextZ)
      if (nextDistance > this.rayExit) return

      if (nextX <= nextY && nextX <= nextZ) {
        cellX += stepX
        nextX += deltaX
      } else if (nextY <= nextZ) {
        cellY += stepY
        nextY += deltaY
      } else {
        cellZ += stepZ
        nextZ += deltaZ
      }
      if (
        cellX < 0 ||
        cellX >= this.cellsX ||
        cellY < 0 ||
        cellY >= this.cellsY ||
        cellZ < 0 ||
        cellZ >= this.cellsZ
      ) {
        return
      }
    }
  }

  private collectCellNeighborhood(
    centerX: number,
    centerY: number,
    centerZ: number,
    radius: number,
    stamp: number,
    nodes: boolean
  ): void {
    const minX = Math.max(0, centerX - radius)
    const maxX = Math.min(this.cellsX - 1, centerX + radius)
    const minY = Math.max(0, centerY - radius)
    const maxY = Math.min(this.cellsY - 1, centerY + radius)
    const minZ = Math.max(0, centerZ - radius)
    const maxZ = Math.min(this.cellsZ - 1, centerZ + radius)

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const cell = x + this.cellsX * (y + this.cellsY * z)
          if (this.cellMarks[cell] === stamp) continue
          this.cellMarks[cell] = stamp
          if (nodes) this.collectNodesInCell(cell, stamp)
          else this.collectLinksInCell(cell, stamp)
        }
      }
    }
  }

  private collectNodesInCell(cell: number, stamp: number): void {
    for (let index = this.nodeHeads[cell]; index >= 0; index = this.nodeNext[index]) {
      if (this.nodeMarks[index] === stamp) continue
      this.nodeMarks[index] = stamp
      this.nodeCandidateIndices[this.nodeCandidateCount++] = index
    }
  }

  private collectLinksInCell(cell: number, stamp: number): void {
    for (
      let reference = this.linkHeads[cell];
      reference >= 0;
      reference = this.linkReferenceNext[reference]
    ) {
      const index = this.linkReferenceLinks[reference]
      if (this.linkMarks[index] === stamp) continue
      this.linkMarks[index] = stamp
      this.linkCandidateIndices[this.linkCandidateCount++] = index
    }
  }

  private nextQueryStamp(): number {
    if (this.queryStamp >= STAMP_LIMIT) {
      this.queryStamp = 0
      this.nodeMarks.fill(0)
      this.linkMarks.fill(0)
      this.cellMarks.fill(0)
    }
    this.queryStamp++
    return this.queryStamp
  }
}
