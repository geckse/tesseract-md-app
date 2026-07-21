import * as THREE from 'three'

import type { Graph3DData, Graph3DLink, Graph3DNode } from './graph-3d-bridge'
import { GraphSpatialPicker, graphPickNodeRadius } from './graph-spatial-picker'

export interface GraphBatchedVisualState {
  nodeColor(node: Graph3DNode): string
  nodeOpacity(node: Graph3DNode): number
  nodeVisible(node: Graph3DNode): boolean
  nodeHalo(node: Graph3DNode): boolean
  linkColor(link: Graph3DLink): string
  linkOpacity(link: Graph3DLink): number
  linkWidth?(link: Graph3DLink): number
  /** Progressive semantic-line reveal. Omitted states remain fully rendered. */
  linkReveal?(link: Graph3DLink): number
  /** Positive reveals source -> target; negative reveals target -> source. */
  linkRevealDirection?(link: Graph3DLink): 1 | -1
  linkVisible(link: Graph3DLink): boolean
  arrowColor(link: Graph3DLink): string
  arrowOpacity(link: Graph3DLink): number
  arrowVisible(link: Graph3DLink): boolean
}

export interface GraphBatchedLayerStats {
  nodes: number
  links: number
  drawables: number
}

const DEFAULT_VISUAL_STATE: GraphBatchedVisualState = {
  nodeColor: (node) => node.color,
  nodeOpacity: () => 1,
  nodeVisible: () => true,
  nodeHalo: () => false,
  linkColor: (link) => link.color,
  linkOpacity: () => 1,
  linkWidth: (link) => link.width,
  linkReveal: () => 1,
  linkRevealDirection: () => 1,
  linkVisible: () => true,
  arrowColor: (link) => link.color,
  arrowOpacity: () => 1,
  arrowVisible: () => true
}

const UNIT_Y = new THREE.Vector3(0, 1, 0)
const HIDDEN_SCALE = 1e-6
const MIN_BUFFER_CAPACITY = 8
const BUFFER_GROWTH_FACTOR = 1.5

/**
 * Leave geometric headroom so small topology patches do not churn GPU objects.
 * The 1.5x series keeps the worst-case slack below a power-of-two allocator's
 * while still making repeated growth logarithmic.
 */
function graphBufferCapacity(required: number): number {
  if (required <= 0) return 0
  let capacity = MIN_BUFFER_CAPACITY
  while (capacity < required) capacity = Math.ceil(capacity * BUFFER_GROWTH_FACTOR)
  return capacity
}

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0
}

/** Mark an explicit active range so a later partial write cannot narrow a full GPU upload. */
function markFullAttributeUpdate(
  attribute:
    | THREE.BufferAttribute
    | THREE.InstancedBufferAttribute
    | THREE.InterleavedBuffer
    | null
    | undefined,
  componentCount: number
): void {
  if (!attribute) return
  attribute.clearUpdateRanges()
  if (componentCount > 0) attribute.addUpdateRange(0, componentCount)
  attribute.needsUpdate = true
}

function renderedLinkWidth(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1
}

function renderedLinkReveal(value: number | undefined): number {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value as number, 0, 1) : 1
}

function renderedLinkRevealDirection(value: number | undefined): 1 | -1 {
  return Number.isFinite(value) && (value as number) < 0 ? -1 : 1
}

interface ParsedStyleColor {
  color: THREE.Color
  alpha: number
}

function parseStyleColor(style: string, opacity = 1): ParsedStyleColor {
  const rgba = style.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*(?:\.\d+)?))?\s*\)$/i
  )
  let color: THREE.Color
  let sourceAlpha = 1
  if (rgba) {
    color = new THREE.Color().setRGB(
      Number(rgba[1]) / 255,
      Number(rgba[2]) / 255,
      Number(rgba[3]) / 255,
      THREE.SRGBColorSpace
    )
    if (rgba[4] !== undefined && rgba[4] !== '') sourceAlpha = Number(rgba[4])
  } else {
    color = new THREE.Color()
    try {
      color.setStyle(style)
    } catch {
      color.set('#ffffff')
    }
  }

  return {
    color,
    alpha: THREE.MathUtils.clamp(opacity * sourceAlpha, 0, 1)
  }
}

/** Add a per-instance/per-vertex alpha attribute while retaining Three's material pipeline. */
function configureGraphOpacity(material: THREE.Material, cacheKey: string): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <color_pars_vertex>',
        '#include <color_pars_vertex>\nattribute float graphOpacity;\nvarying float vGraphOpacity;'
      )
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGraphOpacity = graphOpacity;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_pars_fragment>',
        '#include <color_pars_fragment>\nvarying float vGraphOpacity;'
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * vGraphOpacity );'
      )
  }
  material.customProgramCacheKey = () => `tesseract-graph-opacity-${cacheKey}`
}

const WIDE_LINK_VERTEX_SHADER = /* glsl */ `
  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute vec3 instanceColor;
  attribute float instanceOpacity;
  attribute float instanceWidth;
  attribute float instanceReveal;
  attribute float instanceRevealDirection;

  uniform vec2 resolution;

  varying vec3 vLinkColor;
  varying float vLinkOpacity;
  varying float vLinkAlong;
  varying float vLinkReveal;
  varying float vLinkRevealDirection;

  void trimSegment(const in vec4 start, inout vec4 end) {
    float a = projectionMatrix[2][2];
    float b = projectionMatrix[3][2];
    float nearEstimate = -0.5 * b / a;
    float alpha = (nearEstimate - start.z) / (end.z - start.z);
    end.xyz = mix(start.xyz, end.xyz, alpha);
  }

  void main() {
    vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
    vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);

    bool perspective = projectionMatrix[2][3] == -1.0;
    if (perspective) {
      if (start.z < 0.0 && end.z >= 0.0) {
        trimSegment(start, end);
      } else if (end.z < 0.0 && start.z >= 0.0) {
        trimSegment(end, start);
      }
    }

    vec4 clipStart = projectionMatrix * start;
    vec4 clipEnd = projectionMatrix * end;
    vec2 safeResolution = max(resolution, vec2(1.0));
    vec2 screenStart = (clipStart.xy / clipStart.w) * safeResolution;
    vec2 screenEnd = (clipEnd.xy / clipEnd.w) * safeResolution;
    vec2 screenDirection = screenEnd - screenStart;
    float screenLength = length(screenDirection);
    vec2 normal = screenLength > 0.0001
      ? vec2(-screenDirection.y, screenDirection.x) / screenLength
      : vec2(0.0, 1.0);

    float along = position.x;
    float side = position.y;
    vec4 clip = mix(clipStart, clipEnd, along);
    vec2 pixelOffset = normal * side * max(instanceWidth, 1.0);
    clip.xy += (pixelOffset * 2.0 / safeResolution) * clip.w;

    gl_Position = clip;
    vLinkColor = instanceColor;
    vLinkOpacity = instanceOpacity;
    vLinkAlong = along;
    vLinkReveal = instanceReveal;
    vLinkRevealDirection = instanceRevealDirection;
  }
`

