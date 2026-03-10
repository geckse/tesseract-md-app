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
  const CENTER_RADIUS = 6;
  const NEIGHBOR_RADIUS = 4;
  const DEPTH2_RADIUS = 3;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.25;
  const MIN_SPREAD = 30;
  const MAX_SPREAD = 150;
  const SPREAD_STEP = 15;

  let simNodes: LocalNode[] = $state([]);
  let simEdges: LocalEdge[] = $state([]);
  let hoveredPath: string | null = $state(null);
  let simulation: Simulation<LocalNode, LocalEdge> | null = null;

  // Zoom & pan state
  let zoom: number = $state(1);
  let panX: number = $state(0);
  let panY: number = $state(0);
  let panMode: boolean = $state(false);
  let isPanning: boolean = $state(false);
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;
  let svgEl: SVGSVGElement | undefined = $state(undefined);

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

  function togglePanMode() {
    panMode = !panMode;
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
    if (!panMode) return;
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
    if (node.depth === 2) return DEPTH2_RADIUS;
    return NEIGHBOR_RADIUS;
  }

  function runSimulation(graph: LocalGraphData) {
    if (simulation) simulation.stop();
    lastGraphData = graph;

    if (graph.nodes.length === 0) {
      simNodes = [];
      simEdges = [];
      return;
    }

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
      .force('collide', forceCollide<LocalNode>(12))
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
    panMode = false;
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

    // Try single neighborhood call (depth 2) — replaces N+1 fetch pattern
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

  function handleNodeClick(path: string) {
    if (panMode) return; // don't select nodes while panning
    onfileselect?.({ path });
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
        class:pan-cursor={panMode}
        class:grabbing-cursor={isPanning}
        viewBox={viewBox()}
        xmlns="http://www.w3.org/2000/svg"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
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
            marker-end={isHovered ? (isBidi ? 'url(#arrow-hover-bidi)' : isCenterIn ? 'url(#arrow-hover-in)' : 'url(#arrow-hover-out)') : ''}
            marker-start={isHovered && isBidi ? 'url(#arrow-hover-bidi)' : ''}
          />
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
            onclick={() => handleNodeClick(node.path)}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') handleNodeClick(node.path); }}
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
        <button
          class="control-btn"
          class:control-active={panMode}
          title="Pan mode"
          onclick={togglePanMode}
        >
          <span class="material-symbols-outlined">pan_tool</span>
        </button>
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
</div>

<style>
  .local-graph {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
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
    color: rgba(228, 228, 231, 0.5);
  }

  .expand-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: rgba(228, 228, 231, 0.4);
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .expand-button:hover {
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.08);
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
    color: rgba(228, 228, 231, 0.3);
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
  }

  .local-graph-svg.pan-cursor {
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
    background: rgba(30, 30, 36, 0.85);
    color: rgba(228, 228, 231, 0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }

  .control-btn:hover {
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.12);
  }

  .control-btn.control-active {
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.15);
  }

  .control-btn .material-symbols-outlined {
    font-size: 14px;
  }

  .graph-edge {
    stroke: rgba(255, 255, 255, 0.15);
    stroke-width: 0.5;
  }

  .graph-edge.edge-out {
    stroke: var(--color-primary, #00E5FF);
    stroke-width: 0.8;
    opacity: 0.6;
  }

  .graph-edge.edge-in {
    stroke: var(--color-edge-in, #FF6B6B);
    stroke-width: 0.8;
    opacity: 0.6;
  }

  .graph-edge.edge-depth2 {
    stroke: rgba(255, 255, 255, 0.08);
    stroke-width: 0.3;
  }

  .graph-edge.edge-hovered {
    stroke: var(--color-primary, #00E5FF);
    stroke-width: 1.5;
    opacity: 1;
  }

  .graph-edge.edge-hovered-out {
    stroke: var(--color-primary, #00E5FF);
    stroke-width: 1.5;
    opacity: 1;
  }

  .graph-edge.edge-hovered-in {
    stroke: var(--color-edge-in, #FF6B6B);
    stroke-width: 1.5;
    opacity: 1;
  }

  .graph-edge.edge-bidi {
    stroke: var(--color-edge-bidi, #51CF66);
    stroke-width: 0.8;
    opacity: 0.6;
  }

  .graph-edge.edge-hovered-bidi {
    stroke: var(--color-edge-bidi, #51CF66);
    stroke-width: 1.5;
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
    fill: rgba(228, 228, 231, 0.2);
  }

  .graph-node.node-hovered circle {
    stroke: var(--color-primary, #00E5FF);
    stroke-width: 1.5;
  }

  .node-label-bg {
    fill: rgba(15, 15, 16, 0.85);
    pointer-events: none;
  }

  .node-label {
    font-size: 11px;
    fill: rgba(228, 228, 231, 0.85);
    pointer-events: none;
  }

  .node-label.center-label {
    fill: #e4e4e7;
    font-weight: 600;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 1.5s linear infinite;
  }
</style>
