<script module lang="ts">
  /** Per-graph-tab camera state cache. Survives component destroy/recreate cycles. */
  const cameraStateCache = new Map<
    string,
    {
      position: { x: number; y: number; z: number }
      target: { x: number; y: number; z: number }
    }
  >()

  /** Per-graph-tab node position cache. Preserves force-simulation layout across remounts. */
  const nodePositionCache = new Map<string, Map<string, { x: number; y: number; z: number }>>()

  /** Per-graph-tab selected node ID cache. */
  let selectedNodeIdCache: string | null = null

  /** Flag to suppress focusCameraOnNode during state restore. */
  let suppressCameraFocus = false

  /** Clear all graph state caches (e.g., on collection switch). */
  export function clearGraphStateCache(): void {
    cameraStateCache.clear()
    nodePositionCache.clear()
    selectedNodeIdCache = null
  }
</script>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import type { ForceGraph3DInstance } from '3d-force-graph'
  import type { NodeObject, LinkObject } from 'three-forcegraph'
  import * as THREE from 'three'
  import {
    graphData,
    graphLoading,
    graphError,
    graphSelectedNode,
    graphOpenedNode,
    graphColoringMode,
    graphLevel,
    graphPathFilter,
    graphHighlightedFolder,
    graphHoveredFilePath,
    graphLoadMode,
    graphDataSource,
    loadGraphData,
    selectGraphNode,
    openGraphNode,
    setGraphLevel,
    setGraphPathFilter,
    setGraphHighlightedFolder,
    graphEdgeFilter,
    graphUnconnectedHighlight,
    graphSemanticEdgesEnabled,
    graphEdgeWeakThreshold,
    toggleEdgeClusterFilter,
    clearEdgeFilter,
    toggleGraphUnconnectedHighlight,
    onGraphMenuAction,
    type GraphMenuAction
  } from '../stores/graph'
  import type { GraphColoringMode } from '../stores/graph'
  import type { GraphLevel, GraphNode, GraphData, GraphContextItem } from '../types/cli'
  import { selectedFilePath } from '../stores/files'
  import { openResolvedPathOtherPane } from '../lib/link-navigation'
  import { activeCollection, activeCollectionId } from '../stores/collections'
  import { get } from 'svelte/store'
  import { workspace } from '../stores/workspace.svelte'
  import GraphPreview from './GraphPreview.svelte'
  import GraphPerformanceWarning from './GraphPerformanceWarning.svelte'
  import GraphUnconnectedFilter from './GraphUnconnectedFilter.svelte'
  import GraphDisplayControls from './GraphDisplayControls.svelte'
  import GraphPresentationControl from './GraphPresentationControl.svelte'
  import GraphBackgroundContextMenu from './GraphBackgroundContextMenu.svelte'
  import PopoverMenu, { type PopoverMenuItem } from './ui/PopoverMenu.svelte'
  import {
    edgeClusterColor,
    isEdgeVisible,
    edgeLinkColor,
    edgeLinkWidth,
    edgeIdleOpacity,
    edgeScreenWidth,
    edgeArrowOpacity,
    isFrontmatterEdge,
    FRONTMATTER_EDGE_COLOR,
    UNCLUSTERED_EDGE_COLOR
  } from '../lib/edge-utils'
  import {
    diffGraphData,
    graphContextToken,
    linkKey,
    shouldPatch,
    isEmptyDelta,
    type GraphDelta
  } from '../lib/graph-delta'
  import {
    advanceGraphPresentationMotion,
    buildGraphPresentationOrder,
    captureGraphPresentationLayout,
    createGraphPresentationRootSpawn,
    createGraphPresentationSpawn,
    restoreGraphPresentationLayout,
    shouldEndGraphPresentationForPointerTarget,
    type GraphPresentationLayoutSnapshot,
    type GraphPresentationMotion,
    type GraphPresentationStep
  } from '../lib/graph-presentation'
  import {
    GraphPresentationCameraController,
    type GraphPresentationCameraPose
  } from '../lib/graph-presentation-camera'
  import { GraphHullLayer, type GraphHullDefinition } from '../lib/graph-hull-layer'
  import { GraphPerformanceCollector } from '../lib/graph-performance'
  import { GraphBatchedLayer, type GraphBatchedVisualState } from '../lib/graph-batched-layer'
  import { GraphLayoutWorkerClient } from '../lib/graph-layout-client'
  import type { GraphLayoutEvent, GraphLayoutWorkerState } from '../lib/graph-layout-protocol'
  import {
    applyGraphLayoutPositions,
    applyGraphLayoutPositionsInOrder,
    buildGraphLayoutInputs,
    graphTopologyRevision,
    packGraphNodePositions
  } from '../lib/graph-layout-data'
  import {
    createBrowserGraphPositionCache,
    createGraphPositionCacheKey,
    restoreGraphPositions
  } from '../lib/graph-position-cache'
  import { captureGraphScreenshotPng, graphScreenshotDefaultName } from '../lib/graph-screenshot'
  import { routeGraphMenuAction } from '../lib/graph-menu-router'
  import { paletteColor, paletteTextColor, type HarmonicPalette } from '../lib/harmonic-palette'
  import {
    clusterPalette,
    customClusterPalette,
    edgePalette,
    arrowPalette
  } from '../stores/palette'
  import {
    buildSearchScoreMap,
    buildGraphContextMap,
    computeSearchNodeOpacity,
    computeEdgeSearchAlpha
  } from '../lib/graph-search-utils'
  import {
    buildGraphSearchContextParents,
    buildGraphSearchRevealPlan,
    changedGraphSearchRevealNodeIds,
    sampleGraphSearchReveal,
    type GraphSearchRevealFrame,
    type GraphSearchRevealPlan
  } from '../lib/graph-search-animation'
  import {
    graphLegendLinkMatch,
    graphNodeMatchesLegendHighlight,
    type GraphLegendHighlight,
    type GraphLegendLinkMatch
  } from '../lib/graph-legend-filters'
  import {
    adaptiveGraphLabelBudget,
    graphLinkPickIntervalMs,
    selectReadableGraphLabels,
    type GraphLabelCandidate
  } from '../lib/graph-label-layout'
  import {
    buildGraph3DData,
    seedClusterPositions,
    seedNearNeighbors,
    computeDegreeMap,
    findUnconnectedNodeIds,
    nodeSizeValue,
    nodeColorForMode,
    edgeArrowColor,
    type Graph3DNode,
    type Graph3DLink,
    type Graph3DData
  } from '../lib/graph-3d-bridge'

  // ─── Props ─────────────────────────────────────────────────────────

  interface GraphViewProps {
    paneId?: string
  }
  let { paneId }: GraphViewProps = $props()

  // Derive graph tab ID for camera state caching
  let graphTabId = $derived(paneId ? (workspace.panes[paneId]?.graphTabId ?? null) : null)

  // ─── Palette State ───────────────────────────────────────────────────

  /** Current cluster palette (reactive, updated via store subscription). */
  let currentClusterPalette: HarmonicPalette = $state.raw(get(clusterPalette))

  /** Current custom cluster palette (reactive). */
  let currentCustomClusterPalette: HarmonicPalette = $state.raw(get(customClusterPalette))

  /** Current edge palette (reactive). */
  let currentEdgePalette: HarmonicPalette = $state.raw(get(edgePalette))

  /** Current arrow palette (reactive). */
  let currentArrowPalette: HarmonicPalette = get(arrowPalette)

  // ─── 3D Graph Types ─────────────────────────────────────────────────

  /** Node type with Graph3DNode fields plus NodeObject simulation fields. */
  type ForceNode = Graph3DNode & NodeObject

  /** Link type with Graph3DLink fields plus LinkObject simulation fields. */
  type ForceLink = Graph3DLink & LinkObject<ForceNode>

  /** Typed ForceGraph3D instance using our node/link types. */
  type GraphInstance = ForceGraph3DInstance<ForceNode, ForceLink>

  /** Runtime controls exposed by 3d-force-graph when orbit controls are active. */
  interface GraphControls {
    target: THREE.Vector3
    enabled?: boolean
    update?: () => void
    addEventListener?: (type: string, listener: () => void) => void
    removeEventListener?: (type: string, listener: () => void) => void
  }

  // ─── State ──────────────────────────────────────────────────────────

  /** The 3d-force-graph instance. Created in onMount via dynamic import. */
  let graph: GraphInstance | null = $state.raw(null)
  let graphInitPromise: Promise<void> | null = null
  let destroyed = false

  /** Bounded diagnostics exposed to DevTools as window.__tesseractGraphPerformance(). */
  const graphPerformance = new GraphPerformanceCollector()
  let graphPerformanceFrameId: number | null = null
  let graphPerformanceLastRendererSample = 0
  let graphPerformancePreviousFrame = 0
  let stopLongTaskObserver: (() => void) | null = null
  let graphDprRestoreTimer: ReturnType<typeof setTimeout> | null = null
  let graphAutoFitTimer: ReturnType<typeof setTimeout> | null = null
  let graphAnimationIdleTimer: ReturnType<typeof setTimeout> | null = null
  let graphManualRenderFrameId: number | null = null
  let graphHostAnimating = true
  let graphCameraAnimationUntil = 0
  let graphFeedGeneration = 0
  let pendingAutoFitRevision: string | null = null

  type GraphDiagnosticsWindow = Window & {
    __tesseractGraphPerformance?: () => ReturnType<GraphPerformanceCollector['snapshot']>
  }
  const readGraphPerformance = () => graphPerformance.snapshot()

  function sampleGraphPerformanceFrame(timestamp: number): void {
    graphPerformanceFrameId = null
    if (!graph || document.hidden || !graphHostAnimating) return
    graphPerformance.recordFrame(timestamp)
    if (graphPerformancePreviousFrame > 0) {
      batchedLayer?.advanceParticles((timestamp - graphPerformancePreviousFrame) / 1000)
    }
    graphPerformancePreviousFrame = timestamp
    if (timestamp - graphPerformanceLastRendererSample >= 1000) {
      graphPerformanceLastRendererSample = timestamp
      graphPerformance.recordRendererInfo(graph.renderer().info)
    }
    graphPerformanceFrameId = requestAnimationFrame(sampleGraphPerformanceFrame)
  }

  function startGraphPerformanceSampling(): void {
    if (graphPerformanceFrameId === null && !document.hidden) {
      graphPerformanceFrameId = requestAnimationFrame(sampleGraphPerformanceFrame)
    }
  }

  function stopGraphPerformanceSampling(): void {
    if (graphPerformanceFrameId !== null) cancelAnimationFrame(graphPerformanceFrameId)
    graphPerformanceFrameId = null
    graphPerformancePreviousFrame = 0
    graphPerformance.resetFrameBaseline()
  }

  function setGraphInteractiveQuality(interactive: boolean): void {
    if (!graph) return
    if (graphDprRestoreTimer) {
      clearTimeout(graphDprRestoreTimer)
      graphDprRestoreTimer = null
    }
    const apply = () => {
      if (!graph) return
      const target = Math.min(window.devicePixelRatio || 1, interactive ? 1.25 : 2)
      if (Math.abs(graph.renderer().getPixelRatio() - target) < 0.01) return
      graph.renderer().setPixelRatio(target)
      syncGraphSize()
    }
    if (interactive) apply()
    else graphDprRestoreTimer = setTimeout(apply, 160)
  }

  function handleGraphControlsStart(): void {
    claimPresentationCamera()
    cancelPendingAutoFit()
    setGraphInteractiveQuality(true)
    wakeGraphAnimation()
  }

  function handleGraphControlsEnd(): void {
    setGraphInteractiveQuality(layoutWorkerState === 'running' || presentationActive)
    settleGraphAnimation(240)
  }

  function handleGraphControlsChange(): void {
    scheduleLabelUpdate()
    requestGraphRender()
    // OrbitControls can keep emitting damped changes briefly after pointer-up.
    // Extend the idle deadline from the latest change so the final camera pose
    // is rendered, then let the host loop sleep again.
    settleGraphAnimation(240)
  }

  function cancelPendingAutoFit(): void {
    if (graphAutoFitTimer) clearTimeout(graphAutoFitTimer)
    graphAutoFitTimer = null
    pendingAutoFitRevision = null
  }

  function needsContinuousGraphAnimation(): boolean {
    return (
      !document.hidden &&
      (layoutWorkerState === 'running' ||
        (presentationActive && !presentationPaused) ||
        draggingNode !== null ||
        graphSearchRevealFrameId !== null ||
        cameraLoopFrameId !== null ||
        batchedLayer?.hasActiveParticles === true ||
        performance.now() < graphCameraAnimationUntil)
    )
  }

  function requestGraphRender(): void {
    if (!graph || document.hidden || graphHostAnimating || graphManualRenderFrameId !== null) return
    graphManualRenderFrameId = requestAnimationFrame(() => {
      graphManualRenderFrameId = null
      if (graph && !document.hidden) graph.renderer().render(graph.scene(), graph.camera())
    })
  }

  function wakeGraphAnimation(durationMs = 0): void {
    if (!graph || document.hidden) return
    if (durationMs > 0) {
      graphCameraAnimationUntil = Math.max(
        graphCameraAnimationUntil,
        performance.now() + durationMs + 80
      )
    }
    if (graphAnimationIdleTimer) clearTimeout(graphAnimationIdleTimer)
    graphAnimationIdleTimer = null
    if (!graphHostAnimating) {
      graph.resumeAnimation()
      graphHostAnimating = true
    }
    startGraphPerformanceSampling()
    if (durationMs > 0) settleGraphAnimation(durationMs + 100)
  }

  function settleGraphAnimation(delayMs = 180): void {
    if (graphAnimationIdleTimer) clearTimeout(graphAnimationIdleTimer)
    graphAnimationIdleTimer = setTimeout(() => {
      graphAnimationIdleTimer = null
      if (!graph || needsContinuousGraphAnimation()) {
        const cameraRemaining = Math.max(0, graphCameraAnimationUntil - performance.now())
        if (cameraRemaining > 0) settleGraphAnimation(cameraRemaining + 80)
        return
      }
      graph.pauseAnimation()
      graphHostAnimating = false
      stopGraphPerformanceSampling()
      requestGraphRender()
    }, delayMs)
  }

  function handleGraphDocumentVisibility(): void {
    if (document.hidden) {
      resumeLayoutAfterVisibility = layoutWorkerState === 'running'
      if (resumeLayoutAfterVisibility) layoutClient?.pause()
      graph?.pauseAnimation()
      graphHostAnimating = false
      if (graphAnimationIdleTimer) clearTimeout(graphAnimationIdleTimer)
      graphAnimationIdleTimer = null
      if (graphManualRenderFrameId !== null) cancelAnimationFrame(graphManualRenderFrameId)
      graphManualRenderFrameId = null
      stopGraphPerformanceSampling()
    } else {
      if (resumeLayoutAfterVisibility) layoutClient?.start()
      resumeLayoutAfterVisibility = false
      if (needsContinuousGraphAnimation()) wakeGraphAnimation()
      else {
        requestGraphRender()
        settleGraphAnimation()
      }
      startGraphPerformanceSampling()
      scheduleLabelUpdate()
    }
  }

  /** Outer container div (used for ResizeObserver and overlay positioning). */
  let containerEl: HTMLDivElement | undefined = $state(undefined)

  /** Inner container div where 3d-force-graph mounts the WebGL canvas. */
  let graphContainerEl: HTMLDivElement | undefined = $state(undefined)

  /** Current 3D graph data fed to the graph instance. */
  let currentGraph3DData: Graph3DData | null = null
  let lastFedData: GraphData | null = null

  /** GPU-batched scene layer and off-main-thread force layout. */
  let batchedLayer: GraphBatchedLayer | null = null
  let layoutClient: GraphLayoutWorkerClient | null = null
  let unsubscribeLayout: (() => void) | null = null
  let layoutNodeIds: string[] = []
  let layoutNodesInVisualOrder = false
  let layoutLastLabelUpdateAt = 0
  let layoutRevision = ''
  let layoutCacheKey: string | null = null
  let layoutWorkerState: GraphLayoutWorkerState = 'uninitialized'
  let resumeLayoutAfterVisibility = false
  const persistentPositionCache = createBrowserGraphPositionCache()
  let liveNodesById = new Map<string, ForceNode>()
  let adjacency = new Map<string, Set<string>>()

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
  let unsubUnconnectedHighlight: (() => void) | null = null
  let unsubSemanticEdges: (() => void) | null = null
  let unsubEdgeWeakThreshold: (() => void) | null = null
  let unsubLoading: (() => void) | null = null
  let unsubError: (() => void) | null = null
  let unsubLevel: (() => void) | null = null
  let unsubOpenedNode: (() => void) | null = null
  let unsubClusterPalette: (() => void) | null = null
  let unsubCustomClusterPalette: (() => void) | null = null
  let unsubEdgePalette: (() => void) | null = null
  let unsubArrowPalette: (() => void) | null = null
  let removeGraphMenuActionListener: (() => void) | null = null

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
  let currentEdgeFilter: Set<number> | null = $state(null)
  let currentUnconnectedHighlight = $state(false)
  let unconnectedNodeIds: Set<string> = $state(new Set())
  let _currentSemanticEdgesEnabled: boolean = $state(true)
  let currentEdgeWeakThreshold: number = $state(0.3)
  let currentOpenedNode: GraphNode | null = $state(null)

  /** Pending camera restore from cache. Set on mount, consumed by first feedData call. */
  let pendingCameraRestore: {
    position: { x: number; y: number; z: number }
    target: { x: number; y: number; z: number }
  } | null = null

  // Context menu state
  let contextMenuNode: ForceNode | null = $state(null)
  let contextMenuX = $state(0)
  let contextMenuY = $state(0)
  let backgroundContextMenuOpen = $state(false)
  let graphScreenshotExporting = $state(false)

  // Legend visibility
  let legendVisible = $state(true)

  // ─── View Mode Dropdown ─────────────────────────────────────────────

  /** Available graph view modes shown in the top-left dropdown. */
  const VIEW_MODES: { id: GraphColoringMode; label: string; icon: string }[] = [
    { id: 'cluster', label: 'Clusters', icon: 'workspaces' },
    { id: 'custom-cluster', label: 'Topics', icon: 'category' },
    { id: 'folder', label: 'Folders', icon: 'folder' },
    { id: 'none', label: 'No coloring', icon: 'visibility_off' }
  ]

  /** Whether the view-mode dropdown menu is open. */
  let viewModeMenuOpen = $state(false)

  /** Anchor element for the view-mode dropdown. */
  let viewModeBtnEl: HTMLButtonElement | null = $state(null)

  /** The currently active view mode entry (label + icon for the trigger). */
  let currentViewMode = $derived(
    VIEW_MODES.find((m) => m.id === currentColoringMode) ?? VIEW_MODES[0]
  )

  /** Dropdown items — Topics is disabled when the collection defines none. */
  let viewModeItems = $derived.by<PopoverMenuItem[]>(() => {
    const hasTopics = (currentData?.custom_clusters?.length ?? 0) > 0
    return VIEW_MODES.map((m) => ({
      id: m.id,
      label: m.label,
      icon: m.icon,
      checked: currentColoringMode === m.id,
      disabled: m.id === 'custom-cluster' && !hasTopics
    }))
  })

  /** Switch the graph view mode (persisted as the default via the store). */
  function selectViewMode(id: string): void {
    graphColoringMode.set(id as GraphColoringMode)
  }

  // Legend row selections highlight their members without changing topology.
  let highlightedClusterId: number | null = $state(null)

  // Highlighted topic (custom cluster) — legend row click highlights ALL
  // members of that topic (including secondary memberships) and dims the rest.
  let highlightedTopicId: number | null = $state(null)

  // Hover state (populated by interaction handlers in subtask 2-2)
  let hoveredNode: ForceNode | null = $state(null)
  let hoveredEdge: ForceLink | null = $state(null)
  let tooltipX = $state(0)
  let tooltipY = $state(0)

  // Proximity labels: visible node labels when camera is close enough (document mode)
  let visibleLabels: { id: string; label: string; x: number; y: number }[] = $state([])
  const proximityLabelNodes: Graph3DNode[] = []
  const proximityLabelCandidates: GraphLabelCandidate[] = []
  const graphLabelProjection = new THREE.Vector3()

  const graphRaycaster = new THREE.Raycaster()
  const graphPointerNdc = new THREE.Vector2()
  const graphDragPlane = new THREE.Plane()
  const graphDragPoint = new THREE.Vector3()
  const graphDragOffset = new THREE.Vector3()
  const graphDragNodePosition = new THREE.Vector3()
  const graphDragPlaneNormal = new THREE.Vector3()
  let graphCanvas: HTMLCanvasElement | null = null
  let graphPickFrameId: number | null = null
  let graphPickTimer: ReturnType<typeof setTimeout> | null = null
  let graphLastLinkPickAt = 0
  let graphForceNextLinkPick = false
  let pendingPickPoint: { x: number; y: number } | null = null
  let pointerCandidate: {
    node: ForceNode | null
    x: number
    y: number
    pointerId: number
  } | null = null
  let draggingNode: ForceNode | null = null
  let pendingGraphDragRelease: {
    requestId: number
    nodeId: string
    x: number
    y: number
    z: number
  } | null = null

  // Resize observer
  let resizeObs: ResizeObserver | null = null

  // Node count for performance warnings
  let nodeCount = $state(0)

  // Display controls
  let graphLabelsVisible = $state(true)
  let graphLinesVisible = $state(true)
  let graphShapesVisible = $state(true)

  // Active remains true while playback is paused so the revealed subset stays visible.
  let presentationActive = $state(false)
  let presentationPaused = $state(false)
  let presentationVisibleNodeIds: Set<string> = $state(new Set())
  let presentationRevealedCount = $state(0)
  let presentationTotal = $state(0)
  let presentationOrder: GraphPresentationStep[] = []
  let presentationCursor = 0
  let presentationBatchSize = 1
  let presentationFrameId: number | null = null
  let presentationLastRevealAt = 0
  let presentationRevealTicks = 0
  let presentationNodesById = new Map<string, ForceNode>()
  let presentationHullNodes = new Map<number, ForceNode[]>()
  let presentationTargetPositions = new Map<string, { x: number; y: number; z: number }>()
  let presentationLayoutSnapshot: GraphPresentationLayoutSnapshot | null = null
  let presentationMotions = new Map<string, GraphPresentationMotion>()
  let presentationAllRevealed = false
  let presentationLastMotionAt = 0
  let presentationLastEnclosureAt = 0
  let presentationLayoutWasRunning = false
  const presentationCamera = new GraphPresentationCameraController()
  let presentationStatusMessage = $state('')

  const PRESENTATION_INTERVAL_MS = 90
  const PRESENTATION_MAX_TICKS = 160
  const PRESENTATION_ENCLOSURE_INTERVAL_MS = 100

  // Label update animation frame
  let labelFrameId: number | null = null
  const nodeLabelCache = new Map<string, string>()
  let graphControls: GraphControls | null = null

  // ─── Keyboard Camera Controls State ─────────────────────────────────
  /** Set of currently held camera control keys. */
  const pressedCameraKeys = new Set<string>()
  /** Animation frame ID for the camera movement loop. */
  let cameraLoopFrameId: number | null = null
  /** Translation speed as a fraction of camera-to-target distance per frame. */
  const MOVE_SPEED_FACTOR = 0.007
  /** Rotation speed (radians per frame). */
  const ROTATE_SPEED = 0.02

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

  /** Relevance-first search reveal state. Plain maps avoid reactive mutation overhead per frame. */
  let graphSearchRevealPlan: GraphSearchRevealPlan | null = null
  let graphSearchRevealFrame: GraphSearchRevealFrame | null = null
  let graphSearchRevealFrameId: number | null = null
  let graphSearchRevealStartedAt = 0
  let graphSearchRevealLastVisualAt = 0
  let graphSearchRevealGeneration = 0
  let graphSearchRevealLinkIndices = new Map<Graph3DLink, number>()
  let graphSearchRevealLinkDirections = new Map<number, 1 | -1>()

  // ─── Graph Search Functions ─────────────────────────────────────────

  function cancelGraphSearchReveal(renderFinalState: boolean = false): void {
    graphSearchRevealGeneration++
    if (graphSearchRevealFrameId !== null) cancelAnimationFrame(graphSearchRevealFrameId)
    graphSearchRevealFrameId = null
    graphSearchRevealPlan = null
    graphSearchRevealFrame = null
    graphSearchRevealLinkIndices = new Map()
    graphSearchRevealLinkDirections = new Map()
    graphSearchRevealLastVisualAt = 0
    if (renderFinalState) syncBatchedVisuals()
    settleGraphAnimation()
  }

  function finishGraphSearchReveal(generation: number): void {
    if (generation !== graphSearchRevealGeneration) return
    graphSearchRevealFrameId = null
    graphSearchRevealPlan = null
    graphSearchRevealFrame = null
    graphSearchRevealLinkIndices = new Map()
    graphSearchRevealLinkDirections = new Map()
    graphSearchRevealLastVisualAt = 0
    // Clear the animation mask before the final full update so the static
    // search state exactly matches the long-standing highlight contract.
    syncBatchedVisuals()
    settleGraphAnimation()
  }

  function runGraphSearchRevealFrame(timestamp: number, generation: number): void {
    graphSearchRevealFrameId = null
    if (destroyed || generation !== graphSearchRevealGeneration) return
    const plan = graphSearchRevealPlan
    // This is deliberately the last frame uploaded to the GPU, rather than
    // merely the last sampled RAF. Skipped throttle frames must accumulate so
    // their final opacity/halo changes cannot disappear from the next upload.
    const previousRendered = graphSearchRevealFrame
    if (!plan || !previousRendered || !batchedLayer) return

    const next = sampleGraphSearchReveal(plan, timestamp - graphSearchRevealStartedAt)
    if (next.complete) {
      // finishGraphSearchReveal performs the one terminal full update after
      // clearing the trace mask. Avoid uploading the complete frame twice.
      finishGraphSearchReveal(generation)
      return
    }

    const phaseChanged = next.phase !== previousRendered.phase
    // The global dimming pass is intentionally capped because it rewrites the
    // whole graph. Once the tree walk starts, only the active nodes and their
    // incident links change, so let requestAnimationFrame drive a smooth trace.
    const visualInterval = next.phase === 'dimming' ? 1000 / 30 : 1000 / 55
    const shouldUpdate = phaseChanged || timestamp - graphSearchRevealLastVisualAt >= visualInterval

    if (shouldUpdate) {
      graphSearchRevealFrame = next
      graphSearchRevealLastVisualAt = timestamp
      const visuals = graphBatchedVisualState()
      if (next.phase === 'dimming' || phaseChanged) {
        // Dimming touches the entire graph, but only for a short six-to-seven
        // frame transition. The longer tree walk below stays strictly partial.
        batchedLayer.updateVisuals(visuals)
      } else {
        const changedNodeIds = changedGraphSearchRevealNodeIds(plan, previousRendered, next)
        if (changedNodeIds.size > 0) {
          batchedLayer.updateVisualsForNodes(changedNodeIds, visuals)
        }
      }
      requestGraphRender()
    }
    graphSearchRevealFrameId = requestAnimationFrame((nextTimestamp) =>
      runGraphSearchRevealFrame(nextTimestamp, generation)
    )
  }

  function startGraphSearchReveal(contextItems: GraphContextItem[]): void {
    cancelGraphSearchReveal(false)
    if (!currentGraph3DData || !batchedLayer) {
      applySearchDimming()
      return
    }

    const plan = buildGraphSearchRevealPlan(
      currentGraph3DData.nodes,
      currentGraph3DData.links,
      graphSearchScores,
      graphSearchContextScores,
      buildGraphSearchContextParents(contextItems)
    )
    if (plan.steps.length === 0) {
      applySearchDimming()
      return
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reducedMotion) {
      // Avoid flashing or delayed input while preserving the same final
      // relevance-weighted search state as the animated path.
      applySearchDimming()
      return
    }

    graphSearchRevealPlan = plan
    graphSearchRevealFrame = sampleGraphSearchReveal(plan, 0)
    graphSearchRevealLinkIndices = new Map(
      currentGraph3DData.links.map((link, index) => [link, index])
    )
    graphSearchRevealLinkDirections = new Map(
      plan.connections.map((connection) => [connection.linkIndex, connection.direction])
    )
    graphSearchRevealStartedAt = performance.now()
    graphSearchRevealLastVisualAt = graphSearchRevealStartedAt
    const generation = ++graphSearchRevealGeneration

    // First paint is unchanged; subsequent frames fade everything into the
    // quiet search baseline before any result or connection enters.
    batchedLayer.updateVisuals(graphBatchedVisualState())
    batchedLayer.setParticleLinks(null)
    wakeGraphAnimation()
    requestGraphRender()
    graphSearchRevealFrameId = requestAnimationFrame((timestamp) =>
      runGraphSearchRevealFrame(timestamp, generation)
    )
  }

  /**
   * Handle graph search input with 400ms debounce and 2-char minimum.
   */
  function onGraphSearchInput(query: string): void {
    graphSearchQuery = query
    // Invalidate both the pending backend result and any visual playback as
    // soon as the query changes, not after the next debounce completes.
    graphSearchGeneration++

    if (graphSearchDebounceTimer !== null) {
      clearTimeout(graphSearchDebounceTimer)
      graphSearchDebounceTimer = null
    }
    if (graphSearchRevealPlan || graphSearchRevealFrameId !== null) {
      cancelGraphSearchReveal(query.length >= 2)
    }

    if (query.length < 2) {
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
      graphSearchLoading = false
      graphSearchError = null
      syncBatchedVisuals()
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
    if (graphSearchRevealPlan || graphSearchRevealFrameId !== null) {
      cancelGraphSearchReveal(true)
    }
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
      graphSearchResultCount = result.total_results ?? result.results?.length ?? 0
      graphSearchError = null
      startGraphSearchReveal(result.graph_context ?? [])
    } catch (err) {
      if (generation !== graphSearchGeneration) return
      cancelGraphSearchReveal(false)
      graphSearchError = err instanceof Error ? err.message : String(err)
      graphSearchScores = new Map()
      graphSearchContextScores = new Map()
      graphSearchResultCount = 0
      syncBatchedVisuals()
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
    cancelGraphSearchReveal(false)
    graphSearchGeneration++
    graphSearchQuery = ''
    graphSearchScores = new Map()
    graphSearchContextScores = new Map()
    graphSearchResultCount = 0
    graphSearchLoading = false
    graphSearchError = null
    graphSearchVisible = false
    applySelectionDimming()
    syncBatchedVisuals()
  }

  /** Open and focus the graph search overlay. */
  function openGraphSearch(): void {
    if (presentationActive) endGraphPresentation()
    graphSearchVisible = true
    tick().then(() => {
      const input = containerEl?.querySelector('.graph-search-input') as HTMLInputElement | null
      input?.focus()
    })
  }

  /**
   * Update proximity labels: project node positions to screen,
   * show labels only for nodes within a distance threshold from camera.
   * Scheduled on camera/layout changes for smooth tracking during orbit.
   */
  function scheduleLabelUpdate(): void {
    if (labelFrameId !== null) return
    labelFrameId = requestAnimationFrame(() => {
      labelFrameId = null
      updateProximityLabels()
    })
  }

  function publishVisibleLabels(labels: typeof visibleLabels): void {
    if (
      labels.length === visibleLabels.length &&
      labels.every((label, index) => {
        const previous = visibleLabels[index]
        return (
          previous?.id === label.id &&
          Math.abs(previous.x - label.x) < 0.5 &&
          Math.abs(previous.y - label.y) < 0.5
        )
      })
    ) {
      return
    }
    visibleLabels = labels
  }

  /** Move only the grabbed label; a full proximity query would rebuild the O(V) picker grid. */
  function updateDraggedNodeLabel(node: ForceNode): void {
    if (!graph || !graphLabelsVisible || isChunkMode()) return
    const index = visibleLabels.findIndex((label) => label.id === node.id)
    if (index < 0) return
    const screen = graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0)
    if (!screen) return
    const current = visibleLabels[index]
    if (Math.abs(current.x - screen.x) < 0.5 && Math.abs(current.y - screen.y) < 0.5) return
    const next = visibleLabels.slice()
    next[index] = { ...current, x: screen.x, y: screen.y }
    visibleLabels = next
  }

  function graphLabelImportance(node: ForceNode, distanceSquared: number): number {
    let importance = (degreeMap.get(node.id) ?? 0) * 1_000
    importance += Math.max(0, node.val ?? 0) * 100
    importance += 100_000 / Math.max(25, Math.sqrt(distanceSquared))

    const directSearchScore = graphSearchScores.get(node.path)
    const contextSearchScore = graphSearchContextScores.get(node.path)
    if (directSearchScore !== undefined) importance += 10_000_000 + directSearchScore * 100_000
    else if (contextSearchScore !== undefined)
      importance += 5_000_000 + contextSearchScore * 100_000
    if (neighborSet.has(node.id)) importance += 1_000_000
    if (node.custom_cluster_ids?.includes(highlightedTopicId ?? Number.NaN)) importance += 500_000
    if (hoveredNode?.id === node.id) importance += 500_000_000
    if (currentSelected?.id === node.id) importance += 1_000_000_000
    return importance
  }

  function updateProximityLabels(): void {
    if (!graph || !graphLabelsVisible || isChunkMode()) {
      if (visibleLabels.length > 0) visibleLabels = []
      updateClusterLabelPositions()
      return
    }

    const camera = graph.camera()
    if (!camera) return

    const camPos = camera.position
    let nodes: ForceNode[]
    if (batchedLayer) {
      batchedLayer.collectNodesWithinRadius(camPos, 350, proximityLabelNodes)
      nodes = proximityLabelNodes as ForceNode[]
    } else {
      nodes = getLiveGraphData().nodes as ForceNode[]
    }

    // Distance threshold: labels visible within this range from camera
    const maxDistSquared = 350 * 350
    const labels: typeof visibleLabels = []
    const rendererElement = graph.renderer().domElement
    const viewport = {
      width: rendererElement.clientWidth,
      height: rendererElement.clientHeight
    }
    const useAdaptiveLabels = (currentGraph3DData?.nodes.length ?? nodes.length) >= 1_500
    proximityLabelCandidates.length = 0

    for (const node of nodes) {
      const nx = node.x ?? 0
      const ny = node.y ?? 0
      const nz = node.z ?? 0

      const dx = camPos.x - nx
      const dy = camPos.y - ny
      const dz = camPos.z - nz
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared > maxDistSquared) continue
      if (presentationActive && !presentationVisibleNodeIds.has(node.id)) continue

      // Extract filename from path
      let fileName = nodeLabelCache.get(node.id)
      if (!fileName) {
        const separator = node.path?.lastIndexOf('/') ?? -1
        fileName = separator >= 0 ? node.path.slice(separator + 1) : (node.path ?? node.id)
        nodeLabelCache.set(node.id, fileName)
      }

      if (useAdaptiveLabels) {
        graphLabelProjection.set(nx, ny, nz).project(camera)
        if (
          graphLabelProjection.z < -1 ||
          graphLabelProjection.z > 1 ||
          graphLabelProjection.x < -1 ||
          graphLabelProjection.x > 1 ||
          graphLabelProjection.y < -1 ||
          graphLabelProjection.y > 1
        ) {
          continue
        }
        proximityLabelCandidates.push({
          id: node.id,
          label: fileName,
          x: (graphLabelProjection.x * 0.5 + 0.5) * viewport.width,
          y: (-graphLabelProjection.y * 0.5 + 0.5) * viewport.height,
          importance: graphLabelImportance(node, distanceSquared)
        })
      } else {
        const screenCoords = graph.graph2ScreenCoords(nx, ny, nz)
        if (!screenCoords) continue
        labels.push({
          id: node.id,
          label: fileName,
          x: screenCoords.x,
          y: screenCoords.y
        })
      }
    }

    if (useAdaptiveLabels) {
      const budget = adaptiveGraphLabelBudget(
        viewport,
        proximityLabelCandidates.length,
        layoutWorkerState === 'running'
      )
      publishVisibleLabels(selectReadableGraphLabels(proximityLabelCandidates, viewport, budget))
    } else {
      publishVisibleLabels(labels)
    }
    updateClusterLabelPositions()
  }

  /** Whether WebGL is supported by the browser. Checked in onMount before graph init. */
  let webglSupported = $state(true)

  // ─── Cluster Enclosure State ────────────────────────────────────────

  /** Stable, dirty-cluster-only enclosure layer. */
  let clusterHullLayer: GraphHullLayer | null = null

  /** Last worker snapshot time used to throttle enclosure updates. */
  let lastHullLayoutUpdateAt = 0

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

  /** Current node-group selection from the legend or file tree. */
  function activeLegendHighlight(): GraphLegendHighlight | null {
    if (currentColoringMode === 'cluster' && highlightedClusterId != null) {
      return { kind: 'cluster', id: highlightedClusterId }
    }
    if (currentColoringMode === 'custom-cluster' && highlightedTopicId != null) {
      return { kind: 'topic', id: highlightedTopicId }
    }
    if (currentHighlightedFolder) return { kind: 'folder', path: currentHighlightedFolder }
    return null
  }

  function nodeMatchesLegendHighlight(node: ForceNode): boolean {
    const highlight = activeLegendHighlight()
    return highlight ? graphNodeMatchesLegendHighlight(node, highlight) : false
  }

  function linkLegendMatch(link: Graph3DLink): GraphLegendLinkMatch | null {
    const highlight = activeLegendHighlight()
    if (!highlight) return null
    return graphLegendLinkMatch(
      resolveLinkNode(link.source),
      resolveLinkNode(link.target),
      highlight
    )
  }

  function activeHullHighlightId(): number | null {
    if (currentColoringMode === 'cluster') return highlightedClusterId
    if (currentColoringMode === 'custom-cluster') return highlightedTopicId
    return null
  }

  function syncHullLegendHighlight(): void {
    clusterHullLayer?.setHighlightedGroup(activeHullHighlightId())
    requestGraphRender()
  }

  /**
   * Compute node color dynamically based on the current coloring mode.
   * Called by the nodeColor accessor on each render/refresh so that
   * mode switches only require a graph.refresh() instead of full data rebuild.
   *
   * Delegates to the bridge's pure nodeColorForMode() (single source of
   * truth shared with buildGraph3DData), plus legend highlighting.
   */
  function getNodeColor(
    node: ForceNode,
    colors: { default: string; primary: string; muted: string }
  ): string {
    const searchActive = graphSearchScores.size > 0 || graphSearchContextScores.size > 0
    if (currentUnconnectedHighlight && !searchActive) {
      return unconnectedNodeIds.has(node.id) ? colors.primary : colors.muted
    }
    const legendHighlight = activeLegendHighlight()
    if (!currentSelected && !searchActive && legendHighlight) {
      if (!graphNodeMatchesLegendHighlight(node, legendHighlight)) return colors.muted
      if (legendHighlight.kind === 'folder') return colors.primary
    }
    return nodeColorForMode(
      node,
      currentColoringMode,
      folderColorMap,
      isChunkMode(),
      currentClusterPalette,
      currentCustomClusterPalette,
      colors.default
    )
  }

  /** Toggle an automatic cluster from the legend. */
  function toggleClusterHighlight(id: number): void {
    highlightedClusterId = highlightedClusterId === id ? null : id
    syncBatchedVisuals()
    syncHullLegendHighlight()
  }

  function clearClusterHighlight(): void {
    if (highlightedClusterId == null) return
    highlightedClusterId = null
    syncBatchedVisuals()
    syncHullLegendHighlight()
  }

  /** Toggle the highlighted topic (legend row click). Same id again clears. */
  function toggleTopicHighlight(id: number): void {
    highlightedTopicId = highlightedTopicId === id ? null : id
    syncBatchedVisuals()
    syncHullLegendHighlight()
  }

  /** Clear the topic highlight filter. */
  function clearTopicHighlight(): void {
    if (highlightedTopicId == null) return
    highlightedTopicId = null
    syncBatchedVisuals()
    syncHullLegendHighlight()
  }

  /** Read the default node color from CSS variable. */
  function getDefaultNodeColor(): string {
    if (typeof document !== 'undefined') {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim()
      if (val) return val
    }
    return '#E4E4E7'
  }

  /** Read the accent used to call out unconnected nodes. */
  function getPrimaryColor(): string {
    if (typeof document !== 'undefined') {
      const val = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-primary')
        .trim()
      if (val) return val
    }
    return '#00E5FF'
  }

  /** Read a low-contrast color used to dim connected nodes. */
  function getMutedNodeColor(): string {
    if (typeof document !== 'undefined') {
      const val = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-border')
        .trim()
      if (val) return val
    }
    return '#27272A'
  }

  /** Read the current background color from CSS variable. */
  function getBackgroundColor(): string {
    if (typeof document !== 'undefined') {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
      if (val) return val
    }
    return '#0f0f10'
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

  function getLiveGraphData(): { nodes: ForceNode[]; links: ForceLink[] } {
    return {
      nodes: (currentGraph3DData?.nodes ?? []) as ForceNode[],
      links: (currentGraph3DData?.links ?? []) as ForceLink[]
    }
  }

  function rebuildLiveGraphIndices(): void {
    const live = getLiveGraphData()
    liveNodesById = new Map(live.nodes.map((node) => [node.id, node]))
    adjacency = new Map(live.nodes.map((node) => [node.id, new Set<string>()]))
    for (const link of live.links) {
      const source = linkNodeId(link.source)
      const target = linkNodeId(link.target)
      adjacency.get(source)?.add(target)
      adjacency.get(target)?.add(source)
    }
  }

  function resolveLinkNode(endpoint: unknown): ForceNode | undefined {
    return liveNodesById.get(linkNodeId(endpoint))
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
   * Idle arrows stay neutral so thousands of arrowheads do not bias the
   * semantic edge palette. A selected node activates directional colors.
   */
  function getLinkArrowColor(link: ForceLink): string {
    const srcId = linkNodeId(link.source)
    const tgtId = linkNodeId(link.target)
    const selectedId = currentSelected?.id ?? null

    const isBidi = bidirectionalPairs.has(`${srcId}->${tgtId}`)
    return edgeArrowColor(srcId, tgtId, selectedId, isBidi, currentArrowPalette)
  }

  // ─── Selection Dimming & Hub Glow ──────────────────────────────────

  /**
   * Compute the set of node IDs that are neighbors of the currently selected node.
   * Includes the selected node itself. Used by selection dimming logic.
   * When no node is selected, the set is empty (no dimming applied).
   */
  function computeNeighborSet() {
    neighborSet = new Set()
    if (!currentSelected) return
    neighborSet.add(currentSelected.id)
    for (const neighbor of adjacency.get(currentSelected.id) ?? []) neighborSet.add(neighbor)
  }

  function graphSearchScoreForNode(node: Graph3DNode | undefined): number | undefined {
    if (!node) return undefined
    return graphSearchScores.get(node.path) ?? graphSearchContextScores.get(node.path)
  }

  function batchedNodeBaseOpacity(node: Graph3DNode): number {
    if (currentSelected) return neighborSet.has(node.id) ? 0.95 : 0.15
    const legendHighlight = activeLegendHighlight()
    if (legendHighlight) {
      return graphNodeMatchesLegendHighlight(node, legendHighlight) ? 0.96 : 0.1
    }
    if (currentUnconnectedHighlight) return unconnectedNodeIds.has(node.id) ? 1 : 0.16
    return 0.9
  }

  function batchedNodeOpacity(node: Graph3DNode): number {
    const searchScore = graphSearchScoreForNode(node)
    if (graphSearchScores.size > 0 || graphSearchContextScores.size > 0) {
      const reveal = graphSearchRevealFrame
      if (reveal?.phase === 'dimming') {
        return THREE.MathUtils.lerp(batchedNodeBaseOpacity(node), 0.05, reveal.dimProgress)
      }
      if (reveal && searchScore !== undefined) {
        return THREE.MathUtils.lerp(
          0.05,
          computeSearchNodeOpacity(searchScore),
          reveal.nodeProgress.get(node.id) ?? 0
        )
      }
      return searchScore === undefined ? 0.05 : computeSearchNodeOpacity(searchScore)
    }
    return batchedNodeBaseOpacity(node)
  }

  function graphSearchLinkScores(link: Graph3DLink): {
    source: ForceNode | undefined
    target: ForceNode | undefined
    sourceScore: number | undefined
    targetScore: number | undefined
  } {
    const source = resolveLinkNode(link.source)
    const target = resolveLinkNode(link.target)
    return {
      source,
      target,
      sourceScore: graphSearchScoreForNode(source),
      targetScore: graphSearchScoreForNode(target)
    }
  }

  function batchedLinkSearchColor(link: Graph3DLink): string {
    const { sourceScore, targetScore } = graphSearchLinkScores(link)
    if (sourceScore !== undefined && targetScore !== undefined) {
      return `rgba(0, 220, 255, ${computeEdgeSearchAlpha(sourceScore, targetScore)})`
    }
    if (sourceScore !== undefined || targetScore !== undefined) return 'rgba(0, 220, 255, 0.08)'
    return 'rgba(80, 80, 80, 0.02)'
  }

  function graphBatchedVisualState(): GraphBatchedVisualState {
    const searchActive = graphSearchScores.size > 0 || graphSearchContextScores.size > 0
    const normalLinkOpacity = (link: Graph3DLink): number => {
      const semantic = _currentSemanticEdgesEnabled || isFrontmatterEdge(link)
      if (searchActive) {
        const reveal = graphSearchRevealFrame
        if (reveal?.phase === 'dimming') {
          const idle = edgeIdleOpacity(
            link.strength ?? 0.5,
            currentEdgeWeakThreshold,
            isChunkMode(),
            semantic
          )
          return THREE.MathUtils.lerp(idle, 0.02, reveal.dimProgress)
        }
        if (reveal?.phase === 'revealing') {
          const { source, target, sourceScore, targetScore } = graphSearchLinkScores(link)
          if ((sourceScore === undefined) !== (targetScore === undefined)) {
            const relevantNode = sourceScore !== undefined ? source : target
            const progress = relevantNode ? (reveal.nodeProgress.get(relevantNode.id) ?? 0) : 0
            // batchedLinkSearchColor contributes alpha .08; this moves the
            // one-ended context line smoothly from .02 to that final value.
            return 0.25 + progress * 0.75
          }
        }
        return 1
      }
      if (currentSelected) return 1
      const idle = edgeIdleOpacity(
        link.strength ?? 0.5,
        currentEdgeWeakThreshold,
        isChunkMode(),
        semantic
      )
      const legendMatch = linkLegendMatch(link)
      if (legendMatch === 'both') return Math.max(0.72, idle)
      if (legendMatch === 'incident') return 0.38
      if (legendMatch === 'none') return 0.035
      return idle
    }
    const normalLinkWidth = (link: Graph3DLink): number => {
      if (searchActive && graphSearchRevealFrame?.phase !== 'dimming') {
        const { sourceScore, targetScore } = graphSearchLinkScores(link)
        if (sourceScore !== undefined && targetScore !== undefined) {
          return 1 + Math.min(sourceScore, targetScore) * 1.4
        }
        return sourceScore !== undefined || targetScore !== undefined ? 1.15 : 1
      }
      const semantic = _currentSemanticEdgesEnabled || isFrontmatterEdge(link)
      const incident =
        currentSelected != null &&
        (link.source === currentSelected.id || link.target === currentSelected.id)
      return edgeScreenWidth(link.width ?? 0.5, semantic, incident)
    }
    const graphColors = {
      default: getDefaultNodeColor(),
      primary: getPrimaryColor(),
      muted: getMutedNodeColor()
    }
    return {
      nodeColor: (node) => getNodeColor(node as ForceNode, graphColors),
      nodeOpacity: batchedNodeOpacity,
      nodeVisible: (node) => !presentationActive || presentationVisibleNodeIds.has(node.id),
      nodeHalo: (node) => {
        const revealProgress = graphSearchRevealFrame?.nodeProgress.get(node.id) ?? 0
        if (revealProgress > 0 && revealProgress < 1) return true
        if (!searchActive && activeLegendHighlight()) return nodeMatchesLegendHighlight(node)
        return (degreeMap.get(node.id) ?? 0) >= 5 && batchedNodeOpacity(node) > 0.2
      },
      linkColor: (link) => {
        if (searchActive) {
          if (graphSearchRevealFrame?.phase === 'dimming') {
            if (!_currentSemanticEdgesEnabled && !isFrontmatterEdge(link)) {
              return UNCLUSTERED_EDGE_COLOR
            }
            return link.color
          }
          return batchedLinkSearchColor(link)
        }
        if (currentSelected) {
          const incident = link.source === currentSelected.id || link.target === currentSelected.id
          return incident ? getLinkArrowColor(link as ForceLink) : 'rgba(80, 80, 80, 0.04)'
        }
        if (linkLegendMatch(link) === 'none') return UNCLUSTERED_EDGE_COLOR
        if (!_currentSemanticEdgesEnabled && !isFrontmatterEdge(link)) {
          return UNCLUSTERED_EDGE_COLOR
        }
        return link.color
      },
      linkOpacity: normalLinkOpacity,
      linkWidth: normalLinkWidth,
      linkReveal: (link) => {
        const reveal = graphSearchRevealFrame
        if (!searchActive || reveal?.phase !== 'revealing') return 1
        const { sourceScore, targetScore } = graphSearchLinkScores(link)
        if (sourceScore === undefined || targetScore === undefined) return 1
        const index = graphSearchRevealLinkIndices.get(link)
        return index === undefined ? 1 : (reveal.linkProgress.get(index) ?? 0)
      },
      linkRevealDirection: (link) => {
        const index = graphSearchRevealLinkIndices.get(link)
        return index === undefined ? 1 : (graphSearchRevealLinkDirections.get(index) ?? 1)
      },
      linkVisible: (link) => {
        if (!graphLinesVisible) return false
        if (!isEdgeVisible(link, currentEdgeFilter)) return false
        if (!presentationActive) return true
        return (
          presentationVisibleNodeIds.has(link.source) && presentationVisibleNodeIds.has(link.target)
        )
      },
      arrowColor: (link) => getLinkArrowColor(link as ForceLink),
      // Direction is a secondary overview cue and becomes primary only for a
      // selected node. Keeping idle arrows close to line opacity prevents
      // thousands of cones from washing the graph toward one palette hue.
      arrowOpacity: (link) => edgeArrowOpacity(normalLinkOpacity(link), currentSelected != null),
      arrowVisible: (link) => {
        const searchHasFinishedDimming = searchActive && graphSearchRevealFrame?.phase !== 'dimming'
        if (isChunkMode() || searchHasFinishedDimming || !graphLinesVisible) return false
        if (
          presentationActive &&
          (!presentationVisibleNodeIds.has(link.source) ||
            !presentationVisibleNodeIds.has(link.target))
        ) {
          return false
        }
        return (
          !currentSelected ||
          link.source === currentSelected.id ||
          link.target === currentSelected.id
        )
      }
    }
  }

  function syncBatchedVisuals(): void {
    if (!batchedLayer) return
    batchedLayer.setLinesVisible(graphLinesVisible)
    batchedLayer.updateVisuals(graphBatchedVisualState())
    const searchActive = graphSearchScores.size > 0 || graphSearchContextScores.size > 0
    batchedLayer.setParticleLinks(searchActive ? null : (currentSelected?.id ?? null))
    syncParticleAnimationState()
    requestGraphRender()
  }

  /** Keep the host RAF alive only while the selected-edge particle batch exists. */
  function syncParticleAnimationState(): void {
    if (batchedLayer?.hasActiveParticles) wakeGraphAnimation()
    else settleGraphAnimation()
  }

  function replaceBatchedGraphData(data: Graph3DData): void {
    if (!batchedLayer) return
    batchedLayer.setLinesVisible(graphLinesVisible)
    const visuals = graphBatchedVisualState()
    if (!batchedLayer.replaceData(data, visuals)) batchedLayer.setData(data, visuals)
    const searchActive = graphSearchScores.size > 0 || graphSearchContextScores.size > 0
    batchedLayer.setParticleLinks(searchActive ? null : (currentSelected?.id ?? null))
    syncParticleAnimationState()
    requestGraphRender()
  }

  function refreshBatchedLinkStyles(): void {
    if (!currentGraph3DData) return
    for (const link of currentGraph3DData.links) {
      link.color = isFrontmatterEdge(link)
        ? FRONTMATTER_EDGE_COLOR
        : edgeLinkColor(
            link.edge_cluster_id,
            link.strength ?? 0.5,
            currentEdgeWeakThreshold,
            currentEdgePalette
          )
      link.width = edgeLinkWidth(link.strength ?? 0.5)
    }
    syncBatchedVisuals()
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
    syncBatchedVisuals()
  }

  /**
   * Apply search-based dimming to the graph.
   * Highlights matched nodes (direct + context) and dims everything else.
   */
  function applySearchDimming() {
    syncBatchedVisuals()
  }

  // ─── Camera Utilities ─────────────────────────────────────────────

  /**
   * Animate the camera to focus on a specific node with a smooth transition.
   * Positions the camera at a distance proportional to the node's distance from origin,
   * looking at the node's position. Uses 1000ms transition duration.
   */
  function cameraPoseForNode(node: ForceNode): GraphPresentationCameraPose {
    const nx = node.x ?? 0
    const ny = node.y ?? 0
    const nz = node.z ?? 0

    // Position camera at a fixed distance from the node
    const distance = 120
    const nodeDistFromOrigin = Math.hypot(nx, ny, nz)

    // Scale factor to place camera behind/above the node relative to origin
    const distRatio = nodeDistFromOrigin > 0 ? 1 + distance / nodeDistFromOrigin : distance // Fallback for node at origin

    return {
      position: { x: nx * distRatio, y: ny * distRatio, z: nz * distRatio },
      target: { x: nx, y: ny, z: nz }
    }
  }

  function focusCameraOnNode(node: ForceNode) {
    if (!graph || suppressCameraFocus) return
    cancelPendingAutoFit()
    const pose = cameraPoseForNode(node)

    graph.cameraPosition(
      pose.position,
      pose.target,
      1000 // 1000ms transition duration
    )
    wakeGraphAnimation(1000)
  }

  // ─── Keyboard Camera Controls ───────────────────────────────────────

  /** All keys that trigger the camera movement loop. */
  const CAMERA_KEYS = new Set([
    'w',
    'a',
    's',
    'd',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'q',
    'e'
  ])

  /**
   * Continuous camera control loop. Translates (WASD/arrows) and rotates (Q/E)
   * the camera each frame while keys are held. Both the camera and the orbit
   * target move together for translation so the scene pans smoothly.
   */
  function cameraControlLoop() {
    if (!graph || pressedCameraKeys.size === 0) {
      cameraLoopFrameId = null
      settleGraphAnimation()
      return
    }

    const controls = graph.controls() as GraphControls
    const camera = graph.camera() as THREE.PerspectiveCamera
    if (!controls || !camera) {
      cameraLoopFrameId = null
      return
    }

    const target = controls.target as THREE.Vector3

    // --- Translation (WASD / Arrows) ---
    // Build a movement vector in camera-local space then transform to world space.
    let moveX = 0 // strafe right/left
    let moveZ = 0 // forward/back

    if (pressedCameraKeys.has('w') || pressedCameraKeys.has('ArrowUp')) moveZ -= 1
    if (pressedCameraKeys.has('s') || pressedCameraKeys.has('ArrowDown')) moveZ += 1
    if (pressedCameraKeys.has('a') || pressedCameraKeys.has('ArrowLeft')) moveX -= 1
    if (pressedCameraKeys.has('d') || pressedCameraKeys.has('ArrowRight')) moveX += 1

    if (moveX !== 0 || moveZ !== 0) {
      // Speed scales with zoom: far out = fast sweeping, zoomed in = precise
      const dist = camera.position.distanceTo(target)
      const speed = dist * MOVE_SPEED_FACTOR

      // Get camera's forward and right vectors projected onto the XZ plane
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3()
      right.crossVectors(forward, camera.up).normalize()

      const delta = new THREE.Vector3()
      delta.addScaledVector(right, moveX * speed)
      delta.addScaledVector(forward, -moveZ * speed) // -z = forward

      // Move both camera and target together (pan, not zoom)
      camera.position.add(delta)
      target.add(delta)
    }

    // --- Rotation (Q / E): yaw in place ---
    // Rotate the camera around its own position (and swing the orbit target
    // to match) so rotation always feels centered on the camera, not some
    // distant anchor point.
    if (pressedCameraKeys.has('q') || pressedCameraKeys.has('e')) {
      const sign = pressedCameraKeys.has('q') ? 1 : -1
      const toTarget = new THREE.Vector3().subVectors(target, camera.position)
      const azimuth = Math.atan2(toTarget.x, toTarget.z) + sign * ROTATE_SPEED
      const radius = Math.hypot(toTarget.x, toTarget.z)

      toTarget.x = radius * Math.sin(azimuth)
      toTarget.z = radius * Math.cos(azimuth)
      // y stays the same — pure yaw, no pitch change

      target.copy(camera.position).add(toTarget)
      camera.lookAt(target)
    }

    controls.update?.()
    cameraLoopFrameId = requestAnimationFrame(cameraControlLoop)
  }

  /** Start the camera loop if not already running. */
  function startCameraLoop() {
    claimPresentationCamera()
    cancelPendingAutoFit()
    wakeGraphAnimation()
    if (cameraLoopFrameId == null) {
      cameraLoopFrameId = requestAnimationFrame(cameraControlLoop)
    }
  }

  /** Stop the camera loop and clear all pressed keys. */
  function stopCameraLoop() {
    pressedCameraKeys.clear()
    if (cameraLoopFrameId != null) {
      cancelAnimationFrame(cameraLoopFrameId)
      cameraLoopFrameId = null
    }
    settleGraphAnimation()
  }

  /** Recenter the camera to fit the entire graph in view. */
  function recenterCamera() {
    claimPresentationCamera()
    cancelPendingAutoFit()
    zoomToBatchedGraph(600, 80)
  }

  function zoomToBatchedGraph(
    duration = 600,
    padding = 80,
    filter: (node: ForceNode) => boolean = () => true
  ): void {
    if (!graph) return
    const pose = batchedGraphCameraPose(padding, filter)
    if (!pose) return
    graph.cameraPosition(pose.position, pose.target, duration)
    wakeGraphAnimation(duration)
  }

  function batchedGraphCameraPose(
    padding = 80,
    filter: (node: ForceNode) => boolean = () => true
  ): GraphPresentationCameraPose | null {
    if (!graph) return null
    const points = getLiveGraphData().nodes.filter(filter)
    if (points.length === 0) return null
    const bounds = new THREE.Box3()
    for (const node of points) {
      if (node.x == null || node.y == null || node.z == null) continue
      bounds.expandByPoint(new THREE.Vector3(node.x, node.y, node.z))
    }
    if (bounds.isEmpty()) return null
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    const camera = graph.camera()
    const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null
    const halfFov = THREE.MathUtils.degToRad((perspective?.fov ?? 50) / 2)
    const distance = Math.max(
      60,
      (sphere.radius / Math.max(Math.sin(halfFov), 0.1)) * (1 + padding / 500)
    )
    const currentTarget = (graph.controls() as Partial<GraphControls>).target
    const currentPosition = graph.cameraPosition()
    const direction = new THREE.Vector3(
      currentPosition.x,
      currentPosition.y,
      currentPosition.z
    ).sub(currentTarget ?? sphere.center)
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1)
    direction.normalize()
    const position = sphere.center.clone().addScaledVector(direction, distance)
    return {
      position: { x: position.x, y: position.y, z: position.z },
      target: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z }
    }
  }

  function toggleGraphLabels(): void {
    graphLabelsVisible = !graphLabelsVisible
    scheduleLabelUpdate()
  }

  function toggleGraphLines(): void {
    graphLinesVisible = !graphLinesVisible
    applyGraphVisibility()
  }

  function toggleGraphShapes(): void {
    graphShapesVisible = !graphShapesVisible
    if (!graphShapesVisible) clusterHullLayer?.setVisible(false)
    else updateClusterSpheres(true)
    requestGraphRender()
  }

  function dismissBackgroundContextMenu(): void {
    backgroundContextMenuOpen = false
  }

  function positionBackgroundContextMenu(event: MouseEvent): void {
    const menuWidth = 252
    const menuHeight = 180
    const viewportPadding = 8
    contextMenuX = Math.max(
      viewportPadding,
      Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding)
    )
    contextMenuY = Math.max(
      viewportPadding,
      Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding)
    )
  }

  function handleBackgroundRecenter(): void {
    dismissBackgroundContextMenu()
    recenterCamera()
  }

  function handleBackgroundToggleLabels(): void {
    dismissBackgroundContextMenu()
    toggleGraphLabels()
  }

  function handleBackgroundScreenshot(transparent: boolean): void {
    dismissBackgroundContextMenu()
    void exportGraphScreenshot(transparent)
  }

  async function exportGraphScreenshot(transparent: boolean): Promise<void> {
    if (!graph || !containerEl || graphScreenshotExporting) return

    graphScreenshotExporting = true
    try {
      if (isHullMode() && graphShapesVisible) updateClusterSpheres(true)
      updateProximityLabels()
      const png = await graphPerformance.measure(
        'graph.screenshot',
        () =>
          captureGraphScreenshotPng({
            renderer: graph!.renderer(),
            scene: graph!.scene(),
            camera: graph!.camera(),
            overlayRoot: containerEl!,
            transparent
          }),
        { transparent }
      )
      const collection = get(activeCollection)
      await window.api.exportSave({
        defaultName: graphScreenshotDefaultName(collection?.name, transparent),
        content: png,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })
    } catch (error) {
      await window.api.showMessage({
        title: 'Screenshot Failed',
        message: error instanceof Error ? error.message : String(error),
        type: 'error'
      })
    } finally {
      graphScreenshotExporting = false
    }
  }

  /** Route native Graph-menu commands to this pane's live graph controller. */
  function handleGraphMenuAction(action: GraphMenuAction): void {
    if (workspace.activePaneId !== paneId || workspace.focusedTab?.kind !== 'graph') return
    routeGraphMenuAction(action, {
      presentationActive,
      presentationPaused,
      shapesAvailable:
        currentColoringMode === 'cluster' || currentColoringMode === 'custom-cluster',
      search: openGraphSearch,
      recenter: recenterCamera,
      toggleLabels: toggleGraphLabels,
      toggleLines: toggleGraphLines,
      toggleShapes: toggleGraphShapes,
      startPresentation: startGraphPresentation,
      pausePresentation: pauseGraphPresentation,
      continuePresentation: continueGraphPresentation,
      resetPresentation: resetGraphPresentation,
      screenshot: (transparent) => void exportGraphScreenshot(transparent)
    })
  }

  function visiblePresentationNodes(nodes: ForceNode[]): ForceNode[] {
    return presentationActive
      ? nodes.filter((node) => presentationVisibleNodeIds.has(node.id))
      : nodes
  }

  /** Update batched visibility attributes after presentation or line-state changes. */
  function applyGraphVisibility(): void {
    syncBatchedVisuals()
  }

  function setPresentationNodePosition(
    node: ForceNode,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ): void {
    node.x = position.x
    node.y = position.y
    node.z = position.z
    node.fx = position.x
    node.fy = position.y
    node.fz = position.z
    node.vx = velocity.x
    node.vy = velocity.y
    node.vz = velocity.z
  }

  /** Restore the exact settled layout and fixed-position state captured at start. */
  function restorePresentationLayout(): void {
    if (presentationLayoutSnapshot) {
      restoreGraphPresentationLayout(
        [...presentationNodesById.values()],
        presentationLayoutSnapshot
      )
    }
    batchedLayer?.syncPositions()
    scheduleLabelUpdate()
  }

  function currentGraphCameraPose(): GraphPresentationCameraPose | null {
    if (!graph || !graphControls?.target) return null
    const position = graph.cameraPosition()
    return {
      position: { x: position.x, y: position.y, z: position.z },
      target: {
        x: graphControls.target.x,
        y: graphControls.target.y,
        z: graphControls.target.z
      }
    }
  }

  function beginPresentationCameraMotion(
    destination: GraphPresentationCameraPose | null,
    durationMs: number,
    timestamp = performance.now()
  ): void {
    if (!destination || !presentationCamera.shouldAutoFrame) return
    const current = currentGraphCameraPose()
    if (!current) return
    if (presentationCamera.beginAutoMotion(current, destination, timestamp, durationMs)) {
      wakeGraphAnimation(durationMs)
    }
  }

  function advancePresentationCamera(timestamp: number): void {
    if (!graph) return
    const frame = presentationCamera.advance(timestamp)
    if (!frame) return
    graph.cameraPosition(frame.position, frame.target, 0)
    requestGraphRender()
  }

  /** Let user input own the camera without touching presentation playback. */
  function claimPresentationCamera(): void {
    if (!presentationActive || !presentationCamera.takeManualControl()) return
    presentationStatusMessage =
      'Camera auto-follow stopped. Graph presentation continues with manual camera control.'
  }

  function refreshPresentationEnclosures(
    timestamp: number,
    immediate = false,
    affectedGroups?: ReadonlySet<number>,
    forceExact = false
  ): void {
    if (!isHullMode()) return
    if (
      !immediate &&
      timestamp - presentationLastEnclosureAt < PRESENTATION_ENCLOSURE_INTERVAL_MS
    ) {
      return
    }
    presentationLastEnclosureAt = timestamp
    // `immediate` bypasses only the presentation timer. The hull layer still
    // performs its dirty-membership/movement test unless an exact refresh was
    // explicitly requested (pause/screenshot), avoiding repeated hull work.
    updateClusterSpheres(forceExact, affectedGroups, presentationHullNodes)
  }

  function finishGraphPresentation(fitAll: boolean, statusMessage?: string): void {
    if (presentationFrameId !== null) {
      cancelAnimationFrame(presentationFrameId)
      presentationFrameId = null
    }
    restorePresentationLayout()
    if (presentationLayoutWasRunning) layoutClient?.start()
    presentationLayoutWasRunning = false
    presentationCamera.finish()
    presentationActive = false
    presentationPaused = false
    setGraphInteractiveQuality(layoutWorkerState === 'running')
    settleGraphAnimation()
    presentationVisibleNodeIds = new Set()
    presentationRevealedCount = 0
    presentationOrder = []
    presentationCursor = 0
    presentationLastRevealAt = 0
    presentationLastMotionAt = 0
    presentationLastEnclosureAt = 0
    presentationRevealTicks = 0
    presentationAllRevealed = false
    presentationMotions.clear()
    presentationNodesById.clear()
    presentationHullNodes.clear()
    presentationTargetPositions.clear()
    presentationLayoutSnapshot = null
    if (statusMessage) presentationStatusMessage = statusMessage
    applyGraphVisibility()
    if (isHullMode()) updateClusterSpheres()
    if (fitAll) zoomToBatchedGraph(800, 80)
  }

  function endGraphPresentation(): void {
    finishGraphPresentation(false, 'Graph presentation ended. All nodes are visible.')
  }

  function resetGraphPresentation(): void {
    finishGraphPresentation(true, 'Graph presentation reset. All nodes are visible.')
  }

  /** Stop the cancellable presentation camera motion at its current position. */
  function freezePresentationCamera(): void {
    presentationCamera.cancelMotion()
  }

  function pauseGraphPresentation(): void {
    if (!presentationActive || presentationPaused) return
    if (presentationFrameId !== null) {
      cancelAnimationFrame(presentationFrameId)
      presentationFrameId = null
    }
    presentationPaused = true
    presentationLastRevealAt = 0
    presentationLastMotionAt = 0
    freezePresentationCamera()
    refreshPresentationEnclosures(performance.now(), true, undefined, true)
    settleGraphAnimation()
    presentationStatusMessage = `Graph presentation paused at ${presentationRevealedCount} of ${presentationTotal}.`
  }

  function continueGraphPresentation(): void {
    if (!presentationActive || !presentationPaused) return
    presentationPaused = false
    wakeGraphAnimation()
    presentationLastRevealAt = 0
    presentationLastMotionAt = 0
    if (presentationAllRevealed && presentationMotions.size === 0) {
      finishGraphPresentation(presentationCamera.shouldAutoFrame, 'Graph presentation complete.')
      return
    }
    presentationStatusMessage = `Graph presentation continued at ${presentationRevealedCount} of ${presentationTotal}.`
    if (presentationFrameId !== null) cancelAnimationFrame(presentationFrameId)
    presentationFrameId = requestAnimationFrame(runGraphPresentationFrame)
  }

  /** Seed a revealed child beside the connection that discovered it. */
  function seedPresentationNode(
    step: GraphPresentationStep,
    nodesById: Map<string, ForceNode>
  ): boolean {
    const node = nodesById.get(step.nodeId)
    const targetPosition = presentationTargetPositions.get(step.nodeId)
    if (!node || !targetPosition) return false

    const nodeRadius = Math.cbrt(Math.max(node.val, 1)) * 2
    let spawn
    if (step.parentNodeId) {
      const parent = nodesById.get(step.parentNodeId)
      const parentTarget = presentationTargetPositions.get(step.parentNodeId)
      if (!parent || !parentTarget) return false
      const parentPosition = {
        x: parent.x ?? parentTarget.x,
        y: parent.y ?? parentTarget.y,
        z: parent.z ?? parentTarget.z
      }
      const parentRadius = Math.cbrt(Math.max(parent.val, 1)) * 2
      spawn = createGraphPresentationSpawn(node.id, parentPosition, targetPosition, {
        directionOrigin: parentTarget,
        distance: Math.max(10, parentRadius + nodeRadius + 4)
      })
    } else {
      spawn = createGraphPresentationRootSpawn(node.id, targetPosition, Math.max(8, nodeRadius + 4))
    }

    setPresentationNodePosition(node, spawn.position, spawn.velocity)
    presentationMotions.set(node.id, {
      position: spawn.position,
      velocity: spawn.velocity,
      target: targetPosition
    })
    return true
  }

  function advancePresentationMotions(elapsedMs: number): Set<number> {
    const movedGroups = new Set<number>()
    const movedNodeIds: string[] = []
    let moved = false
    for (const [nodeId, motion] of presentationMotions) {
      const node = presentationNodesById.get(nodeId)
      if (!node) {
        presentationMotions.delete(nodeId)
        continue
      }
      const next = advanceGraphPresentationMotion(motion, elapsedMs)
      setPresentationNodePosition(node, next.position, next.velocity)
      moved = true
      movedNodeIds.push(node.id)
      const groupId = hullGroupId(node)
      if (groupId != null) movedGroups.add(groupId)
      if (next.settled) presentationMotions.delete(nodeId)
      else presentationMotions.set(nodeId, next)
    }
    if (moved) {
      batchedLayer?.syncNodePositionsById(movedNodeIds)
      requestGraphRender()
      scheduleLabelUpdate()
    }
    return movedGroups
  }

  /** Reveal the next adaptive batch and its now-connected edges. */
  function revealNextPresentationBatch(timestamp: number): boolean {
    const end = Math.min(presentationCursor + presentationBatchSize, presentationOrder.length)
    const affectedGroups = new Set<number>()
    const revealedNodeIds: string[] = []
    for (let i = presentationCursor; i < end; i++) {
      const step = presentationOrder[i]
      // Svelte's reactive Set instruments add/delete, so mutating in place is
      // observable without cloning every previously revealed id each beat.
      presentationVisibleNodeIds.add(step.nodeId)
      revealedNodeIds.push(step.nodeId)
      seedPresentationNode(step, presentationNodesById)
      const node = presentationNodesById.get(step.nodeId)
      if (node) {
        const groupId = hullGroupId(node)
        if (groupId != null) {
          affectedGroups.add(groupId)
          const members = presentationHullNodes.get(groupId)
          if (members) members.push(node)
          else presentationHullNodes.set(groupId, [node])
        }
      }
    }
    presentationCursor = end
    presentationRevealedCount = end
    presentationRevealTicks++
    batchedLayer?.updateVisualsForNodes(revealedNodeIds, graphBatchedVisualState())
    requestGraphRender()
    scheduleLabelUpdate()
    refreshPresentationEnclosures(timestamp, true, affectedGroups)
    return end >= presentationOrder.length
  }

  function runGraphPresentationFrame(timestamp: number): void {
    presentationFrameId = null
    if (!presentationActive || presentationPaused) return
    advancePresentationCamera(timestamp)
    const elapsedMs = presentationLastMotionAt === 0 ? 16 : timestamp - presentationLastMotionAt
    presentationLastMotionAt = timestamp
    const movedGroups = advancePresentationMotions(elapsedMs)
    if (movedGroups.size > 0) {
      refreshPresentationEnclosures(timestamp, false, movedGroups)
    }
    if (presentationLastRevealAt === 0) presentationLastRevealAt = timestamp

    if (
      !presentationAllRevealed &&
      timestamp - presentationLastRevealAt >= PRESENTATION_INTERVAL_MS
    ) {
      presentationLastRevealAt = timestamp
      presentationAllRevealed = revealNextPresentationBatch(timestamp)

      // Gently widen the camera every few reveal beats as the neighborhood grows.
      if (
        !presentationAllRevealed &&
        presentationRevealTicks >= 12 &&
        (presentationRevealTicks - 12) % 8 === 0 &&
        graph &&
        presentationCamera.shouldAutoFrame
      ) {
        beginPresentationCameraMotion(
          batchedGraphCameraPose(100, (node) => presentationVisibleNodeIds.has(node.id)),
          500,
          timestamp
        )
      }
    }

    if (presentationAllRevealed && presentationMotions.size === 0) {
      // Keep the fully settled canonical layout on screen for one paint.
      presentationFrameId = requestAnimationFrame(() => {
        presentationFrameId = null
        if (presentationActive && !presentationPaused) {
          finishGraphPresentation(
            presentationCamera.shouldAutoFrame,
            'Graph presentation complete.'
          )
        }
      })
      return
    }

    presentationFrameId = requestAnimationFrame(runGraphPresentationFrame)
  }

  function startGraphPresentation(): void {
    if (presentationActive || !graph || !currentData || currentData.nodes.length === 0) return

    const selectedStartId = currentSelected?.id ?? null
    const visibleEdges = currentData.edges.filter((edge) => isEdgeVisible(edge, currentEdgeFilter))
    const order = buildGraphPresentationOrder(currentData.nodes, visibleEdges, selectedStartId)
    if (order.length === 0) return

    if (graphSearchVisible || graphSearchScores.size > 0 || graphSearchContextScores.size > 0) {
      clearGraphSearch()
    }
    if (currentSelected) selectGraphNode(null)
    hoveredNode = null
    hoveredEdge = null
    contextMenuNode = null
    backgroundContextMenuOpen = false

    const liveNodes = getLiveGraphData().nodes
    // Pause worker snapshots while presentation springs animate this canonical layout.
    presentationLayoutWasRunning = layoutWorkerState === 'running'
    layoutClient?.pause()
    presentationNodesById = new Map(liveNodes.map((node) => [node.id, node]))
    presentationHullNodes = new Map()
    presentationLayoutSnapshot = captureGraphPresentationLayout(liveNodes)
    presentationTargetPositions = presentationLayoutSnapshot.positions

    presentationOrder = order
    presentationTotal = order.length
    presentationCursor = 0
    presentationBatchSize = Math.max(1, Math.ceil(order.length / PRESENTATION_MAX_TICKS))
    presentationVisibleNodeIds = new Set()
    presentationRevealedCount = 0
    presentationLastRevealAt = 0
    presentationLastMotionAt = 0
    presentationLastEnclosureAt = 0
    presentationRevealTicks = 0
    presentationAllRevealed = false
    presentationMotions.clear()
    presentationCamera.begin()
    presentationActive = true
    presentationPaused = false
    setGraphInteractiveQuality(true)
    wakeGraphAnimation()
    presentationStatusMessage = selectedStartId
      ? 'Graph presentation started from the selected node.'
      : 'Graph presentation started from the most root-like node.'
    applyGraphVisibility()
    if (isHullMode()) updateClusterSpheres()

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reducedMotion) {
      presentationVisibleNodeIds = new Set(order.map((step) => step.nodeId))
      presentationRevealedCount = order.length
      syncBatchedVisuals()
      if (isHullMode()) updateClusterSpheres()
      finishGraphPresentation(false, 'Graph presentation complete.')
      return
    }

    presentationAllRevealed = revealNextPresentationBatch(performance.now())
    const firstNode = getLiveGraphData().nodes.find((node) => node.id === order[0].nodeId)
    if (firstNode) beginPresentationCameraMotion(cameraPoseForNode(firstNode), 1_000)
    presentationFrameId = requestAnimationFrame(runGraphPresentationFrame)
  }

  function handleKeyUp(e: KeyboardEvent) {
    pressedCameraKeys.delete(e.key)
  }

  // ─── Data Feeding ───────────────────────────────────────────────────

  function handleLayoutEvent(event: GraphLayoutEvent): void {
    if (event.type === 'error') {
      console.warn('Graph layout worker failed:', event.message)
      pendingGraphDragRelease = null
      layoutWorkerState = 'paused'
      setGraphInteractiveQuality(false)
      settleGraphAnimation()
      return
    }
    if (event.type === 'state') {
      // Worker messages are ordered. Once the release request is acknowledged,
      // every later snapshot includes the final pin/unpin position and no
      // renderer-side override is necessary.
      if (pendingGraphDragRelease?.requestId === event.requestId) {
        pendingGraphDragRelease = null
      }
      layoutWorkerState = event.state
      if (document.hidden && event.state === 'running') {
        resumeLayoutAfterVisibility = true
        layoutClient?.pause()
      }
      setGraphInteractiveQuality(
        event.state === 'running' || presentationActive || draggingNode !== null
      )
      if (event.state === 'running') wakeGraphAnimation()
      else settleGraphAnimation()
      return
    }
    if (event.revision !== layoutRevision || !currentGraph3DData) return
    if (presentationActive) return

    const positionOverride = draggingNode
      ? {
          nodeId: draggingNode.id,
          x: draggingNode.x ?? 0,
          y: draggingNode.y ?? 0,
          z: draggingNode.z ?? 0
        }
      : pendingGraphDragRelease

    if (event.type === 'ready') {
      layoutNodeIds = event.nodeIds
      layoutNodesInVisualOrder =
        event.nodeIds.length === currentGraph3DData.nodes.length &&
        event.nodeIds.every((nodeId, index) => nodeId === currentGraph3DData.nodes[index].id)
    }
    const applied = layoutNodesInVisualOrder
      ? applyGraphLayoutPositionsInOrder(
          currentGraph3DData.nodes,
          event.positions,
          positionOverride
        )
      : applyGraphLayoutPositions(liveNodesById, layoutNodeIds, event.positions, positionOverride)
    if (applied === 0) return
    const updateArrows =
      batchedLayer?.hasVisibleArrows === true &&
      (event.type === 'ready' ||
        event.settled ||
        currentGraph3DData.links.length < 10_000 ||
        event.sequence % 3 === 0)
    graphPerformance.measureSync(
      'graph.sync-layout-buffers',
      () => {
        batchedLayer?.syncPositions(updateArrows, event.linkPositions)
        // Packed worker endpoints may be one pointer frame behind. Refresh
        // only the protected node's incident links from the local drag position.
        // Do not queue a one-node matrix range after the complete node upload:
        // Three would then upload only that partial range and freeze every
        // force-driven neighbor on the GPU.
        if (positionOverride) {
          batchedLayer?.syncIncidentLinkPositionsByNodeIds([positionOverride.nodeId])
        }
      },
      {
        nodes: currentGraph3DData.nodes.length,
        links: currentGraph3DData.links.length,
        arrows: updateArrows,
        packedLinks: event.linkPositions?.length === currentGraph3DData.links.length * 6
      }
    )
    requestGraphRender()
    const labelNow = performance.now()
    if (
      !draggingNode &&
      (event.type === 'ready' || event.settled || labelNow - layoutLastLabelUpdateAt >= 160)
    ) {
      layoutLastLabelUpdateAt = labelNow
      scheduleLabelUpdate()
    }
    handleEngineTick()

    if (event.type === 'snapshot' && event.settled) {
      if (persistentPositionCache && layoutCacheKey) {
        persistentPositionCache.set(layoutCacheKey, {
          version: 1,
          nodeIds: [...layoutNodeIds],
          positions: event.positions.slice(),
          createdAt: Date.now()
        })
      }
      handleEngineStop()
    }
  }

  function startWorkerLayout(data: GraphData, graph3DData: Graph3DData, initialAlpha = 1): boolean {
    pendingGraphDragRelease = null
    layoutWorkerState = 'uninitialized'
    // Keep the worker process warm across topology refreshes. Re-initialize its
    // force engine in place with the stable node coordinates instead of paying
    // worker startup/module parse cost for every added or removed note.
    if (!layoutClient) layoutClient = new GraphLayoutWorkerClient()
    if (!unsubscribeLayout) unsubscribeLayout = layoutClient.subscribe(handleLayoutEvent)

    layoutRevision = graphTopologyRevision(data)
    layoutNodeIds = graph3DData.nodes.map((node) => node.id)
    layoutNodesInVisualOrder = true
    layoutLastLabelUpdateAt = 0
    const bundle = buildGraphLayoutInputs(graph3DData, degreeMap, currentLevel)
    bundle.settings.alpha = initialAlpha
    const collectionIdentity = get(activeCollectionId) ?? get(activeCollection)?.path ?? 'unknown'
    layoutCacheKey = createGraphPositionCacheKey({
      collectionId: collectionIdentity,
      graphLevel: currentLevel,
      revision: layoutRevision,
      scope: currentPathFilter,
      settings: {
        // v2 restores the established force contract. Keep it in the cache key
        // so positions produced by the contracted v1 layout are not reused as
        // a supposedly complete layout.
        engine: 'd3-force-3d-worker-v2',
        clusterStrength: bundle.settings.clusterStrength ?? 0,
        chargeTheta: bundle.settings.chargeTheta ?? 1,
        linkStrength: bundle.settings.linkStrength ?? 0
      }
    })

    const initialPositions = packGraphNodePositions(graph3DData.nodes)
    const cached = persistentPositionCache?.get(layoutCacheKey)
    let completeCacheHit = false
    if (cached) {
      const restored = restoreGraphPositions(layoutNodeIds, cached)
      completeCacheHit = restored.matchedNodeCount === layoutNodeIds.length
      for (let index = 0; index < layoutNodeIds.length; index++) {
        const offset = index * 3
        const x = restored.positions[offset]
        const y = restored.positions[offset + 1]
        const z = restored.positions[offset + 2]
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
        initialPositions[offset] = x
        initialPositions[offset + 1] = y
        initialPositions[offset + 2] = z
        const node = graph3DData.nodes[index]
        node.x = x
        node.y = y
        node.z = z
      }
    }

    layoutClient.initialize({
      revision: layoutRevision,
      nodes: bundle.nodes,
      links: bundle.links,
      settings: bundle.settings,
      initialPositions,
      autoStart: !completeCacheHit
    })
    return completeCacheHit
  }

  /**
   * Convert GraphData to 3d-force-graph format and feed it to the graph.
   * Seeds cluster positions before rendering for spatial separation.
   */
  function feedData(data: GraphData) {
    if (!graph) return
    if (lastFedData === data && currentGraph3DData) return
    cancelPendingAutoFit()
    const feedGeneration = ++graphFeedGeneration
    const feedSpan = graphPerformance.beginSpan('graph.feed-data', {
      level: data.level,
      nodes: data.nodes.length,
      links: data.edges.length
    })
    if (presentationActive) {
      finishGraphPresentation(false, 'Graph presentation cancelled because the graph changed.')
    }

    const options = {
      coloringMode: currentColoringMode,
      // Keep complete topology in the worker; edge filters only alter the
      // batched visibility attribute so layouts never restart for a toggle.
      edgeFilter: null,
      weakThreshold: currentEdgeWeakThreshold,
      level: currentLevel,
      clusterPalette: currentClusterPalette,
      customClusterPalette: currentCustomClusterPalette,
      edgePalette: currentEdgePalette
    }

    const graph3DData = graphPerformance.measureSync('graph.bridge-data', () =>
      buildGraph3DData(data, options)
    )

    // Compute bidirectional edge pairs for arrow/particle color logic
    computeBidirectionalPairs(graph3DData.links)

    // Seed cluster positions using Fibonacci sphere distribution
    const spreadRadius = currentLevel === 'chunk' ? 300 : 200
    seedClusterPositions(graph3DData.nodes, data.clusters, spreadRadius)

    // Override with cached node positions if available (preserves layout across remounts)
    const cachedPositions = graphTabId ? nodePositionCache.get(graphTabId) : null
    if (cachedPositions && cachedPositions.size > 0) {
      for (const node of graph3DData.nodes) {
        const cached = cachedPositions.get(node.id)
        if (cached) {
          node.x = cached.x
          node.y = cached.y
          node.z = cached.z
        }
      }
      // Clear the cache after restoring (one-time use)
      nodePositionCache.delete(graphTabId!)
    }

    // Compute cluster centroids from seeded positions
    computeClusterCentroids(graph3DData.nodes)

    // Compute degree map for force configuration
    degreeMap = computeDegreeMap(data.edges)

    // Build folder color map for legend
    rebuildFolderColorMap(graph3DData.nodes)

    // Store reference
    currentGraph3DData = graph3DData
    nodeCount = graph3DData.nodes.length
    rebuildLiveGraphIndices()
    const topologyChanged = graphTopologyRevision(data) !== layoutRevision
    const completeCacheHit =
      !layoutClient || topologyChanged ? startWorkerLayout(data, graph3DData) : false
    replaceBatchedGraphData(graph3DData)
    nodeLabelCache.clear()
    scheduleLabelUpdate()

    // Restore saved camera state or zoom to fit after layout settles
    const cameraToRestore = pendingCameraRestore
    pendingCameraRestore = null
    pendingAutoFitRevision = cameraToRestore ? null : layoutRevision
    const runGuardedCameraAction = (action: () => void): void => {
      if (destroyed || feedGeneration !== graphFeedGeneration) return
      action()
    }
    if (cameraToRestore) {
      graphAutoFitTimer = setTimeout(() => {
        graphAutoFitTimer = null
        runGuardedCameraAction(() =>
          graph?.cameraPosition(cameraToRestore.position, cameraToRestore.target, 0)
        )
      }, 100)
    } else {
      graphAutoFitTimer = setTimeout(
        () => {
          graphAutoFitTimer = null
          if (pendingAutoFitRevision !== layoutRevision) return
          runGuardedCameraAction(() => zoomToBatchedGraph(400, 50))
          if (completeCacheHit) pendingAutoFitRevision = null
        },
        completeCacheHit ? 100 : 350
      )
    }

    // Restore selected node if cached (suppress camera focus — camera is already restored)
    if (selectedNodeIdCache) {
      const nodeId = selectedNodeIdCache
      selectedNodeIdCache = null
      const matchingNode = graph3DData.nodes.find((n) => n.id === nodeId)
      if (matchingNode) {
        suppressCameraFocus = true
        const graphNode = toGraphNode(matchingNode as unknown as ForceNode)
        selectGraphNode(graphNode)
        openGraphNode(graphNode)
        // Re-enable after the store subscription has fired synchronously
        requestAnimationFrame(() => {
          suppressCameraFocus = false
        })
      }
    }
    lastFedData = data
    feedSpan.end({ outcome: 'success' })
  }

  /** Content key for a live link (endpoints may be resolved node objects). */
  function liveLinkKey(link: ForceLink): string {
    if (link.content_key) return link.content_key
    return [
      linkNodeId(link.source),
      linkNodeId(link.target),
      link.relationship_type ?? '',
      link.strength ?? '',
      graphContextToken(link.context_text),
      link.edge_cluster_id ?? '',
      link.field ?? ''
    ].join('\0')
  }

  /**
   * Apply an incremental delta to the live graph WITHOUT a full rebuild:
   * surviving node/link objects are reused (positions, velocities, and THREE
   * meshes preserved), so the camera and settled layout are untouched. New
   * nodes are seeded near their neighbors; pre-existing nodes are briefly
   * pinned so the reheat doesn't scatter them. No zoomToFit, no reseed.
   */
  function applyGraphDelta(next: GraphData, delta: GraphDelta) {
    if (!graph) return
    const deltaSpan = graphPerformance.beginSpan('graph.apply-delta', {
      addedNodes: delta.addedNodes.length,
      removedNodes: delta.removedNodeIds.size,
      addedLinks: delta.addedLinks.length,
      removedLinks: delta.removedLinkKeys.size
    })

    const gd = getLiveGraphData()
    const liveNodes = gd.nodes as ForceNode[]
    const liveLinks = gd.links as ForceLink[]

    const degreeOfNode = computeDegreeMap(next.edges)
    let maxSize = 1
    for (const node of next.nodes) maxSize = Math.max(maxSize, node.size ?? 0)

    // 1. Remove deleted nodes and any link touching them
    const removed = delta.removedNodeIds
    let nodes: ForceNode[] = removed.size ? liveNodes.filter((n) => !removed.has(n.id)) : liveNodes
    let links: ForceLink[] = removed.size
      ? liveLinks.filter(
          (l) => !removed.has(linkNodeId(l.source)) && !removed.has(linkNodeId(l.target))
        )
      : liveLinks

    // 2. Update changed nodes in place (positions untouched)
    if (delta.updatedNodes.size) {
      for (const node of nodes) {
        const upd = delta.updatedNodes.get(node.id)
        if (upd) {
          node.cluster_id = upd.cluster_id
          node.custom_cluster_id = upd.custom_cluster_id ?? null
          node.custom_cluster_ids = upd.custom_cluster_ids ?? []
          node.custom_cluster_scores = upd.custom_cluster_scores ?? []
          node.label = upd.label
          node.size = upd.size ?? null
        }
      }
    }

    // 3. Recompute sphere size (val) for every surviving node
    for (const node of nodes) {
      node.val = nodeSizeValue(
        currentLevel,
        degreeOfNode.get(node.id) ?? 0,
        node.size ?? 0,
        maxSize
      )
    }

    // 4. Add new nodes, seeded near their already-positioned neighbors
    if (delta.addedNodes.length) {
      const positions = new Map<string, { x: number; y: number; z: number }>()
      for (const n of nodes) {
        if (n.x != null && n.y != null && n.z != null) {
          positions.set(n.id, { x: n.x, y: n.y, z: n.z })
        }
      }
      const linkPairs = next.edges.map((e) => ({ sourceId: e.source, targetId: e.target }))

      const newNodes: Graph3DNode[] = delta.addedNodes.map((node) => ({
        id: node.id,
        path: node.path,
        label: node.label,
        cluster_id: node.cluster_id,
        custom_cluster_id: node.custom_cluster_id ?? null,
        custom_cluster_ids: node.custom_cluster_ids ?? [],
        custom_cluster_scores: node.custom_cluster_scores ?? [],
        chunk_index: node.chunk_index,
        size: node.size ?? null,
        val: nodeSizeValue(currentLevel, degreeOfNode.get(node.id) ?? 0, node.size ?? 0, maxSize),
        color: '' // resolved live by the nodeColor accessor after refresh()
      }))
      seedNearNeighbors(newNodes, linkPairs, positions, clusterCentroids)
      nodes = nodes.concat(newNodes as ForceNode[])
    }

    // 5. Remove matched link occurrences, then append new links
    if (delta.removedLinkKeys.size) {
      const remaining = new Map(delta.removedLinkKeys)
      links = links.filter((l) => {
        const key = liveLinkKey(l)
        const count = remaining.get(key)
        if (count && count > 0) {
          remaining.set(key, count - 1)
          return false
        }
        return true
      })
    }
    if (delta.addedLinks.length) {
      const newLinks: Graph3DLink[] = delta.addedLinks.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relationship_type: edge.relationship_type ?? null,
        strength: edge.strength ?? null,
        context_text:
          edge.context_text ??
          (edge.context_index == null ? null : (next.contexts?.[edge.context_index] ?? null)),
        edge_cluster_id: edge.edge_cluster_id ?? null,
        field: edge.field,
        color: isFrontmatterEdge(edge)
          ? FRONTMATTER_EDGE_COLOR
          : edgeLinkColor(
              edge.edge_cluster_id,
              edge.strength ?? 0.5,
              currentEdgeWeakThreshold,
              currentEdgePalette
            ),
        width: edgeLinkWidth(edge.strength ?? 0.5),
        content_key: linkKey(edge, next.contexts)
      }))
      links = links.concat(newLinks as ForceLink[])
    }

    // 6. Swap stable objects back into the batched layer and let the worker
    // relax the changed topology from those existing coordinates.
    degreeMap = computeDegreeMap(next.edges)
    computeBidirectionalPairs(links)
    recomputeLiveCentroids(nodes)
    if (currentColoringMode === 'folder') rebuildFolderColorMap(nodes)

    currentGraph3DData = { nodes, links }
    nodeCount = nodes.length
    rebuildLiveGraphIndices()
    if (graphTopologyRevision(next) !== layoutRevision) {
      startWorkerLayout(next, currentGraph3DData, 0.25)
    }
    replaceBatchedGraphData(currentGraph3DData)

    // 9. Reconcile selection/hover state against removed nodes
    if (currentSelected && removed.has(currentSelected.id)) {
      selectGraphNode(null)
    } else {
      computeNeighborSet()
      applySelectionDimming()
    }
    if (hoveredNode && removed.has(hoveredNode.id)) hoveredNode = null
    if (contextMenuNode && removed.has(contextMenuNode.id)) contextMenuNode = null

    // Re-apply an active graph search against the new node set
    if (graphSearchVisible && graphSearchQuery.length >= 2) {
      executeGraphSearch(graphSearchQuery)
    }

    // Cluster shells rebuild from current positions/cluster ids
    if (isHullMode()) updateClusterSpheres()

    scheduleLabelUpdate()
    lastFedData = next
    deltaSpan.end({ outcome: 'success' })
  }

  /**
   * Capture the current camera + node positions into the per-tab caches so a
   * subsequent feedData() restores them instead of zooming to fit — used when
   * a delta is too large to patch but we still want to avoid a camera reset.
   */
  function preserveViewForRebuild() {
    if (!graph || !graphTabId) return
    const cam = graph.cameraPosition()
    const controls = graph.controls() as { target?: { x: number; y: number; z: number } }
    if (cam && controls?.target) {
      pendingCameraRestore = {
        position: { x: cam.x, y: cam.y, z: cam.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      }
    }
    const positions = new Map<string, { x: number; y: number; z: number }>()
    for (const node of getLiveGraphData().nodes) {
      if (node.x != null && node.y != null && node.z != null) {
        positions.set(node.id, { x: node.x, y: node.y, z: node.z })
      }
    }
    nodePositionCache.set(graphTabId, positions)
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
      folderColorMap.set(sorted[i], paletteColor(currentClusterPalette, i))
    }
  }

  // ─── Cluster Enclosures ─────────────────────────────────────────────

  /**
   * Remove all existing cluster enclosure meshes and labels from the scene.
   * Called before recomputing them or when switching away from cluster mode.
   */
  function clearClusterMeshes() {
    clusterHullLayer?.dispose()
    clusterHullLayer = null
    clusterLabels = []
    requestGraphRender()
  }

  /** Whether hull/enclosure rendering applies to the current coloring mode. */
  function isHullMode(): boolean {
    return currentColoringMode === 'cluster' || currentColoringMode === 'custom-cluster'
  }

  /**
   * Grouping id for hulls/labels: auto cluster_id in cluster mode,
   * PRIMARY topic (custom_cluster_id) in custom-cluster mode.
   * Null (unclustered / Unassigned) groups get no hull — desired.
   */
  function hullGroupId(node: ForceNode): number | null {
    return currentColoringMode === 'custom-cluster'
      ? (node.custom_cluster_id ?? null)
      : node.cluster_id
  }

  /** Palette used for hulls/labels in the current mode. */
  function hullPalette(): HarmonicPalette {
    return currentColoringMode === 'custom-cluster'
      ? currentCustomClusterPalette
      : currentClusterPalette
  }

  /** Label for a hull group id from the current data (mode-aware). */
  function hullLabel(id: number): string {
    if (currentColoringMode === 'custom-cluster') {
      return currentData?.custom_clusters?.find((c) => c.id === id)?.label ?? `Topic ${id}`
    }
    return currentData?.clusters.find((c) => c.id === id)?.label ?? `Cluster ${id}`
  }

  /**
   * Compute a faceted enclosure for each cluster from current node positions,
   * then add transparent nested hull meshes to the scene.
   * Also computes screen-projected cluster label positions for the HTML overlay.
   *
   * Runs in both 'cluster' and 'custom-cluster' coloring modes; groups by
   * cluster_id or PRIMARY topic id respectively.
   */
  function updateClusterSpheres(
    forceExact = false,
    onlyGroupIds?: ReadonlySet<number>,
    suppliedGroups?: ReadonlyMap<number, ForceNode[]>
  ) {
    if (!graph) return

    // Only show enclosures in cluster/custom-cluster coloring modes
    if (!isHullMode()) {
      clearClusterMeshes()
      return
    }

    // Keep the cached layer but skip all grouping/QuickHull work while shapes
    // are hidden. Re-enabling forces one exact refresh from current positions.
    if (!graphShapesVisible) {
      clusterHullLayer?.setVisible(false)
      return
    }
    // Reuse the cached hulls after Shapes is toggled back on. The previous
    // implementation only set visibility while constructing a new layer, so
    // an existing layer remained hidden indefinitely.
    clusterHullLayer?.setVisible(true)

    const allNodes = getLiveGraphData().nodes as ForceNode[]
    const partial = onlyGroupIds !== undefined

    // Group nodes by cluster_id (or primary topic id in custom-cluster mode).
    // Presentation keeps its own revealed-members map so one reveal step does
    // not rescan every node just to update one or two shells.
    const clusterNodes = new Map<number, ForceNode[]>()
    if (suppliedGroups && onlyGroupIds) {
      for (const groupId of onlyGroupIds) {
        const members = suppliedGroups.get(groupId)
        if (members?.length) clusterNodes.set(groupId, members)
      }
    } else {
      const visibleNodes = visiblePresentationNodes(allNodes)
      for (const node of visibleNodes) {
        const groupId = hullGroupId(node)
        if (groupId == null || (onlyGroupIds && !onlyGroupIds.has(groupId))) continue
        const existing = clusterNodes.get(groupId)
        if (existing) existing.push(node)
        else clusterNodes.set(groupId, [node])
      }
    }

    let groupedNodeCount = 0
    for (const members of clusterNodes.values()) groupedNodeCount += members.length
    if (groupedNodeCount === 0) {
      clusterHullLayer?.update([], { partial })
      if (!partial) clusterLabels = []
      return
    }

    if (!clusterHullLayer) {
      clusterHullLayer = new GraphHullLayer()
      clusterHullLayer.setVisible(graphShapesVisible)
      graph.scene().add(clusterHullLayer.group)
    }

    const definitions: GraphHullDefinition[] = [...clusterNodes].map(([clusterId, cnodes]) => ({
      id: clusterId,
      label: hullLabel(clusterId),
      color: paletteColor(hullPalette(), clusterId),
      points: cnodes.map((node) => ({
        nodeId: node.id,
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0
      }))
    }))
    const hullSpan = graphPerformance.beginSpan('graph.update-hulls', {
      clusters: definitions.length,
      nodes: groupedNodeCount,
      exact: forceExact
    })
    const rebuilt = clusterHullLayer.update(definitions, {
      force: forceExact,
      movementThreshold: presentationActive ? 2 : 6,
      partial
    })
    clusterHullLayer.setHighlightedGroup(activeHullHighlightId())
    hullSpan.end({ rebuilt })
    if (rebuilt > 0) requestGraphRender()
    updateClusterLabelPositions()

    // Also recompute cluster centroids for the attraction force
    if (!partial) recomputeLiveCentroids(allNodes)
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
    if (!graph || !isHullMode() || !clusterHullLayer) return

    clusterLabels = clusterHullLayer.centroids().map((centroid) => {
      const pos = projectToScreen(centroid.x, centroid.y, centroid.z)
      return {
        id: centroid.id,
        label: centroid.label,
        screenX: pos.x,
        screenY: pos.y,
        visible: pos.visible
      }
    })
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

  /** Keep enclosure shells responsive without rebuilding them for every worker snapshot. */
  function handleEngineTick() {
    if (!isHullMode()) return
    if (!graph) return
    const now = performance.now()
    if (now - lastHullLayoutUpdateAt < 250) return
    lastHullLayoutUpdateAt = now

    const graphData = getLiveGraphData()
    const nodes = graphData.nodes as ForceNode[]

    // Recompute live centroids for the attraction force
    recomputeLiveCentroids(nodes)

    // Reveal beats already rebuild lightweight shells. Avoid duplicating that
    // geometry work on simulation ticks while presentation mode is active.
    if (presentationActive && !presentationPaused) return

    // Update sphere positions + sizes
    updateClusterSphereMeshPositions(nodes)

    // Update label screen positions
    updateClusterLabelPositions()
  }

  /**
   * Handle engine stop: final cluster sphere update when simulation completes.
   */
  function handleEngineStop() {
    scheduleLabelUpdate()
    if ((!presentationActive || presentationPaused) && isHullMode() && graph) {
      updateClusterSpheres(true)
    }
    if (pendingAutoFitRevision === layoutRevision) {
      if (graphAutoFitTimer) clearTimeout(graphAutoFitTimer)
      graphAutoFitTimer = null
      pendingAutoFitRevision = null
      zoomToBatchedGraph(500, 60)
    }
  }

  /**
   * Update existing cluster sphere mesh positions and sizes based on current node positions.
   * Avoids recreating meshes on every tick — just repositions and rescales them.
   */
  function updateClusterSphereMeshPositions(nodes: ForceNode[]) {
    if (!clusterHullLayer || nodes.length === 0) return
    updateClusterSpheres()
  }

  // ─── Store Subscriptions ────────────────────────────────────────────

  function setupStoreSubscriptions() {
    // Data changes → rebuild graph (or lazily initialize if graph doesn't exist yet)
    unsubData = graphData.subscribe(async (d) => {
      if (graphSearchRevealPlan || graphSearchRevealFrameId !== null) {
        cancelGraphSearchReveal(true)
      }
      if (presentationActive) {
        finishGraphPresentation(false, 'Graph presentation cancelled because the graph changed.')
      }
      const prev = currentData
      currentData = d
      unconnectedNodeIds = d ? findUnconnectedNodeIds(d.nodes, d.edges) : new Set()
      if (currentUnconnectedHighlight) syncBatchedVisuals()
      if (d && d.nodes.length > 0 && !graph && webglSupported) {
        // graphContainerEl is always mounted, but may need a tick for bind:this
        await tick()
        if (destroyed) return
        if (graphContainerEl && !graph) {
          await initializeGraph()
          if (destroyed || !graph) return
          syncGraphSize()
          feedData(d)
          if (graphSearchVisible && graphSearchQuery.length >= 2) {
            executeGraphSearch(graphSearchQuery)
          }
        }
      } else if (d && graph) {
        syncGraphSize()
        // Background index refresh of the same level's full graph → diff and
        // patch incrementally so the camera/layout/selection survive.
        const canPatch =
          get(graphLoadMode) === 'refresh' &&
          get(graphDataSource) === 'cli' &&
          prev != null &&
          prev.level === d.level
        if (canPatch && prev) {
          const delta = diffGraphData(prev, d)
          if (isEmptyDelta(delta)) {
            lastFedData = d
            return
          }
          if (
            shouldPatch(delta, prev.nodes.length, d.nodes.length, prev.edges.length, d.edges.length)
          ) {
            applyGraphDelta(d, delta)
            return
          }
          // Too large to patch — full rebuild, but preserve the camera + layout
          preserveViewForRebuild()
        }
        feedData(d)
        if (graphSearchVisible && graphSearchQuery.length >= 2) {
          executeGraphSearch(graphSearchQuery)
        }
      }
    })

    // Coloring mode → refresh graph to re-evaluate nodeColor accessor + toggle cluster spheres
    unsubColoring = graphColoringMode.subscribe((v) => {
      currentColoringMode = v
      // Ensure folder color map is current when switching to folder mode
      if (v === 'folder' && currentGraph3DData) {
        rebuildFolderColorMap(currentGraph3DData.nodes)
      }
      // Group highlights only apply to their corresponding coloring mode.
      if (v !== 'cluster') {
        highlightedClusterId = null
      }
      if (v !== 'custom-cluster') {
        highlightedTopicId = null
      }
      syncBatchedVisuals()

      // Show cluster enclosure spheres in cluster + custom-cluster modes
      if (v === 'cluster' || v === 'custom-cluster') {
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
      if (batchedLayer?.hasActiveParticles) wakeGraphAnimation()
      else settleGraphAnimation()

      // Optional camera focus animation on node select
      if (n && graph) {
        const forceNode = liveNodesById.get(n.id)
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
      syncBatchedVisuals()
      scheduleLabelUpdate()
    })

    // Search result hover highlight
    unsubHoveredFilePath = graphHoveredFilePath.subscribe((p) => {
      _currentHoveredFilePath = p
    })

    // Edge filters are visual state; topology/layout stays stable.
    unsubEdgeFilter = graphEdgeFilter.subscribe((f) => {
      currentEdgeFilter = f
      syncBatchedVisuals()
    })

    // Unconnected-node highlight → recolor in place without disturbing layout.
    unsubUnconnectedHighlight = graphUnconnectedHighlight.subscribe((active) => {
      currentUnconnectedHighlight = active
      syncBatchedVisuals()
    })

    // Semantic edge toggle → switch the existing GPU attributes in place.
    unsubSemanticEdges = graphSemanticEdgesEnabled.subscribe((v) => {
      _currentSemanticEdgesEnabled = v
      syncBatchedVisuals()
    })

    // Weak edge threshold only updates shared link color attributes.
    unsubEdgeWeakThreshold = graphEdgeWeakThreshold.subscribe((v) => {
      currentEdgeWeakThreshold = v
      refreshBatchedLinkStyles()
    })

    // Loading state → when loading clears with data ready, initialize graph
    unsubLoading = graphLoading.subscribe(async (v) => {
      currentLoading = v
      // When loading finishes and data is available but graph isn't initialized yet,
      // wait for Svelte to render the {:else} block then initialize
      if (!v && currentData && currentData.nodes.length > 0 && !graph && webglSupported) {
        await tick()
        if (destroyed) return
        if (graphContainerEl && !graph) {
          await initializeGraph()
          if (destroyed || !graph) return
          syncGraphSize()
          feedData(currentData)
        }
      }
    })
    unsubError = graphError.subscribe((v) => {
      currentError = v
    })

    // Level changes load a new graph; its worker settings are configured in feedData.
    // setGraphLevel() calls loadGraphData(), which triggers graphData subscription
    // → feedData() rebuilds graph data with level-appropriate sizing and forces.
    // Document mode: degree-based node sizing, wider link distances, arrows (subtask 3-2)
    // Chunk mode: size-based node sizing, tighter link distances, no arrows
    unsubLevel = graphLevel.subscribe((v) => {
      const prevLevel = currentLevel
      currentLevel = v
      if (prevLevel !== v && graph) {
        if (graphSearchVisible && graphSearchQuery.length >= 2) {
          executeGraphSearch(graphSearchQuery)
        }
      }
    })

    // Opened node → tracked for inline preview visibility
    unsubOpenedNode = graphOpenedNode.subscribe((v) => {
      currentOpenedNode = v
    })

    // Palette changes → refresh colors without full data rebuild
    unsubClusterPalette = clusterPalette.subscribe((p) => {
      currentClusterPalette = p
      if (currentColoringMode === 'folder' && currentGraph3DData) {
        rebuildFolderColorMap(currentGraph3DData.nodes)
      }
      if (currentColoringMode === 'cluster') {
        updateClusterSpheres(true)
      }
      syncBatchedVisuals()
    })

    unsubCustomClusterPalette = customClusterPalette.subscribe((p) => {
      currentCustomClusterPalette = p
      if (currentColoringMode === 'custom-cluster') {
        updateClusterSpheres(true)
        syncBatchedVisuals()
      }
    })

    unsubEdgePalette = edgePalette.subscribe((p) => {
      currentEdgePalette = p
      refreshBatchedLinkStyles()
    })

    unsubArrowPalette = arrowPalette.subscribe((p) => {
      currentArrowPalette = p
      syncBatchedVisuals()
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
      batchedLayer?.setViewport(rect.width, rect.height)
      scheduleLabelUpdate()
      requestGraphRender()
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
      custom_cluster_id: node.custom_cluster_id ?? null,
      custom_cluster_ids: node.custom_cluster_ids ?? [],
      custom_cluster_scores: node.custom_cluster_scores ?? [],
      chunk_index: node.chunk_index
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Cmd/Ctrl+F: toggle graph search overlay
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      if (graphSearchVisible) {
        clearGraphSearch()
      } else {
        openGraphSearch()
      }
      return
    }

    // '/': open graph search (only when not typing in an input)
    if (e.key === '/' && !graphSearchVisible) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        (e.target as HTMLElement)?.hasAttribute('contenteditable')
      if (!isEditable) {
        e.preventDefault()
        openGraphSearch()
        return
      }
    }

    if (e.key === 'Escape') {
      if (graphSearchVisible) {
        clearGraphSearch()
        graphSearchVisible = false
        return
      }
      if (backgroundContextMenuOpen) {
        backgroundContextMenuOpen = false
        return
      }
      if (contextMenuNode) {
        contextMenuNode = null
        return
      }
      selectGraphNode(null)
      setGraphHighlightedFolder(null)
      clearClusterHighlight()
      clearTopicHighlight()
      hoveredNode = null
      hoveredEdge = null
      return
    }

    // Camera controls: WASD/arrows to move, Q/E to rotate (when no node selected)
    // Arrow keys navigate connected nodes when a node IS selected
    if (graph && CAMERA_KEYS.has(e.key)) {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        (e.target as HTMLElement)?.hasAttribute('contenteditable')
      if (isEditable) return

      if (currentSelected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        // Arrow keys navigate between connected nodes when a node is selected
        e.preventDefault()
        navigateToConnectedNode(e.key)
      } else if (!currentSelected) {
        e.preventDefault()
        pressedCameraKeys.add(e.key)
        startCameraLoop()
      }
    }
  }

  /**
   * Navigate to the closest connected node in the given arrow direction.
   * Projects 3D positions to screen space using the camera, then picks
   * the neighbor whose screen-space direction best matches the arrow key.
   */
  function navigateToConnectedNode(key: string) {
    if (!currentSelected || !graph) return

    const graphD = getLiveGraphData()
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
    // Popup-aware: a popped-out graph has no panes to open into — this
    // routes the document to a fresh popup window instead.
    openResolvedPathOtherPane(contextMenuNode.path)
    contextMenuNode = null
  }

  function handleContextMenuPreview() {
    if (!contextMenuNode) return
    openGraphNode(toGraphNode(contextMenuNode))
    contextMenuNode = null
  }

  function handleContextMenuSelect() {
    if (!contextMenuNode) return
    selectGraphNode(toGraphNode(contextMenuNode))
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
      color: paletteColor(currentClusterPalette, c.id),
      member_count: c.member_count
    }))
  }

  /** Get custom cluster items for legend display. */
  function getCustomClusters(): {
    id: number
    label: string
    color: string
    member_count: number
  }[] {
    if (!currentData?.custom_clusters) return []
    return currentData.custom_clusters.map((c) => ({
      id: c.id,
      label: c.label,
      color: paletteColor(currentCustomClusterPalette, c.id),
      member_count: c.member_count
    }))
  }

  /** Client-side count of document-level nodes with no topic (Unassigned). */
  function getUnassignedCount(): number {
    if (!currentData) return 0
    return currentData.nodes.filter((n) => n.chunk_index == null && n.custom_cluster_id == null)
      .length
  }

  /** Look up a topic name by id in the current graph data. */
  function topicName(id: number): string {
    return currentData?.custom_clusters?.find((c) => c.id === id)?.label ?? `Topic ${id}`
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
        color: edgeClusterColor(id, currentEdgePalette),
        label: info.label,
        count: info.count
      }))
      .sort((a, b) => a.id - b.id)
  }

  /** Check if a given edge cluster is currently filtered out. */
  function isEdgeClusterFiltered(clusterId: number): boolean {
    if (currentEdgeFilter === null) return false
    return !currentEdgeFilter.has(clusterId)
  }

  /** Toggle one edge type without rebuilding the graph or disturbing its layout. */
  function toggleLegendEdgeCluster(clusterId: number): void {
    toggleEdgeClusterFilter(
      clusterId,
      getEdgeClusters().map((cluster) => cluster.id)
    )
  }

  // ─── Batched Picking & Dragging ──────────────────────────────────────

  function setGraphRay(clientX: number, clientY: number): void {
    if (!graph || !graphCanvas) return
    const rect = graphCanvas.getBoundingClientRect()
    graphPointerNdc.set(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1
    )
    graphRaycaster.params.Line = { threshold: 2 }
    graphRaycaster.setFromCamera(graphPointerNdc, graph.camera())
  }

  function pickBatchedNode(clientX: number, clientY: number): ForceNode | null {
    if (!batchedLayer) return null
    setGraphRay(clientX, clientY)
    return batchedLayer.pickNode(graphRaycaster) as ForceNode | null
  }

  function updateBatchedHover(clientX: number, clientY: number, forceLinkPick = false): void {
    if (!batchedLayer || presentationActive || draggingNode) {
      hoveredNode = null
      hoveredEdge = null
      return
    }
    setGraphRay(clientX, clientY)
    const node = batchedLayer.pickNode(graphRaycaster) as ForceNode | null
    hoveredNode = node
    if (node) {
      hoveredEdge = null
      if (graphPickTimer !== null) clearTimeout(graphPickTimer)
      graphPickTimer = null
    } else {
      const linkPickInterval = graphLinkPickIntervalMs(
        layoutWorkerState === 'running',
        currentGraph3DData?.links.length ?? 0
      )
      const now = performance.now()
      const remaining = linkPickInterval - (now - graphLastLinkPickAt)
      if (!forceLinkPick && remaining > 0) {
        if (graphPickTimer === null) {
          graphPickTimer = setTimeout(() => {
            graphPickTimer = null
            graphForceNextLinkPick = true
            scheduleBatchedHoverFrame()
          }, remaining)
        }
      } else {
        if (graphPickTimer !== null) clearTimeout(graphPickTimer)
        graphPickTimer = null
        graphLastLinkPickAt = now
        hoveredEdge = batchedLayer.pickLink(graphRaycaster) as ForceLink | null
      }
    }
    if (node || hoveredEdge) {
      tooltipX = clientX
      tooltipY = clientY
    }
  }

  function scheduleBatchedHoverFrame(): void {
    if (graphPickFrameId !== null) return
    graphPickFrameId = requestAnimationFrame(() => {
      graphPickFrameId = null
      const point = pendingPickPoint
      const forceLinkPick = graphForceNextLinkPick
      graphForceNextLinkPick = false
      if (point) updateBatchedHover(point.x, point.y, forceLinkPick)
    })
  }

  function scheduleBatchedHover(clientX: number, clientY: number): void {
    pendingPickPoint = { x: clientX, y: clientY }
    // Node broad-phase picking remains frame-responsive. Only the much more
    // expensive link-grid rebuild is throttled while a huge layout is moving.
    scheduleBatchedHoverFrame()
  }

  function selectBatchedNode(node: ForceNode): void {
    if (presentationActive) endGraphPresentation()
    const graphNode = toGraphNode(node)
    if (currentSelected?.id === node.id) {
      openResolvedPathOtherPane(node.path)
    } else {
      selectGraphNode(graphNode)
      openGraphNode(graphNode)
    }
    contextMenuNode = null
    backgroundContextMenuOpen = false
  }

  function postGraphDragPin(node: ForceNode): void {
    // Pointer events are already coalesced by Chromium. Forward the newest
    // coordinate immediately so physics does not trail the visible node by an
    // additional requestAnimationFrame before the worker's own frame pacing.
    layoutClient?.pin(node.id, node.x ?? 0, node.y ?? 0, node.z ?? 0, 0.3)
  }

  function onBatchedPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    const node = pickBatchedNode(event.clientX, event.clientY)
    // Empty-space pointer gestures belong to OrbitControls. Keep the reveal
    // animation alive and let the controls-start event claim only the camera.
    if (shouldEndGraphPresentationForPointerTarget(presentationActive, node !== null)) {
      endGraphPresentation()
    }
    if (node && graphControls) graphControls.enabled = false
    pointerCandidate = { node, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  function onBatchedPointerMove(event: PointerEvent): void {
    const candidate = pointerCandidate
    if (candidate?.node) {
      const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y)
      if (!draggingNode && moved >= 3 && graph) {
        draggingNode = candidate.node
        setGraphInteractiveQuality(true)
        wakeGraphAnimation()
        const nodePosition = graphDragNodePosition.set(
          candidate.node.x ?? 0,
          candidate.node.y ?? 0,
          candidate.node.z ?? 0
        )
        graph.camera().getWorldDirection(graphDragPlaneNormal)
        graphDragPlane.setFromNormalAndCoplanarPoint(graphDragPlaneNormal, nodePosition)
        // Match THREE DragControls: preserve where on the sphere the pointer
        // grabbed it instead of snapping the node center under the cursor.
        setGraphRay(candidate.x, candidate.y)
        if (graphRaycaster.ray.intersectPlane(graphDragPlane, graphDragPoint)) {
          graphDragOffset.copy(graphDragPoint).sub(nodePosition)
        } else {
          graphDragOffset.set(0, 0, 0)
        }
        graphCanvas?.setPointerCapture(event.pointerId)
      }
      if (draggingNode) {
        event.preventDefault()
        setGraphRay(event.clientX, event.clientY)
        if (graphRaycaster.ray.intersectPlane(graphDragPlane, graphDragPoint)) {
          graphDragPoint.sub(graphDragOffset)
          draggingNode.x = graphDragPoint.x
          draggingNode.y = graphDragPoint.y
          draggingNode.z = graphDragPoint.z
          postGraphDragPin(draggingNode)
          batchedLayer?.syncNodePositionsById([draggingNode.id])
          requestGraphRender()
          updateDraggedNodeLabel(draggingNode)
        }
        return
      }
    }
    scheduleBatchedHover(event.clientX, event.clientY)
  }

  function onBatchedPointerUp(event: PointerEvent): void {
    const candidate = pointerCandidate
    pointerCandidate = null
    if (draggingNode) {
      const node = draggingNode
      const releaseRequestId = layoutClient?.unpin(node.id, true)
      if (releaseRequestId !== undefined) {
        pendingGraphDragRelease = {
          requestId: releaseRequestId,
          nodeId: node.id,
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0
        }
      }
      draggingNode = null
      if (graphControls) graphControls.enabled = true
      if (graphCanvas?.hasPointerCapture(event.pointerId)) {
        graphCanvas.releasePointerCapture(event.pointerId)
      }
      updateClusterSpheres()
      scheduleLabelUpdate()
      setGraphInteractiveQuality(true)
      settleGraphAnimation()
      return
    }
    if (event.type === 'pointercancel' || !candidate || candidate.pointerId !== event.pointerId) {
      if (candidate?.node && graphControls) graphControls.enabled = true
      return
    }
    const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y)
    if (candidate.node && graphControls) graphControls.enabled = true
    if (moved >= 3) return
    if (candidate.node) {
      selectBatchedNode(candidate.node)
      return
    }
    if (event.button === 0) {
      selectGraphNode(null)
      setGraphHighlightedFolder(null)
      clearClusterHighlight()
      clearTopicHighlight()
      contextMenuNode = null
      backgroundContextMenuOpen = false
    }
  }

  function onBatchedContextMenu(event: MouseEvent): void {
    event.preventDefault()
    const node = pickBatchedNode(event.clientX, event.clientY)
    if (node) {
      if (presentationActive) endGraphPresentation()
      backgroundContextMenuOpen = false
      contextMenuNode = node
      contextMenuX = event.clientX
      contextMenuY = event.clientY
      return
    }
    contextMenuNode = null
    hoveredNode = null
    hoveredEdge = null
    positionBackgroundContextMenu(event)
    backgroundContextMenuOpen = true
  }

  function onBatchedPointerLeave(): void {
    if (draggingNode) return
    pendingPickPoint = null
    graphForceNextLinkPick = false
    if (graphPickTimer !== null) clearTimeout(graphPickTimer)
    graphPickTimer = null
    hoveredNode = null
    hoveredEdge = null
  }

  function setupBatchedInteractions(): void {
    if (!graph) return
    graphCanvas = graph.renderer().domElement
    graphCanvas.addEventListener('pointerdown', onBatchedPointerDown)
    graphCanvas.addEventListener('pointermove', onBatchedPointerMove)
    graphCanvas.addEventListener('pointerup', onBatchedPointerUp)
    graphCanvas.addEventListener('pointercancel', onBatchedPointerUp)
    graphCanvas.addEventListener('pointerleave', onBatchedPointerLeave)
    graphCanvas.addEventListener('contextmenu', onBatchedContextMenu)
  }

  function teardownBatchedInteractions(): void {
    if (graphPickFrameId !== null) cancelAnimationFrame(graphPickFrameId)
    graphPickFrameId = null
    if (graphPickTimer !== null) clearTimeout(graphPickTimer)
    graphPickTimer = null
    graphForceNextLinkPick = false
    pendingPickPoint = null
    pendingGraphDragRelease = null
    pointerCandidate = null
    draggingNode = null
    if (!graphCanvas) return
    graphCanvas.removeEventListener('pointerdown', onBatchedPointerDown)
    graphCanvas.removeEventListener('pointermove', onBatchedPointerMove)
    graphCanvas.removeEventListener('pointerup', onBatchedPointerUp)
    graphCanvas.removeEventListener('pointercancel', onBatchedPointerUp)
    graphCanvas.removeEventListener('pointerleave', onBatchedPointerLeave)
    graphCanvas.removeEventListener('contextmenu', onBatchedContextMenu)
    graphCanvas = null
  }

  // ─── Graph Initialization ────────────────────────────────────────────

  /**
   * Initialize the 3d-force-graph instance.
   * Called lazily when graphContainerEl becomes available (after data loads
   * and Svelte renders the {:else} block with the container div).
   */
  async function initializeGraph(): Promise<void> {
    if (graph) return
    if (!graphInitPromise) {
      graphInitPromise = initializeGraphNow().finally(() => {
        graphInitPromise = null
      })
    }
    await graphInitPromise
  }

  async function initializeGraphNow(): Promise<void> {
    if (!graphContainerEl || graph || destroyed) return
    const targetContainer = graphContainerEl
    const initializeSpan = graphPerformance.beginSpan('graph.initialize')

    // Dynamic import for Electron compatibility (avoids SSR/Node.js issues)
    const ForceGraph3DModule = await import('3d-force-graph')
    if (
      destroyed ||
      graph ||
      graphContainerEl !== targetContainer ||
      !targetContainer.isConnected
    ) {
      initializeSpan.end({ outcome: 'cancelled' })
      return
    }
    const ForceGraph3D = ForceGraph3DModule.default

    // Get container dimensions before init (3d-force-graph defaults to window size)
    const rect = containerEl?.getBoundingClientRect()
    const initWidth = rect?.width || graphContainerEl.clientWidth || 800
    const initHeight = rect?.height || graphContainerEl.clientHeight || 600

    // Initialize 3d-force-graph with PRD configuration values
    graph = new ForceGraph3D(graphContainerEl, {
      controlType: 'orbit',
      rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' }
    })
      .width(initWidth)
      .height(initHeight)
      .backgroundColor(
        getComputedStyle(document.documentElement).getPropertyValue('--color-graph-bg').trim() ||
          '#0a0a0b'
      )
      .showNavInfo(false)
      .warmupTicks(0)
      .cooldownTicks(0)
      .nodeVisibility(false)
      .linkVisibility(false)
      .linkDirectionalArrowLength(0)
      .linkDirectionalParticles(0)
      .enablePointerInteraction(false) as GraphInstance

    // 3d-force-graph remains the camera/OrbitControls/render-loop host. All
    // topology, force work, rendering and picking live in the worker-backed
    // batched layer, so the host scene never allocates per-node/link objects.
    graph.graphData({ nodes: [], links: [] })
    graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    batchedLayer = new GraphBatchedLayer()
    batchedLayer.setViewport(initWidth, initHeight)
    graph.scene().add(batchedLayer.group)
    setupBatchedInteractions()

    // Labels are camera/layout driven; no permanent requestAnimationFrame scan.
    graphControls = graph.controls() as GraphControls
    graphControls.addEventListener?.('change', handleGraphControlsChange)
    graphControls.addEventListener?.('start', handleGraphControlsStart)
    graphControls.addEventListener?.('end', handleGraphControlsEnd)
    scheduleLabelUpdate()
    startGraphPerformanceSampling()
    initializeSpan.end({ outcome: 'success' })
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  onMount(() => {
    destroyed = false
    stopLongTaskObserver = graphPerformance.observeLongTasks()
    ;(window as GraphDiagnosticsWindow).__tesseractGraphPerformance = readGraphPerformance
    document.addEventListener('visibilitychange', handleGraphDocumentVisibility)

    // Check WebGL support before anything else
    if (!checkWebGLSupport()) {
      webglSupported = false
    }

    // 0. Check for saved camera state BEFORE subscriptions (which may trigger feedData).
    //    pendingCameraRestore is consumed by the first feedData() call.
    if (graphTabId) {
      pendingCameraRestore = cameraStateCache.get(graphTabId) ?? null
    }

    // 1. Set up store subscriptions FIRST (unconditionally).
    //    This populates currentData, currentLoading, currentError which drive
    //    the conditional template rendering. When graphData arrives and the
    //    {:else} block renders graphContainerEl, the subscription lazily
    //    initializes the graph via initializeGraph().
    setupStoreSubscriptions()
    removeGraphMenuActionListener = onGraphMenuAction(handleGraphMenuAction)

    // 2. Set up resize observer on the outer container (always rendered)
    setupResizeObserver()

    // 3. Add keyboard and mouse listeners
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', stopCameraLoop)
    containerEl?.addEventListener('mousemove', handleMouseMove)
  })

  onDestroy(() => {
    destroyed = true
    graphSearchGeneration++
    cancelGraphSearchReveal(false)
    graphFeedGeneration++
    cancelPendingAutoFit()
    // Never persist a half-spawned presentation layout across remounts.
    if (presentationActive) finishGraphPresentation(false)

    // Save camera state and node positions for this graph tab before destruction
    if (graph && graphTabId) {
      try {
        const pos = graph.cameraPosition()
        const controls = graph.controls() as Partial<GraphControls>
        const target = controls?.target
          ? {
              x: controls.target.x as number,
              y: controls.target.y as number,
              z: controls.target.z as number
            }
          : { x: 0, y: 0, z: 0 }
        cameraStateCache.set(graphTabId, { position: pos, target })

        // Save node positions from force simulation
        const gd = getLiveGraphData()
        const positions = new Map<string, { x: number; y: number; z: number }>()
        for (const node of gd.nodes as ForceNode[]) {
          if (node.id != null && node.x != null && node.y != null && node.z != null) {
            positions.set(String(node.id), { x: node.x, y: node.y, z: node.z })
          }
        }
        if (positions.size > 0) {
          nodePositionCache.set(graphTabId, positions)
        }
      } catch {
        // State save is best-effort
      }
    }

    // Save selected node ID
    selectedNodeIdCache = currentSelected?.id ?? null

    // Clean up graph search debounce timer
    if (graphSearchDebounceTimer) {
      clearTimeout(graphSearchDebounceTimer)
    }

    if (presentationFrameId !== null) {
      cancelAnimationFrame(presentationFrameId)
      presentationFrameId = null
    }

    // Stop label update loop
    if (labelFrameId !== null) {
      cancelAnimationFrame(labelFrameId)
      labelFrameId = null
    }
    stopGraphPerformanceSampling()
    if (graphDprRestoreTimer) clearTimeout(graphDprRestoreTimer)
    graphDprRestoreTimer = null
    if (graphAnimationIdleTimer) clearTimeout(graphAnimationIdleTimer)
    graphAnimationIdleTimer = null
    if (graphManualRenderFrameId !== null) cancelAnimationFrame(graphManualRenderFrameId)
    graphManualRenderFrameId = null
    stopLongTaskObserver?.()
    stopLongTaskObserver = null
    document.removeEventListener('visibilitychange', handleGraphDocumentVisibility)
    const diagnosticsWindow = window as GraphDiagnosticsWindow
    if (diagnosticsWindow.__tesseractGraphPerformance === readGraphPerformance) {
      delete diagnosticsWindow.__tesseractGraphPerformance
    }

    teardownBatchedInteractions()
    unsubscribeLayout?.()
    unsubscribeLayout = null
    layoutClient?.dispose()
    layoutClient = null
    layoutWorkerState = 'uninitialized'
    batchedLayer?.dispose()
    batchedLayer = null

    // Clean up cluster sphere meshes before disposing graph
    clearClusterMeshes()

    // Dispose 3d-force-graph (cleans up ThreeJS renderer, scene, controls)
    if (graph) {
      graphControls?.removeEventListener?.('change', handleGraphControlsChange)
      graphControls?.removeEventListener?.('start', handleGraphControlsStart)
      graphControls?.removeEventListener?.('end', handleGraphControlsEnd)
      graphControls = null
      graph._destructor()
      graph = null
    }

    // Stop orbit loop
    stopCameraLoop()

    // Remove keyboard listeners
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('blur', stopCameraLoop)

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
    unsubUnconnectedHighlight?.()
    unsubSemanticEdges?.()
    unsubEdgeWeakThreshold?.()
    unsubLoading?.()
    unsubError?.()
    unsubLevel?.()
    unsubOpenedNode?.()
    unsubClusterPalette?.()
    unsubCustomClusterPalette?.()
    unsubEdgePalette?.()
    unsubArrowPalette?.()
    removeGraphMenuActionListener?.()
  })

  // Publish only from the focused graph pane. App.svelte supplies inactive
  // state when focus leaves GraphView; this snapshot adds live checkmarks and
  // presentation labels without rebuilding on every animation reveal step.
  $effect(() => {
    if (workspace.activePaneId !== paneId || workspace.focusedTab?.kind !== 'graph') return
    void window.api
      .setMenuContext({
        active: true,
        ready: !!graph && !!currentData && currentData.nodes.length > 0 && !currentError,
        labelsVisible: graphLabelsVisible,
        linesVisible: graphLinesVisible,
        shapesVisible: graphShapesVisible,
        shapesAvailable:
          currentColoringMode === 'cluster' || currentColoringMode === 'custom-cluster',
        unconnectedHighlighted: currentUnconnectedHighlight,
        unconnectedCount: unconnectedNodeIds.size,
        hasSelection: currentSelected !== null,
        presentationState: presentationActive
          ? presentationPaused
            ? 'paused'
            : 'playing'
          : 'idle',
        exportingScreenshot: graphScreenshotExporting,
        level: currentLevel,
        coloringMode: currentColoringMode,
        topicsAvailable: (currentData?.custom_clusters?.length ?? 0) > 0
      })
      .catch(() => {})
  })
</script>

<div class="graph-tab-layout">
  <div class="graph-view" bind:this={containerEl}>
    <!-- 3d-force-graph container: ALWAYS mounted so WebGL context survives tab switches.
       Hidden until data is available via CSS visibility. -->
    <div
      bind:this={graphContainerEl}
      class="graph-3d-container"
      role="img"
      aria-label={currentData
        ? `Knowledge graph with ${currentData.nodes.length} node${currentData.nodes.length === 1 ? '' : 's'}`
        : 'Knowledge graph'}
      style:visibility={currentData &&
      currentData.nodes.length > 0 &&
      !currentError &&
      webglSupported
        ? 'visible'
        : 'hidden'}
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
    {#if graphLabelsVisible && visibleLabels.length > 0}
      <div class="proximity-labels">
        {#each visibleLabels as lbl (lbl.id)}
          {#if !presentationActive || presentationVisibleNodeIds.has(lbl.id)}
            <span
              class="proximity-label"
              data-graph-export-label
              style="left: {lbl.x}px; top: {lbl.y}px">{lbl.label}</span
            >
          {/if}
        {/each}
      </div>
    {/if}

    {#if currentData && currentData.nodes.length > 0 && !currentError && webglSupported}
      <!-- View and content filters (top-left). -->
      <div class="graph-top-left-controls">
        <button
          bind:this={viewModeBtnEl}
          class="graph-view-mode-trigger"
          onclick={() => (viewModeMenuOpen = !viewModeMenuOpen)}
          aria-haspopup="menu"
          aria-expanded={viewModeMenuOpen}
          title="Select graph view"
        >
          <span class="material-symbols-outlined view-mode-icon">{currentViewMode.icon}</span>
          <span class="view-mode-label">{currentViewMode.label}</span>
          <span class="material-symbols-outlined view-mode-caret">arrow_drop_down</span>
        </button>
        <GraphUnconnectedFilter
          count={unconnectedNodeIds.size}
          active={currentUnconnectedHighlight}
          ontoggle={toggleGraphUnconnectedHighlight}
        />
      </div>
      {#if viewModeMenuOpen && viewModeBtnEl}
        <PopoverMenu
          anchorEl={viewModeBtnEl}
          items={viewModeItems}
          onselect={selectViewMode}
          ondismiss={() => (viewModeMenuOpen = false)}
          ariaLabel="Graph view mode"
        />
      {/if}

      <!-- Level tab switcher + pop-out button -->
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
        {#if !workspace.isPopup}
          <button
            class="level-tab graph-popout-btn"
            title="Pop out graph"
            onclick={() => {
              const collection = get(activeCollection)
              const colId = get(activeCollectionId)
              window.api.openPopup({
                kind: 'graph',
                collectionId: colId ?? undefined,
                collectionPath: collection?.path,
                graphLevel: currentLevel,
                graphColoringMode: currentColoringMode
              })
            }}
          >
            <span class="material-symbols-outlined" style="font-size: 16px;"
              >picture_in_picture_alt</span
            >
          </button>
        {/if}
      </div>

      <GraphPresentationControl
        active={presentationActive}
        paused={presentationPaused}
        revealed={presentationRevealedCount}
        total={presentationActive ? presentationTotal : currentData.nodes.length}
        startsFromSelection={currentSelected != null}
        statusMessage={presentationStatusMessage}
        onstart={startGraphPresentation}
        onpause={pauseGraphPresentation}
        onresume={continueGraphPresentation}
        onreset={resetGraphPresentation}
      />

      <!-- Graph search overlay -->
      {#if graphSearchVisible}
        <div class="graph-search-overlay" style="left: {searchPanelX}px; bottom: {searchPanelY}px;">
          <span
            role="separator"
            aria-label="Drag to reposition search overlay"
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
            <span class="material-symbols-outlined" style="font-size: 14px; opacity: 0.4;"
              >drag_indicator</span
            >
          </span>
          <span class="material-symbols-outlined" style="font-size: 16px; opacity: 0.5;"
            >search</span
          >
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
            <button class="graph-search-clear" onclick={clearGraphSearch} title="Clear search"
              >×</button
            >
          {/if}
          {#if graphSearchLoading}
            <span class="material-symbols-outlined spinning" style="font-size: 16px; opacity: 0.5;"
              >progress_activity</span
            >
          {/if}
          {#if graphSearchError}
            <span
              class="material-symbols-outlined"
              style="font-size: 16px; color: var(--color-error, #ef4444);"
              title={graphSearchError}>error</span
            >
          {/if}
          {#if graphSearchQuery.length >= 2 && !graphSearchLoading && !graphSearchError}
            <span class="graph-search-count">
              {graphSearchResultCount > 0
                ? `${graphSearchResultCount} file${graphSearchResultCount === 1 ? '' : 's'}`
                : 'No matches'}
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

      <!-- Cluster/topic enclosure labels (screen-projected from 3D centroids) -->
      {#if graphLabelsVisible && (currentColoringMode === 'cluster' || currentColoringMode === 'custom-cluster') && clusterLabels.length > 0}
        {#each clusterLabels as label}
          {#if label.visible}
            <div
              class="cluster-label"
              class:cluster-label-muted={activeHullHighlightId() != null &&
                label.id !== activeHullHighlightId()}
              data-graph-export-label
              style="left: {label.screenX}px; top: {label.screenY}px; color: {paletteTextColor(
                currentColoringMode === 'custom-cluster'
                  ? currentCustomClusterPalette
                  : currentClusterPalette,
                label.id,
                getBackgroundColor()
              )}"
            >
              {label.label}
            </div>
          {/if}
        {/each}
      {/if}

      {#if currentData.edges.length === 0 && currentLevel !== 'chunk'}
        <div class="graph-notice">No link connections found.</div>
      {/if}

      <GraphPerformanceWarning {nodeCount} />

      <GraphDisplayControls
        searchOpen={graphSearchVisible}
        labelsVisible={graphLabelsVisible}
        linesVisible={graphLinesVisible}
        shapesVisible={graphShapesVisible}
        shapesAvailable={currentColoringMode === 'cluster' ||
          currentColoringMode === 'custom-cluster'}
        onsearch={openGraphSearch}
        ontogglelabels={toggleGraphLabels}
        ontogglelines={toggleGraphLines}
        ontoggleshapes={toggleGraphShapes}
        onrecenter={recenterCamera}
      />

      <!-- Node tooltip (populated by hover handler in subtask 2-2) -->
      {#if hoveredNode}
        <div class="graph-tooltip" style="left: {tooltipX + 12}px; top: {tooltipY - 30}px">
          <div class="tooltip-path">{hoveredNode.path}</div>
          {#if isChunkMode() && hoveredNode.label}
            <div class="tooltip-heading">{hoveredNode.label}</div>
          {/if}
          {#if currentColoringMode === 'custom-cluster'}
            {#if hoveredNode.custom_cluster_ids && hoveredNode.custom_cluster_ids.length > 0}
              {#each hoveredNode.custom_cluster_ids as topicId, i}
                <div class="tooltip-cluster">
                  {topicName(topicId)} · {Math.round(
                    (hoveredNode.custom_cluster_scores?.[i] ?? 0) * 100
                  )}%
                </div>
              {/each}
            {:else if hoveredNode.chunk_index == null}
              <div class="tooltip-cluster">Unassigned</div>
            {/if}
          {:else if hoveredNode.cluster_id != null && currentData}
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
                  ? edgeClusterColor(hoveredEdge.edge_cluster_id, currentEdgePalette)
                  : 'rgba(255,255,255,0.5)'}"
              ></span>
              {hoveredEdge.relationship_type}
            </div>
          {/if}
          {#if edgeSrc && edgeTgt}
            <div class="edge-tooltip-nodes">{edgeSrc.path} → {edgeTgt.path}</div>
          {/if}
          {#if hoveredEdge.field}
            <div class="edge-tooltip-field">via frontmatter: {hoveredEdge.field}</div>
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

      {#if backgroundContextMenuOpen}
        <GraphBackgroundContextMenu
          x={contextMenuX}
          y={contextMenuY}
          labelsVisible={graphLabelsVisible}
          busy={!graph || currentLoading}
          exporting={graphScreenshotExporting}
          ondismiss={dismissBackgroundContextMenu}
          onrecenter={handleBackgroundRecenter}
          ontogglelabels={handleBackgroundToggleLabels}
          onscreenshot={() => handleBackgroundScreenshot(false)}
          onscreenshottransparent={() => handleBackgroundScreenshot(true)}
        />
      {/if}

      <!-- Context menu -->
      {#if contextMenuNode}
        <button
          type="button"
          class="context-menu-backdrop"
          aria-label="Close context menu"
          onclick={() => (contextMenuNode = null)}
          oncontextmenu={(e) => {
            e.preventDefault()
            contextMenuNode = null
          }}
        ></button>
        <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px">
          <div class="context-menu-header">{contextMenuNode.path.split('/').pop()}</div>
          <button class="context-menu-item" onclick={handleContextMenuOpen}>
            <span class="material-symbols-outlined">open_in_new</span>
            Open in tab
          </button>
          <button class="context-menu-item" onclick={handleContextMenuPreview}>
            <span class="material-symbols-outlined">preview</span>
            Preview
          </button>
          <button class="context-menu-item" onclick={handleContextMenuSelect}>
            <span class="material-symbols-outlined">radio_button_checked</span>
            Select node
          </button>
        </div>
      {/if}

      <!-- Legend filters for the active view mode (mode switching lives in the top-left dropdown) -->
      {#if (currentColoringMode === 'cluster' && getClusters().length > 0) || (currentColoringMode === 'custom-cluster' && getCustomClusters().length > 0) || (currentColoringMode === 'folder' && folderColorMap.size > 0)}
        <div class="graph-legend">
          <div class="legend-header">
            <span class="legend-title"
              >{currentColoringMode === 'cluster'
                ? 'Clusters'
                : currentColoringMode === 'custom-cluster'
                  ? 'Topics'
                  : 'Folders'}</span
            >
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
                  <button
                    class="legend-item legend-item-clickable"
                    class:legend-item-active={highlightedClusterId === cluster.id}
                    onclick={() => toggleClusterHighlight(cluster.id)}
                    title={highlightedClusterId === cluster.id
                      ? `Clear ${cluster.label} highlight`
                      : `Highlight all members of ${cluster.label}`}
                  >
                    <span class="legend-dot" style="background: {cluster.color}"></span>
                    <span class="legend-label">{cluster.label}</span>
                    <span class="legend-count">{cluster.member_count}</span>
                  </button>
                {/each}
                {#if highlightedClusterId != null}
                  <button
                    class="legend-clear-filter"
                    onclick={clearClusterHighlight}
                    title="Clear cluster highlight"
                    style="margin-top: 4px; width: 100%;"
                  >
                    <span class="material-symbols-outlined" style="font-size: 14px;"
                      >filter_alt_off</span
                    >
                    <span style="font-size: 10px;">Clear</span>
                  </button>
                {/if}
              {:else if currentColoringMode === 'custom-cluster'}
                {#each getCustomClusters() as cluster}
                  <button
                    class="legend-item legend-item-clickable"
                    class:legend-item-active={highlightedTopicId === cluster.id}
                    onclick={() => toggleTopicHighlight(cluster.id)}
                    title={highlightedTopicId === cluster.id
                      ? `Clear ${cluster.label} highlight`
                      : `Highlight all members of ${cluster.label}`}
                  >
                    <span class="legend-dot" style="background: {cluster.color}"></span>
                    <span class="legend-label">{cluster.label}</span>
                    <span class="legend-count">{cluster.member_count}</span>
                  </button>
                {/each}
                {#if getUnassignedCount() > 0}
                  <div class="legend-item legend-item-unassigned">
                    <span class="legend-dot" style="background: {getDefaultNodeColor()}"></span>
                    <span class="legend-label">Unassigned</span>
                    <span class="legend-count">{getUnassignedCount()}</span>
                  </div>
                {/if}
                {#if highlightedTopicId != null}
                  <button
                    class="legend-clear-filter"
                    onclick={clearTopicHighlight}
                    title="Clear topic highlight"
                    style="margin-top: 4px; width: 100%;"
                  >
                    <span class="material-symbols-outlined" style="font-size: 14px;"
                      >filter_alt_off</span
                    >
                    <span style="font-size: 10px;">Clear</span>
                  </button>
                {/if}
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
                  {#if currentEdgeFilter !== null}
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
                    onclick={() => toggleLegendEdgeCluster(ec.id)}
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
  {#if currentOpenedNode}
    <GraphPreview />
  {/if}
</div>

<style>
  .graph-tab-layout {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .graph-view {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--color-graph-bg, #0a0a0b);
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
    color: var(--color-text-muted, rgba(228, 228, 231, 0.7));
    white-space: nowrap;
    /* Halo matches the canvas background (theme-aware) so labels stay readable
       over hull fills and edges in both dark and light mode. */
    text-shadow:
      0 0 4px color-mix(in srgb, var(--color-bg, #0f0f10) 90%, transparent),
      0 0 8px color-mix(in srgb, var(--color-bg, #0f0f10) 60%, transparent);
    transition:
      left 60ms linear,
      top 60ms linear,
      opacity 200ms ease;
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
      0 0 6px color-mix(in srgb, var(--color-bg, #0f0f10) 90%, transparent),
      0 0 12px color-mix(in srgb, var(--color-bg, #0f0f10) 60%, transparent);
    opacity: 0.85;
    transition:
      left 60ms linear,
      top 60ms linear;
    z-index: 5;
  }

  .cluster-label-muted {
    opacity: 0.12;
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

  .edge-tooltip-field {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
    margin-top: 2px;
  }

  /* Context menu */
  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: default;
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
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .context-menu-item:hover {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
    color: var(--color-primary, #00e5ff);
  }

  .context-menu-item .material-symbols-outlined {
    font-size: 16px;
  }

  .graph-top-left-controls {
    position: absolute;
    top: var(--space-3, 0.75rem);
    left: var(--space-3, 0.75rem);
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    z-index: var(--z-base, 10);
  }

  .graph-view-mode-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .graph-view-mode-trigger:hover,
  .graph-view-mode-trigger[aria-expanded='true'] {
    border-color: var(--color-primary-glow, #00e5ff40);
  }

  .view-mode-icon {
    font-size: 14px;
    color: var(--color-primary, #00e5ff);
  }

  .view-mode-caret {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
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

  .legend-item-unassigned {
    opacity: 0.6;
  }

  .legend-item-active {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
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
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
  }

  .graph-popout-btn {
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
  }

  .graph-popout-btn:hover {
    color: var(--color-text, #e4e4e7);
  }

  /* Badges stack below the view-mode dropdown in the top-left corner */
  .graph-path-badge {
    position: absolute;
    top: calc(var(--space-3, 0.75rem) + 32px);
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
    top: calc(var(--space-3, 0.75rem) + 32px);
    left: var(--space-3, 0.75rem);
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-primary-glow, #00e5ff40);
    border-radius: var(--radius-md, 0.375rem);
    z-index: var(--z-base, 10);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text, #e4e4e7);
  }

  .graph-folder-badge.has-path-filter {
    top: calc(var(--space-3, 0.75rem) + 64px);
  }

  .folder-badge-icon {
    font-size: 14px;
    color: var(--color-primary, #00e5ff);
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
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
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
