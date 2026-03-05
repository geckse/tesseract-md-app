<script lang="ts">
  import { onDestroy } from 'svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
  import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
  import type { LinksOutput, BacklinksOutput } from '../types/cli';

  interface LocalGraphProps {
    centerPath: string | null;
    linksInfo: LinksOutput | null;
    backlinksInfo: BacklinksOutput | null;
    onfileselect?: (detail: { path: string }) => void;
    onexpand?: () => void;
  }

  let { centerPath, linksInfo, backlinksInfo, onfileselect, onexpand }: LocalGraphProps = $props();

  interface LocalNode extends SimulationNodeDatum {
    path: string;
    isCenter: boolean;
    x: number;
    y: number;
  }

  interface LocalEdge extends SimulationLinkDatum<LocalNode> {
    source: LocalNode | string;
    target: LocalNode | string;
  }

  interface LocalGraph {
    nodes: LocalNode[];
    edges: LocalEdge[];
  }

  const WIDTH = 250;
  const HEIGHT = 200;
  const CENTER_RADIUS = 6;
  const NEIGHBOR_RADIUS = 4;
  const CENTER_COLOR = '#00E5FF';
  const NEIGHBOR_COLOR = 'rgba(228, 228, 231, 0.4)';
  const EDGE_COLOR = 'rgba(255, 255, 255, 0.15)';
  const EDGE_HOVER_COLOR = '#00E5FF';

  let simNodes: LocalNode[] = $state([]);
  let simEdges: LocalEdge[] = $state([]);
  let hoveredPath: string | null = $state(null);
  let simulation: Simulation<LocalNode, LocalEdge> | null = null;

  function getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  function buildLocalGraph(
    center: string | null,
    links: LinksOutput | null,
    backlinks: BacklinksOutput | null,
  ): LocalGraph {
    if (!center) return { nodes: [], edges: [] };

    const nodeMap = new Map<string, LocalNode>();

    // Center node
    nodeMap.set(center, {
      path: center,
      isCenter: true,
      x: WIDTH / 2,
      y: HEIGHT / 2,
    });

    const edges: LocalEdge[] = [];

    // Outgoing links (center -> target)
    if (links?.links?.outgoing) {
      for (const resolved of links.links.outgoing) {
        if (resolved.state !== 'Valid') continue;
        const target = resolved.entry.target;
        if (target === center) continue; // skip self-links
        if (!nodeMap.has(target)) {
          nodeMap.set(target, {
            path: target,
            isCenter: false,
            x: WIDTH / 2 + (Math.random() - 0.5) * 100,
            y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
          });
        }
        edges.push({ source: center, target });
      }
    }

    // Incoming backlinks (source -> center)
    if (backlinks?.backlinks) {
      for (const resolved of backlinks.backlinks) {
        if (resolved.state !== 'Valid') continue;
        const source = resolved.entry.source;
        if (source === center) continue;
        if (!nodeMap.has(source)) {
          nodeMap.set(source, {
            path: source,
            isCenter: false,
            x: WIDTH / 2 + (Math.random() - 0.5) * 100,
            y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
          });
        }
        // Avoid duplicate edges
        const alreadyExists = edges.some(
          (e) =>
            (e.source === source && e.target === center) ||
            (e.source === center && e.target === source),
        );
        if (!alreadyExists) {
          edges.push({ source, target: center });
        }
      }
    }

    return { nodes: Array.from(nodeMap.values()), edges };
  }

  function runSimulation(graph: LocalGraph) {
    if (simulation) simulation.stop();

    if (graph.nodes.length === 0) {
      simNodes = [];
      simEdges = [];
      return;
    }

    simNodes = graph.nodes;

    simulation = forceSimulation<LocalNode>(simNodes)
      .force(
        'link',
        forceLink<LocalNode, LocalEdge>(graph.edges)
          .id((d) => d.path)
          .distance(60)
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

    // Capture resolved edges
    simEdges = graph.edges as LocalEdge[];
    // Trigger reactivity
    simNodes = [...simNodes];
  }

  // Rebuild graph when inputs change
  $effect(() => {
    const graph = buildLocalGraph(centerPath, linksInfo, backlinksInfo);
    runSimulation(graph);
  });

  onDestroy(() => {
    if (simulation) simulation.stop();
  });

  function handleNodeClick(path: string) {
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

  let hasLinks = $derived(simNodes.length > 1);
</script>

<div class="local-graph">
  <div class="local-graph-header">
    <span class="local-graph-title">Graph</span>
    {#if onexpand && hasLinks}
      <button class="expand-button" title="Open full graph" onclick={onexpand}>
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
    <svg
      class="local-graph-svg"
      viewBox="0 0 {WIDTH} {HEIGHT}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- Edges -->
      {#each simEdges as edge}
        {@const src = getEdgeSource(edge)}
        {@const tgt = getEdgeTarget(edge)}
        {@const isHovered =
          hoveredPath === src.path || hoveredPath === tgt.path}
        <line
          x1={getNodeX(src)}
          y1={getNodeY(src)}
          x2={getNodeX(tgt)}
          y2={getNodeY(tgt)}
          stroke={isHovered ? EDGE_HOVER_COLOR : EDGE_COLOR}
          stroke-width={isHovered ? 1.5 : 0.5}
        />
      {/each}

      <!-- Nodes -->
      {#each simNodes as node}
        {@const nx = getNodeX(node)}
        {@const ny = getNodeY(node)}
        {@const isHovered = hoveredPath === node.path}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="graph-node"
          onmouseenter={() => (hoveredPath = node.path)}
          onmouseleave={() => (hoveredPath = null)}
          onclick={() => handleNodeClick(node.path)}
        >
          <circle
            cx={nx}
            cy={ny}
            r={node.isCenter ? CENTER_RADIUS : NEIGHBOR_RADIUS}
            fill={node.isCenter ? CENTER_COLOR : NEIGHBOR_COLOR}
            stroke={isHovered ? CENTER_COLOR : 'none'}
            stroke-width={isHovered ? 1.5 : 0}
          />
          {#if node.isCenter || isHovered}
            <text
              x={nx}
              y={ny - (node.isCenter ? CENTER_RADIUS + 4 : NEIGHBOR_RADIUS + 4)}
              text-anchor="middle"
              class="node-label"
              class:center-label={node.isCenter}
            >
              {getFileName(node.path)}
            </text>
          {/if}
        </g>
      {/each}
    </svg>
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

  .local-graph-svg {
    width: 100%;
    height: 200px;
    display: block;
  }

  .graph-node {
    cursor: pointer;
  }

  .node-label {
    font-size: 9px;
    fill: rgba(228, 228, 231, 0.6);
    pointer-events: none;
  }

  .node-label.center-label {
    fill: rgba(228, 228, 231, 0.9);
    font-weight: 500;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 1.5s linear infinite;
  }
</style>
