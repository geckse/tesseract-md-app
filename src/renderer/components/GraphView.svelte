<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import type { ForceGraph3DInstance } from '3d-force-graph'
  import type { NodeObject, LinkObject } from 'three-forcegraph'
  import * as THREE from 'three'
  import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
  import {
    graphData,
    graphLoading,
    graphError,
    graphSelectedNode,
    graphColoringMode,
    cycleColoringMode,
    graphLevel,
    graphPathFilter,
    graphHighlightedFolder,
    graphHoveredFilePath,
    loadGraphData,
    selectGraphNode,
    openGraphNode,
    setGraphLevel,
    setGraphPathFilter,
    setGraphHighlightedFolder,
    graphEdgeFilter,
    graphSemanticEdgesEnabled,
    graphEdgeWeakThreshold,
    toggleEdgeClusterFilter,
    clearEdgeFilter
  } from '../stores/graph'
  import type { GraphColoringMode } from '../stores/graph'
  import type { GraphLevel } from '../types/cli'
  import type { GraphNode, GraphData } from '../types/cli'
  import { selectedFilePath } from '../stores/files'
  import { activeCollection } from '../stores/collections'
  import { get } from 'svelte/store'
  import { edgeClusterColor } from '../lib/edge-utils'
  import {
    buildSearchScoreMap,
    buildGraphContextMap,
    computeSearchNodeOpacity,
    computeEdgeSearchAlpha,
    getNodePath
  } from '../lib/graph-search-utils'
  import {
    buildGraph3DData,
    seedClusterPositions,
    computeDegreeMap,
    edgeArrowColor,
    nodeTooltipHtml,
    edgeTooltipHtml,
    type Graph3DNode,
    type Graph3DLink,
    type Graph3DData
  } from '../lib/graph-3d-bridge'

  // ─── Constants ───────────────────────────────────────────────────────

  /** Cluster color palette (12 colors, cycling). */
  const CLUSTER_COLORS = [
    '#E879F9',
    '#FF6B6B',
    '#51CF66',
    '#FFD43B',
    '#845EF7',
    '#FF922B',
    '#20C997',
    '#F06595',
    '#339AF0',
    '#B2F2BB',
    '#D0BFFF',
    '#FFC078'
  ]

  /** Default node color for unclustered or uncolored nodes. */
  const DEFAULT_NODE_COLOR = '#E4E4E7'

  // ─── 3D Graph Types ─────────────────────────────────────────────────

  /** Node type with Graph3DNode fields plus NodeObject simulation fields. */
  type ForceNode = Graph3DNode & NodeObject

  /** Link type with Graph3DLink fields plus LinkObject simulation fields. */
  type ForceLink = Graph3DLink & LinkObject<ForceNode>

  /** Typed ForceGraph3D instance using our node/link types. */
  type GraphInstance = ForceGraph3DInstance<ForceNode, ForceLink>

  // ─── State ──────────────────────────────────────────────────────────

  /** The 3d-force-graph instance. Created in onMount via dynamic import. */
  let graph: GraphInstance | null = null

  /** Outer container div (used for ResizeObserver and overlay positioning). */
  let containerEl: HTMLDivElement | undefined = $state(undefined)

  /** Inner container div where 3d-force-graph mounts the WebGL canvas. */
  let graphContainerEl: HTMLDivElement | undefined = $state(undefined)

  /** Current 3D graph data fed to the graph instance. */
  let currentGraph3DData: Graph3DData | null = null

  /** Degree map computed from current edges (used for force configuration). */
  let degreeMap: Map<string, number> = new Map()

  /** Cluster centroids computed from seeded positions (used by cluster force). */
  let clusterCentroids: Map<number, { x: number; y: number; z: number }> = new Map()

  /** Map from top-level folder name to assigned color. */
  let folderColorMap: Map<string, string> = $state(new Map())

  /** Set of bidirectional edge pair keys ("srcId->tgtId") for arrow color logic. */
  let bidirectionalPairs: Set<string> = new Set()

  /** Set of node IDs neighboring the selected node (includes the selected node itself). */
  let neighborSet: Set<string> = new Set()

  // Store subscriptions
  let unsubData: (() => void) | null = null
  let unsubColoring: (() => void) | null = null
  let unsubSelected: (() => void) | null = null
  let unsubFilePath: (() => void) | null = null
  let unsubPathFilter: (() => void) | null = null
  let unsubHighlightedFolder: (() => void) | null = null
  let unsubHoveredFilePath: (() => void) | null = null
  let unsubEdgeFilter: (() => void) | null = null
  let unsubSemanticEdges: (() => void) | null = null
  let unsubEdgeWeakThreshold: (() => void) | null = null
  let unsubLoading: (() => void) | null = null
  let unsubError: (() => void) | null = null
  let unsubLevel: (() => void) | null = null

  // Reactive local copies for template use
  let currentData: GraphData | null = $state(null)
  let currentLoading = $state(false)
  let currentError: string | null = $state(null)
  let currentColoringMode: GraphColoringMode = $state('cluster')
  let currentSelected: GraphNode | null = $state(null)
  let currentLevel: GraphLevel = $state('document')
  let _currentFilePath: string | null = $state(null)
  let currentPathFilter: string | null = $state(null)
  let currentHighlightedFolder: string | null = $state(null)
  let _currentHoveredFilePath: string | null = $state(null)
  let currentEdgeFilter: Set<number> = $state(new Set())
  let _currentSemanticEdgesEnabled: boolean = $state(true)
  let currentEdgeWeakThreshold: number = $state(0.3)

  // Context menu state
  let contextMenuNode: ForceNode | null = $state(null)
  let contextMenuX = $state(0)
  let contextMenuY = $state(0)

  // Legend visibility
  let legendVisible = $state(true)

  // Hover state (populated by interaction handlers in subtask 2-2)
  let hoveredNode: ForceNode | null = $state(null)
  let hoveredEdge: ForceLink | null = $state(null)
  let tooltipX = $state(0)
  let tooltipY = $state(0)

  // Proximity labels: visible node labels when camera is close enough (document mode)
  let visibleLabels: { id: string; label: string; x: number; y: number }[] = $state([])

  /** Last known mouse client X coordinate for tooltip positioning. */
  let lastMouseX = 0
  /** Last known mouse client Y coordinate for tooltip positioning. */
  let lastMouseY = 0

  // Resize observer
  let resizeObs: ResizeObserver | null = null

  // Node count for performance warnings
  let nodeCount = $state(0)

  // Label update animation frame
  let labelFrameId: number | null = null
  let labelFrameCount = 0

  // ─── Graph Search State ─────────────────────────────────────────────

  /** Whether the graph search overlay panel is visible. */
  let graphSearchVisible = $state(false)

  /** Current graph search query text. */
  let graphSearchQuery = $state('')

  /** Whether a graph search is currently in progress. */
  let graphSearchLoading = $state(false)

  /** Error message if graph search failed. */
  let graphSearchError: string | null = $state(null)

  /** Map of file path → max search score for direct matches. */
  let graphSearchScores: Map<string, number> = $state(new Map())

  /** Map of file path → attenuated score for graph context matches. */
  let graphSearchContextScores: Map<string, number> = $state(new Map())

  /** Number of direct search results returned. */
  let graphSearchResultCount = $state(0)

  /** Search panel X position. */
  let searchPanelX = $state(16)

  /** Search panel Y position. */
  let searchPanelY = $state(16)

  /** Whether the search panel is currently being dragged. */
  let isDraggingSearch = $state(false)

  /** Generation counter to discard stale async search results. */
  let graphSearchGeneration = 0

  /** Debounce timer for graph search input. */
  let graphSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // ─── Graph Search Functions ─────────────────────────────────────────

  /**
   * Handle graph search input with 400ms debounce and 2-char minimum.
   */
  function onGraphSearchInput(query: string): void {
    graphSearchQuery = query

    if (graphSearchDebounceTimer !== null) {
      clearTimeout(graphSearchDebounceTimer)
      graphSearchDebounceTimer = null
    }

    if (query.length < 2) {
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
      graphSearchLoading = false
      graphSearchError = null
      return
    }

    graphSearchLoading = true
    graphSearchDebounceTimer = setTimeout(() => {
      graphSearchDebounceTimer = null
      executeGraphSearch(query)
    }, 400)
  }

  /**
   * Execute graph search with generation counter for stale result handling.
   */
  async function executeGraphSearch(query: string): Promise<void> {
    const collection = get(activeCollection)
    if (!collection) {
      graphSearchLoading = false
      return
    }

    const generation = ++graphSearchGeneration

    try {
      const result = await window.api.search(collection.path, query, {
        mode: 'hybrid',
        boostLinks: true,
        expand: 1,
        limit: 50
      })

      // Ignore stale results
      if (generation !== graphSearchGeneration) return

      const directScores = buildSearchScoreMap(result.results ?? [])
      const contextScores = buildGraphContextMap(result.graph_context ?? [], directScores)

      graphSearchScores = directScores
      graphSearchContextScores = contextScores
      graphSearchResultCount = result.total_results ?? (result.results?.length ?? 0)
      graphSearchError = null
    } catch (err) {
      if (generation !== graphSearchGeneration) return
      graphSearchError = err instanceof Error ? err.message : String(err)
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
    } finally {
      if (generation === graphSearchGeneration) {
        graphSearchLoading = false
      }
    }
  }

  /**
   * Clear all graph search state and restore normal rendering.
   */
  function clearGraphSearch(): void {
    if (graphSearchDebounceTimer !== null) {
      clearTimeout(graphSearchDebounceTimer)
      graphSearchDebounceTimer = null
    }
    graphSearchGeneration++
    graphSearchQuery = ''
    graphSearchScores = new Map()
    graphSearchContextScores = new Map()
    graphSearchResultCount = 0
    graphSearchLoading = false
    graphSearchError = null
    graphSearchVisible = false
  }

  /**
   * Update proximity labels: project node positions to screen,
   * show labels only for nodes within a distance threshold from camera.
   * Runs every frame via requestAnimationFrame for smooth tracking during orbit.
   */
  function updateProximityLabels() {
    labelFrameCount++

    if (!graph || isChunkMode()) {
      if (visibleLabels.length > 0) visibleLabels = []
      // Still update cluster labels every frame for smooth tracking
      updateClusterLabelPositions()
      labelFrameId = requestAnimationFrame(updateProximityLabels)
      return
    }

    // Throttle DOM updates to ~20fps (every 3rd frame) — CSS transitions smooth the gaps
    if (labelFrameCount % 3 !== 0) {
      // Still update cluster labels every frame
      updateClusterLabelPositions()
      labelFrameId = requestAnimationFrame(updateProximityLabels)
      return
    }

    const camera = graph.camera()
    if (!camera) {
      labelFrameId = requestAnimationFrame(updateProximityLabels)
      return
    }

    const camPos = camera.position
    const graphData = graph.graphData()
    const nodes = graphData.nodes as ForceNode[]

    // Distance threshold: labels visible within this range from camera
    const maxDist = 350
    const labels: typeof visibleLabels = []

    for (const node of nodes) {
      const nx = node.x ?? 0
      const ny = node.y ?? 0
      const nz = node.z ?? 0

      const dx = camPos.x - nx
      const dy = camPos.y - ny
      const dz = camPos.z - nz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist > maxDist) continue

      const screenCoords = graph.graph2ScreenCoords(nx, ny, nz)
      if (!screenCoords) continue

      // Extract filename from path
      const fileName = node.path?.split('/').pop() ?? node.id

      labels.push({
        id: node.id,
        label: fileName,
        x: screenCoords.x,
        y: screenCoords.y
      })
    }

    visibleLabels = labels
    updateClusterLabelPositions()
    labelFrameId = requestAnimationFrame(updateProximityLabels)
  }

  /** Whether WebGL is supported by the browser. Checked in onMount before graph init. */
  let webglSupported = $state(true)

  // ─── Cluster Enclosure Sphere State ─────────────────────────────────

  /** THREE.js Group containing all cluster sphere + wireframe meshes. */
  let clusterMeshGroup: THREE.Group | null = null

  /** Tick counter for throttled cluster sphere updates during simulation. */
  let engineTickCount = 0

  /** Cluster labels computed for the HTML overlay. */
  let clusterLabels: {
    id: number
    label: string
    screenX: number
    screenY: number
    visible: boolean
  }[] = $state([])

  // ─── Helper Functions ───────────────────────────────────────────────

  /** Extract the top-level folder from a path, or '(root)' if no folder. */
  function getTopLevelFolder(path: string): string {
    const idx = path.indexOf('/')
    return idx >= 0 ? path.substring(0, idx) : '(root)'
  }

  /** Whether we're currently in chunk mode. */
  function isChunkMode(): boolean {
    return currentLevel === 'chunk'
  }

  /**
   * Deterministic hash-based color for a file path.
   * Maps any string to one of the 12 cluster palette colors via djb2 hash.
   */
  function fileHashColor(path: string): string {
    let hash = 0
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
    }
    return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length]
  }

  /**
   * Compute node color dynamically based on the current coloring mode.
   * Called by the nodeColor accessor on each render/refresh so that
   * mode switches only require a graph.refresh() instead of full data rebuild.
   *
   * - cluster: 12-color CLUSTER_COLORS palette by cluster_id
   * - folder: folderColorMap by top-level directory
   * - none: per-file djb2 hash color
   */
  function getNodeColor(node: ForceNode): string {
    if (currentColoringMode === 'cluster') {
      if (node.cluster_id != null) {
        return CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length]
      }
      // Unclustered: chunks get file hash color, documents get default
      return isChunkMode() ? fileHashColor(node.path) : DEFAULT_NODE_COLOR
    }

    if (currentColoringMode === 'folder') {
      return folderColorMap.get(getTopLevelFolder(node.path)) ?? DEFAULT_NODE_COLOR
    }

    // 'none' mode: per-file hash color
    return fileHashColor(node.path)
  }

  // ─── WebGL Detection ──────────────────────────────────────────────

  /**
   * Check whether the browser/renderer supports WebGL.
   * Attempts to create both WebGL2 and WebGL1 contexts.
   * Returns false if neither is available (e.g., software rendering disabled).
   */
  function checkWebGLSupport(): boolean {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    } catch {
      return false
    }
  }

  /**
   * Extract the node ID from a link endpoint.
   * Handles both the initial string ID and resolved ForceNode object
   * (3d-force-graph replaces string IDs with node object references).
   */
  function linkNodeId(endpoint: unknown): string {
    if (typeof endpoint === 'object' && endpoint != null && 'id' in endpoint) {
      return String((endpoint as { id: string }).id)
    }
    return String(endpoint ?? '')
  }

  /**
   * Compute the set of bidirectional edge pairs from the current links.
   * An edge A→B is bidirectional if B→A also exists.
   * Stores keys as "srcId->tgtId" for O(1) lookup in arrow color accessors.
   */
  function computeBidirectionalPairs(links: Graph3DLink[]) {
    const edgeSet = new Set<string>()
    for (const link of links) {
      edgeSet.add(`${link.source}->${link.target}`)
    }
    const bidi = new Set<string>()
    for (const link of links) {
      if (edgeSet.has(`${link.target}->${link.source}`)) {
        bidi.add(`${link.source}->${link.target}`)
        bidi.add(`${link.target}->${link.source}`)
      }
    }
    bidirectionalPairs = bidi
  }

  /**
   * Get the directional arrow/particle color for a link.
   * When a node is selected: directional coloring (cyan out, red in, green bidi).
   * When no selection: use the link's own color so arrows match their edge.
   */
  function getLinkArrowColor(link: ForceLink): string {
    const srcId = linkNodeId(link.source)
    const tgtId = linkNodeId(link.target)
    const selectedId = currentSelected?.id ?? null

    // No selection → arrow matches the edge color (visible on dark background)
    if (!selectedId) return link.color || '#aaaaaa'

    // Not a neighbor of selected node → match edge color
    const isNeighbor = srcId === selectedId || tgtId === selectedId
    if (!isNeighbor) return link.color || '#aaaaaa'

    // Neighbor edge → directional coloring
    const isBidi = bidirectionalPairs.has(`${srcId}->${tgtId}`)
    return edgeArrowColor(srcId, tgtId, selectedId, isBidi)
  }

  // ─── Selection Dimming & Hub Glow ──────────────────────────────────

  /**
   * Compute the set of node IDs that are neighbors of the currently selected node.
   * Includes the selected node itself. Used by selection dimming logic.
   * When no node is selected, the set is empty (no dimming applied).
   */
  function computeNeighborSet() {
    neighborSet = new Set()
    if (!currentSelected || !graph) return

    const graphD = graph.graphData()
    const links = graphD.links as ForceLink[]
    const selectedId = currentSelected.id

    neighborSet.add(selectedId)

    for (const link of links) {
      const srcId = linkNodeId(link.source)
      const tgtId = linkNodeId(link.target)
      if (srcId === selectedId) {
        neighborSet.add(tgtId)
      } else if (tgtId === selectedId) {
        neighborSet.add(srcId)
      }
    }
  }

  /**
   * Create a hub node THREE.Group with a sphere mesh and emissive glow halo.
   * Hub nodes (degree >= 5) get a visible glow effect via emissive material + outer halo.
   */
  function createHubNodeObject(node: ForceNode, opacity: number): THREE.Group {
    const color = getNodeColor(node)
    const threeColor = new THREE.Color(color)
    const radius = Math.cbrt(node.val) * 2 // Match nodeRelSize=2

    const group = new THREE.Group()

    // Inner sphere: emissive glow instead of PointLight (PointLights exceed WebGL uniform
    // limits when many hub nodes exist, causing shader compilation failures)
    const geometry = new THREE.SphereGeometry(radius, 12, 8)
    const material = new THREE.MeshPhongMaterial({
      color: threeColor,
      emissive: threeColor,
      emissiveIntensity: opacity > 0.5 ? 0.4 : 0.1,
      transparent: true,
      opacity
    })
    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)

    // Outer glow halo: slightly larger transparent sphere for visual glow effect
    const glowGeometry = new THREE.SphereGeometry(radius * 1.4, 10, 6)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: threeColor,
      transparent: true,
      opacity: opacity > 0.5 ? 0.12 : 0.03,
      depthWrite: false
    })
    group.add(new THREE.Mesh(glowGeometry, glowMaterial))

    return group
  }

  /**
   * Apply selection dimming to the graph.
   *
   * When a node is selected:
   *   - Set global nodeOpacity to 0.15 (dims all default-sphere nodes)
   *   - Set global linkOpacity to 0.05 (dims all links)
   *   - Use nodeThreeObject to render selected+neighbor nodes at full opacity
   *   - Use linkMaterial to render neighbor links at full opacity
   *
   * When no node is selected:
   *   - Restore global nodeOpacity to 0.9
   *   - Restore global linkOpacity to 0.4
   *   - Use nodeThreeObject only for hub node glow (degree >= 5)
   *   - Clear linkMaterial override
   */
  function applySelectionDimming() {
    if (!graph) return

    if (currentSelected && neighborSet.size > 0) {
      // Dim non-neighbor nodes
      graph.nodeOpacity(0.15)

      // Keep linkOpacity high so arrows are visible — dim via linkColor instead
      graph.linkOpacity(0.8)
      graph.linkColor((link: ForceLink) => {
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        if (srcId === currentSelected!.id || tgtId === currentSelected!.id) {
          return getLinkArrowColor(link) // Bright directional color for neighbor edges
        }
        return 'rgba(80, 80, 80, 0.04)' // Nearly invisible for non-neighbor edges
      })

      // Arrows: only on neighbor edges, bright directional color
      graph.linkDirectionalArrowLength((link: ForceLink) => {
        if (isChunkMode()) return 0
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        if (srcId === currentSelected!.id || tgtId === currentSelected!.id) return 6
        return 0
      })
      graph.linkDirectionalArrowColor((link: ForceLink) => getLinkArrowColor(link))

      // Particles: on neighbor edges
      graph.linkDirectionalParticles((link: ForceLink) => {
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        return srcId === currentSelected!.id || tgtId === currentSelected!.id ? 3 : 0
      })

      // Override nodeThreeObject: neighbor + hub nodes get custom objects at full opacity
      graph.nodeThreeObject(((node: ForceNode) => {
        const degree = degreeMap.get(node.id) ?? 0
        const isNeighbor = neighborSet.has(node.id)
        const isHub = degree >= 5

        if (!isNeighbor && !isHub) return false // Use default sphere at 0.15 opacity

        const targetOpacity = isNeighbor ? 0.9 : 0.15

        if (isHub) {
          return createHubNodeObject(node, targetOpacity)
        }

        // Non-hub neighbor: create sphere at full opacity
        const color = getNodeColor(node)
        const threeColor = new THREE.Color(color)
        const radius = Math.cbrt(node.val) * 2

        const group = new THREE.Group()
        const geometry = new THREE.SphereGeometry(radius, 12, 8)
        const material = new THREE.MeshLambertMaterial({
          color: threeColor,
          transparent: true,
          opacity: targetOpacity
        })
        group.add(new THREE.Mesh(geometry, material))
        return group
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any)

      // Clear linkMaterial — dimming handled via linkColor + linkOpacity
      graph.linkMaterial(null)
    } else {
      // No selection: restore default state
      graph.nodeOpacity(0.85)
      graph.linkOpacity(isChunkMode() ? 0.08 : 0.15)

      // Restore link color to pre-computed values
      graph.linkColor((link: ForceLink) => link.color)

      // Restore arrows on all edges (document mode)
      graph.linkDirectionalArrowLength((_link: ForceLink) => (isChunkMode() ? 0 : 6))
      graph.linkDirectionalArrowColor((link: ForceLink) => getLinkArrowColor(link))

      // Restore particle accessor (active only when selected)
      graph.linkDirectionalParticles((link: ForceLink) => {
        if (!currentSelected) return 0
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        return srcId === currentSelected.id || tgtId === currentSelected.id ? 3 : 0
      })

      // Restore nodeThreeObject to hub-only mode
      graph.nodeThreeObject(((node: ForceNode) => {
        const degree = degreeMap.get(node.id) ?? 0
        if (degree < 5) return false
        return createHubNodeObject(node, 0.85)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any)

      // Clear linkMaterial override
      graph.linkMaterial(null)
    }
  }

  // ─── Force Configuration ────────────────────────────────────────────

  /**
   * Create a custom d3-force-3d force that pulls nodes toward their cluster centroid.
   * This replaces forceCenter, which fights cluster separation.
   */
  function createClusterForce(strength: number) {
    let nodes: ForceNode[] = []

    function force(alpha: number) {
      for (const node of nodes) {
        if (node.cluster_id == null) continue
        const centroid = clusterCentroids.get(node.cluster_id)
        if (!centroid) continue

        const k = strength * alpha
        node.vx = (node.vx ?? 0) + (centroid.x - (node.x ?? 0)) * k
        node.vy = (node.vy ?? 0) + (centroid.y - (node.y ?? 0)) * k
        node.vz = (node.vz ?? 0) + (centroid.z - (node.z ?? 0)) * k
      }
    }

    force.initialize = function (_nodes: ForceNode[]) {
      nodes = _nodes
    }

    return force
  }

  /**
   * Configure cluster-aware forces on the 3d-force-graph instance.
   * - Link distance varies by cluster membership
   * - Charge is degree-dependent
   * - Cluster attraction via custom forceX/Y/Z replacement
   * - No forceCenter (fights cluster separation)
   */
  function configureForces(level: GraphLevel) {
    if (!graph) return

    const isDocument = level === 'document'

    // Remove forceCenter — it fights cluster separation
    graph.d3Force('center', null)

    // Link force: cluster-aware distances
    // Same cluster → tight, different clusters → push far apart
    const linkForce = graph.d3Force('link')
    if (linkForce) {
      linkForce.distance((link: ForceLink) => {
        const s = typeof link.source === 'object' ? link.source : null
        const t = typeof link.target === 'object' ? link.target : null
        const sameCluster =
          s && t && s.cluster_id != null && t.cluster_id != null && s.cluster_id === t.cluster_id
        if (isDocument) {
          return sameCluster ? 30 : 120
        }
        // Chunk mode
        return sameCluster ? 20 : 150
      })
      // Weaker link strength so cluster force dominates over edge pull
      linkForce.strength(isDocument ? 0.2 : 0.15)
    }

    // Charge force: repulsion pushes nodes apart
    const chargeForce = graph.d3Force('charge')
    if (chargeForce) {
      if (isDocument) {
        // Degree-dependent: hubs push harder
        chargeForce.strength((node: ForceNode) => {
          const degree = degreeMap.get(node.id) ?? 0
          return -100 - degree * 10
        })
        chargeForce.distanceMax(400)
      } else {
        // Chunk mode: uniform repulsion
        chargeForce.strength(-100)
        chargeForce.distanceMax(400)
      }
    }

    // Cluster attraction: pulls nodes toward their cluster centroid
    // Strong enough that clusters form tight groups despite repulsion
    const clusterStrength = isDocument ? 0.15 : 0.25
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph.d3Force('cluster', createClusterForce(clusterStrength) as any)

    // Edge opacity: subtle hairlines. Chunk mode even more subtle.
    if (!isDocument) {
      graph.linkOpacity(0.08)
    } else {
      graph.linkOpacity(0.15)
    }
  }

  // ─── Performance Safeguards ─────────────────────────────────────────

  /**
   * Apply performance safeguards based on current graph size.
   *
   * - Normal (≤500 nodes): full quality (nodeResolution 12, particles enabled, full edge labels)
   * - Large (>500 nodes): reduced quality (nodeResolution 6, particles disabled, cooldownTime 3000ms)
   * - Very large (>2000 nodes): minimal rendering (linkWidth 0 for thin lines, reduced nodeOpacity,
   *   edge labels disabled on hover)
   *
   * Called in feedData() after computing nodeCount, before feeding data to the graph.
   */
  function applyPerformanceSafeguards() {
    if (!graph) return

    // All modes use hairline links (linkWidth=0 set at init)
    if (nodeCount > 2000) {
      // Very large graph: minimal rendering for WebGL performance
      graph.nodeResolution(4)
      graph.cooldownTime(3000)
      graph.nodeOpacity(0.6)
      graph.linkDirectionalParticles(0)
      graph.linkLabel(() => '')
    } else if (nodeCount > 500) {
      // Large graph: reduced quality
      graph.nodeResolution(6)
      graph.cooldownTime(3000)
      graph.linkDirectionalParticles(0)
      graph.nodeOpacity(0.85)
      graph.linkLabel((link: ForceLink) => edgeTooltipHtml(link as unknown as Graph3DLink))
    } else {
      // Normal graph: full quality settings
      graph.nodeResolution(8)
      graph.cooldownTime(5000)
      graph.nodeOpacity(0.85)
      // Restore particle accessor (active on selected node edges)
      graph.linkDirectionalParticles((link: ForceLink) => {
        if (!currentSelected) return 0
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        return srcId === currentSelected.id || tgtId === currentSelected.id ? 2 : 0
      })
      // Restore edge labels
      graph.linkLabel((link: ForceLink) => edgeTooltipHtml(link as unknown as Graph3DLink))
    }
  }

  // ─── Camera Utilities ─────────────────────────────────────────────

  /**
   * Animate the camera to focus on a specific node with a smooth transition.
   * Positions the camera at a distance proportional to the node's distance from origin,
   * looking at the node's position. Uses 1000ms transition duration.
   */
  function focusCameraOnNode(node: ForceNode) {
    if (!graph) return
    const nx = node.x ?? 0
    const ny = node.y ?? 0
    const nz = node.z ?? 0

    // Position camera at a fixed distance from the node
    const distance = 120
    const nodeDistFromOrigin = Math.hypot(nx, ny, nz)

    // Scale factor to place camera behind/above the node relative to origin
    const distRatio = nodeDistFromOrigin > 0 ? 1 + distance / nodeDistFromOrigin : distance // Fallback for node at origin

    graph.cameraPosition(
      { x: nx * distRatio, y: ny * distRatio, z: nz * distRatio }, // Camera position
      { x: nx, y: ny, z: nz }, // Look-at target
      1000 // 1000ms transition duration
    )
  }

  // ─── Data Feeding ───────────────────────────────────────────────────

  /**
   * Convert GraphData to 3d-force-graph format and feed it to the graph.
   * Seeds cluster positions before rendering for spatial separation.
   */
  function feedData(data: GraphData) {
    if (!graph) return

    const options = {
      coloringMode: currentColoringMode,
      edgeFilter: currentEdgeFilter.size > 0 ? currentEdgeFilter : null,
      weakThreshold: currentEdgeWeakThreshold,
      level: currentLevel
    }

    const graph3DData = buildGraph3DData(data, options)

    // Compute bidirectional edge pairs for arrow/particle color logic
    computeBidirectionalPairs(graph3DData.links)

    // Seed cluster positions using Fibonacci sphere distribution
    const spreadRadius = currentLevel === 'chunk' ? 300 : 200
    seedClusterPositions(graph3DData.nodes, data.clusters, spreadRadius)

    // Compute cluster centroids from seeded positions
    computeClusterCentroids(graph3DData.nodes)

    // Compute degree map for force configuration
    degreeMap = computeDegreeMap(data.edges)

    // Build folder color map for legend
    rebuildFolderColorMap(graph3DData.nodes)

    // Store reference
    currentGraph3DData = graph3DData
    nodeCount = graph3DData.nodes.length

    // Apply performance safeguards before feeding data (adjusts resolution, particles, etc.)
    applyPerformanceSafeguards()

    // Configure forces before feeding data
    configureForces(currentLevel)

    // Pause animation during data swap to prevent OrbitControls/DragControls
    // pointer race conditions (accessing stale node positions during graphData update)
    graph.pauseAnimation()

    // Feed data to 3d-force-graph
    graph.graphData({
      nodes: graph3DData.nodes as ForceNode[],
      links: graph3DData.links as ForceLink[]
    })

    // Resume after data is set
    graph.resumeAnimation()

    // Zoom to fit after layout settles
    setTimeout(() => {
      graph?.zoomToFit(400, 50)
    }, 600)
  }

  /**
   * Compute cluster centroids from seeded node positions.
   * Used by the cluster attraction force.
   */
  function computeClusterCentroids(nodes: Graph3DNode[]) {
    const sums = new Map<number, { x: number; y: number; z: number; count: number }>()

    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const existing = sums.get(node.cluster_id)
      if (existing) {
        existing.x += node.x ?? 0
        existing.y += node.y ?? 0
        existing.z += node.z ?? 0
        existing.count++
      } else {
        sums.set(node.cluster_id, {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
          count: 1
        })
      }
    }

    clusterCentroids = new Map()
    for (const [id, sum] of sums) {
      clusterCentroids.set(id, {
        x: sum.x / sum.count,
        y: sum.y / sum.count,
        z: sum.z / sum.count
      })
    }
  }

  /** Rebuild the folder→color map from current nodes. */
  function rebuildFolderColorMap(nodes: Graph3DNode[]) {
    const folders = new Set<string>()
    for (const node of nodes) {
      folders.add(getTopLevelFolder(node.path))
    }
    const sorted = [...folders].sort()
    folderColorMap = new Map()
    for (let i = 0; i < sorted.length; i++) {
      folderColorMap.set(sorted[i], CLUSTER_COLORS[i % CLUSTER_COLORS.length])
    }
  }

  // ─── Cluster Enclosure Spheres ──────────────────────────────────────

  /**
   * Remove all existing cluster sphere meshes and labels from the scene.
   * Called before recomputing spheres or when switching away from cluster mode.
   */
  function clearClusterMeshes() {
    if (clusterMeshGroup && graph) {
      // Dispose all geometries and materials in the group
      clusterMeshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      graph.scene().remove(clusterMeshGroup)
      clusterMeshGroup = null
    }
    clusterLabels = []
  }

  /**
   * Compute an enclosing sphere for each cluster from current node positions,
   * then add transparent sphere + wireframe outline meshes to the scene.
   * Also computes screen-projected cluster label positions for the HTML overlay.
   *
   * Only adds spheres when in cluster coloring mode.
   */
  function updateClusterSpheres() {
    if (!graph) return

    // Remove previous meshes
    clearClusterMeshes()

    // Only show spheres in cluster coloring mode
    if (currentColoringMode !== 'cluster') return

    const graphData = graph.graphData()
    const nodes = graphData.nodes as ForceNode[]
    if (nodes.length === 0) return

    // Group nodes by cluster_id
    const clusterNodes = new Map<number, ForceNode[]>()
    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const existing = clusterNodes.get(node.cluster_id)
      if (existing) {
        existing.push(node)
      } else {
        clusterNodes.set(node.cluster_id, [node])
      }
    }

    if (clusterNodes.size === 0) return

    // Create a group to hold all cluster meshes
    clusterMeshGroup = new THREE.Group()
    clusterMeshGroup.name = 'clusterEnclosures'

    const newLabels: typeof clusterLabels = []

    for (const [clusterId, cnodes] of clusterNodes) {
      // Compute centroid
      let cx = 0,
        cy = 0,
        cz = 0
      for (const n of cnodes) {
        cx += n.x ?? 0
        cy += n.y ?? 0
        cz += n.z ?? 0
      }
      cx /= cnodes.length
      cy /= cnodes.length
      cz /= cnodes.length

      // Compute max distance from centroid to any node in this cluster
      let maxDist = 0
      for (const n of cnodes) {
        const dx = (n.x ?? 0) - cx
        const dy = (n.y ?? 0) - cy
        const dz = (n.z ?? 0) - cz
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist > maxDist) maxDist = dist
      }

      // Add padding (minimum sphere radius of 10 for single-node clusters)
      const radius = Math.max(maxDist + 20, 10)

      const clusterColor = new THREE.Color(CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length])
      const center = new THREE.Vector3(cx, cy, cz)

      // ── Volumetric convex hull: shape-conforming multi-shell + Fresnel ──
      // Uses 3D convex hull of actual node positions (not a sphere) so the
      // enclosure follows elongated, flat, or irregular cluster shapes.

      // Collect node positions as Vector3
      const nodePoints = cnodes.map(
        (n) => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0)
      )

      // Helper: push each point outward from centroid by (scale * distance + fixedPad)
      function padPoints(pts: THREE.Vector3[], scale: number, fixedPad: number): THREE.Vector3[] {
        return pts.map((p) => {
          const dir = p.clone().sub(center)
          const len = dir.length()
          if (len < 0.01) return p.clone().add(new THREE.Vector3(fixedPad, 0, 0))
          dir.normalize()
          return center.clone().add(dir.multiplyScalar(len * scale + fixedPad))
        })
      }

      // For clusters with < 4 nodes, ConvexGeometry can't form a 3D hull.
      // Fall back to a small sphere at the centroid for those.
      const canHull = nodePoints.length >= 4

      // Shell 1: dense inner core (40% scale from centroid)
      const coreGeo = canHull
        ? new ConvexGeometry(padPoints(nodePoints, 0.5, 5))
        : new THREE.SphereGeometry(radius * 0.4, 16, 12)
      const coreMat = new THREE.MeshBasicMaterial({
        color: clusterColor,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        depthWrite: false
      })
      const coreMesh = new THREE.Mesh(coreGeo, coreMat)
      if (!canHull) coreMesh.position.set(cx, cy, cz)
      clusterMeshGroup.add(coreMesh)

      // Shell 2: mid-density layer (80% scale + padding)
      const midGeo = canHull
        ? new ConvexGeometry(padPoints(nodePoints, 0.9, 10))
        : new THREE.SphereGeometry(radius * 0.7, 16, 12)
      const midMat = new THREE.MeshBasicMaterial({
        color: clusterColor,
        transparent: true,
        opacity: 0.045,
        side: THREE.BackSide,
        depthWrite: false
      })
      const midMesh = new THREE.Mesh(midGeo, midMat)
      if (!canHull) midMesh.position.set(cx, cy, cz)
      clusterMeshGroup.add(midMesh)

      // Shell 3: outer boundary (full extent + generous padding)
      const outerPadded = padPoints(nodePoints, 1.0, 25)
      const outerGeo = canHull
        ? new ConvexGeometry(outerPadded)
        : new THREE.SphereGeometry(radius, 16, 12)
      const outerMat = new THREE.MeshBasicMaterial({
        color: clusterColor,
        transparent: true,
        opacity: 0.025,
        side: THREE.BackSide,
        depthWrite: false
      })
      const outerMesh = new THREE.Mesh(outerGeo, outerMat)
      if (!canHull) outerMesh.position.set(cx, cy, cz)
      clusterMeshGroup.add(outerMesh)

      // No Fresnel rim — all shells use flat MeshBasicMaterial for uniform
      // appearance from every camera angle (no lighting, no view-dependent shading).

      // Compute screen position for the cluster label
      const labelPos = projectToScreen(cx, cy, cz)

      // Find cluster label from current data
      const clusterInfo = currentData?.clusters.find((c) => c.id === clusterId)
      newLabels.push({
        id: clusterId,
        label: clusterInfo?.label ?? `Cluster ${clusterId}`,
        screenX: labelPos.x,
        screenY: labelPos.y,
        visible: labelPos.visible
      })
    }

    graph.scene().add(clusterMeshGroup)
    clusterLabels = newLabels

    // Also recompute cluster centroids for the attraction force
    recomputeLiveCentroids(nodes)
  }

  /**
   * Project a 3D world position to 2D screen coordinates.
   * Returns { x, y, visible } where visible indicates if the point is in front of the camera.
   */
  function projectToScreen(
    wx: number,
    wy: number,
    wz: number
  ): { x: number; y: number; visible: boolean } {
    if (!graph || !containerEl) return { x: 0, y: 0, visible: false }

    const camera = graph.camera()
    const renderer = graph.renderer()
    const vec = new THREE.Vector3(wx, wy, wz)

    // Project to normalized device coordinates
    vec.project(camera)

    // Check if behind camera
    if (vec.z > 1) return { x: 0, y: 0, visible: false }

    // Convert NDC to screen pixel coordinates
    const domEl = renderer.domElement
    const x = (vec.x * 0.5 + 0.5) * domEl.clientWidth
    const y = (-vec.y * 0.5 + 0.5) * domEl.clientHeight

    return { x, y, visible: true }
  }

  /**
   * Update cluster label screen positions without recreating meshes.
   * Called during camera movement or simulation ticks.
   */
  function updateClusterLabelPositions() {
    if (!graph || currentColoringMode !== 'cluster' || !clusterMeshGroup) return

    const graphData = graph.graphData()
    const nodes = graphData.nodes as ForceNode[]

    // Recompute centroids from current positions
    const centroids = new Map<number, { x: number; y: number; z: number; count: number }>()
    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const existing = centroids.get(node.cluster_id)
      if (existing) {
        existing.x += node.x ?? 0
        existing.y += node.y ?? 0
        existing.z += node.z ?? 0
        existing.count++
      } else {
        centroids.set(node.cluster_id, {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
          count: 1
        })
      }
    }

    const updatedLabels: typeof clusterLabels = []
    for (const [clusterId, sum] of centroids) {
      const cx = sum.x / sum.count
      const cy = sum.y / sum.count
      const cz = sum.z / sum.count
      const pos = projectToScreen(cx, cy, cz)
      const clusterInfo = currentData?.clusters.find((c) => c.id === clusterId)
      updatedLabels.push({
        id: clusterId,
        label: clusterInfo?.label ?? `Cluster ${clusterId}`,
        screenX: pos.x,
        screenY: pos.y,
        visible: pos.visible
      })
    }
    clusterLabels = updatedLabels
  }

  /**
   * Recompute live cluster centroids from current node positions.
   * Updates the clusterCentroids map used by the cluster attraction force,
   * so that the force targets track the actual cluster centers during simulation.
   */
  function recomputeLiveCentroids(nodes: ForceNode[]) {
    const sums = new Map<number, { x: number; y: number; z: number; count: number }>()
    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const existing = sums.get(node.cluster_id)
      if (existing) {
        existing.x += node.x ?? 0
        existing.y += node.y ?? 0
        existing.z += node.z ?? 0
        existing.count++
      } else {
        sums.set(node.cluster_id, {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
          count: 1
        })
      }
    }

    for (const [id, sum] of sums) {
      clusterCentroids.set(id, {
        x: sum.x / sum.count,
        y: sum.y / sum.count,
        z: sum.z / sum.count
      })
    }
  }

  /**
   * Handle engine tick: throttled cluster sphere + centroid updates.
   * Called on every simulation tick; only updates every ~30 ticks for performance.
   */
  function handleEngineTick() {
    engineTickCount++
    if (engineTickCount % 30 !== 0) return
    if (currentColoringMode !== 'cluster') return
    if (!graph) return

    const graphData = graph.graphData()
    const nodes = graphData.nodes as ForceNode[]

    // Recompute live centroids for the attraction force
    recomputeLiveCentroids(nodes)

    // Update sphere positions + sizes
    updateClusterSphereMeshPositions(nodes)

    // Update label screen positions
    updateClusterLabelPositions()
  }

  /**
   * Handle engine stop: final cluster sphere update when simulation completes.
   */
  function handleEngineStop() {
    if (currentColoringMode === 'cluster' && graph) {
      updateClusterSpheres()
    }
  }

  /**
   * Update existing cluster sphere mesh positions and sizes based on current node positions.
   * Avoids recreating meshes on every tick — just repositions and rescales them.
   */
  function updateClusterSphereMeshPositions(nodes: ForceNode[]) {
    if (!clusterMeshGroup) return

    // Group nodes by cluster_id to compute current centroids and radii
    const clusterData = new Map<number, { cx: number; cy: number; cz: number; maxDist: number }>()
    const clusterSums = new Map<number, { x: number; y: number; z: number; count: number }>()

    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const existing = clusterSums.get(node.cluster_id)
      if (existing) {
        existing.x += node.x ?? 0
        existing.y += node.y ?? 0
        existing.z += node.z ?? 0
        existing.count++
      } else {
        clusterSums.set(node.cluster_id, {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
          count: 1
        })
      }
    }

    for (const [id, sum] of clusterSums) {
      const cx = sum.x / sum.count
      const cy = sum.y / sum.count
      const cz = sum.z / sum.count
      clusterData.set(id, { cx, cy, cz, maxDist: 0 })
    }

    // Compute max distances
    for (const node of nodes) {
      if (node.cluster_id == null) continue
      const data = clusterData.get(node.cluster_id)
      if (!data) continue
      const dx = (node.x ?? 0) - data.cx
      const dy = (node.y ?? 0) - data.cy
      const dz = (node.z ?? 0) - data.cz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > data.maxDist) data.maxDist = dist
    }

    // The mesh group has pairs of meshes: [fill, wire] for each cluster
    // They're in the same order as the iteration over clusterNodes in updateClusterSpheres
    // Instead of tracking order, we use mesh userData to match cluster IDs.
    // For now, just do a full rebuild since it's only every ~30 ticks.
    // This is simpler and avoids ordering issues.
    updateClusterSpheres()
  }

  // ─── Store Subscriptions ────────────────────────────────────────────

  function setupStoreSubscriptions() {
    // Data changes → rebuild graph (or lazily initialize if graph doesn't exist yet)
    unsubData = graphData.subscribe(async (d) => {
      currentData = d
      if (d && d.nodes.length > 0 && !graph && webglSupported) {
        // graphContainerEl is always mounted, but may need a tick for bind:this
        await tick()
        if (graphContainerEl && !graph) {
          await initializeGraph()
          syncGraphSize()
          feedData(d)
        }
      } else if (d && graph) {
        syncGraphSize()
        feedData(d)
      }
    })

    // Coloring mode → refresh graph to re-evaluate nodeColor accessor + toggle cluster spheres
    unsubColoring = graphColoringMode.subscribe((v) => {
      currentColoringMode = v
      // Ensure folder color map is current when switching to folder mode
      if (v === 'folder' && currentGraph3DData) {
        rebuildFolderColorMap(currentGraph3DData.nodes)
      }
      // nodeColor accessor reads currentColoringMode dynamically,
      // so a refresh is enough — no full data rebuild needed
      if (graph) graph.refresh()

      // Show cluster enclosure spheres only in cluster mode
      if (v === 'cluster') {
        updateClusterSpheres()
      } else {
        clearClusterMeshes()
      }
    })

    // Selection state → compute neighbor set, apply dimming, refresh accessors, camera focus
    unsubSelected = graphSelectedNode.subscribe((n) => {
      currentSelected = n
      computeNeighborSet()
      applySelectionDimming()
      if (graph) graph.refresh()

      // Optional camera focus animation on node select
      if (n && graph) {
        const gd = graph.graphData()
        const forceNode = (gd.nodes as ForceNode[]).find((nd) => nd.id === n.id)
        if (forceNode && forceNode.x != null) {
          focusCameraOnNode(forceNode)
        }
      }
    })

    // Editor file path highlight
    unsubFilePath = selectedFilePath.subscribe((p) => {
      _currentFilePath = p
    })

    // Path filter
    unsubPathFilter = graphPathFilter.subscribe((p) => {
      currentPathFilter = p
    })

    // Folder highlight
    unsubHighlightedFolder = graphHighlightedFolder.subscribe((p) => {
      currentHighlightedFolder = p
    })

    // Search result hover highlight
    unsubHoveredFilePath = graphHoveredFilePath.subscribe((p) => {
      _currentHoveredFilePath = p
    })

    // Edge filter → rebuild data (filters edges)
    unsubEdgeFilter = graphEdgeFilter.subscribe((f) => {
      currentEdgeFilter = f
      if (currentData && graph) feedData(currentData)
    })

    // Semantic edge toggle → rebuild data
    unsubSemanticEdges = graphSemanticEdgesEnabled.subscribe((v) => {
      _currentSemanticEdgesEnabled = v
    })

    // Weak edge threshold → rebuild data (affects edge colors)
    unsubEdgeWeakThreshold = graphEdgeWeakThreshold.subscribe((v) => {
      currentEdgeWeakThreshold = v
      if (currentData && graph) feedData(currentData)
    })

    // Loading state → when loading clears with data ready, initialize graph
    unsubLoading = graphLoading.subscribe(async (v) => {
      currentLoading = v
      // When loading finishes and data is available but graph isn't initialized yet,
      // wait for Svelte to render the {:else} block then initialize
      if (!v && currentData && currentData.nodes.length > 0 && !graph && webglSupported) {
        await tick()
        if (graphContainerEl && !graph) {
          await initializeGraph()
          syncGraphSize()
          feedData(currentData)
        }
      }
    })
    unsubError = graphError.subscribe((v) => {
      currentError = v
    })

    // Level change → reconfigure forces for new level
    // setGraphLevel() calls loadGraphData(), which triggers graphData subscription
    // → feedData() rebuilds graph data with level-appropriate sizing and forces.
    // Document mode: degree-based node sizing, wider link distances, arrows (subtask 3-2)
    // Chunk mode: size-based node sizing, tighter link distances, no arrows
    unsubLevel = graphLevel.subscribe((v) => {
      const prevLevel = currentLevel
      currentLevel = v
      if (prevLevel !== v && graph) {
        // Pre-configure forces so any in-flight simulation uses correct params
        // (feedData will reconfigure again when new data arrives)
        configureForces(v)
      }
    })
  }

  // ─── Resize Handling ────────────────────────────────────────────────

  /**
   * Sync the graph's width/height to match the outer container.
   * Called after graph init and on resize to ensure the WebGL viewport
   * and camera aspect ratio match the actual DOM layout.
   */
  function syncGraphSize() {
    if (!containerEl || !graph) return
    const rect = containerEl.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      graph.width(rect.width)
      graph.height(rect.height)
    }
  }

  function setupResizeObserver() {
    if (!containerEl) return

    resizeObs = new ResizeObserver(() => syncGraphSize())
    resizeObs.observe(containerEl)

    // Initial sizing
    syncGraphSize()
  }

  // ─── Interaction Handlers ───────────────────────────────────────────

  /**
   * Track mouse position on the container for tooltip positioning.
   * Also updates tooltip coordinates while a node or edge is hovered.
   */
  function handleMouseMove(e: MouseEvent) {
    lastMouseX = e.clientX
    lastMouseY = e.clientY
    if (hoveredNode || hoveredEdge) {
      tooltipX = e.clientX
      tooltipY = e.clientY
    }
  }

  /**
   * Convert a ForceNode to a GraphNode for store operations.
   */
  function toGraphNode(node: ForceNode): GraphNode {
    return {
      id: node.id,
      path: node.path,
      label: node.label,
      cluster_id: node.cluster_id,
      chunk_index: node.chunk_index
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Cmd/Ctrl+F: toggle graph search overlay
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      graphSearchVisible = !graphSearchVisible
      if (graphSearchVisible) {
        tick().then(() => {
          const input = containerEl?.querySelector('.graph-search-input') as HTMLInputElement | null
          input?.focus()
        })
      }
      return
    }

    // '/': open graph search (only when not typing in an input)
    if (e.key === '/' && !graphSearchVisible) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isEditable = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.hasAttribute('contenteditable')
      if (!isEditable) {
        e.preventDefault()
        graphSearchVisible = true
        tick().then(() => {
          const input = containerEl?.querySelector('.graph-search-input') as HTMLInputElement | null
          input?.focus()
        })
        return
      }
    }

    if (e.key === 'Escape') {
      if (graphSearchVisible) {
        clearGraphSearch()
        graphSearchVisible = false
        return
      }
      if (contextMenuNode) {
        contextMenuNode = null
        return
      }
      selectGraphNode(null)
      setGraphHighlightedFolder(null)
      hoveredNode = null
      hoveredEdge = null
      return
    }

    // Arrow key navigation between connected nodes
    if (
      currentSelected &&
      graph &&
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    ) {
      e.preventDefault()
      navigateToConnectedNode(e.key)
    }
  }

  /**
   * Navigate to the closest connected node in the given arrow direction.
   * Projects 3D positions to screen space using the camera, then picks
   * the neighbor whose screen-space direction best matches the arrow key.
   */
  function navigateToConnectedNode(key: string) {
    if (!currentSelected || !graph) return

    const graphD = graph.graphData()
    const nodes = graphD.nodes as ForceNode[]
    const links = graphD.links as ForceLink[]

    // Find the currently selected ForceNode (with 3D coordinates)
    const selectedForceNode = nodes.find((n) => n.id === currentSelected!.id)
    if (!selectedForceNode || selectedForceNode.x == null) return

    // Get the Three.js camera and renderer size for projection
    const camera = graph.camera() as THREE.PerspectiveCamera
    const renderer = graph.renderer() as THREE.WebGLRenderer
    if (!camera || !renderer) return
    const width = renderer.domElement.clientWidth
    const height = renderer.domElement.clientHeight

    // Project a 3D node position to 2D screen coordinates
    function toScreen(node: ForceNode): { x: number; y: number } | null {
      if (node.x == null || node.y == null || node.z == null) return null
      const v = new THREE.Vector3(node.x, node.y, node.z)
      v.project(camera)
      return {
        x: ((v.x + 1) / 2) * width,
        y: ((-v.y + 1) / 2) * height
      }
    }

    const selectedScreen = toScreen(selectedForceNode)
    if (!selectedScreen) return

    // Collect connected neighbor nodes with their screen positions
    const neighbors: { node: ForceNode; sx: number; sy: number }[] = []
    for (const link of links) {
      const srcId = linkNodeId(link.source)
      const tgtId = linkNodeId(link.target)
      let neighborId: string | null = null
      if (srcId === currentSelected!.id) neighborId = tgtId
      else if (tgtId === currentSelected!.id) neighborId = srcId
      if (!neighborId) continue

      const neighborNode = nodes.find((n) => n.id === neighborId)
      if (!neighborNode) continue

      const screen = toScreen(neighborNode)
      if (!screen) continue

      // Avoid duplicates (bidirectional edges)
      if (!neighbors.some((n) => n.node.id === neighborNode.id)) {
        neighbors.push({ node: neighborNode, sx: screen.x, sy: screen.y })
      }
    }

    if (neighbors.length === 0) return

    // Direction vector for the arrow key (screen space: +x right, +y down)
    let dirX = 0
    let dirY = 0
    switch (key) {
      case 'ArrowUp':
        dirY = -1
        break
      case 'ArrowDown':
        dirY = 1
        break
      case 'ArrowLeft':
        dirX = -1
        break
      case 'ArrowRight':
        dirX = 1
        break
    }

    // Score each neighbor: prefer nodes in the arrow direction.
    // Score = dot(normalized_offset, direction) / distance — higher is better.
    // Only consider nodes in the correct half-plane (dot product > 0).
    let bestNode: ForceNode | null = null
    let bestScore = -Infinity
    for (const nb of neighbors) {
      const dx = nb.sx - selectedScreen.x
      const dy = nb.sy - selectedScreen.y
      const dist = Math.hypot(dx, dy)
      if (dist < 1) continue // Skip overlapping nodes

      const dot = (dx * dirX + dy * dirY) / dist
      if (dot <= 0.3) continue // Must be at least roughly in the right direction

      // Weight by alignment and penalize distance
      const score = dot / Math.sqrt(dist)
      if (score > bestScore) {
        bestScore = score
        bestNode = nb.node
      }
    }

    if (bestNode) {
      selectGraphNode(toGraphNode(bestNode))
    }
  }

  function handleRetry() {
    loadGraphData()
  }

  function handleContextMenuOpen() {
    if (!contextMenuNode) return
    const node = contextMenuNode
    openGraphNode({
      id: node.id,
      path: node.path,
      label: node.label,
      cluster_id: node.cluster_id,
      chunk_index: node.chunk_index
    })
    contextMenuNode = null
  }

  function handleContextMenuSelect() {
    if (!contextMenuNode) return
    const node = contextMenuNode
    selectGraphNode({
      id: node.id,
      path: node.path,
      label: node.label,
      cluster_id: node.cluster_id,
      chunk_index: node.chunk_index
    })
    contextMenuNode = null
  }

  function toggleLegend() {
    legendVisible = !legendVisible
  }

  // ─── Legend Helpers ─────────────────────────────────────────────────

  /** Get cluster items for legend display. */
  function getClusters(): { id: number; label: string; color: string; member_count: number }[] {
    if (!currentData) return []
    return currentData.clusters.map((c) => ({
      id: c.id,
      label: c.label,
      color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
      member_count: c.member_count
    }))
  }

  /** Get legend items for folder coloring mode. */
  function getFolderLegendItems(): { folder: string; color: string; count: number }[] {
    if (!currentGraph3DData) return []
    const counts = new Map<string, number>()
    for (const node of currentGraph3DData.nodes) {
      const folder = getTopLevelFolder(node.path)
      counts.set(folder, (counts.get(folder) ?? 0) + 1)
    }
    const items: { folder: string; color: string; count: number }[] = []
    for (const [folder, color] of folderColorMap) {
      items.push({ folder, color, count: counts.get(folder) ?? 0 })
    }
    return items.sort((a, b) => a.folder.localeCompare(b.folder))
  }

  /** Get unique edge clusters present in the current edges for legend display. */
  function getEdgeClusters(): { id: number; color: string; label: string; count: number }[] {
    if (!currentGraph3DData) return []
    const counts = new Map<number, { label: string; count: number }>()
    for (const link of currentGraph3DData.links) {
      if (link.edge_cluster_id == null) continue
      const existing = counts.get(link.edge_cluster_id)
      if (existing) {
        existing.count++
      } else {
        counts.set(link.edge_cluster_id, {
          label: link.relationship_type ?? `Type ${link.edge_cluster_id}`,
          count: 1
        })
      }
    }
    return Array.from(counts.entries())
      .map(([id, info]) => ({
        id,
        color: edgeClusterColor(id),
        label: info.label,
        count: info.count
      }))
      .sort((a, b) => a.id - b.id)
  }

  /** Check if a given edge cluster is currently filtered out. */
  function isEdgeClusterFiltered(clusterId: number): boolean {
    if (currentEdgeFilter.size === 0) return false
    return !currentEdgeFilter.has(clusterId)
  }

  // ─── Graph Initialization ────────────────────────────────────────────

  /**
   * Initialize the 3d-force-graph instance.
   * Called lazily when graphContainerEl becomes available (after data loads
   * and Svelte renders the {:else} block with the container div).
   */
  async function initializeGraph() {
    if (!graphContainerEl || graph) return

    // Dynamic import for Electron compatibility (avoids SSR/Node.js issues)
    const ForceGraph3DModule = await import('3d-force-graph')
    const ForceGraph3D = ForceGraph3DModule.default

    // Get container dimensions before init (3d-force-graph defaults to window size)
    const rect = containerEl?.getBoundingClientRect()
    const initWidth = rect?.width || graphContainerEl.clientWidth || 800
    const initHeight = rect?.height || graphContainerEl.clientHeight || 600

    // Initialize 3d-force-graph with PRD configuration values
    graph = new ForceGraph3D(graphContainerEl, {
      controlType: 'orbit'
    })
      .width(initWidth)
      .height(initHeight)
      .backgroundColor('#0a0a0b')
      .showNavInfo(false)
      .nodeOpacity(0.85)
      .linkOpacity(0.15)
      .warmupTicks(100)
      .cooldownTime(5000)
      .d3AlphaDecay(0.02)
      .d3VelocityDecay(0.4)
      // Small dot-like nodes: nodeRelSize controls px³ per val unit
      // Low value = tiny particle-like dots (Cosmograph style)
      .nodeRelSize(2)
      .nodeResolution(8)
      // Node sizing: val field drives sphere volume
      .nodeVal((node: ForceNode) => node.val)
      // Node color: dynamic accessor reads current coloring mode on each render
      .nodeColor((node: ForceNode) => getNodeColor(node))
      // Link color: pre-computed by buildGraph3DData (edge cluster palette, weak edges at low opacity)
      .linkColor((link: ForceLink) => link.color)
      // Link width: 0 = ThreeJS Line (constant 1px hairline, very fast)
      .linkWidth(0)
      // Directional arrows: visible in document mode, hidden in chunk mode (symmetric similarity)
      .linkDirectionalArrowLength((_link: ForceLink) => (isChunkMode() ? 0 : 6))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowResolution(4)
      .linkDirectionalArrowColor((link: ForceLink) => getLinkArrowColor(link))
      // Directional particles: animate on selected node's neighbor edges
      .linkDirectionalParticles((link: ForceLink) => {
        if (!currentSelected) return 0
        const srcId = linkNodeId(link.source)
        const tgtId = linkNodeId(link.target)
        return srcId === currentSelected.id || tgtId === currentSelected.id ? 2 : 0
      })
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1)
      .linkDirectionalParticleResolution(6)
      .linkDirectionalParticleColor(() => '#ffffff')
      // Custom particle object: additive-blended sphere that glows like light
      .linkDirectionalParticleThreeObject(() => {
        const geo = new THREE.SphereGeometry(0.2, 6, 4)
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
        return new THREE.Mesh(geo, mat)
      })
      // Hub node glow: custom THREE.Group with emissive sphere + halo for high-degree nodes (degree >= 5)
      // Returns false for low-degree nodes to use default sphere rendering.
      .nodeThreeObject(((node: ForceNode) => {
        const degree = degreeMap.get(node.id) ?? 0
        if (degree < 5) return false
        return createHubNodeObject(node, 0.9)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any)
      // Disable built-in tooltips — we use custom HTML overlays instead
      .nodeLabel(() => '')
      .linkLabel(() => '') as GraphInstance

    // ─── Event Handlers ──────────────────────────────────────────────

    // Node click: first click selects, second click on same node opens in side panel
    graph.onNodeClick((node: ForceNode, _event: MouseEvent) => {
      const graphNode = toGraphNode(node)
      if (currentSelected && currentSelected.id === node.id) {
        openGraphNode(graphNode)
      } else {
        selectGraphNode(graphNode)
      }
      // Close context menu if open
      contextMenuNode = null
    })

    // Background click: clear selection and context menu
    graph.onBackgroundClick((_event: MouseEvent) => {
      selectGraphNode(null)
      contextMenuNode = null
    })

    // Right-click on node: show context menu at click position
    graph.onNodeRightClick((node: ForceNode, event: MouseEvent) => {
      event.preventDefault()
      contextMenuNode = node
      contextMenuX = event.clientX
      contextMenuY = event.clientY
    })

    // Node hover: update hovered node state for tooltip display
    graph.onNodeHover((node: ForceNode | null) => {
      hoveredNode = node
      if (node) {
        tooltipX = lastMouseX
        tooltipY = lastMouseY
      }
    })

    // Link hover: update hovered edge state for edge tooltip display
    graph.onLinkHover((link: ForceLink | null) => {
      hoveredEdge = link
      if (link) {
        tooltipX = lastMouseX
        tooltipY = lastMouseY
      }
    })

    // Node drag end: unpin node so simulation can reposition it
    graph.onNodeDragEnd((node: ForceNode) => {
      node.fx = undefined
      node.fy = undefined
      node.fz = undefined
    })

    // Engine tick: throttled cluster sphere + centroid updates during simulation
    graph.onEngineTick(handleEngineTick)

    // Engine stop: final cluster sphere update when simulation completes
    graph.onEngineStop(handleEngineStop)

    // Configure cluster-aware forces
    configureForces(currentLevel)

    // Start proximity label update loop
    if (labelFrameId === null) {
      labelFrameId = requestAnimationFrame(updateProximityLabels)
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  onMount(() => {
    // Check WebGL support before anything else
    if (!checkWebGLSupport()) {
      webglSupported = false
    }

    // 1. Set up store subscriptions FIRST (unconditionally).
    //    This populates currentData, currentLoading, currentError which drive
    //    the conditional template rendering. When graphData arrives and the
    //    {:else} block renders graphContainerEl, the subscription lazily
    //    initializes the graph via initializeGraph().
    setupStoreSubscriptions()

    // 2. Set up resize observer on the outer container (always rendered)
    setupResizeObserver()

    // 3. Add keyboard and mouse listeners
    window.addEventListener('keydown', handleKeyDown)
    containerEl?.addEventListener('mousemove', handleMouseMove)
  })

  onDestroy(() => {
    // Stop label update loop
    if (labelFrameId !== null) {
      cancelAnimationFrame(labelFrameId)
      labelFrameId = null
    }

    // Clean up cluster sphere meshes before disposing graph
    clearClusterMeshes()

    // Dispose 3d-force-graph (cleans up ThreeJS renderer, scene, controls)
    if (graph) {
      graph._destructor()
      graph = null
    }

    // Remove keyboard listener
    window.removeEventListener('keydown', handleKeyDown)

    // Remove mouse tracking listener
    containerEl?.removeEventListener('mousemove', handleMouseMove)

    // Disconnect resize observer
    resizeObs?.disconnect()

    // Unsubscribe from all stores
    unsubData?.()
    unsubColoring?.()
    unsubSelected?.()
    unsubFilePath?.()
    unsubPathFilter?.()
    unsubHighlightedFolder?.()
    unsubHoveredFilePath?.()
    unsubEdgeFilter?.()
    unsubSemanticEdges?.()
    unsubEdgeWeakThreshold?.()
    unsubLoading?.()
    unsubError?.()
    unsubLevel?.()
  })
</script>

<div class="graph-view" bind:this={containerEl}>
  <!-- 3d-force-graph container: ALWAYS mounted so WebGL context survives tab switches.
       Hidden until data is available via CSS visibility. -->
  <div
    bind:this={graphContainerEl}
    class="graph-3d-container"
    style:visibility={currentData && currentData.nodes.length > 0 && !currentError && webglSupported ? 'visible' : 'hidden'}
  ></div>

  {#if currentLoading && !graph}
    <!-- Only show full loading overlay on first load (no graph yet).
         Tab switches keep the graph visible while new data loads. -->
    <div class="graph-empty">
      <span class="material-symbols-outlined spinning">progress_activity</span>
      <p>Loading graph data…</p>
    </div>
  {:else if currentError}
    <div class="graph-empty">
      <span class="material-symbols-outlined error-icon">error</span>
      <p>{currentError}</p>
      <button class="retry-btn" onclick={handleRetry}>Retry</button>
    </div>
  {:else if !webglSupported}
    <div class="graph-empty">
      <span class="material-symbols-outlined error-icon">warning</span>
      <p>WebGL is not supported</p>
      <p class="graph-empty-hint">
        3D graph visualization requires WebGL support. Please use a browser or environment with
        WebGL enabled.
      </p>
    </div>
  {:else if !currentData || currentData.nodes.length === 0}
    <div class="graph-empty">
      <span class="material-symbols-outlined">hub</span>
      <p>No files indexed. Run ingest to build the graph.</p>
    </div>
  {/if}

  <!-- Proximity node labels (document mode only, distance-based) -->
  {#if visibleLabels.length > 0}
    <div class="proximity-labels">
      {#each visibleLabels as lbl (lbl.id)}
        <span class="proximity-label" style="left: {lbl.x}px; top: {lbl.y}px">{lbl.label}</span>
      {/each}
    </div>
  {/if}

  {#if currentData && currentData.nodes.length > 0 && !currentError && webglSupported}
    <!-- Level tab switcher -->
    <div class="graph-level-switcher" role="tablist">
      <button
        class="level-tab"
        class:active={currentLevel === 'document'}
        onclick={() => setGraphLevel('document')}>Documents</button
      >
      <button
        class="level-tab"
        class:active={currentLevel === 'chunk'}
        onclick={() => setGraphLevel('chunk')}>Chunks</button
      >
    </div>

    <!-- Graph search overlay -->
    {#if graphSearchVisible}
      <div
        class="graph-search-overlay"
        style="left: {searchPanelX}px; bottom: {searchPanelY}px;"
      >
        <span
          class="graph-search-drag-handle"
          class:grabbing={isDraggingSearch}
          onpointerdown={(e) => {
            isDraggingSearch = true
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onpointermove={(e) => {
            if (!isDraggingSearch || !containerEl) return
            const rect = containerEl.getBoundingClientRect()
            searchPanelX = Math.max(0, Math.min(e.clientX - rect.left - 12, rect.width - 280))
            searchPanelY = Math.max(0, Math.min(rect.bottom - e.clientY - 12, rect.height - 48))
          }}
          onpointerup={(e) => {
            isDraggingSearch = false
            ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
          }}
        >
          <span class="material-symbols-outlined" style="font-size: 14px; opacity: 0.4;">drag_indicator</span>
        </span>
        <span class="material-symbols-outlined" style="font-size: 16px; opacity: 0.5;">search</span>
        <input
          type="text"
          class="graph-search-input"
          placeholder="Search graph…"
          value={graphSearchQuery}
          oninput={(e) => onGraphSearchInput((e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key !== 'Escape' && !((e.metaKey || e.ctrlKey) && e.key === 'f')) {
              e.stopPropagation()
            }
          }}
        />
        {#if graphSearchQuery.length > 0}
          <button class="graph-search-clear" onclick={clearGraphSearch} title="Clear search">×</button>
        {/if}
        {#if graphSearchLoading}
          <span class="material-symbols-outlined spinning" style="font-size: 16px; opacity: 0.5;">progress_activity</span>
        {/if}
        {#if graphSearchError}
          <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-error, #ef4444);" title={graphSearchError}>error</span>
        {/if}
        {#if graphSearchQuery.length >= 2 && !graphSearchLoading && !graphSearchError}
          <span class="graph-search-count">
            {graphSearchResultCount > 0 ? `${graphSearchResultCount} file${graphSearchResultCount === 1 ? '' : 's'}` : 'No matches'}
          </span>
        {/if}
      </div>
    {/if}

    <!-- Path filter badge -->
    {#if currentPathFilter}
      <div class="graph-path-badge">
        <span class="material-symbols-outlined path-badge-icon">folder</span>
        <span class="path-badge-text">{currentPathFilter}</span>
        <button
          class="path-badge-close"
          onclick={() => setGraphPathFilter(null)}
          title="Clear path filter">×</button
        >
      </div>
    {/if}

    <!-- Folder highlight badge -->
    {#if currentHighlightedFolder}
      <div class="graph-folder-badge" class:has-path-filter={!!currentPathFilter}>
        <span class="material-symbols-outlined folder-badge-icon">folder_open</span>
        <span class="folder-badge-text">{currentHighlightedFolder}</span>
        <button
          class="folder-badge-close"
          onclick={() => setGraphHighlightedFolder(null)}
          title="Clear folder highlight">×</button
        >
      </div>
    {/if}

    <!-- Cluster enclosure labels (screen-projected from 3D centroids) -->
    {#if currentColoringMode === 'cluster' && clusterLabels.length > 0}
      {#each clusterLabels as label}
        {#if label.visible}
          <div
            class="cluster-label"
            style="left: {label.screenX}px; top: {label.screenY}px; color: {CLUSTER_COLORS[
              label.id % CLUSTER_COLORS.length
            ]}"
          >
            {label.label}
          </div>
        {/if}
      {/each}
    {/if}

    {#if currentData.edges.length === 0 && currentLevel !== 'chunk'}
      <div class="graph-notice">No link connections found.</div>
    {/if}

    {#if nodeCount > 2000}
      <div class="graph-notice warning">
        Very large graph ({nodeCount} nodes). Visual quality reduced for performance.
      </div>
    {:else if nodeCount > 500}
      <div class="graph-notice warning">
        Large graph ({nodeCount} nodes). Some effects disabled for performance.
      </div>
    {/if}

    <!-- Node tooltip (populated by hover handler in subtask 2-2) -->
    {#if hoveredNode}
      <div class="graph-tooltip" style="left: {tooltipX + 12}px; top: {tooltipY - 30}px">
        <div class="tooltip-path">{hoveredNode.path}</div>
        {#if isChunkMode() && hoveredNode.label}
          <div class="tooltip-heading">{hoveredNode.label}</div>
        {/if}
        {#if hoveredNode.cluster_id != null && currentData}
          {@const cluster = currentData.clusters.find((c) => c.id === hoveredNode!.cluster_id)}
          {#if cluster}
            <div class="tooltip-cluster">{cluster.label}</div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Edge tooltip (populated by hover handler in subtask 2-2) -->
    {#if hoveredEdge && !hoveredNode}
      {@const edgeSrc =
        hoveredEdge.source && typeof hoveredEdge.source === 'object'
          ? (hoveredEdge.source as ForceNode)
          : null}
      {@const edgeTgt =
        hoveredEdge.target && typeof hoveredEdge.target === 'object'
          ? (hoveredEdge.target as ForceNode)
          : null}
      <div
        class="graph-tooltip edge-tooltip"
        style="left: {tooltipX + 12}px; top: {tooltipY - 30}px"
      >
        {#if hoveredEdge.relationship_type}
          <div class="edge-tooltip-type">
            <span
              class="edge-tooltip-dot"
              style="background: {hoveredEdge.edge_cluster_id != null
                ? edgeClusterColor(hoveredEdge.edge_cluster_id)
                : 'rgba(255,255,255,0.5)'}"
            ></span>
            {hoveredEdge.relationship_type}
          </div>
        {/if}
        {#if edgeSrc && edgeTgt}
          <div class="edge-tooltip-nodes">{edgeSrc.path} → {edgeTgt.path}</div>
        {/if}
        {#if hoveredEdge.strength != null}
          <div class="edge-tooltip-strength">
            <span class="edge-tooltip-strength-label">Strength</span>
            <div class="edge-tooltip-bar">
              <div
                class="edge-tooltip-bar-fill"
                style="width: {Math.round((hoveredEdge.strength ?? 0) * 100)}%"
              ></div>
            </div>
            <span class="edge-tooltip-strength-value"
              >{Math.round((hoveredEdge.strength ?? 0) * 100)}%</span
            >
          </div>
        {/if}
        {#if hoveredEdge.context_text}
          <div class="edge-tooltip-context">
            {hoveredEdge.context_text.length > 120
              ? hoveredEdge.context_text.slice(0, 120) + '…'
              : hoveredEdge.context_text}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Context menu -->
    {#if contextMenuNode}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div
        class="context-menu-backdrop"
        onclick={() => (contextMenuNode = null)}
        oncontextmenu={(e) => {
          e.preventDefault()
          contextMenuNode = null
        }}
      ></div>
      <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px">
        <div class="context-menu-header">{contextMenuNode.path.split('/').pop()}</div>
        <button class="context-menu-item" onclick={handleContextMenuOpen}>
          <span class="material-symbols-outlined">preview</span>
          Open in side panel
        </button>
        <button class="context-menu-item" onclick={handleContextMenuSelect}>
          <span class="material-symbols-outlined">radio_button_checked</span>
          Select node
        </button>
      </div>
    {/if}

    <!-- Legend: tri-state coloring mode -->
    {#if currentColoringMode === 'none'}
      <div class="graph-legend-collapsed">
        <button class="legend-toggle" onclick={cycleColoringMode} title="Color by clusters">
          <span class="material-symbols-outlined">visibility_off</span>
        </button>
      </div>
    {:else if (currentColoringMode === 'cluster' && getClusters().length > 0) || (currentColoringMode === 'folder' && folderColorMap.size > 0)}
      <div class="graph-legend">
        <div class="legend-header">
          <span class="legend-title"
            >{currentColoringMode === 'cluster' ? 'Clusters' : 'Folders'}</span
          >
          <button
            class="legend-toggle"
            onclick={cycleColoringMode}
            title={currentColoringMode === 'cluster' ? 'Color by folders' : 'No coloring'}
          >
            <span class="material-symbols-outlined"
              >{currentColoringMode === 'cluster' ? 'category' : 'folder'}</span
            >
          </button>
          <button
            class="legend-toggle"
            onclick={toggleLegend}
            title={legendVisible ? 'Hide legend' : 'Show legend'}
          >
            <span class="material-symbols-outlined"
              >{legendVisible ? 'expand_less' : 'expand_more'}</span
            >
          </button>
        </div>
        {#if legendVisible}
          <div class="legend-items">
            {#if currentColoringMode === 'cluster'}
              {#each getClusters() as cluster}
                <div class="legend-item">
                  <span class="legend-dot" style="background: {cluster.color}"></span>
                  <span class="legend-label">{cluster.label}</span>
                  <span class="legend-count">{cluster.member_count}</span>
                </div>
              {/each}
            {:else if currentColoringMode === 'folder'}
              {#each getFolderLegendItems() as item}
                <button
                  class="legend-item legend-item-clickable"
                  class:legend-item-active={currentHighlightedFolder === item.folder}
                  onclick={() => setGraphHighlightedFolder(item.folder)}
                  title={currentHighlightedFolder === item.folder
                    ? `Clear ${item.folder} highlight`
                    : `Highlight ${item.folder}`}
                >
                  <span class="legend-dot" style="background: {item.color}"></span>
                  <span class="legend-label">{item.folder}</span>
                  <span class="legend-count">{item.count}</span>
                </button>
              {/each}
              {#if currentHighlightedFolder}
                <button
                  class="legend-clear-filter"
                  onclick={() => setGraphHighlightedFolder(null)}
                  title="Clear folder highlight"
                  style="margin-top: 4px; width: 100%;"
                >
                  <span class="material-symbols-outlined" style="font-size: 14px;"
                    >filter_alt_off</span
                  >
                  <span style="font-size: 10px;">Clear</span>
                </button>
              {/if}
            {/if}
            {#if getEdgeClusters().length > 0}
              <div class="legend-separator"></div>
              <div class="legend-section-title">
                <span>Edge Types</span>
                {#if currentEdgeFilter.size > 0}
                  <button
                    class="legend-clear-filter"
                    onclick={clearEdgeFilter}
                    title="Show all edges"
                  >
                    <span class="material-symbols-outlined">filter_alt_off</span>
                  </button>
                {/if}
              </div>
              {#each getEdgeClusters() as ec}
                <button
                  class="legend-item legend-item-clickable"
                  class:legend-item-muted={isEdgeClusterFiltered(ec.id)}
                  onclick={() => toggleEdgeClusterFilter(ec.id)}
                  title={isEdgeClusterFiltered(ec.id)
                    ? `Show ${ec.label} edges`
                    : `Hide ${ec.label} edges`}
                >
                  <span class="legend-line" style="background: {ec.color}"></span>
                  <span class="legend-label">{ec.label}</span>
                  <span class="legend-count">{ec.count}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .graph-view {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #0a0a0b;
    min-width: 0;
    min-height: 0;
  }

  .proximity-labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    overflow: hidden;
  }

  .proximity-label {
    position: absolute;
    transform: translate(-50%, -100%) translateY(-6px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: rgba(228, 228, 231, 0.7);
    white-space: nowrap;
    text-shadow: 0 0 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.6);
    transition: left 60ms linear, top 60ms linear, opacity 200ms ease;
  }

  .graph-3d-container {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /*
   * 3d-force-graph sets canvas pixel dimensions via graph.width()/graph.height().
   * Do NOT override with CSS width/height: 100% — that stretches the pixel buffer
   * and causes blurriness or sizing mismatches. Only set display: block to remove
   * the inline-block baseline gap.
   */
  .graph-3d-container :global(canvas) {
    display: block;
  }

  /* Style 3d-force-graph's built-in tooltip container */
  .graph-3d-container :global(.float-tooltip-kap) {
    background: var(--color-surface, #161617) !important;
    border: 1px solid var(--color-border, #27272a) !important;
    border-radius: var(--radius-md, 0.375rem) !important;
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem) !important;
    font-family: var(--font-display, 'Space Grotesk', sans-serif) !important;
    font-size: var(--text-sm, 0.75rem) !important;
    color: var(--color-text, #e4e4e7) !important;
    max-width: 320px !important;
    z-index: var(--z-overlay, 40);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  /* Tooltip title: file path or relationship type */
  .graph-3d-container :global(.graph-tooltip-title) {
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
    word-break: break-all;
  }

  /* Tooltip metadata: cluster label, chunk heading, strength */
  .graph-3d-container :global(.graph-tooltip-meta) {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-1, 0.25rem);
  }

  /* Tooltip context text: italic excerpt */
  .graph-3d-container :global(.graph-tooltip-context) {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-2, 0.5rem);
    line-height: 1.4;
    font-style: italic;
  }

  .cluster-label {
    position: absolute;
    transform: translate(-50%, -50%);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: 14px;
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
    text-shadow:
      0 0 6px rgba(0, 0, 0, 0.9),
      0 0 12px rgba(0, 0, 0, 0.6);
    opacity: 0.85;
    transition: left 60ms linear, top 60ms linear;
    z-index: 5;
  }

  .graph-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3, 0.75rem);
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-base, 0.875rem);
  }

  .graph-empty .material-symbols-outlined {
    font-size: 48px;
    opacity: 0.4;
  }

  .graph-empty .error-icon {
    color: var(--color-error, #ef4444);
    opacity: 0.8;
  }

  .graph-empty-hint {
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-sm, 0.75rem);
    max-width: 320px;
    text-align: center;
    line-height: 1.5;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .retry-btn {
    margin-top: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00e5ff);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-sm, 0.75rem);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
  }

  .retry-btn:hover {
    background: var(--color-border, #27272a);
  }

  .graph-notice {
    position: absolute;
    bottom: var(--space-4, 1rem);
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-sm, 0.75rem);
    pointer-events: none;
  }

  .graph-notice.warning {
    border-color: var(--color-warning, #f59e0b);
    color: var(--color-warning, #f59e0b);
  }

  .graph-tooltip {
    position: fixed;
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    pointer-events: none;
    z-index: var(--z-overlay, 40);
    max-width: 300px;
  }

  .tooltip-path {
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 0.75rem);
    word-break: break-all;
  }

  .tooltip-heading {
    color: var(--color-primary, #00e5ff);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-1, 0.25rem);
  }

  .tooltip-cluster {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-1, 0.25rem);
  }

  .edge-tooltip {
    max-width: 320px;
  }

  .edge-tooltip-type {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
  }

  .edge-tooltip-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full, 9999px);
    flex-shrink: 0;
  }

  .edge-tooltip-nodes {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-1, 0.25rem);
    word-break: break-all;
  }

  .edge-tooltip-strength {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    margin-top: var(--space-2, 0.5rem);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
  }

  .edge-tooltip-strength-label {
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .edge-tooltip-bar {
    flex: 1;
    height: 4px;
    background: var(--color-border, #27272a);
    border-radius: 2px;
    overflow: hidden;
    min-width: 60px;
  }

  .edge-tooltip-bar-fill {
    height: 100%;
    background: var(--color-primary, #00e5ff);
    border-radius: 2px;
    transition: width var(--transition-fast, 150ms ease);
  }

  .edge-tooltip-strength-value {
    color: var(--color-text, #e4e4e7);
    flex-shrink: 0;
    min-width: 30px;
    text-align: right;
  }

  .edge-tooltip-context {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-2, 0.5rem);
    line-height: 1.4;
    font-style: italic;
  }

  /* Context menu */
  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .context-menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .context-menu-header {
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--color-text-dim, #71717a);
    border-bottom: 1px solid var(--color-border, #27272a);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--color-text-main, #e4e4e7);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .context-menu-item:hover {
    background: rgba(0, 229, 255, 0.08);
    color: var(--color-primary, #00e5ff);
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  .graph-legend-collapsed {
    position: absolute;
    top: var(--space-4, 1rem);
    right: var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    padding: var(--space-1, 0.25rem);
    z-index: var(--z-base, 10);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .graph-legend {
    position: absolute;
    top: var(--space-4, 1rem);
    right: var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    padding: var(--space-2, 0.5rem);
    max-height: 300px;
    overflow-y: auto;
    z-index: var(--z-base, 10);
    min-width: 140px;
  }

  .legend-header {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding-bottom: var(--space-2, 0.5rem);
  }

  .legend-title {
    flex: 1;
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
    color: var(--color-text, #e4e4e7);
  }

  .legend-toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-dim, #71717a);
    display: flex;
    align-items: center;
  }

  .legend-toggle .material-symbols-outlined {
    font-size: 18px;
  }

  .legend-toggle:hover {
    color: var(--color-text, #e4e4e7);
  }

  .legend-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full, 9999px);
    flex-shrink: 0;
  }

  .legend-label {
    flex: 1;
    color: var(--color-text, #e4e4e7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .legend-count {
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .legend-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: var(--space-2, 0.5rem) 0;
  }

  .legend-section-title {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    font-weight: var(--weight-medium, 500);
    color: var(--color-text-dim, #71717a);
    margin-bottom: var(--space-1, 0.25rem);
  }

  .legend-section-title span {
    flex: 1;
  }

  .legend-clear-filter {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-dim, #71717a);
    display: flex;
    align-items: center;
  }

  .legend-clear-filter .material-symbols-outlined {
    font-size: 14px;
  }

  .legend-clear-filter:hover {
    color: var(--color-text, #e4e4e7);
  }

  .legend-item-clickable {
    background: none;
    border: none;
    padding: var(--space-1, 0.25rem) 0;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .legend-item-clickable:hover {
    opacity: 0.8;
  }

  .legend-item-muted {
    opacity: 0.35;
  }

  .legend-item-active {
    background: rgba(0, 229, 255, 0.1);
    border-radius: 4px;
  }

  .legend-line {
    width: 12px;
    height: 3px;
    border-radius: 1.5px;
    flex-shrink: 0;
  }

  .graph-level-switcher {
    position: absolute;
    top: var(--space-3, 0.75rem);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    z-index: var(--z-base, 10);
    overflow: hidden;
  }

  .level-tab {
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }

  .level-tab:not(:last-child) {
    border-right: 1px solid var(--color-border, #27272a);
  }

  .level-tab.active {
    color: var(--color-primary, #00e5ff);
    background: rgba(0, 229, 255, 0.08);
  }

  .graph-path-badge {
    position: absolute;
    top: var(--space-3, 0.75rem);
    left: var(--space-3, 0.75rem);
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    z-index: var(--z-base, 10);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text, #e4e4e7);
  }

  .path-badge-icon {
    font-size: 14px;
    color: var(--color-text-dim, #71717a);
  }

  .path-badge-text {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-badge-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-size: 14px;
    cursor: pointer;
    border-radius: 2px;
    transition: color var(--transition-fast, 150ms ease);
  }

  .path-badge-close:hover {
    color: var(--color-text, #e4e4e7);
  }

  .graph-folder-badge {
    position: absolute;
    top: var(--space-3, 0.75rem);
    left: var(--space-3, 0.75rem);
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    background: var(--color-surface, #161617);
    border: 1px solid #00e5ff40;
    border-radius: var(--radius-md, 0.375rem);
    z-index: var(--z-base, 10);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text, #e4e4e7);
  }

  .graph-folder-badge.has-path-filter {
    top: calc(var(--space-3, 0.75rem) + 32px);
  }

  .folder-badge-icon {
    font-size: 14px;
    color: #00e5ff;
  }

  .folder-badge-text {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-badge-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-size: 14px;
    cursor: pointer;
    border-radius: 2px;
    transition: color var(--transition-fast, 150ms ease);
  }

  .folder-badge-close:hover {
    color: var(--color-text, #e4e4e7);
  }

  /* ─── Graph Search Overlay ─────────────────────────────────────── */

  .graph-search-overlay {
    z-index: 15;
    position: absolute;
    background: var(--color-surface, #161617);
    backdrop-filter: blur(12px);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 0.375rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 280px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
  }

  .graph-search-drag-handle {
    cursor: grab;
    touch-action: none;
    display: flex;
    align-items: center;
  }

  .graph-search-drag-handle.grabbing {
    cursor: grabbing;
  }

  .graph-search-input {
    flex: 1;
    background: transparent;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 0.75rem);
    color: var(--color-text, #e4e4e7);
    outline: none;
    border: none;
    min-width: 0;
  }

  .graph-search-input::placeholder {
    color: var(--color-text-dim, #71717a);
  }

  .graph-search-clear {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    font-size: 16px;
    padding: 0 2px;
    line-height: 1;
  }

  .graph-search-clear:hover {
    color: var(--color-text, #e4e4e7);
  }

  .graph-search-count {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text-dim, #71717a);
    white-space: nowrap;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning {
      animation: none;
    }
  }
</style>
