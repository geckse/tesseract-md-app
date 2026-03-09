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
    loadGraphData,
    selectGraphNode,
    setGraphLevel,
    setGraphPathFilter,
  } from '../stores/graph';
  import type { GraphColoringMode } from '../stores/graph';
  import type { GraphLevel } from '../types/cli';
  import type { GraphNode, GraphEdge, GraphData } from '../types/cli';
  import { selectedFilePath } from '../stores/files';

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
  }

  interface SimEdge extends SimulationLinkDatum<SimNode> {
    source: SimNode | string;
    target: SimNode | string;
    weight: number | null;
  }

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let simulation: Simulation<SimNode, SimEdge> | null = null;
  let simNodes: SimNode[] = [];
  let simEdges: SimEdge[] = [];
  let animFrameId: number | null = null;
  let dirty = true;
  let pendingData: GraphData | null = null;

  // Pan/zoom state
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // Drag state
  let draggedNode: SimNode | null = null;

  // Hover state
  let hoveredNode: SimNode | null = null;
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

  // Reactive local copies for template use
  let currentData: GraphData | null = $state(null);
  let currentLoading = $state(false);
  let currentError: string | null = $state(null);
  let currentColoringMode: GraphColoringMode = $state('cluster');
  let currentSelected: GraphNode | null = $state(null);
  let currentLevel: GraphLevel = $state('document');
  let currentFilePath: string | null = $state(null);
  let currentPathFilter: string | null = $state(null);

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

    simNodes = data.nodes.map((n) => ({
      id: n.id,
      path: n.path,
      label: n.label,
      cluster_id: n.cluster_id,
      chunk_index: n.chunk_index,
      x: Math.random() * width,
      y: Math.random() * height,
    }));

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
      .map((e) => ({ source: e.source, target: e.target, weight: e.weight }));

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
        .force('collide', forceCollide<SimNode>(10))
        .alphaDecay(isLarge ? 0.04 : 0.02)
        .velocityDecay(0.3)
        .on('tick', () => { dirty = true; });

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
        .force('collide', forceCollide<SimNode>(16))
        .alphaDecay(isLarge ? 0.04 : 0.02)
        .velocityDecay(0.3)
        .on('tick', () => { dirty = true; });

      simulation.tick(300);
    }

    // Center the view
    panX = 0;
    panY = 0;
    zoom = 1;
    dirty = true;
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
  const ARROW_SIZE = 8;              // arrowhead length in graph-space pixels

  /** Draw an arrowhead at the target end of an edge, stopping at the node radius. */
  function drawArrow(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    tx: number, ty: number,
    nodeRadius: number,
  ) {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    // Unit vector from source to target
    const ux = dx / len;
    const uy = dy / len;

    // Arrow tip stops at the target node's edge
    const tipX = tx - ux * nodeRadius;
    const tipY = ty - uy * nodeRadius;

    // Two wing points
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

    const chunk = isChunkMode();
    const selectedId = currentSelected?.id ?? null;
    const { neighbors, outEdges, inEdges } = getSelectedNeighbors(selectedId);
    const hasSelection = selectedId !== null;
    const { fileNodeIds, fileEdges } = getFileHighlight(currentFilePath);
    const hasFileHighlight = !hasSelection && fileNodeIds.size > 0;

    // --- Edges ---
    // 1. Draw non-highlighted edges first (dimmed when there's a selection or file highlight)
    ctx.lineWidth = 1 / zoom;
    for (const edge of simEdges) {
      if (outEdges.has(edge) || inEdges.has(edge)) continue;
      // Skip file-highlighted edges here; they're drawn later with brighter style
      if (hasFileHighlight && fileEdges.has(edge)) continue;
      const s = edge.source as SimNode;
      const t = edge.target as SimNode;
      if (s.x == null || t.x == null) continue;

      const dimFactor = hasSelection || hasFileHighlight;
      // In chunk mode, edge opacity is proportional to weight
      if (chunk && edge.weight != null) {
        const alpha = dimFactor ? (0.05 + edge.weight * 0.2) * 0.3 : 0.05 + edge.weight * 0.2;
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = dimFactor ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }

    // 1b. Draw file-highlighted edges (brighter)
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
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          drawArrow(ctx, s.x, s.y, t.x, t.y, 8);
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
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          drawArrow(ctx, s.x, s.y, t.x, t.y, 6);
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
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          drawArrow(ctx, s.x, s.y, t.x, t.y, 8);
          drawArrow(ctx, t.x, t.y, s.x, s.y, 8);
        }
      }
    }

    // --- Nodes ---
    const baseRadius = chunk ? 3 : 5;
    for (const node of simNodes) {
      const isHovered = hoveredNode === node;
      const isSelected = node.id === selectedId;
      const isNeighbor = neighbors.has(node.id);
      const isFileNode = hasFileHighlight && fileNodeIds.has(node.id);
      const dimmed = (hasSelection && !isSelected && !isNeighbor) ||
                     (hasFileHighlight && !isFileNode);

      const radius = isSelected ? (chunk ? 6 : 8) : isHovered ? (chunk ? 5 : 7) : isNeighbor ? (chunk ? 4 : 6) : isFileNode ? (chunk ? 5 : 7) : baseRadius;

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

    // --- Labels ---
    if (zoom > 0.8) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const node of simNodes) {
        const isSelected = node.id === selectedId;
        const isNeighbor = neighbors.has(node.id);
        const isFileNode = hasFileHighlight && fileNodeIds.has(node.id);
        const dimmed = (hasSelection && !isSelected && !isNeighbor) ||
                       (hasFileHighlight && !isFileNode);

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
        ctx.fillText(label, node.x, node.y + (hoveredNode === node || isSelected ? 10 : 8));
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
    const hitRadius = 12 / zoom;
    if (!simulation) return null;
    return simulation.find(gx, gy, hitRadius) ?? null;
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
      dirty = true;
      return;
    }

    const node = findNodeAt(sx, sy);
    if (node !== hoveredNode) {
      hoveredNode = node;
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
    }
    isPanning = false;
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
      hoveredNode = null;
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
      style="cursor: {draggedNode ? 'grabbing' : isPanning ? 'grabbing' : hoveredNode ? 'pointer' : 'grab'}"
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
                <div class="legend-item">
                  <span class="legend-dot" style="background: {item.color}"></span>
                  <span class="legend-label">{item.folder}</span>
                  <span class="legend-count">{item.count}</span>
                </div>
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
</style>
