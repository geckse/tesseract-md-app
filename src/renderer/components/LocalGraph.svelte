<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
  import type { Simulation } from 'd3-force';
  import type { LinksOutput, BacklinksOutput } from '../types/cli';
  import { activeCollection } from '../stores/collections';
  import { buildLocalGraph, buildLocalGraphFromNeighborhood } from '../utils/local-graph';
  import type { LocalNode, LocalEdge, LocalGraphData } from '../utils/local-graph';

  interface LocalGraphProps {
    centerPath: string | null;
    linksInfo: LinksOutput | null;
    backlinksInfo: BacklinksOutput | null;
    onfileselect?: (detail: { path: string }) => void;
    onexpand?: () => void;
  }

  let { centerPath, linksInfo, backlinksInfo, onfileselect, onexpand }: LocalGraphProps = $props();

  const WIDTH = 250;
  const HEIGHT = 200;
  const CENTER_RADIUS = 8;
  const MIN_RADIUS = 2.5;
  const MAX_RADIUS = 8;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.25;
  const MIN_SPREAD = 30;
  const MAX_SPREAD = 150;
  const SPREAD_STEP = 15;

  let simNodes: LocalNode[] = $state([]);
  let simEdges: LocalEdge[] = $state([]);
  let degreeMap: Map<string, number> = $state(new Map());
  let hoveredPath: string | null = $state(null);
  let simulation: Simulation<LocalNode, LocalEdge> | null = null;

  // Zoom & pan state
  let zoom: number = $state(1);
  let panX: number = $state(0);
  let panY: number = $state(0);
  let isPanning: boolean = $state(false);
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  // Node drag state
  let draggedNodePath: string | null = $state(null);
  let didDragNode = false;

  // Context menu state
  let contextMenuPath: string | null = $state(null);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  // Spread (link distance) state
  let spread: number = $state(60);
  let lastGraphData: LocalGraphData | null = null;

  // Derived viewBox based on zoom & pan
  let viewBox = $derived(() => {
    const w = WIDTH / zoom;
    const h = HEIGHT / zoom;
    const x = (WIDTH - w) / 2 - panX / zoom;
    const y = (HEIGHT - h) / 2 - panY / zoom;
    return `${x} ${y} ${w} ${h}`;
  });

  function zoomIn() {
    zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
  }

  function zoomOut() {
    zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
  }

  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  }

  function spreadOut() {
    spread = Math.min(MAX_SPREAD, spread + SPREAD_STEP);
    if (lastGraphData) runSimulation(lastGraphData);
  }

  function spreadIn() {
    spread = Math.max(MIN_SPREAD, spread - SPREAD_STEP);
    if (lastGraphData) runSimulation(lastGraphData);
  }

  function handlePointerDown(e: PointerEvent) {
    // Only pan on background drag (not node clicks)
    const target = e.target as Element;
    if (target.closest('.graph-node')) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    (e.currentTarget as Element)?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
  }

  function handlePointerUp() {
    isPanning = false;
  }

  function getFileName(path: string): string {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    return name.length > 15 ? name.slice(0, 12) + '…' : name;
  }

  function getNodeRadius(node: LocalNode): number {
    if (node.isCenter) return CENTER_RADIUS;
    const degree = degreeMap.get(node.path) ?? 0;
    const maxDeg = Math.max(1, ...degreeMap.values());
    const ratio = degree / maxDeg;
    return MIN_RADIUS + ratio * ratio * (MAX_RADIUS - MIN_RADIUS);
  }

  /** Map edge strength (0–1) to stroke-width. Default strength assumed 0.5. */
  function getEdgeStrokeWidth(edge: LocalEdge, isHovered: boolean, isDepth2: boolean): number {
    if (isHovered) return 1.5;
    if (isDepth2) return 0.3;
    const s = edge.strength ?? 0.5;
    // Scale from 0.4 (weakest) to 1.4 (strongest)
    return 0.4 + s * 1.0;
  }

  /** Weak edges (strength < 0.3) get dashed rendering. */
  function getEdgeDashArray(edge: LocalEdge, isDepth2: boolean): string | undefined {
    if (isDepth2) return undefined;
    const s = edge.strength ?? 0.5;
    return s < 0.3 ? '2,2' : undefined;
  }

  /** Build tooltip text from edge semantic fields. */
  function getEdgeTooltip(edge: LocalEdge): string {
    const parts: string[] = [];
    if (edge.relationship_type) parts.push(edge.relationship_type);
    if (edge.strength != null) parts.push(`strength: ${Math.round(edge.strength * 100)}%`);
    if (edge.context_text) parts.push(edge.context_text);
    if (edge.bidirectional) parts.push('(bidirectional)');
    return parts.length > 0 ? parts.join(' — ') : '';
  }

  function runSimulation(graph: LocalGraphData) {
    if (simulation) simulation.stop();
    lastGraphData = graph;

    if (graph.nodes.length === 0) {
      simNodes = [];
      simEdges = [];
      degreeMap = new Map();
      return;
    }

    // Compute degree map for data-driven node sizing
    const dm = new Map<string, number>();
    for (const e of graph.edges) {
      const src = typeof e.source === 'string' ? e.source : e.source.path;
      const tgt = typeof e.target === 'string' ? e.target : e.target.path;
      dm.set(src, (dm.get(src) ?? 0) + 1);
      dm.set(tgt, (dm.get(tgt) ?? 0) + 1);
    }
    degreeMap = dm;

    const nodes = graph.nodes;

    simulation = forceSimulation<LocalNode>(nodes)
      .force(
        'link',
        forceLink<LocalNode, LocalEdge>(graph.edges)
          .id((d) => d.path)
          .distance(spread)
          .strength(0.5),
      )
      .force('charge', forceManyBody<LocalNode>().strength(-80).distanceMax(150))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide<LocalNode>().radius((d) => (getNodeRadius(d as LocalNode) + 2)))
      .alphaDecay(0.05)
      .velocityDecay(0.4);

    // Warm-up ticks
    simulation.tick(100);
    simulation.stop();

    // Capture resolved edges and trigger reactivity
    simEdges = graph.edges as LocalEdge[];
    simNodes = [...nodes];
  }

  // Reset zoom/pan when file changes
  $effect(() => {
    centerPath;
    zoom = 1;
    panX = 0;
    panY = 0;
    spread = 60;
  });

  // Rebuild graph when inputs change — use single neighborhood API call for depth-2
  $effect(() => {
    if (!centerPath) {
      runSimulation({ nodes: [], edges: [] });
      return;
    }

    const collection = get(activeCollection);
    const cp = centerPath;
    const li = linksInfo;
    const bi = backlinksInfo;

    if (!collection) {
      runSimulation(buildLocalGraph(cp, li, bi));
      return;
    }

    // Try single neighborhood call (depth 2) — show neighbors of neighbors
    window.api.neighborhood(collection.path, cp, 2).then((result) => {
      runSimulation(buildLocalGraphFromNeighborhood(cp, result));
    }).catch(() => {
      // Fallback: use existing 1-hop data from props
      runSimulation(buildLocalGraph(cp, li, bi));
    });
  });

  onDestroy(() => {
    if (simulation) simulation.stop();
  });

  function handleNodePointerDown(path: string, e: PointerEvent) {
    if (e.button !== 0) return; // Only handle primary (left) button
    draggedNodePath = path;
    didDragNode = false;
    (e.currentTarget as Element)?.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function handleNodePointerMove(e: PointerEvent) {
    if (!draggedNodePath) return;
    didDragNode = true;
  }

  function handleNodePointerUp() {
    if (draggedNodePath && !didDragNode) {
      onfileselect?.({ path: draggedNodePath });
    }
    draggedNodePath = null;
    didDragNode = false;
  }

  function handleNodeContextMenu(path: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuPath = path;
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
  }

  function handleContextMenuOpen() {
    if (contextMenuPath) {
      onfileselect?.({ path: contextMenuPath });
    }
    contextMenuPath = null;
  }

  function getNodeX(node: LocalNode): number {
    return Math.max(CENTER_RADIUS, Math.min(WIDTH - CENTER_RADIUS, node.x ?? WIDTH / 2));
  }

  function getNodeY(node: LocalNode): number {
    return Math.max(CENTER_RADIUS, Math.min(HEIGHT - CENTER_RADIUS, node.y ?? HEIGHT / 2));
  }

  function getEdgeSource(edge: LocalEdge): LocalNode {
    return edge.source as LocalNode;
  }

  function getEdgeTarget(edge: LocalEdge): LocalNode {
    return edge.target as LocalNode;
  }

  // Sort edges: depth2 first, then default/outgoing, then incoming last (on top)
  let sortedEdges = $derived(
    [...simEdges].sort((a, b) => {
      const aIn = (getEdgeTarget(a)).isCenter ? 1 : 0;
      const bIn = (getEdgeTarget(b)).isCenter ? 1 : 0;
      if (aIn !== bIn) return aIn - bIn; // incoming last
      const aD2 = (getEdgeSource(a)).depth === 2 || (getEdgeTarget(a)).depth === 2 ? -1 : 0;
      const bD2 = (getEdgeSource(b)).depth === 2 || (getEdgeTarget(b)).depth === 2 ? -1 : 0;
      return aD2 - bD2; // depth2 first
    }),
  );

  let hasLinks = $derived(simNodes.length > 1);

</script>

<div class="local-graph">
  <div class="local-graph-header">
    <span class="local-graph-title">Graph</span>
    {#if onexpand && hasLinks}
      <button class="expand-button" title="Open full graph view" onclick={onexpand}>
        <span class="material-symbols-outlined">open_in_full</span>
      </button>
    {/if}
  </div>

  {#if !centerPath}
    <div class="local-graph-empty">
      <span class="material-symbols-outlined empty-icon">hub</span>
      <span class="empty-text">No file selected</span>
    </div>
  {:else if !linksInfo && !backlinksInfo}
    <div class="local-graph-empty">
      <span class="material-symbols-outlined empty-icon spinning">hourglass_empty</span>
      <span class="empty-text">Loading…</span>
    </div>
  {:else if !hasLinks}
    <div class="local-graph-empty">
      <span class="material-symbols-outlined empty-icon">scatter_plot</span>
      <span class="empty-text">No connections</span>
    </div>
  {:else}
    <div class="graph-container">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        bind:this={svgEl}
        class="local-graph-svg"
        class:grabbing-cursor={isPanning}
        viewBox={viewBox()}
        xmlns="http://www.w3.org/2000/svg"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        onwheel={handleWheel}
      >
        <!-- Arrow markers (only shown on hover) -->
        <defs>
          <marker id="arrow-hover-out" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-primary, #00E5FF)" />
          </marker>
          <marker id="arrow-hover-in" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-edge-in, #FF6B6B)" />
          </marker>
          <marker id="arrow-hover-bidi" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-edge-bidi, #51CF66)" />
          </marker>
        </defs>

        <!-- Edges (sorted: depth2 → outgoing → incoming on top) -->
        {#each sortedEdges as edge}
          {@const src = getEdgeSource(edge)}
          {@const tgt = getEdgeTarget(edge)}
          {@const isHovered =
            hoveredPath === src.path || hoveredPath === tgt.path}
          {@const isDepth2Edge = src.depth === 2 || tgt.depth === 2}
          {@const isCenterOut = src.isCenter}
          {@const isCenterIn = tgt.isCenter}
          {@const isBidi = edge.bidirectional}
          {@const sx = getNodeX(src)}
          {@const sy = getNodeY(src)}
          {@const tx = getNodeX(tgt)}
          {@const ty = getNodeY(tgt)}
          {@const edgeStrokeWidth = getEdgeStrokeWidth(edge, isHovered, isDepth2Edge)}
          {@const edgeDashArray = getEdgeDashArray(edge, isDepth2Edge)}
          {@const edgeTooltip = getEdgeTooltip(edge)}
          <line
            class="graph-edge"
            class:edge-bidi={isBidi && !isDepth2Edge && !isHovered}
            class:edge-hovered-bidi={isHovered && isBidi}
            class:edge-hovered-out={isHovered && !isBidi && isCenterOut}
            class:edge-hovered-in={isHovered && !isBidi && isCenterIn}
            class:edge-hovered={isHovered && !isBidi && !isCenterOut && !isCenterIn}
            class:edge-depth2={isDepth2Edge && !isHovered}
            class:edge-out={!isBidi && isCenterOut && !isHovered}
            class:edge-in={!isBidi && isCenterIn && !isHovered}
            x1={sx}
            y1={sy}
            x2={tx}
            y2={ty}
            style:stroke-width={edgeStrokeWidth}
            stroke-dasharray={edgeDashArray}
            marker-end={isHovered ? (isBidi ? 'url(#arrow-hover-bidi)' : isCenterIn ? 'url(#arrow-hover-in)' : 'url(#arrow-hover-out)') : ''}
            marker-start={isHovered && isBidi ? 'url(#arrow-hover-bidi)' : ''}
          >
            {#if edgeTooltip}<title>{edgeTooltip}</title>{/if}
          </line>
        {/each}

        <!-- Nodes -->
        {#each simNodes as node}
          {@const nx = getNodeX(node)}
          {@const ny = getNodeY(node)}
          {@const isHovered = hoveredPath === node.path}
          {@const radius = getNodeRadius(node)}
          <g
            class="graph-node"
            class:center-node={node.isCenter}
            class:neighbor-node={!node.isCenter && node.depth === 1}
            class:depth2-node={node.depth === 2}
            class:node-hovered={isHovered}
            role="button"
            tabindex="0"
            aria-label={getFileName(node.path)}
            onmouseenter={() => (hoveredPath = node.path)}
            onmouseleave={() => (hoveredPath = null)}
            onpointerdown={(e: PointerEvent) => handleNodePointerDown(node.path, e)}
            onpointermove={handleNodePointerMove}
            onpointerup={handleNodePointerUp}
            onpointercancel={() => { draggedNodePath = null; didDragNode = false; }}
            oncontextmenu={(e: MouseEvent) => handleNodeContextMenu(node.path, e)}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onfileselect?.({ path: node.path }); }}
          >
            <circle
              cx={nx}
              cy={ny}
              r={radius}
            />
            {#if node.isCenter || isHovered}
              {@const labelText = getFileName(node.path)}
              {@const labelY = ny - (radius + 5)}
              {@const labelW = labelText.length * 5.5 + 8}
              {@const labelH = 14}
              <rect
                x={nx - labelW / 2}
                y={labelY - labelH + 2}
                width={labelW}
                height={labelH}
                rx="2"
                class="node-label-bg"
              />
              <text
                x={nx}
                y={labelY}
                text-anchor="middle"
                class="node-label"
                class:center-label={node.isCenter}
              >
                {labelText}
              </text>
            {/if}
          </g>
        {/each}
      </svg>

      <!-- Controls overlay — left -->
      <div class="graph-controls graph-controls-left">
        <button class="control-btn" title="Zoom in" onclick={zoomIn}>
          <span class="material-symbols-outlined">add</span>
        </button>
        <button class="control-btn" title="Zoom out" onclick={zoomOut}>
          <span class="material-symbols-outlined">remove</span>
        </button>
      </div>

      <!-- Controls overlay — right -->
      <div class="graph-controls graph-controls-right">
        <button class="control-btn" title="Spread out" onclick={spreadOut}>
          <span class="material-symbols-outlined">open_in_full</span>
        </button>
        <button class="control-btn" title="Spread in" onclick={spreadIn}>
          <span class="material-symbols-outlined">close_fullscreen</span>
        </button>
      </div>
    </div>
  {/if}

  <!-- Context menu -->
  {#if contextMenuPath}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="context-menu-backdrop" onclick={() => (contextMenuPath = null)} oncontextmenu={(e) => { e.preventDefault(); contextMenuPath = null; }}></div>
    <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px">
      <div class="context-menu-header">{contextMenuPath.split('/').pop()}</div>
      <button class="context-menu-item" onclick={handleContextMenuOpen}>
        <span class="material-symbols-outlined">open_in_new</span>
        Open file
      </button>
    </div>
  {/if}
</div>

<style>
  .local-graph {
    border-top: 1px solid var(--overlay-hover, rgba(255, 255, 255, 0.06));
    padding: 0;
  }

  .local-graph-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
  }

  .local-graph-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, rgba(228, 228, 231, 0.5));
  }

  .expand-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: var(--color-text-dim, rgba(228, 228, 231, 0.4));
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .expand-button:hover {
    color: var(--color-primary, #00e5ff);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
  }

  .expand-button .material-symbols-outlined {
    font-size: 16px;
  }

  .local-graph-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 120px;
    gap: 8px;
    color: var(--color-text-dim, rgba(228, 228, 231, 0.3));
  }

  .empty-icon {
    font-size: 24px;
  }

  .empty-text {
    font-size: 12px;
  }

  .graph-container {
    position: relative;
  }

  .local-graph-svg {
    width: 100%;
    height: 200px;
    display: block;
    cursor: grab;
  }

  .local-graph-svg.grabbing-cursor {
    cursor: grabbing;
  }

  .graph-controls {
    position: absolute;
    bottom: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .graph-controls-left {
    left: 6px;
  }

  .graph-controls-right {
    right: 6px;
  }

  .control-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-surface-elevated, #1e1e24) 85%, transparent);
    color: var(--color-text-dim, rgba(228, 228, 231, 0.5));
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }

  .control-btn:hover {
    color: var(--color-primary, #00e5ff);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.12));
  }

  .control-btn .material-symbols-outlined {
    font-size: 14px;
  }

  .graph-edge {
    stroke: var(--overlay-active, rgba(255, 255, 255, 0.15));
  }

  .graph-edge.edge-out {
    stroke: var(--color-primary, #00E5FF);
    opacity: 0.6;
  }

  .graph-edge.edge-in {
    stroke: var(--color-edge-in, #FF6B6B);
    opacity: 0.6;
  }

  .graph-edge.edge-depth2 {
    stroke: var(--overlay-border, rgba(255, 255, 255, 0.08));
  }

  .graph-edge.edge-hovered {
    stroke: var(--color-primary, #00E5FF);
    opacity: 1;
  }

  .graph-edge.edge-hovered-out {
    stroke: var(--color-primary, #00E5FF);
    opacity: 1;
  }

  .graph-edge.edge-hovered-in {
    stroke: var(--color-edge-in, #FF6B6B);
    opacity: 1;
  }

  .graph-edge.edge-bidi {
    stroke: var(--color-edge-bidi, #51CF66);
    opacity: 0.6;
  }

  .graph-edge.edge-hovered-bidi {
    stroke: var(--color-edge-bidi, #51CF66);
    opacity: 1;
  }

  .graph-node {
    cursor: pointer;
  }

  .graph-node.center-node circle {
    fill: var(--color-primary, #00E5FF);
  }

  .graph-node.neighbor-node circle {
    fill: var(--color-neighbor, rgba(228, 228, 231, 0.4));
  }

  .graph-node.depth2-node circle {
    fill: var(--color-text-dim, rgba(228, 228, 231, 0.2));
  }

  .graph-node.node-hovered circle {
    stroke: var(--color-primary, #00E5FF);
    stroke-width: 1.5;
  }

  .node-label-bg {
    fill: color-mix(in srgb, var(--color-bg, #0f0f10) 85%, transparent);
    pointer-events: none;
  }

  .node-label {
    font-size: 11px;
    fill: var(--color-text-main, rgba(228, 228, 231, 0.85));
    pointer-events: none;
  }

  .node-label.center-label {
    fill: var(--color-text, #e4e4e7);
    font-weight: 600;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 1.5s linear infinite;
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
    min-width: 160px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .context-menu-header {
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: rgba(228, 228, 231, 0.5);
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
</style>
