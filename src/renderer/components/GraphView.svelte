<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
  import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
  import {
    graphData,
    graphLoading,
    graphError,
    graphSelectedNode,
    graphClusterColoring,
    loadGraphData,
    selectGraphNode,
  } from '../stores/graph';
  import type { GraphNode, GraphEdge, GraphData } from '../types/cli';

  /** Cluster color palette (12 colors, cycling). */
  const CLUSTER_COLORS = [
    '#00E5FF', '#FF6B6B', '#51CF66', '#FFD43B', '#845EF7', '#FF922B',
    '#20C997', '#F06595', '#339AF0', '#B2F2BB', '#D0BFFF', '#FFC078',
  ];

  const DEFAULT_NODE_COLOR = 'rgba(228, 228, 231, 0.6)';

  interface SimNode extends SimulationNodeDatum {
    path: string;
    cluster_id: number | null;
    x: number;
    y: number;
  }

  interface SimEdge extends SimulationLinkDatum<SimNode> {
    source: SimNode | string;
    target: SimNode | string;
  }

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let simulation: Simulation<SimNode, SimEdge> | null = null;
  let simNodes: SimNode[] = [];
  let simEdges: SimEdge[] = [];
  let animFrameId: number | null = null;
  let dirty = true;

  // Pan/zoom state
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // Hover state
  let hoveredNode: SimNode | null = null;
  let tooltipX = 0;
  let tooltipY = 0;

  // Legend visibility
  let legendVisible = $state(true);

  // Canvas dimensions
  let width = 0;
  let height = 0;

  // Store subscriptions
  let unsubData: (() => void) | null = null;
  let unsubColoring: (() => void) | null = null;
  let unsubSelected: (() => void) | null = null;

  // Reactive local copies for template use
  let currentData: GraphData | null = $state(null);
  let currentLoading = $state(false);
  let currentError: string | null = $state(null);
  let currentColoring = $state(true);
  let currentSelected: GraphNode | null = $state(null);

  onMount(() => {
    unsubData = graphData.subscribe((d) => {
      currentData = d;
      if (d) buildSimulation(d);
    });
    unsubColoring = graphClusterColoring.subscribe((v) => {
      currentColoring = v;
      dirty = true;
    });
    unsubSelected = graphSelectedNode.subscribe((n) => {
      currentSelected = n;
      dirty = true;
    });
    graphLoading.subscribe((v) => { currentLoading = v; });
    graphError.subscribe((v) => { currentError = v; });

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    startRenderLoop();
  });

  onDestroy(() => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (simulation) simulation.stop();
    window.removeEventListener('resize', resizeCanvas);
    unsubData?.();
    unsubColoring?.();
    unsubSelected?.();
  });

  function resizeCanvas() {
    if (!containerEl || !canvasEl) return;
    const rect = containerEl.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvasEl.width = width * devicePixelRatio;
    canvasEl.height = height * devicePixelRatio;
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;
    dirty = true;
  }

  function buildSimulation(data: GraphData) {
    if (simulation) simulation.stop();

    simNodes = data.nodes.map((n) => ({
      path: n.path,
      cluster_id: n.cluster_id,
      x: Math.random() * (width || 800),
      y: Math.random() * (height || 600),
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.path, n]));
    simEdges = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const isLarge = simNodes.length > 300;

    simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.path)
          .distance(80)
          .strength(0.4),
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(isLarge ? -60 : -120)
          .distanceMax(isLarge ? 200 : 400),
      )
      .force('center', forceCenter(width / 2 || 400, height / 2 || 300))
      .force('collide', forceCollide<SimNode>(16))
      .alphaDecay(isLarge ? 0.04 : 0.02)
      .velocityDecay(0.3)
      .on('tick', () => {
        dirty = true;
      });

    // Warm-up
    simulation.tick(300);

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

    // Draw edges
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    for (const edge of simEdges) {
      const s = edge.source as SimNode;
      const t = edge.target as SimNode;
      if (s.x == null || t.x == null) continue;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();

    // Draw nodes
    const selectedPath = currentSelected?.path ?? null;
    for (const node of simNodes) {
      const isHovered = hoveredNode === node;
      const isSelected = node.path === selectedPath;
      const radius = isSelected ? 8 : isHovered ? 7 : 5;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

      // Fill color
      if (currentColoring && node.cluster_id != null) {
        ctx.fillStyle = CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length];
      } else {
        ctx.fillStyle = DEFAULT_NODE_COLOR;
      }
      ctx.fill();

      // Selected ring
      if (isSelected) {
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
    }

    // Draw labels when zoomed in
    if (zoom > 0.8) {
      ctx.fillStyle = 'rgba(228, 228, 231, 0.8)';
      ctx.font = `${11 / zoom}px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const node of simNodes) {
        const label = node.path.split('/').pop() ?? node.path;
        ctx.fillText(label, node.x, node.y + (hoveredNode === node ? 10 : 8));
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
      selectGraphNode({ path: node.path, cluster_id: node.cluster_id });
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
    isPanning = false;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvasEl!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
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

  function toggleClusterColoring() {
    graphClusterColoring.update((v) => !v);
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
      style="cursor: {isPanning ? 'grabbing' : hoveredNode ? 'pointer' : 'grab'}"
    ></canvas>

    {#if currentData.edges.length === 0}
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
        {#if hoveredNode.cluster_id != null && currentData}
          {@const cluster = currentData.clusters.find((c) => c.id === hoveredNode!.cluster_id)}
          {#if cluster}
            <div class="tooltip-cluster">{cluster.label}</div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Cluster legend -->
    {#if getClusters().length > 0}
      <div class="graph-legend">
        <div class="legend-header">
          <span class="legend-title">Clusters</span>
          <button class="legend-toggle" onclick={toggleClusterColoring} title={currentColoring ? 'Disable coloring' : 'Enable coloring'}>
            <span class="material-symbols-outlined">{currentColoring ? 'visibility' : 'visibility_off'}</span>
          </button>
          <button class="legend-toggle" onclick={toggleLegend} title={legendVisible ? 'Hide legend' : 'Show legend'}>
            <span class="material-symbols-outlined">{legendVisible ? 'expand_less' : 'expand_more'}</span>
          </button>
        </div>
        {#if legendVisible}
          <div class="legend-items">
            {#each getClusters() as cluster}
              <div class="legend-item">
                <span class="legend-dot" style="background: {cluster.color}"></span>
                <span class="legend-label">{cluster.label}</span>
                <span class="legend-count">{cluster.member_count}</span>
              </div>
            {/each}
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

  .tooltip-cluster {
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: var(--text-xs, 0.625rem);
    margin-top: var(--space-1, 0.25rem);
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
</style>