const WIDE_LINK_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vLinkColor;
  varying float vLinkOpacity;
  varying float vLinkAlong;
  varying float vLinkReveal;
  varying float vLinkRevealDirection;

  void main() {
    if (vLinkOpacity <= 0.0) discard;
    float progress = clamp(vLinkReveal, 0.0, 1.0);
    if (progress <= 0.0) discard;

    float revealAlpha = 1.0;
    if (progress < 1.0) {
      float directedAlong = vLinkRevealDirection < 0.0 ? 1.0 - vLinkAlong : vLinkAlong;
      float feather = min(0.08, min(progress, 1.0 - progress));
      revealAlpha = 1.0 - smoothstep(progress - feather, progress, directedAlong);
      if (revealAlpha <= 0.0) discard;
    }

    gl_FragColor = vec4(vLinkColor, vLinkOpacity * revealAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * A GPU-batched visual layer for the global graph.
 *
 * The force/layout owner mutates Graph3DNode coordinates. This layer packs
 * those coordinates into one instanced node mesh, one instanced halo mesh,
 * one instanced screen-space link mesh, and one instanced arrow mesh. Visual-only changes
 * update instance/buffer attributes in place; topology changes call setData.
 */
export class GraphBatchedLayer {
  readonly group = new THREE.Group()

  private data: Graph3DData = { nodes: [], links: [] }
  private visualState: GraphBatchedVisualState = DEFAULT_VISUAL_STATE
  private nodeIndex = new Map<string, number>()
  private nodeCapacity = 0
  private linkCapacity = 0
  private nodeMesh: THREE.InstancedMesh | null = null
  private haloMesh: THREE.InstancedMesh | null = null
  private linkSegments: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null =
    null
  private arrowMesh: THREE.InstancedMesh | null = null
  private readonly matrixObject = new THREE.Object3D()
  private readonly direction = new THREE.Vector3()
  private readonly sourcePosition = new THREE.Vector3()
  private readonly targetPosition = new THREE.Vector3()
  private particlePoints: THREE.Points | null = null
  private particleLinkIndices: number[] = []
  private particlePhase = 0
  private selectedParticleNodeId: string | null = null
  private nodeVisibility = new Uint8Array()
  private haloVisibility = new Uint8Array()
  private linkVisibility = new Uint8Array()
  private arrowVisibility = new Uint8Array()
  private visibleArrowCount = 0
  private linesEnabled = true
  private readonly spatialPicker = new GraphSpatialPicker()
  private incidentOffsets = new Int32Array()
  private incidentLinks = new Int32Array()
  private linkSourceIndices = new Int32Array()
  private linkTargetIndices = new Int32Array()
  private linkUpdateMarks = new Uint32Array()
  private linkUpdateStamp = 0
  private readonly viewport = new THREE.Vector2(1, 1)

  constructor() {
    this.group.name = 'graphBatchedLayer'
  }

  get stats(): GraphBatchedLayerStats {
    return {
      nodes: this.data.nodes.length,
      links: this.data.links.length,
      drawables: this.group.children.length
    }
  }

  /** Whether the renderer currently has a visible particle batch to animate. */
  get hasActiveParticles(): boolean {
    return this.particlePoints !== null && this.linesEnabled && this.particleLinkIndices.length > 0
  }

  /** Whether any active link currently renders a directional arrow. */
  get hasVisibleArrows(): boolean {
    return this.linesEnabled && this.visibleArrowCount > 0
  }

  /** Keep screen-space edge widths in CSS pixels, independent of DPR and camera zoom. */
  setViewport(width: number, height: number): void {
    this.viewport.set(
      Number.isFinite(width) && width > 0 ? width : 1,
      Number.isFinite(height) && height > 0 ? height : 1
    )
  }

  setData(data: Graph3DData, visualState: GraphBatchedVisualState = this.visualState): void {
    this.disposeDrawables()
    this.data = data
    this.nodeCapacity = graphBufferCapacity(data.nodes.length)
    this.linkCapacity = graphBufferCapacity(data.links.length)
    this.spatialPicker.setData(data)
    this.visualState = visualState
    this.nodeIndex = new Map(data.nodes.map((node, index) => [node.id, index]))
    this.rebuildIncidentIndex()
    this.nodeVisibility = new Uint8Array(this.nodeCapacity)
    this.haloVisibility = new Uint8Array(this.nodeCapacity)
    this.linkVisibility = new Uint8Array(this.linkCapacity)
    this.arrowVisibility = new Uint8Array(this.linkCapacity)

    if (this.nodeCapacity > 0) {
      const sphere = new THREE.SphereGeometry(1, 10, 7)
      sphere.setAttribute(
        'graphOpacity',
        new THREE.InstancedBufferAttribute(new Float32Array(this.nodeCapacity), 1)
      )
      // InstancedMesh.instanceColor activates USE_INSTANCING_COLOR on its own.
      // Enabling ordinary vertexColors here is incorrect because SphereGeometry
      // has no `color` attribute: WebGL supplies zeroes for the missing attribute
      // and Three multiplies every valid instance color by black. Lambert shading
      // also keeps the appearance congruent with three-force-graph's old nodes.
      const material = new THREE.MeshLambertMaterial({
        transparent: true,
        opacity: 1,
        depthWrite: true
      })
      configureGraphOpacity(material, 'nodes')
      this.nodeMesh = new THREE.InstancedMesh(sphere, material, this.nodeCapacity)
      this.nodeMesh.name = 'graphNodes'
      this.nodeMesh.count = data.nodes.length
      this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.nodeCapacity * 3),
        3
      )
      this.nodeMesh.frustumCulled = false
      this.nodeMesh.renderOrder = 3
      this.group.add(this.nodeMesh)

      const haloGeometry = new THREE.SphereGeometry(1, 8, 6)
      haloGeometry.setAttribute(
        'graphOpacity',
        new THREE.InstancedBufferAttribute(new Float32Array(this.nodeCapacity), 1)
      )
      const haloMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
      configureGraphOpacity(haloMaterial, 'halos')
      this.haloMesh = new THREE.InstancedMesh(haloGeometry, haloMaterial, this.nodeCapacity)
      this.haloMesh.name = 'graphNodeHalos'
      this.haloMesh.count = data.nodes.length
      this.haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.haloMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.nodeCapacity * 3),
        3
      )
      this.haloMesh.frustumCulled = false
      this.haloMesh.renderOrder = 4
      this.group.add(this.haloMesh)
    }

    if (this.linkCapacity > 0) {
      const endpoints = new THREE.InstancedInterleavedBuffer(
        new Float32Array(this.linkCapacity * 6),
        6,
        1
      )
      endpoints.setUsage(THREE.DynamicDrawUsage)
      const colors = new THREE.InstancedBufferAttribute(new Float32Array(this.linkCapacity * 3), 3)
      colors.setUsage(THREE.DynamicDrawUsage)
      const opacities = new THREE.InstancedBufferAttribute(new Float32Array(this.linkCapacity), 1)
      opacities.setUsage(THREE.DynamicDrawUsage)
      const widths = new THREE.InstancedBufferAttribute(new Float32Array(this.linkCapacity), 1)
      widths.setUsage(THREE.DynamicDrawUsage)
      const reveals = new THREE.InstancedBufferAttribute(new Float32Array(this.linkCapacity), 1)
      reveals.setUsage(THREE.DynamicDrawUsage)
      const revealDirections = new THREE.InstancedBufferAttribute(
        new Float32Array(this.linkCapacity),
        1
      )
      revealDirections.setUsage(THREE.DynamicDrawUsage)
      const lineGeometry = new THREE.InstancedBufferGeometry()
      lineGeometry.setIndex([0, 2, 1, 2, 3, 1])
      lineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, -0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5, 0], 3)
      )
      lineGeometry.setAttribute(
        'instanceStart',
        new THREE.InterleavedBufferAttribute(endpoints, 3, 0)
      )
      lineGeometry.setAttribute(
        'instanceEnd',
        new THREE.InterleavedBufferAttribute(endpoints, 3, 3)
      )
      lineGeometry.setAttribute('instanceColor', colors)
      lineGeometry.setAttribute('instanceOpacity', opacities)
      lineGeometry.setAttribute('instanceWidth', widths)
      lineGeometry.setAttribute('instanceReveal', reveals)
      lineGeometry.setAttribute('instanceRevealDirection', revealDirections)
      lineGeometry.instanceCount = data.links.length
      const lineMaterial = new THREE.ShaderMaterial({
        uniforms: { resolution: { value: this.viewport } },
        vertexShader: WIDE_LINK_VERTEX_SHADER,
        fragmentShader: WIDE_LINK_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      this.linkSegments = new THREE.Mesh(lineGeometry, lineMaterial)
      this.linkSegments.name = 'graphLinks'
      this.linkSegments.frustumCulled = false
      this.linkSegments.renderOrder = 1
      this.linkSegments.visible = this.linesEnabled
      this.group.add(this.linkSegments)

      const arrowGeometry = new THREE.ConeGeometry(1.15, 4, 5)
      arrowGeometry.setAttribute(
        'graphOpacity',
        new THREE.InstancedBufferAttribute(new Float32Array(this.linkCapacity), 1)
      )
      const arrowMaterial = new THREE.MeshLambertMaterial({
        transparent: true,
        opacity: 1,
        depthWrite: false
      })
      configureGraphOpacity(arrowMaterial, 'arrows')
      this.arrowMesh = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, this.linkCapacity)
      this.arrowMesh.name = 'graphArrows'
      this.arrowMesh.count = data.links.length
      this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.arrowMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.linkCapacity * 3),
        3
      )
      this.arrowMesh.frustumCulled = false
      this.arrowMesh.renderOrder = 2
      this.arrowMesh.visible = this.linesEnabled
      this.group.add(this.arrowMesh)
    }

    this.updateVisuals(visualState)
  }

  /** Reuse existing GPU allocations while a topology patch fits their geometric headroom. */
  replaceData(data: Graph3DData, visualState: GraphBatchedVisualState = this.visualState): boolean {
    if (data.nodes.length > this.nodeCapacity || data.links.length > this.linkCapacity) return false
    if (this.nodeCapacity > 0 && (!this.nodeMesh || !this.haloMesh)) return false
    if (this.linkCapacity > 0 && (!this.linkSegments || !this.arrowMesh)) return false

    this.data = data
    this.visualState = visualState
    this.nodeIndex = new Map(data.nodes.map((node, index) => [node.id, index]))
    this.rebuildIncidentIndex()
    this.spatialPicker.setData(data)
    this.nodeVisibility.fill(0)
    this.haloVisibility.fill(0)
    this.linkVisibility.fill(0)
    this.arrowVisibility.fill(0)
    if (this.nodeMesh) this.nodeMesh.count = data.nodes.length
    if (this.haloMesh) this.haloMesh.count = data.nodes.length
    if (this.linkSegments) this.linkSegments.geometry.instanceCount = data.links.length
    if (this.arrowMesh) this.arrowMesh.count = data.links.length
    this.updateVisuals(visualState)
    return true
  }

  updateVisuals(visualState: GraphBatchedVisualState): void {
    this.visualState = visualState
    this.visibleArrowCount = 0

    if (this.nodeMesh && this.haloMesh) {
      const nodeOpacities = this.nodeMesh.geometry.getAttribute(
        'graphOpacity'
      ) as THREE.InstancedBufferAttribute
      const haloOpacities = this.haloMesh.geometry.getAttribute(
        'graphOpacity'
      ) as THREE.InstancedBufferAttribute
      for (let index = 0; index < this.data.nodes.length; index++) {
        const node = this.data.nodes[index]
        const style = parseStyleColor(visualState.nodeColor(node), visualState.nodeOpacity(node))
        const visible = visualState.nodeVisible(node)
        const halo = visible && visualState.nodeHalo(node)
        this.nodeVisibility[index] = visible ? 1 : 0
        this.haloVisibility[index] = halo ? 1 : 0
        this.nodeMesh.setColorAt(index, style.color)
        this.haloMesh.setColorAt(index, style.color)
        nodeOpacities.setX(index, visible ? style.alpha : 0)
        haloOpacities.setX(index, halo ? style.alpha : 0)
      }
      markFullAttributeUpdate(this.nodeMesh.instanceColor, this.data.nodes.length * 3)
      markFullAttributeUpdate(this.haloMesh.instanceColor, this.data.nodes.length * 3)
      markFullAttributeUpdate(nodeOpacities, this.data.nodes.length)
      markFullAttributeUpdate(haloOpacities, this.data.nodes.length)
    }

    if (this.linkSegments && this.linesEnabled) {
      const colors = this.linkSegments.geometry.getAttribute(
        'instanceColor'
      ) as THREE.InstancedBufferAttribute
      const opacities = this.linkSegments.geometry.getAttribute(
        'instanceOpacity'
      ) as THREE.InstancedBufferAttribute
      const widths = this.linkSegments.geometry.getAttribute(
        'instanceWidth'
      ) as THREE.InstancedBufferAttribute
      const reveals = this.linkSegments.geometry.getAttribute(
        'instanceReveal'
      ) as THREE.InstancedBufferAttribute
      const revealDirections = this.linkSegments.geometry.getAttribute(
        'instanceRevealDirection'
      ) as THREE.InstancedBufferAttribute
      for (let index = 0; index < this.data.links.length; index++) {
        const link = this.data.links[index]
        const style = parseStyleColor(visualState.linkColor(link), visualState.linkOpacity(link))
        const visible = visualState.linkVisible(link)
        this.linkVisibility[index] = visible ? 1 : 0
        colors.setXYZ(index, style.color.r, style.color.g, style.color.b)
        opacities.setX(index, visible ? style.alpha : 0)
        widths.setX(index, renderedLinkWidth(visualState.linkWidth?.(link) ?? link.width))
        reveals.setX(index, renderedLinkReveal(visualState.linkReveal?.(link)))
        revealDirections.setX(
          index,
          renderedLinkRevealDirection(visualState.linkRevealDirection?.(link))
        )
      }
      markFullAttributeUpdate(colors, this.data.links.length * 3)
      markFullAttributeUpdate(opacities, this.data.links.length)
      markFullAttributeUpdate(widths, this.data.links.length)
      markFullAttributeUpdate(reveals, this.data.links.length)
      markFullAttributeUpdate(revealDirections, this.data.links.length)
    } else {
      this.linkVisibility.fill(0)
    }

    if (this.arrowMesh && this.linesEnabled) {
      const opacities = this.arrowMesh.geometry.getAttribute(
        'graphOpacity'
      ) as THREE.InstancedBufferAttribute
      for (let index = 0; index < this.data.links.length; index++) {
        const link = this.data.links[index]
        const style = parseStyleColor(visualState.arrowColor(link), visualState.arrowOpacity(link))
        const visible = this.linkVisibility[index] === 1 && visualState.arrowVisible(link)
        this.arrowVisibility[index] = visible ? 1 : 0
        if (visible) this.visibleArrowCount++
        this.arrowMesh.setColorAt(index, style.color)
        opacities.setX(index, visible ? style.alpha : 0)
      }
      markFullAttributeUpdate(this.arrowMesh.instanceColor, this.data.links.length * 3)
      markFullAttributeUpdate(opacities, this.data.links.length)
    } else {
      this.arrowVisibility.fill(0)
    }

    this.syncPositions()
    if (this.selectedParticleNodeId) this.rebuildParticles()
  }

  /** Re-evaluate visuals only for changed nodes and their incident links. */
  updateVisualsForNodes(nodeIds: Iterable<string>, visualState: GraphBatchedVisualState): void {
    if (!this.nodeMesh || !this.haloMesh) return
    this.visualState = visualState
    const nodeColors = this.nodeMesh.instanceColor
    const haloColors = this.haloMesh.instanceColor
    const nodeOpacities = this.nodeMesh.geometry.getAttribute(
      'graphOpacity'
    ) as THREE.InstancedBufferAttribute
    const haloOpacities = this.haloMesh.geometry.getAttribute(
      'graphOpacity'
    ) as THREE.InstancedBufferAttribute
    const linkColors = this.linkSegments?.geometry.getAttribute('instanceColor') as
      | THREE.InstancedBufferAttribute
      | undefined
    const linkOpacities = this.linkSegments?.geometry.getAttribute('instanceOpacity') as
      | THREE.InstancedBufferAttribute
      | undefined
    const linkWidths = this.linkSegments?.geometry.getAttribute('instanceWidth') as
      | THREE.InstancedBufferAttribute
      | undefined
    const linkReveals = this.linkSegments?.geometry.getAttribute('instanceReveal') as
      | THREE.InstancedBufferAttribute
      | undefined
    const linkRevealDirections = this.linkSegments?.geometry.getAttribute(
      'instanceRevealDirection'
    ) as THREE.InstancedBufferAttribute | undefined
    const linkEndpoints = this.linkEndpointBuffer()
    const arrowColors = this.arrowMesh?.instanceColor
    const arrowOpacities = this.arrowMesh?.geometry.getAttribute('graphOpacity') as
      | THREE.InstancedBufferAttribute
      | undefined

    this.linkUpdateStamp++
    if (this.linkUpdateStamp >= 0xffff_fffe) {
      this.linkUpdateMarks.fill(0)
      this.linkUpdateStamp = 1
    }
    let nodeUpdates = 0
    let linkUpdates = 0
    for (const nodeId of nodeIds) {
      const nodeIndex = this.nodeIndex.get(nodeId)
      if (nodeIndex === undefined) continue
      const node = this.data.nodes[nodeIndex]
      const style = parseStyleColor(visualState.nodeColor(node), visualState.nodeOpacity(node))
      const visible = visualState.nodeVisible(node)
      const halo = visible && visualState.nodeHalo(node)
      this.nodeVisibility[nodeIndex] = visible ? 1 : 0
      this.haloVisibility[nodeIndex] = halo ? 1 : 0
      this.nodeMesh.setColorAt(nodeIndex, style.color)
      this.haloMesh.setColorAt(nodeIndex, style.color)
      nodeOpacities.setX(nodeIndex, visible ? style.alpha : 0)
      haloOpacities.setX(nodeIndex, halo ? style.alpha : 0)
      this.writeNodeMatrices(nodeIndex)
      nodeColors?.addUpdateRange(nodeIndex * 3, 3)
      haloColors?.addUpdateRange(nodeIndex * 3, 3)
      nodeOpacities.addUpdateRange(nodeIndex, 1)
      haloOpacities.addUpdateRange(nodeIndex, 1)
      this.nodeMesh.instanceMatrix.addUpdateRange(nodeIndex * 16, 16)
      this.haloMesh.instanceMatrix.addUpdateRange(nodeIndex * 16, 16)
      nodeUpdates++

      if (!this.linesEnabled) continue
      for (
        let offset = this.incidentOffsets[nodeIndex];
        offset < this.incidentOffsets[nodeIndex + 1];
        offset++
      ) {
        const linkIndex = this.incidentLinks[offset]
        if (this.linkUpdateMarks[linkIndex] === this.linkUpdateStamp) continue
        this.linkUpdateMarks[linkIndex] = this.linkUpdateStamp
        const link = this.data.links[linkIndex]
        const linkStyle = parseStyleColor(
          visualState.linkColor(link),
          visualState.linkOpacity(link)
        )
        const linkVisible = visualState.linkVisible(link)
        this.linkVisibility[linkIndex] = linkVisible ? 1 : 0
        linkColors?.setXYZ(linkIndex, linkStyle.color.r, linkStyle.color.g, linkStyle.color.b)
        linkOpacities?.setX(linkIndex, linkVisible ? linkStyle.alpha : 0)
        linkWidths?.setX(linkIndex, renderedLinkWidth(visualState.linkWidth?.(link) ?? link.width))
        linkReveals?.setX(linkIndex, renderedLinkReveal(visualState.linkReveal?.(link)))
        linkRevealDirections?.setX(
          linkIndex,
          renderedLinkRevealDirection(visualState.linkRevealDirection?.(link))
        )

        const arrowStyle = parseStyleColor(
          visualState.arrowColor(link),
          visualState.arrowOpacity(link)
        )
        const arrowVisible = linkVisible && visualState.arrowVisible(link)
        const wasArrowVisible = this.arrowVisibility[linkIndex] === 1
        this.arrowVisibility[linkIndex] = arrowVisible ? 1 : 0
        if (wasArrowVisible !== arrowVisible) this.visibleArrowCount += arrowVisible ? 1 : -1
        this.arrowMesh?.setColorAt(linkIndex, arrowStyle.color)
        arrowOpacities?.setX(linkIndex, arrowVisible ? arrowStyle.alpha : 0)
        this.writeLinkPositions(linkIndex, linkEndpoints)

        linkColors?.addUpdateRange(linkIndex * 3, 3)
        linkOpacities?.addUpdateRange(linkIndex, 1)
        linkWidths?.addUpdateRange(linkIndex, 1)
        linkReveals?.addUpdateRange(linkIndex, 1)
        linkRevealDirections?.addUpdateRange(linkIndex, 1)
        linkEndpoints?.addUpdateRange(linkIndex * 6, 6)
        arrowColors?.addUpdateRange(linkIndex * 3, 3)
        arrowOpacities?.addUpdateRange(linkIndex, 1)
        this.arrowMesh?.instanceMatrix.addUpdateRange(linkIndex * 16, 16)
        linkUpdates++
      }
    }

    if (nodeUpdates > 0) {
      if (nodeColors) nodeColors.needsUpdate = true
      if (haloColors) haloColors.needsUpdate = true
      nodeOpacities.needsUpdate = true
      haloOpacities.needsUpdate = true
      this.nodeMesh.instanceMatrix.needsUpdate = true
      this.haloMesh.instanceMatrix.needsUpdate = true
    }
    if (linkUpdates > 0) {
      if (linkColors) linkColors.needsUpdate = true
      if (linkOpacities) linkOpacities.needsUpdate = true
      if (linkWidths) linkWidths.needsUpdate = true
      if (linkReveals) linkReveals.needsUpdate = true
      if (linkRevealDirections) linkRevealDirections.needsUpdate = true
      if (linkEndpoints) linkEndpoints.needsUpdate = true
      if (arrowColors) arrowColors.needsUpdate = true
      if (arrowOpacities) arrowOpacities.needsUpdate = true
      if (this.arrowMesh) this.arrowMesh.instanceMatrix.needsUpdate = true
    }
    if (nodeUpdates > 0 || linkUpdates > 0) this.spatialPicker.invalidate(visualState)
  }

  syncPositions(updateArrows = true, packedLinkPositions?: Float32Array): void {
    this.syncNodePositions()
    if (this.linesEnabled) {
      if (packedLinkPositions?.length === this.data.links.length * 6) {
        this.syncPackedLinkPositions(packedLinkPositions, updateArrows)
      } else {
        this.syncLinkPositions(updateArrows)
      }
      this.syncParticlePositions(this.particlePhase)
    }
    this.spatialPicker.invalidate(this.visualState)
  }

  /** Update only moved nodes and their incident edges (presentation/drag hot path). */
  syncNodePositionsById(nodeIds: Iterable<string>): void {
    if (!this.nodeMesh || !this.haloMesh) return
    const endpoints = this.linkEndpointBuffer()
    this.linkUpdateStamp++
    if (this.linkUpdateStamp >= 0xffff_fffe) {
      this.linkUpdateMarks.fill(0)
      this.linkUpdateStamp = 1
    }
    let nodeUpdates = 0
    let linkUpdates = 0
    for (const nodeId of nodeIds) {
      const nodeIndex = this.nodeIndex.get(nodeId)
      if (nodeIndex === undefined) continue
      this.writeNodeMatrices(nodeIndex)
      this.nodeMesh.instanceMatrix.addUpdateRange(nodeIndex * 16, 16)
      this.haloMesh.instanceMatrix.addUpdateRange(nodeIndex * 16, 16)
      nodeUpdates++
      if (!this.linesEnabled) continue
      for (
        let offset = this.incidentOffsets[nodeIndex];
        offset < this.incidentOffsets[nodeIndex + 1];
        offset++
      ) {
        const linkIndex = this.incidentLinks[offset]
        if (this.linkUpdateMarks[linkIndex] === this.linkUpdateStamp) continue
        this.linkUpdateMarks[linkIndex] = this.linkUpdateStamp
        this.writeLinkPositions(linkIndex, endpoints)
        endpoints?.addUpdateRange(linkIndex * 6, 6)
        this.arrowMesh?.instanceMatrix.addUpdateRange(linkIndex * 16, 16)
        linkUpdates++
      }
    }
    if (nodeUpdates > 0) {
      this.nodeMesh.instanceMatrix.needsUpdate = true
      this.haloMesh.instanceMatrix.needsUpdate = true
    }
    if (linkUpdates > 0) {
      if (endpoints) endpoints.needsUpdate = true
      if (this.arrowMesh) this.arrowMesh.instanceMatrix.needsUpdate = true
      this.syncParticlePositions(this.particlePhase)
    }
    if (nodeUpdates > 0) this.spatialPicker.invalidate(this.visualState)
  }

  /** Repair incident endpoints after adopting worker-packed links without narrowing node uploads. */
  syncIncidentLinkPositionsByNodeIds(nodeIds: Iterable<string>): void {
    if (!this.linesEnabled) return
    const endpoints = this.linkEndpointBuffer()
    if (!endpoints) return
    this.linkUpdateStamp++
    if (this.linkUpdateStamp >= 0xffff_fffe) {
      this.linkUpdateMarks.fill(0)
      this.linkUpdateStamp = 1
    }
    let linkUpdates = 0
    for (const nodeId of nodeIds) {
      const nodeIndex = this.nodeIndex.get(nodeId)
      if (nodeIndex === undefined) continue
      for (
        let offset = this.incidentOffsets[nodeIndex];
        offset < this.incidentOffsets[nodeIndex + 1];
        offset++
      ) {
        const linkIndex = this.incidentLinks[offset]
        if (this.linkUpdateMarks[linkIndex] === this.linkUpdateStamp) continue
        this.linkUpdateMarks[linkIndex] = this.linkUpdateStamp
        this.writeLinkPositions(linkIndex, endpoints)
        endpoints.addUpdateRange(linkIndex * 6, 6)
        this.arrowMesh?.instanceMatrix.addUpdateRange(linkIndex * 16, 16)
        linkUpdates++
      }
    }
    if (linkUpdates === 0) return
    endpoints.needsUpdate = true
    if (this.arrowMesh) this.arrowMesh.instanceMatrix.needsUpdate = true
    this.syncParticlePositions(this.particlePhase)
  }

  /** Hide the complete edge layer and skip all O(E) snapshot buffer updates. */
  setLinesVisible(visible: boolean): void {
    if (this.linesEnabled === visible) return
    this.linesEnabled = visible
    if (this.linkSegments) this.linkSegments.visible = visible
    if (this.arrowMesh) this.arrowMesh.visible = visible
    if (this.particlePoints) this.particlePoints.visible = visible
    if (!visible) {
      this.linkVisibility.fill(0)
      this.arrowVisibility.fill(0)
      this.visibleArrowCount = 0
      this.spatialPicker.invalidate(this.visualState)
    } else {
      this.updateVisuals(this.visualState)
    }
  }

  private rebuildIncidentIndex(): void {
    const counts = new Int32Array(this.data.nodes.length)
    this.linkSourceIndices = new Int32Array(this.data.links.length)
    this.linkTargetIndices = new Int32Array(this.data.links.length)
    this.linkSourceIndices.fill(-1)
    this.linkTargetIndices.fill(-1)
    for (let linkIndex = 0; linkIndex < this.data.links.length; linkIndex++) {
      const link = this.data.links[linkIndex]
      const source = this.nodeIndex.get(link.source)
      const target = this.nodeIndex.get(link.target)
      if (source !== undefined) {
        this.linkSourceIndices[linkIndex] = source
        counts[source]++
      }
      if (target !== undefined) {
        this.linkTargetIndices[linkIndex] = target
        if (target !== source) counts[target]++
      }
    }
    this.incidentOffsets = new Int32Array(this.data.nodes.length + 1)
    for (let index = 0; index < counts.length; index++) {
      this.incidentOffsets[index + 1] = this.incidentOffsets[index] + counts[index]
    }
    this.incidentLinks = new Int32Array(this.incidentOffsets[this.data.nodes.length])
    const cursors = this.incidentOffsets.slice(0, this.data.nodes.length)
    for (let linkIndex = 0; linkIndex < this.data.links.length; linkIndex++) {
      const source = this.linkSourceIndices[linkIndex]
      const target = this.linkTargetIndices[linkIndex]
      if (source >= 0) this.incidentLinks[cursors[source]++] = linkIndex
      if (target >= 0 && target !== source) {
        this.incidentLinks[cursors[target]++] = linkIndex
      }
    }
    this.linkUpdateMarks = new Uint32Array(this.data.links.length)
    this.linkUpdateStamp = 0
  }

  private syncNodePositions(): void {
    if (!this.nodeMesh || !this.haloMesh) return

    // A preceding pointer-frame update may have queued a one-node range. A
    // full rewrite must clear it or Three uploads only that stale partial range.
    for (let index = 0; index < this.data.nodes.length; index++) {
      this.writeNodeMatrices(index)
    }
    markFullAttributeUpdate(this.nodeMesh.instanceMatrix, this.data.nodes.length * 16)
    markFullAttributeUpdate(this.haloMesh.instanceMatrix, this.data.nodes.length * 16)
  }

  private writeNodeMatrices(index: number): void {
    if (!this.nodeMesh || !this.haloMesh) return
    const node = this.data.nodes[index]
    const visible = this.nodeVisibility[index] === 1
    const radius = graphPickNodeRadius(node)
    const x = finiteCoordinate(node.x)
    const y = finiteCoordinate(node.y)
    const z = finiteCoordinate(node.z)
    this.writeScaleTranslationMatrix(
      this.nodeMesh.instanceMatrix.array as Float32Array,
      index,
      x,
      y,
      z,
      visible ? radius : HIDDEN_SCALE
    )
    const haloVisible = this.haloVisibility[index] === 1
    this.writeScaleTranslationMatrix(
      this.haloMesh.instanceMatrix.array as Float32Array,
      index,
      x,
      y,
      z,
      haloVisible ? radius * 1.4 : HIDDEN_SCALE
    )
  }

  private writeScaleTranslationMatrix(
    target: Float32Array,
    index: number,
    x: number,
    y: number,
    z: number,
    scale: number
  ): void {
    const offset = index * 16
    target[offset] = scale
    target[offset + 1] = 0
    target[offset + 2] = 0
    target[offset + 3] = 0
    target[offset + 4] = 0
    target[offset + 5] = scale
    target[offset + 6] = 0
    target[offset + 7] = 0
    target[offset + 8] = 0
    target[offset + 9] = 0
    target[offset + 10] = scale
    target[offset + 11] = 0
    target[offset + 12] = x
    target[offset + 13] = y
    target[offset + 14] = z
    target[offset + 15] = 1
  }

  /** Start/end share this interleaved stream so packed worker snapshots stay a single copy. */
  private linkEndpointBuffer(): THREE.InstancedInterleavedBuffer | undefined {
    const start = this.linkSegments?.geometry.getAttribute('instanceStart') as
      | THREE.InterleavedBufferAttribute
      | undefined
    return start?.data as THREE.InstancedInterleavedBuffer | undefined
  }

  private syncLinkPositions(updateArrows: boolean): void {
    const endpoints = this.linkEndpointBuffer()

    for (let index = 0; index < this.data.links.length; index++) {
      this.writeLinkPositions(index, endpoints, updateArrows)
    }

    markFullAttributeUpdate(endpoints, this.data.links.length * 6)
    if (this.arrowMesh && updateArrows) {
      markFullAttributeUpdate(this.arrowMesh.instanceMatrix, this.data.links.length * 16)
    }
  }

  /** Adopt the worker-packed endpoint stream with one native typed-array copy. */
  private syncPackedLinkPositions(packed: Float32Array, updateArrows: boolean): void {
    const endpoints = this.linkEndpointBuffer()
    if (endpoints) {
      ;(endpoints.array as Float32Array).set(packed)
      markFullAttributeUpdate(endpoints, packed.length)
    }

    // Chunk graphs intentionally have no arrows. Skip the complete O(E)
    // transform walk in that common huge-graph case; document arrows retain
    // their exact existing transforms at the adaptive cadence chosen upstream.
    if (this.arrowMesh && updateArrows && this.visibleArrowCount > 0) {
      for (let index = 0; index < this.data.links.length; index++) {
        this.writeLinkPositions(index, undefined, true)
      }
      markFullAttributeUpdate(this.arrowMesh.instanceMatrix, this.data.links.length * 16)
    }
  }

  private writeLinkPositions(
    index: number,
    endpoints?: THREE.InstancedInterleavedBuffer,
    updateArrow = true
  ): void {
    const sourceIndex = this.linkSourceIndices[index]
    const targetIndex = this.linkTargetIndices[index]
    const source = sourceIndex >= 0 ? this.data.nodes[sourceIndex] : undefined
    const target = targetIndex >= 0 ? this.data.nodes[targetIndex] : undefined
    const visible = !!source && !!target && this.linkVisibility[index] === 1

    if (source && target) {
      this.sourcePosition.set(
        finiteCoordinate(source.x),
        finiteCoordinate(source.y),
        finiteCoordinate(source.z)
      )
      this.targetPosition.set(
        finiteCoordinate(target.x),
        finiteCoordinate(target.y),
        finiteCoordinate(target.z)
      )
    } else {
      this.sourcePosition.set(0, 0, 0)
      this.targetPosition.set(0, 0, 0)
    }

    if (endpoints) {
      const end = visible ? this.targetPosition : this.sourcePosition
      const targetArray = endpoints.array as Float32Array
      const offset = index * 6
      targetArray[offset] = this.sourcePosition.x
      targetArray[offset + 1] = this.sourcePosition.y
      targetArray[offset + 2] = this.sourcePosition.z
      targetArray[offset + 3] = end.x
      targetArray[offset + 4] = end.y
      targetArray[offset + 5] = end.z
    }

    if (!this.arrowMesh || !updateArrow) return
    const arrowVisible = visible && this.arrowVisibility[index] === 1
    this.direction.subVectors(this.targetPosition, this.sourcePosition)
    const length = this.direction.length()
    if (arrowVisible && length > 0.001) {
      this.direction.multiplyScalar(1 / length)
      this.matrixObject.position.copy(this.sourcePosition).lerp(this.targetPosition, 0.88)
      this.matrixObject.quaternion.setFromUnitVectors(UNIT_Y, this.direction)
      this.matrixObject.scale.set(1, 1, 1)
    } else {
      this.matrixObject.position.copy(this.sourcePosition)
      this.matrixObject.quaternion.identity()
      this.matrixObject.scale.setScalar(HIDDEN_SCALE)
    }
    this.matrixObject.updateMatrix()
    this.arrowMesh.setMatrixAt(index, this.matrixObject.matrix)
  }

  setParticleLinks(selectedNodeId: string | null): void {
    if (this.selectedParticleNodeId === selectedNodeId && this.particlePoints) return
    this.selectedParticleNodeId = selectedNodeId
    this.rebuildParticles()
  }

  private rebuildParticles(): void {
    this.disposeParticles()
    const selectedNodeId = this.selectedParticleNodeId
    if (!selectedNodeId || !this.linesEnabled) return

    this.particleLinkIndices = []
    for (let index = 0; index < this.data.links.length; index++) {
      const link = this.data.links[index]
      if (
        this.linkVisibility[index] === 1 &&
        (link.source === selectedNodeId || link.target === selectedNodeId)
      ) {
        this.particleLinkIndices.push(index)
      }
    }
    if (this.particleLinkIndices.length === 0) return

    const geometry = new THREE.BufferGeometry()
    const positions = new THREE.BufferAttribute(
      new Float32Array(this.particleLinkIndices.length * 2 * 3),
      3
    )
    positions.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', positions)
    const material = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    this.particlePoints = new THREE.Points(geometry, material)
    this.particlePoints.name = 'graphParticles'
    this.particlePoints.frustumCulled = false
    this.particlePoints.renderOrder = 5
    this.group.add(this.particlePoints)
    this.syncParticlePositions(0)
  }

  advanceParticles(elapsedSeconds: number): void {
    if (!this.particlePoints) return
    this.particlePhase = (this.particlePhase + Math.max(0, elapsedSeconds) * 0.45) % 1
    this.syncParticlePositions(this.particlePhase)
  }

  private syncParticlePositions(phase: number): void {
    if (!this.particlePoints) return
    const positions = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let item = 0; item < this.particleLinkIndices.length; item++) {
      const linkIndex = this.particleLinkIndices[item]
      const sourceIndex = this.linkSourceIndices[linkIndex]
      const targetIndex = this.linkTargetIndices[linkIndex]
      const source = sourceIndex >= 0 ? this.data.nodes[sourceIndex] : undefined
      const target = targetIndex >= 0 ? this.data.nodes[targetIndex] : undefined
      if (!source || !target || this.linkVisibility[linkIndex] !== 1) {
        positions.setXYZ(item * 2, 1e12, 1e12, 1e12)
        positions.setXYZ(item * 2 + 1, 1e12, 1e12, 1e12)
        continue
      }
      const sx = finiteCoordinate(source.x)
      const sy = finiteCoordinate(source.y)
      const sz = finiteCoordinate(source.z)
      const tx = finiteCoordinate(target.x)
      const ty = finiteCoordinate(target.y)
      const tz = finiteCoordinate(target.z)
      for (let particle = 0; particle < 2; particle++) {
        const t = (phase + particle * 0.5) % 1
        positions.setXYZ(
          item * 2 + particle,
          THREE.MathUtils.lerp(sx, tx, t),
          THREE.MathUtils.lerp(sy, ty, t),
          THREE.MathUtils.lerp(sz, tz, t)
        )
      }
    }
    positions.needsUpdate = true
  }

  pickNode(raycaster: THREE.Raycaster): Graph3DNode | null {
    return this.spatialPicker.pickNode(raycaster)
  }

  pickLink(raycaster: THREE.Raycaster): Graph3DLink | null {
    return this.spatialPicker.pickLink(raycaster)
  }

  collectNodesWithinRadius(
    center: { readonly x: number; readonly y: number; readonly z: number },
    radius: number,
    target: Graph3DNode[]
  ): number {
    return this.spatialPicker.collectNodesWithinRadius(center, radius, target)
  }

  dispose(): void {
    this.disposeDrawables()
    this.data = { nodes: [], links: [] }
    this.nodeIndex.clear()
    this.nodeCapacity = 0
    this.linkCapacity = 0
    this.selectedParticleNodeId = null
    this.nodeVisibility = new Uint8Array()
    this.haloVisibility = new Uint8Array()
    this.linkVisibility = new Uint8Array()
    this.arrowVisibility = new Uint8Array()
    this.visibleArrowCount = 0
    this.incidentOffsets = new Int32Array()
    this.incidentLinks = new Int32Array()
    this.linkSourceIndices = new Int32Array()
    this.linkTargetIndices = new Int32Array()
    this.linkUpdateMarks = new Uint32Array()
    this.linkUpdateStamp = 0
    this.spatialPicker.clear()
  }

  private disposeParticles(): void {
    if (!this.particlePoints) {
      this.particleLinkIndices = []
      return
    }
    this.group.remove(this.particlePoints)
    this.particlePoints.geometry.dispose()
    const material = this.particlePoints.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
    this.particlePoints = null
    this.particleLinkIndices = []
  }

  private disposeDrawables(): void {
    this.disposeParticles()
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose()
        const material = child.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
    }
    this.nodeMesh = null
    this.haloMesh = null
    this.linkSegments = null
    this.arrowMesh = null
    this.nodeCapacity = 0
    this.linkCapacity = 0
  }
}
