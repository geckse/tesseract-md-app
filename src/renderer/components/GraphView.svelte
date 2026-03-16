<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
  import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
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
    setGraphLevel,
    setGraphPathFilter,
    setGraphHighlightedFolder,
    graphEdgeFilter,
    graphSemanticEdgesEnabled,
    graphEdgeWeakThreshold,
    toggleEdgeClusterFilter,
    clearEdgeFilter,
  } from '../stores/graph';
  import type { GraphColoringMode } from '../stores/graph';
  import type { GraphLevel } from '../types/cli';
  import type { GraphNode, GraphEdge, GraphData } from '../types/cli';
  import { selectedFilePath } from '../stores/files';
  import { convexHull, padHull, centroid, polygonArea, hexToRgb } from '../lib/convex-hull';
  import { edgeClusterColor, isEdgeVisible, edgeLineWidth, isWeakEdge, pointToSegmentDist } from '../lib/edge-utils';

  /** Cluster color palette (12 colors, cycling). */
  const CLUSTER_COLORS = [
    '#E879F9', '#FF6B6B', '#51CF66', '#FFD43B', '#845EF7', '#FF922B',
    '#20C997', '#F06595', '#339AF0', '#B2F2BB', '#D0BFFF', '#FFC078',
  ];

  const DEFAULT_NODE_COLOR = 'rgba(228, 228, 231, 0.6)';

  interface SimNode extends SimulationNodeDatum {
    id: string;
    path: string;
    label: string | null;
    cluster_id: number | null;
    chunk_index: number | null;
    x: number;
    y: number;
    /** Data-driven base radius (computed from degree or content size). */
    baseRadius: number;
  }

  interface SimEdge extends SimulationLinkDatum<SimNode> {
    source: SimNode | string;
    target: SimNode | string;
    weight: number | null;
    /** Semantic relationship type (e.g. "related", "references"). */
    relationship_type?: string | null;
    /** Semantic strength score [0, 1]. */
    strength?: number | null;
    /** Context text excerpt describing the relationship. */
    context_text?: string | null;
    /** Edge cluster ID for color grouping. */
    edge_cluster_id?: number | null;
  }

  interface ClusterHull {
    clusterId: number;
    color: string;
    label: string;
    rawHull: [number, number][];
    centroid: { x: number; y: number };
    area: number;
    nodeCount: number;
  }

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let simulation: Simulation<SimNode, SimEdge> | null = null;
  let simNodes: SimNode[] = [];
  let simEdges: SimEdge[] = [];
  let animFrameId: number | null = null;
  let dirty = true;
  let pendingData: GraphData | null = null;

  // Cluster hull state
  let cachedHulls: ClusterHull[] = [];
  let hullsDirty = true;

  // Pan/zoom state
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let isPanning = false;
  let didPan = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // Drag state
  let draggedNode: SimNode | null = null;

  // Hover state
  let hoveredNode: SimNode | null = null;
  let hoveredEdge: SimEdge | null = null;
  let tooltipX = 0;
  let tooltipY = 0;

  // Legend visibility
  let legendVisible = $state(true);

  // Canvas dimensions
  let width = $state(0);
  let height = $state(0);

  // Store subscriptions
  let unsubData: (() => void) | null = null;
  let unsubColoring: (() => void) | null = null;
  let unsubSelected: (() => void) | null = null;
  let unsubFilePath: (() => void) | null = null;
  let unsubPathFilter: (() => void) | null = null;
  let unsubHighlightedFolder: (() => void) | null = null;
  let unsubHoveredFilePath: (() => void) | null = null;
  let unsubEdgeFilter: (() => void) | null = null;
  let unsubSemanticEdges: (() => void) | null = null;
  let unsubEdgeWeakThreshold: (() => void) | null = null;

  // Reactive local copies for template use
  let currentData: GraphData | null = $state(null);
  let currentLoading = $state(false);
  let currentError: string | null = $state(null);
  let currentColoringMode: GraphColoringMode = $state('cluster');
  let currentSelected: GraphNode | null = $state(null);
  let currentLevel: GraphLevel = $state('document');
  let currentFilePath: string | null = $state(null);
  let currentPathFilter: string | null = $state(null);
  let currentHighlightedFolder: string | null = $state(null);
  let currentHoveredFilePath: string | null = $state(null);
  let currentEdgeFilter: Set<number> = $state(new Set());
  let currentSemanticEdgesEnabled: boolean = $state(true);
  let currentEdgeWeakThreshold: number = $state(0.3);

  /** Hash a string to a stable index for color assignment. */
  function fileColor(path: string): string {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
    }
    return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length];
  }

  /** Extract the top-level folder from a path, or '(root)' if no folder. */
  function getTopLevelFolder(path: string): string {
    const idx = path.indexOf('/');
    return idx >= 0 ? path.substring(0, idx) : '(root)';
  }

  /** Map from top-level folder name to assigned color. */
  let folderColorMap: Map<string, string> = new Map();

  /** Whether we're currently in chunk mode. */
  function isChunkMode(): boolean {
    return currentLevel === 'chunk';
  }

  /** Compute convex hull data for each cluster from current simulation nodes. */
  function computeClusterHulls(): void {
    if (!currentData) {
      cachedHulls = [];
      return;
    }

    // Group simNodes by cluster_id (skip null)
    const groups = new Map<number, [number, number][]>();
    for (const node of simNodes) {
      if (node.cluster_id == null) continue;
      let pts = groups.get(node.cluster_id);
      if (!pts) {
        pts = [];
        groups.set(node.cluster_id, pts);
      }
      pts.push([node.x, node.y]);
    }

    // Build a lookup for cluster labels
    const clusterLabelMap = new Map<number, string>();
    for (const c of currentData.clusters) {
      clusterLabelMap.set(c.id, c.label);
    }

    const hulls: ClusterHull[] = [];
    for (const [clusterId, points] of groups) {
      const color = CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
      const label = clusterLabelMap.get(clusterId) ?? `Cluster ${clusterId}`;
      const nodeCount = points.length;

      if (nodeCount === 1) {
        // Single node: store centroid, area=0
        hulls.push({
          clusterId,
          color,
          label,
          rawHull: points,
          centroid: { x: points[0][0], y: points[0][1] },
          area: 0,
          nodeCount,
        });
      } else if (nodeCount === 2) {
        // Two nodes: store both points, area=0
        const c = centroid(points);
        hulls.push({
          clusterId,
          color,
          label,
          rawHull: points,
          centroid: c,
          area: 0,
          nodeCount,
        });
      } else {
        // 3+ nodes: full convex hull
        const hull = convexHull(points);
        const c = centroid(hull.length > 0 ? hull : points);
        const area = polygonArea(hull);
        hulls.push({
          clusterId,
          color,
          label,
          rawHull: hull,
          centroid: c,
          area,
          nodeCount,
        });
      }
    }

    cachedHulls = hulls;
    hullsDirty = false;
  }

  // When canvasEl becomes available (after {#if} renders it), sync its buffer size
  $effect(() => {
    if (canvasEl && width && height) {
      canvasEl.width = width * devicePixelRatio;
      canvasEl.height = height * devicePixelRatio;
      dirty = true;
    }
  });

  onMount(() => {
    const colors = getEdgeColors();
    EDGE_COLOR_OUT = colors.out;
    EDGE_COLOR_IN = colors.in;
    EDGE_COLOR_BIDI = colors.bidi;
    unsubData = graphData.subscribe((d) => {
      currentData = d;
      if (d) buildSimulation(d);
    });
    unsubColoring = graphColoringMode.subscribe((v) => {
      currentColoringMode = v;
      dirty = true;
    });
    unsubSelected = graphSelectedNode.subscribe((n) => {
      currentSelected = n;
      dirty = true;
    });
    unsubFilePath = selectedFilePath.subscribe((p) => {
      currentFilePath = p;
      dirty = true;
    });
    unsubPathFilter = graphPathFilter.subscribe((p) => {
      currentPathFilter = p;
    });
    unsubHighlightedFolder = graphHighlightedFolder.subscribe((p) => {
      currentHighlightedFolder = p;
      dirty = true;
    });
    unsubHoveredFilePath = graphHoveredFilePath.subscribe((p) => {
      currentHoveredFilePath = p;
      dirty = true;
    });
    unsubEdgeFilter = graphEdgeFilter.subscribe((f) => {
      currentEdgeFilter = f;
      dirty = true;
    });
    unsubSemanticEdges = graphSemanticEdgesEnabled.subscribe((v) => {
      currentSemanticEdgesEnabled = v;
      dirty = true;
    });
    unsubEdgeWeakThreshold = graphEdgeWeakThreshold.subscribe((v) => {
      currentEdgeWeakThreshold = v;
      dirty = true;
    });
    graphLoading.subscribe((v) => { currentLoading = v; });
    graphError.subscribe((v) => { currentError = v; });
    graphLevel.subscribe((v) => {
      const prevLevel = currentLevel;
      currentLevel = v;
      // Destroy and rebuild simulation on mode switch
      if (prevLevel !== v && currentData) {
        buildSimulation(currentData);
      }
    });

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', handleKeyDown);
    resizeObs = new ResizeObserver(() => resizeCanvas());
    if (containerEl) resizeObs.observe(containerEl);
    startRenderLoop();
  });

  let resizeObs: ResizeObserver | null = null;

  onDestroy(() => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (simulation) simulation.stop();
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('keydown', handleKeyDown);
    resizeObs?.disconnect();
    unsubData?.();
    unsubColoring?.();
    unsubSelected?.();
    unsubFilePath?.();
    unsubPathFilter?.();
    unsubHighlightedFolder?.();
    unsubHoveredFilePath?.();
    unsubEdgeFilter?.();
    unsubSemanticEdges?.();
    unsubEdgeWeakThreshold?.();
  });

  function resizeCanvas() {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    width = rect.width;
    height = rect.height;
    if (canvasEl) {
      canvasEl.width = width * devicePixelRatio;
      canvasEl.height = height * devicePixelRatio;
      dirty = true;
    }

    // Flush deferred simulation build once we have real dimensions
    if (pendingData) {
      const data = pendingData;
      pendingData = null;
      buildSimulation(data);
    }
  }

  function buildSimulation(data: GraphData) {
    // Defer if container hasn't been measured yet
    if (!width || !height) {
      pendingData = data;
      return;
    }

    // Destroy previous simulation completely
    if (simulation) {
      simulation.stop();
      simulation = null;
    }

    const chunk = isChunkMode();

    // Build node-to-size map from backend data (chunk mode only)
    const sizeMap = new Map<string, number>();
    for (const n of data.nodes) {
      if (n.size != null) sizeMap.set(n.id, n.size);
    }

    // Compute degree map from edges
    const degreeMap = new Map<string, number>();
    for (const e of data.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }

    // Compute max degree/size for relative scaling
    const maxDegree = Math.max(1, ...degreeMap.values());
    const maxSize = Math.max(1, ...sizeMap.values());

    simNodes = data.nodes.map((n) => {
      let baseRadius: number;
      if (chunk) {
        // Chunk mode: size-based, normalized to max
        const ratio = (sizeMap.get(n.id) ?? 0) / maxSize;
        baseRadius = 1.5 + ratio * 8.5; // range: 1.5 – 10
      } else {
        // Document mode: degree-based, normalized to max degree
        const degree = degreeMap.get(n.id) ?? 0;
        const ratio = degree / maxDegree;
        baseRadius = 2 + ratio * ratio * 14; // quadratic: range 2 – 16, isolated = 2
      }
      return {
        id: n.id,
        path: n.path,
        label: n.label,
        cluster_id: n.cluster_id,
        chunk_index: n.chunk_index,
        x: Math.random() * width,
        y: Math.random() * height,
        baseRadius,
      };
    });

    // Rebuild folder color map
    const folders = new Set<string>();
    for (const node of simNodes) {
      folders.add(getTopLevelFolder(node.path));
    }
    const sortedFolders = [...folders].sort();
    folderColorMap = new Map();
    for (let i = 0; i < sortedFolders.length; i++) {
      folderColorMap.set(sortedFolders[i], CLUSTER_COLORS[i % CLUSTER_COLORS.length]);
    }

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    simEdges = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        relationship_type: e.relationship_type ?? null,
        strength: e.strength ?? null,
        context_text: e.context_text ?? null,
        edge_cluster_id: e.edge_cluster_id ?? null,
      }));

    const isLarge = simNodes.length > 300;

    if (chunk) {
      // Chunk mode: smaller, tighter forces
      simulation = forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          forceLink<SimNode, SimEdge>(simEdges)
            .id((d) => d.id)
            .distance(60)
            .strength(0.4),
        )
        .force(
          'charge',
          forceManyBody<SimNode>()
            .strength(-80)
            .distanceMax(isLarge ? 200 : 400),
        )
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide<SimNode>().radius((d) => d.baseRadius + 2))
        .alphaDecay(isLarge ? 0.04 : 0.02)
        .velocityDecay(0.3)
        .on('tick', () => { dirty = true; hullsDirty = true; });

      simulation.tick(200);
    } else {
      // Document mode: original forces
      simulation = forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          forceLink<SimNode, SimEdge>(simEdges)
            .id((d) => d.id)
            .distance(80)
            .strength(0.4),
        )
        .force(
          'charge',
          forceManyBody<SimNode>()
            .strength(isLarge ? -60 : -120)
            .distanceMax(isLarge ? 200 : 400),
        )
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide<SimNode>().radius((d) => d.baseRadius + 2))
        .alphaDecay(isLarge ? 0.04 : 0.02)
        .velocityDecay(0.3)
        .on('tick', () => { dirty = true; hullsDirty = true; });

      simulation.tick(300);
    }

    // Center the view
    panX = 0;
    panY = 0;
    zoom = 1;
    dirty = true;
    hullsDirty = true;
  }

  function startRenderLoop() {
    function frame() {
      if (dirty) {
        draw();
        dirty = false;
      }
      animFrameId = requestAnimationFrame(frame);
    }
    animFrameId = requestAnimationFrame(frame);
  }

  /** Build neighbor sets for the selected node. */
  function getSelectedNeighbors(selectedId: string | null): {
    neighbors: Set<string>;
    outEdges: Set<SimEdge>;
    inEdges: Set<SimEdge>;
  } {
    const neighbors = new Set<string>();
    const outEdges = new Set<SimEdge>();
    const inEdges = new Set<SimEdge>();
    if (!selectedId) return { neighbors, outEdges, inEdges };

    for (const edge of simEdges) {
      const s = (edge.source as SimNode).id;
      const t = (edge.target as SimNode).id;
      if (s === selectedId) {
        neighbors.add(t);
        outEdges.add(edge);
      }
      if (t === selectedId) {
        neighbors.add(s);
        inEdges.add(edge);
      }
    }
    return { neighbors, outEdges, inEdges };
  }

  /** Build sets of node IDs and edges belonging to the selected file path. */
  function getFileHighlight(filePath: string | null): {
    fileNodeIds: Set<string>;
    fileEdges: Set<SimEdge>;
  } {
    const fileNodeIds = new Set<string>();
    const fileEdges = new Set<SimEdge>();
    if (!filePath) return { fileNodeIds, fileEdges };

    for (const node of simNodes) {
      if (node.path === filePath) {
        fileNodeIds.add(node.id);
      }
    }
    if (fileNodeIds.size === 0) return { fileNodeIds, fileEdges };

    const fileNeighborIds = new Set<string>();
    for (const edge of simEdges) {
      const s = (edge.source as SimNode).id;
      const t = (edge.target as SimNode).id;
      if (fileNodeIds.has(s)) {
        fileEdges.add(edge);
        fileNeighborIds.add(t);
      } else if (fileNodeIds.has(t)) {
        fileEdges.add(edge);
        fileNeighborIds.add(s);
      }
    }
    // Include neighbors so they aren't dimmed
    for (const id of fileNeighborIds) fileNodeIds.add(id);
    return { fileNodeIds, fileEdges };
  }

  /** Build sets of node IDs and edges belonging to the highlighted folder path. */
  function getFolderHighlight(folderPath: string | null): {
    folderNodeIds: Set<string>;
    folderEdges: Set<SimEdge>;
  } {
    const folderNodeIds = new Set<string>();
    const folderEdges = new Set<SimEdge>();
    if (!folderPath) return { folderNodeIds, folderEdges };

    const prefix = folderPath;
    for (const node of simNodes) {
      if (prefix === '(root)') {
        // Root files have no directory separator
        if (!node.path.includes('/')) folderNodeIds.add(node.id);
      } else if (node.path.startsWith(prefix + '/') || node.path === prefix) {
        folderNodeIds.add(node.id);
      }
    }
    if (folderNodeIds.size === 0) return { folderNodeIds, folderEdges };

    const folderNeighborIds = new Set<string>();
    for (const edge of simEdges) {
      const s = (edge.source as SimNode).id;
      const t = (edge.target as SimNode).id;
      if (folderNodeIds.has(s)) {
        folderEdges.add(edge);
        if (!folderNodeIds.has(t)) folderNeighborIds.add(t);
      } else if (folderNodeIds.has(t)) {
        folderEdges.add(edge);
        if (!folderNodeIds.has(s)) folderNeighborIds.add(s);
      }
    }
    // Include neighbors so they aren't dimmed
    for (const id of folderNeighborIds) folderNodeIds.add(id);
    return { folderNodeIds, folderEdges };
  }

  /** Read edge colors from CSS custom properties (design tokens). */
  function getEdgeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      out: style.getPropertyValue('--color-edge-out').trim() || '#00E5FF',
      in: style.getPropertyValue('--color-edge-in').trim() || '#FF6B6B',
      bidi: style.getPropertyValue('--color-edge-bidi').trim() || '#51CF66',
    };
  }
  let EDGE_COLOR_OUT = '#00E5FF';
  let EDGE_COLOR_IN = '#FF6B6B';
  let EDGE_COLOR_BIDI = '#51CF66';
  const ARROW_SIZE = 12;             // arrowhead length in graph-space pixels

  /** Compute the clipped start/end points of an edge, stopping at node boundaries. */
  function clipEdge(
    sx: number, sy: number, sRadius: number,
    tx: number, ty: number, tRadius: number,
  ): { x1: number; y1: number; x2: number; y2: number } | null {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    const ux = dx / len;
    const uy = dy / len;
    return {
      x1: sx + ux * sRadius,
      y1: sy + uy * sRadius,
      x2: tx - ux * tRadius,
      y2: ty - uy * tRadius,
    };
  }

  /** Draw an arrowhead at the target end of a clipped edge. */
  function drawArrow(
    ctx: CanvasRenderingContext2D,
    tipX: number, tipY: number,
    ux: number, uy: number,
  ) {
    const size = ARROW_SIZE / zoom;
    const wingAngle = Math.PI / 7; // ~25 degrees
    const cos = Math.cos(wingAngle);
    const sin = Math.sin(wingAngle);

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - size * (ux * cos + uy * sin), tipY - size * (uy * cos - ux * sin));
    ctx.lineTo(tipX - size * (ux * cos - uy * sin), tipY - size * (uy * cos + ux * sin));
    ctx.closePath();
    ctx.fill();
  }

  /** Draw a smooth hull shape using quadratic curves through midpoints of edges. */
  function drawSmoothHull(
    ctx: CanvasRenderingContext2D,
    points: [number, number][],
    r: number, g: number, b: number,
    fillAlpha: number,
    strokeAlpha: number,
  ): void {
    if (points.length < 3) return;

    const n = points.length;
    // Start at the midpoint between the last and first point
    const mx0 = (points[n - 1][0] + points[0][0]) / 2;
    const my0 = (points[n - 1][1] + points[0][1]) / 2;

    ctx.beginPath();
    ctx.moveTo(mx0, my0);

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const mx = (points[i][0] + points[next][0]) / 2;
      const my = (points[i][1] + points[next][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
    }

    ctx.closePath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
    ctx.stroke();
  }

  /** Draw a capsule (rounded rectangle) between two points. */
  function drawCapsule(
    ctx: CanvasRenderingContext2D,
    p1: [number, number],
    p2: [number, number],
    radius: number,
    r: number, g: number, b: number,
    fillAlpha: number,
    strokeAlpha: number,
  ): void {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      // Degenerate: draw a circle
      ctx.beginPath();
      ctx.arc(p1[0], p1[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
      ctx.stroke();
      return;
    }

    // Normal perpendicular to the line
    const nx = -dy / dist;
    const ny = dx / dist;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    // Top edge offset
    ctx.moveTo(p1[0] + nx * radius, p1[1] + ny * radius);
    ctx.lineTo(p2[0] + nx * radius, p2[1] + ny * radius);
    // Arc around p2
    ctx.arc(p2[0], p2[1], radius, angle - Math.PI / 2, angle + Math.PI / 2);
    // Bottom edge offset
    ctx.lineTo(p1[0] - nx * radius, p1[1] - ny * radius);
    // Arc around p1
    ctx.arc(p1[0], p1[1], radius, angle + Math.PI / 2, angle + Math.PI * 1.5);
    ctx.closePath();

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
    ctx.stroke();
  }

  function draw() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // --- Cluster Hulls (rendered behind edges and nodes) ---
    if (currentColoringMode === 'cluster') {
      if (hullsDirty) {
        computeClusterHulls();
      }

      ctx.lineWidth = 1.5 / zoom;
      for (const hull of cachedHulls) {
        const { r, g, b } = hexToRgb(hull.color);

        if (hull.nodeCount === 1) {
          // Single node: draw a circle
          const radius = 30 / zoom;
          ctx.beginPath();
          ctx.arc(hull.centroid.x, hull.centroid.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.10)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
          ctx.stroke();
        } else if (hull.nodeCount === 2) {
          // Two nodes: draw capsule
          const capsuleRadius = 20 / zoom;
          drawCapsule(ctx, hull.rawHull[0], hull.rawHull[1], capsuleRadius, r, g, b, 0.10, 0.25);
        } else {
          // 3+ nodes: padded smooth hull
          const padded = padHull(hull.rawHull, 20 / zoom);
          drawSmoothHull(ctx, padded, r, g, b, 0.10, 0.25);
        }

      }
    }

    const chunk = isChunkMode();
    const selectedId = currentSelected?.id ?? null;
    const { neighbors, outEdges, inEdges } = getSelectedNeighbors(selectedId);
    const hasSelection = selectedId !== null;
    // Hover highlight from search results (priority 2)
    const { fileNodeIds: hoverNodeIds, fileEdges: hoverEdges } = getFileHighlight(currentHoveredFilePath);
    const hasHoverHighlight = !hasSelection && hoverNodeIds.size > 0;
    // Editor's open file highlight (priority 3)
    const { fileNodeIds, fileEdges } = getFileHighlight(currentFilePath);
    const hasFileHighlight = !hasSelection && !hasHoverHighlight && fileNodeIds.size > 0;
    const { folderNodeIds, folderEdges } = getFolderHighlight(currentHighlightedFolder);
    const hasFolderHighlight = !hasSelection && !hasHoverHighlight && !hasFileHighlight && folderNodeIds.size > 0;

    // --- Edges ---
    // 1. Draw non-highlighted edges first (dimmed when there's a selection or any highlight)
    // Collect edges into solid and dashed batches for performance
    const dimFactor = hasSelection || hasHoverHighlight || hasFileHighlight || hasFolderHighlight;
    const solidEdges: { s: SimNode; t: SimNode; color: string; width: number }[] = [];
    const dashedEdges: { s: SimNode; t: SimNode; color: string; width: number }[] = [];

    for (const edge of simEdges) {
      if (outEdges.has(edge) || inEdges.has(edge)) continue;
      if (hasHoverHighlight && hoverEdges.has(edge)) continue;
      if (hasFileHighlight && fileEdges.has(edge)) continue;
      if (hasFolderHighlight && folderEdges.has(edge)) continue;

      // Apply edge cluster visibility filter
      const edgeFilterSet = currentEdgeFilter.size > 0 ? currentEdgeFilter : null;
      if (!isEdgeVisible(edge, edgeFilterSet)) continue;

      const s = edge.source as SimNode;
      const t = edge.target as SimNode;
      if (s.x == null || t.x == null) continue;

      // Determine if this is a semantic edge (has strength and/or edge_cluster_id)
      const isSemantic = currentSemanticEdgesEnabled && (edge.strength != null || edge.edge_cluster_id != null);

      if (isSemantic && edge.strength != null) {
        // Semantic edge: variable thickness by strength, color by cluster
        const lw = edgeLineWidth(edge.strength, zoom);
        const baseAlpha = dimFactor ? 0.3 : 0.7;
        const alpha = baseAlpha * Math.max(0.2, edge.strength);
        let color: string;
        if (edge.edge_cluster_id != null) {
          const hex = edgeClusterColor(edge.edge_cluster_id);
          const { r, g, b } = hexToRgb(hex);
          color = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } else {
          color = `rgba(255, 255, 255, ${alpha})`;
        }

        if (isWeakEdge(edge.strength, currentEdgeWeakThreshold)) {
          dashedEdges.push({ s, t, color, width: lw });
        } else {
          solidEdges.push({ s, t, color, width: lw });
        }
      } else if (chunk && edge.weight != null) {
        // Chunk mode: edge opacity proportional to weight
        const alpha = dimFactor ? (0.05 + edge.weight * 0.2) * 0.3 : 0.05 + edge.weight * 0.2;
        solidEdges.push({ s, t, color: `rgba(255, 255, 255, ${alpha})`, width: 1 / zoom });
      } else {
        // Default edge style
        const color = dimFactor ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.08)';
        solidEdges.push({ s, t, color, width: 1 / zoom });
      }
    }

    // Batch render: solid edges first
    ctx.setLineDash([]);
    for (const { s, t, color, width: lw } of solidEdges) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }

    // Batch render: dashed edges (weak semantic edges)
    if (dashedEdges.length > 0) {
      const dashLen = 4 / zoom;
      const gapLen = 3 / zoom;
      ctx.setLineDash([dashLen, gapLen]);
      for (const { s, t, color, width: lw } of dashedEdges) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 1b. Draw hover-highlighted edges (search result hover)
    if (hasHoverHighlight && hoverEdges.size > 0) {
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 1.5 / zoom;
      for (const edge of hoverEdges) {
        const s = edge.source as SimNode;
        const t = edge.target as SimNode;
        if (s.x == null || t.x == null) continue;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }

    // 1c. Draw file-highlighted edges (brighter)
    if (hasFileHighlight && fileEdges.size > 0) {
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 1.5 / zoom;
      for (const edge of fileEdges) {
        const s = edge.source as SimNode;
        const t = edge.target as SimNode;
        if (s.x == null || t.x == null) continue;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }

    // 1d. Draw folder-highlighted edges (cyan)
    if (hasFolderHighlight && folderEdges.size > 0) {
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 1.5 / zoom;
      for (const edge of folderEdges) {
        const s = edge.source as SimNode;
        const t = edge.target as SimNode;
        if (s.x == null || t.x == null) continue;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }

    // Detect bidirectional: find neighbor IDs that appear in both in and out sets
    const outTargets = new Set<string>();
    for (const edge of outEdges) outTargets.add((edge.target as SimNode).id);
    const inSources = new Set<string>();
    for (const edge of inEdges) inSources.add((edge.source as SimNode).id);
    const bidiNeighbors = new Set<string>();
    for (const id of outTargets) { if (inSources.has(id)) bidiNeighbors.add(id); }

    const bidiOutEdges = new Set<SimEdge>();
    const bidiInEdges = new Set<SimEdge>();
    for (const edge of outEdges) {
      if (bidiNeighbors.has((edge.target as SimNode).id)) bidiOutEdges.add(edge);
    }
    for (const edge of inEdges) {
      if (bidiNeighbors.has((edge.source as SimNode).id)) bidiInEdges.add(edge);
    }

    // 2-4. Draw highlighted edges — chunk mode uses uniform cyan, no arrows (symmetric similarity);
    //       document mode uses directional in/out/bidi with arrows.
    if (chunk) {
      // Chunk mode: all connected edges drawn as cyan lines, no arrows
      const allHighlighted = new Set<SimEdge>([...outEdges, ...inEdges]);
      if (allHighlighted.size > 0) {
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 2 / zoom;
        for (const edge of allHighlighted) {
          const s = edge.source as SimNode;
          const t = edge.target as SimNode;
          if (s.x == null || t.x == null) continue;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
      }
    } else {
      // Document mode: directional edges with arrows
      // Helper: visual radius including interaction bonus for edge clipping
      const nodeVisualRadius = (n: SimNode): number => {
        if (n.id === selectedId) return n.baseRadius + 3;
        if (neighbors.has(n.id)) return n.baseRadius + 1;
        return n.baseRadius;
      };

      // 2. Incoming edges (one-way only)
      if (inEdges.size > 0) {
        ctx.strokeStyle = EDGE_COLOR_IN;
        ctx.fillStyle = EDGE_COLOR_IN;
        ctx.lineWidth = 2 / zoom;
        for (const edge of inEdges) {
          if (bidiInEdges.has(edge)) continue;
          const s = edge.source as SimNode;
          const t = edge.target as SimNode;
          if (s.x == null || t.x == null) continue;
          const c = clipEdge(s.x, s.y, nodeVisualRadius(s), t.x, t.y, nodeVisualRadius(t));
          if (!c) continue;
          const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;
          ctx.beginPath();
          ctx.moveTo(c.x1, c.y1);
          ctx.lineTo(c.x2, c.y2);
          ctx.stroke();
          drawArrow(ctx, c.x2, c.y2, dx / len, dy / len);
        }
      }

      // 3. Outgoing edges (one-way only)
      if (outEdges.size > 0) {
        ctx.strokeStyle = EDGE_COLOR_OUT;
        ctx.fillStyle = EDGE_COLOR_OUT;
        ctx.lineWidth = 2 / zoom;
        for (const edge of outEdges) {
          if (bidiOutEdges.has(edge)) continue;
          const s = edge.source as SimNode;
          const t = edge.target as SimNode;
          if (s.x == null || t.x == null) continue;
          const c = clipEdge(s.x, s.y, nodeVisualRadius(s), t.x, t.y, nodeVisualRadius(t));
          if (!c) continue;
          const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;
          ctx.beginPath();
          ctx.moveTo(c.x1, c.y1);
          ctx.lineTo(c.x2, c.y2);
          ctx.stroke();
          drawArrow(ctx, c.x2, c.y2, dx / len, dy / len);
        }
      }

      // 4. Bidirectional edges — single line, arrows on both ends
      if (bidiOutEdges.size > 0) {
        ctx.strokeStyle = EDGE_COLOR_BIDI;
        ctx.fillStyle = EDGE_COLOR_BIDI;
        ctx.lineWidth = 2 / zoom;
        for (const edge of bidiOutEdges) {
          const s = edge.source as SimNode;
          const t = edge.target as SimNode;
          if (s.x == null || t.x == null) continue;
          const c = clipEdge(s.x, s.y, nodeVisualRadius(s), t.x, t.y, nodeVisualRadius(t));
          if (!c) continue;
          const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;
          ctx.beginPath();
          ctx.moveTo(c.x1, c.y1);
          ctx.lineTo(c.x2, c.y2);
          ctx.stroke();
          drawArrow(ctx, c.x2, c.y2, dx / len, dy / len);
          drawArrow(ctx, c.x1, c.y1, -dx / len, -dy / len);
        }
      }
    }

    // --- Nodes ---
    for (const node of simNodes) {
      const isHovered = hoveredNode === node;
      const isSelected = node.id === selectedId;
      const isNeighbor = neighbors.has(node.id);
      const isHoverNode = hasHoverHighlight && hoverNodeIds.has(node.id);
      const isFileNode = hasFileHighlight && fileNodeIds.has(node.id);
      const isFolderNode = hasFolderHighlight && folderNodeIds.has(node.id);
      const dimmed = (hasSelection && !isSelected && !isNeighbor) ||
                     (hasHoverHighlight && !isHoverNode) ||
                     (hasFileHighlight && !isFileNode) ||
                     (hasFolderHighlight && !isFolderNode);

      // Data-driven base + interaction bonus
      const bonus = isSelected ? 3 : isHovered ? 2 : (isNeighbor || isHoverNode || isFileNode || isFolderNode) ? 1 : 0;
      const radius = node.baseRadius + bonus;

      // Cyan glow effect for hover-highlighted nodes (search result hover)
      if (isHoverNode) {
        ctx.save();
        ctx.shadowColor = '#00E5FF';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
        ctx.restore();
      }

      // Cyan glow effect for folder-highlighted nodes
      if (isFolderNode) {
        ctx.save();
        ctx.shadowColor = '#00E5FF';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
        ctx.restore();
      }

      // Cyan glow effect for file-highlighted nodes
      if (isFileNode) {
        ctx.save();
        ctx.shadowColor = '#00E5FF';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

      // Fill color — three-way coloring mode: cluster, folder, none
      if (dimmed) {
        ctx.fillStyle = 'rgba(228, 228, 231, 0.15)';
      } else if (currentColoringMode === 'cluster') {
        if (node.cluster_id != null) {
          ctx.fillStyle = CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length];
        } else {
          ctx.fillStyle = chunk ? fileColor(node.path) : DEFAULT_NODE_COLOR;
        }
      } else if (currentColoringMode === 'folder') {
        ctx.fillStyle = folderColorMap.get(getTopLevelFolder(node.path)) ?? DEFAULT_NODE_COLOR;
      } else {
        // 'none' mode
        ctx.fillStyle = chunk ? fileColor(node.path) : DEFAULT_NODE_COLOR;
      }
      ctx.fill();

      // Selected ring
      if (isSelected) {
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
    }

    // --- Cluster Labels (on top of edges and nodes, below node labels) ---
    if (currentColoringMode === 'cluster' && cachedHulls.length > 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const hull of cachedHulls) {
        const { r, g, b } = hexToRgb(hull.color);
        const fontSize = Math.min(16, Math.max(11, Math.sqrt(hull.area) * 0.05)) / zoom;
        ctx.font = `bold ${fontSize}px 'Space Grotesk', sans-serif`;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
        ctx.fillText(hull.label, hull.centroid.x, hull.centroid.y);
      }
    }

    // --- Labels ---
    // Dense graphs: only label interactive nodes; sparse graphs: label all
    const nodeCount = simNodes.length;
    const denseThreshold = 80;
    const isDense = nodeCount > denseThreshold;
    const labelZoomMin = isDense ? 1.5 : 0.8;
    const showAllLabels = zoom > labelZoomMin;
    const hasAnyHighlight = hasSelection || hasHoverHighlight || hasFileHighlight || hasFolderHighlight || hoveredNode;

    if (showAllLabels || hasAnyHighlight) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const node of simNodes) {
        const isHovered = hoveredNode === node;
        const isSelected = node.id === selectedId;
        const isNeighbor = neighbors.has(node.id);
        const isHoverNode = hasHoverHighlight && hoverNodeIds.has(node.id);
        const isFileNode = hasFileHighlight && fileNodeIds.has(node.id);
        const isFolderNode = hasFolderHighlight && folderNodeIds.has(node.id);
        const isImportant = isHovered || isSelected || isNeighbor || isHoverNode || isFileNode || isFolderNode;

        // In dense mode without enough zoom, only show labels for interactive nodes
        if (!showAllLabels && !isImportant) continue;

        const dimmed = (hasSelection && !isSelected && !isNeighbor) ||
                       (hasHoverHighlight && !isHoverNode) ||
                       (hasFileHighlight && !isFileNode) ||
                       (hasFolderHighlight && !isFolderNode);

        ctx.fillStyle = dimmed
          ? 'rgba(228, 228, 231, 0.15)'
          : isSelected
            ? '#00E5FF'
            : isNeighbor
              ? 'rgba(228, 228, 231, 1.0)'
              : 'rgba(228, 228, 231, 0.8)';
        ctx.font = `${(isSelected || isNeighbor ? 12 : 11) / zoom}px 'Space Grotesk', sans-serif`;

        let label: string;
        if (chunk && node.label) {
          // Show deepest heading segment
          label = node.label.split(' > ').pop() ?? node.label;
        } else {
          label = node.path.split('/').pop() ?? node.path;
        }
        ctx.fillText(label, node.x, node.y + (isHovered || isSelected ? 10 : 8));
      }
    }

    ctx.restore();
  }

  // --- Interaction handlers ---

  function screenToGraph(sx: number, sy: number): [number, number] {
    return [(sx - panX) / zoom, (sy - panY) / zoom];
  }

  function findNodeAt(sx: number, sy: number): SimNode | null {
    const [gx, gy] = screenToGraph(sx, sy);
    if (!simulation) return null;
    // Use the largest possible node radius + interaction bonus as the search radius,
    // then verify the hit is actually within the specific node's radius
    const maxHitRadius = 22 / zoom; // 18 max base + 3 select bonus + 1 buffer
    const candidate = simulation.find(gx, gy, maxHitRadius) ?? null;
    if (!candidate) return null;
    const dx = gx - (candidate.x ?? 0);
    const dy = gy - (candidate.y ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Allow clicking within the node's actual radius + a small buffer for usability
    const nodeHitRadius = candidate.baseRadius + 2;
    return dist <= nodeHitRadius ? candidate : null;
  }

  /** Find the nearest edge within 6 screen-pixels of the given screen coordinates. */
  function findEdgeAt(sx: number, sy: number): SimEdge | null {
    if (isChunkMode()) return null;
    const [gx, gy] = screenToGraph(sx, sy);
    const hitDist = 6 / zoom;
    let closest: SimEdge | null = null;
    let closestDist = hitDist;
    for (const edge of simEdges) {
      const s = edge.source as SimNode;
      const t = edge.target as SimNode;
      if (s.x == null || t.x == null) continue;
      if (!isEdgeVisible(edge, currentEdgeFilter.size > 0 ? currentEdgeFilter : null)) continue;
      const dist = pointToSegmentDist(gx, gy, s.x, s.y, t.x, t.y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = edge;
      }
    }
    return closest;
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const rect = canvasEl!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const node = findNodeAt(sx, sy);
    if (node) {
      // Start dragging the node
      draggedNode = node;
      node.fx = node.x;
      node.fy = node.y;
      // Reheat simulation so other nodes react
      simulation?.alphaTarget(0.3).restart();
      selectGraphNode({ id: node.id, path: node.path, label: node.label, cluster_id: node.cluster_id, chunk_index: node.chunk_index });
      return;
    }

    // Start panning
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    didPan = false;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (draggedNode) {
      const [gx, gy] = screenToGraph(sx, sy);
      draggedNode.fx = gx;
      draggedNode.fy = gy;
      dirty = true;
      return;
    }

    if (isPanning) {
      panX = panStartPanX + (e.clientX - panStartX);
      panY = panStartPanY + (e.clientY - panStartY);
      didPan = true;
      dirty = true;
      return;
    }

    const node = findNodeAt(sx, sy);
    if (node) {
      if (node !== hoveredNode) {
        hoveredNode = node;
        hoveredEdge = null;
        tooltipX = e.clientX;
        tooltipY = e.clientY;
        dirty = true;
      }
      return;
    }

    // No node hovered — check for edge hover
    const edge = findEdgeAt(sx, sy);
    if (edge !== hoveredEdge || hoveredNode) {
      hoveredNode = null;
      hoveredEdge = edge;
      tooltipX = e.clientX;
      tooltipY = e.clientY;
      dirty = true;
    }
  }

  function handleMouseUp() {
    if (draggedNode) {
      // Release the node — unpin it so simulation can move it again
      draggedNode.fx = undefined;
      draggedNode.fy = undefined;
      draggedNode = null;
      simulation?.alphaTarget(0);
    } else if (isPanning && !didPan) {
      // Clicked on empty space without dragging — deselect
      selectGraphNode(null);
    }
    isPanning = false;
    didPan = false;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvasEl!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Smooth zoom: scale factor proportional to deltaY magnitude
    // Clamp individual step to avoid massive jumps from trackpad inertia
    const delta = Math.max(-50, Math.min(50, e.deltaY));
    const factor = 1 - delta * 0.003;
    const newZoom = Math.max(0.1, Math.min(10, zoom * factor));

    // Zoom toward cursor
    panX = sx - (sx - panX) * (newZoom / zoom);
    panY = sy - (sy - panY) * (newZoom / zoom);
    zoom = newZoom;
    dirty = true;
  }

  function toggleLegend() {
    legendVisible = !legendVisible;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      selectGraphNode(null);
      setGraphHighlightedFolder(null);
      hoveredNode = null;
      hoveredEdge = null;
      dirty = true;
    }
  }

  function handleRetry() {
    loadGraphData();
  }

  // Derive cluster info for legend
  function getClusters(): { id: number; label: string; color: string; member_count: number }[] {
    if (!currentData) return [];
    return currentData.clusters.map((c) => ({
      id: c.id,
      label: c.label,
      color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
      member_count: c.member_count,
    }));
  }

  /** Get legend items for folder coloring mode. */
  function getFolderLegendItems(): { folder: string; color: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const node of simNodes) {
      const folder = getTopLevelFolder(node.path);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const items: { folder: string; color: string; count: number }[] = [];
    for (const [folder, color] of folderColorMap) {
      items.push({ folder, color, count: counts.get(folder) ?? 0 });
    }
    return items.sort((a, b) => a.folder.localeCompare(b.folder));
  }

  /** Get unique edge clusters present in the current edges for legend display. */
  function getEdgeClusters(): { id: number; color: string; label: string; count: number }[] {
    const counts = new Map<number, { label: string; count: number }>();
    for (const edge of simEdges) {
      const e = edge as SimEdge;
      if (e.edge_cluster_id == null) continue;
      const existing = counts.get(e.edge_cluster_id);
      if (existing) {
        existing.count++;
      } else {
        counts.set(e.edge_cluster_id, {
          label: e.relationship_type ?? `Type ${e.edge_cluster_id}`,
          count: 1,
        });
      }
    }
    return Array.from(counts.entries())
      .map(([id, info]) => ({
        id,
        color: edgeClusterColor(id),
        label: info.label,
        count: info.count,
      }))
      .sort((a, b) => a.id - b.id);
  }

  /** Check if a given edge cluster is currently filtered out. */
  function isEdgeClusterFiltered(clusterId: number): boolean {
    if (currentEdgeFilter.size === 0) return false;
    return !currentEdgeFilter.has(clusterId);
  }
</script>

<div class="graph-view" bind:this={containerEl}>
  {#if currentLoading}
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
  {:else if !currentData || currentData.nodes.length === 0}
    <div class="graph-empty">
      <span class="material-symbols-outlined">hub</span>
      <p>No files indexed. Run ingest to build the graph.</p>
    </div>
  {:else}
    <canvas
      bind:this={canvasEl}
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
      onmouseleave={handleMouseUp}
      onwheel={handleWheel}
      style="cursor: {draggedNode ? 'grabbing' : isPanning ? 'grabbing' : hoveredNode || hoveredEdge ? 'pointer' : 'grab'}"
    ></canvas>

    <!-- Level tab switcher -->
    <div class="graph-level-switcher" role="tablist">
      <button class="level-tab" class:active={currentLevel === 'document'}
        onclick={() => setGraphLevel('document')}>Documents</button>
      <button class="level-tab" class:active={currentLevel === 'chunk'}
        onclick={() => setGraphLevel('chunk')}>Chunks</button>
    </div>

    <!-- Path filter badge -->
    {#if currentPathFilter}
      <div class="graph-path-badge">
        <span class="material-symbols-outlined path-badge-icon">folder</span>
        <span class="path-badge-text">{currentPathFilter}</span>
        <button class="path-badge-close" onclick={() => setGraphPathFilter(null)} title="Clear path filter">×</button>
      </div>
    {/if}

    <!-- Folder highlight badge -->
    {#if currentHighlightedFolder}
      <div class="graph-folder-badge" class:has-path-filter={!!currentPathFilter}>
        <span class="material-symbols-outlined folder-badge-icon">folder_open</span>
        <span class="folder-badge-text">{currentHighlightedFolder}</span>
        <button class="folder-badge-close" onclick={() => setGraphHighlightedFolder(null)} title="Clear folder highlight">×</button>
      </div>
    {/if}

    {#if currentData.edges.length === 0 && currentLevel !== 'chunk'}
      <div class="graph-notice">No link connections found.</div>
    {/if}

    {#if simNodes.length > 1000}
      <div class="graph-notice warning">Large graph ({simNodes.length} nodes). Performance may be reduced.</div>
    {/if}

    <!-- Tooltip -->
    {#if hoveredNode}
      <div
        class="graph-tooltip"
        style="left: {tooltipX + 12}px; top: {tooltipY - 30}px"
      >
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

    <!-- Edge tooltip -->
    {#if hoveredEdge && !hoveredNode}
      {@const edgeSrc = hoveredEdge.source as SimNode}
      {@const edgeTgt = hoveredEdge.target as SimNode}
      <div
        class="graph-tooltip edge-tooltip"
        style="left: {tooltipX + 12}px; top: {tooltipY - 30}px"
      >
        {#if hoveredEdge.relationship_type}
          <div class="edge-tooltip-type">
            <span class="edge-tooltip-dot" style="background: {hoveredEdge.edge_cluster_id != null ? edgeClusterColor(hoveredEdge.edge_cluster_id) : 'rgba(255,255,255,0.5)'}"></span>
            {hoveredEdge.relationship_type}
          </div>
        {/if}
        <div class="edge-tooltip-nodes">{edgeSrc.path} → {edgeTgt.path}</div>
        {#if hoveredEdge.strength != null}
          <div class="edge-tooltip-strength">
            <span class="edge-tooltip-strength-label">Strength</span>
            <div class="edge-tooltip-bar">
              <div class="edge-tooltip-bar-fill" style="width: {Math.round(hoveredEdge.strength * 100)}%"></div>
            </div>
            <span class="edge-tooltip-strength-value">{Math.round(hoveredEdge.strength * 100)}%</span>
          </div>
        {/if}
        {#if hoveredEdge.context_text}
          <div class="edge-tooltip-context">{hoveredEdge.context_text.length > 120 ? hoveredEdge.context_text.slice(0, 120) + '…' : hoveredEdge.context_text}</div>
        {/if}
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
          <span class="legend-title">{currentColoringMode === 'cluster' ? 'Clusters' : 'Folders'}</span>
          <button class="legend-toggle" onclick={cycleColoringMode} title={currentColoringMode === 'cluster' ? 'Color by folders' : 'No coloring'}>
            <span class="material-symbols-outlined">{currentColoringMode === 'cluster' ? 'category' : 'folder'}</span>
          </button>
          <button class="legend-toggle" onclick={toggleLegend} title={legendVisible ? 'Hide legend' : 'Show legend'}>
            <span class="material-symbols-outlined">{legendVisible ? 'expand_less' : 'expand_more'}</span>
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
                  title={currentHighlightedFolder === item.folder ? `Clear ${item.folder} highlight` : `Highlight ${item.folder}`}
                >
                  <span class="legend-dot" style="background: {item.color}"></span>
                  <span class="legend-label">{item.folder}</span>
                  <span class="legend-count">{item.count}</span>
                </button>
              {/each}
              {#if currentHighlightedFolder}
                <button class="legend-clear-filter" onclick={() => setGraphHighlightedFolder(null)} title="Clear folder highlight" style="margin-top: 4px; width: 100%;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">filter_alt_off</span>
                  <span style="font-size: 10px;">Clear</span>
                </button>
              {/if}
            {/if}
            {#if getEdgeClusters().length > 0}
              <div class="legend-separator"></div>
              <div class="legend-section-title">
                <span>Edge Types</span>
                {#if currentEdgeFilter.size > 0}
                  <button class="legend-clear-filter" onclick={clearEdgeFilter} title="Show all edges">
                    <span class="material-symbols-outlined">filter_alt_off</span>
                  </button>
                {/if}
              </div>
              {#each getEdgeClusters() as ec}
                <button
                  class="legend-item legend-item-clickable"
                  class:legend-item-muted={isEdgeClusterFiltered(ec.id)}
                  onclick={() => toggleEdgeClusterFilter(ec.id)}
                  title={isEdgeClusterFiltered(ec.id) ? `Show ${ec.label} edges` : `Hide ${ec.label} edges`}
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
    background: var(--color-bg, #0f0f10);
    min-width: 0;
    min-height: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
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

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .retry-btn {
    margin-top: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
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
    color: var(--color-primary, #00E5FF);
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
    background: var(--color-primary, #00E5FF);
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
    color: var(--color-primary, #00E5FF);
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
    border: 1px solid #00E5FF40;
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
    color: #00E5FF;
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
</style>
