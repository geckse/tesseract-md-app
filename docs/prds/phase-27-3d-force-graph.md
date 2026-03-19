# PRD: 3D Graph View (3d-force-graph Migration)

## Overview

Replace the Canvas 2D + d3-force graph renderer with `3d-force-graph`, a ThreeJS-based WebGL 3D force graph engine. The entire graph becomes an interactive 3D scene with orbit camera controls, 3D node spheres, directional arrow edges, transparent cluster enclosure spheres, and HTML overlay tooltips. Force simulation uses the built-in d3-force-3d engine (same algorithm family, extended to 3 dimensions).

This is a **complete replacement** of GraphView.svelte — the 2D canvas, d3-force simulation, manual rendering loop, and all 2D-specific code are removed.

## Problem Statement

The current 2D graph view has three limitations:

1. **Performance**: Canvas 2D rendering and CPU-based d3-force simulation block the main thread. The `simulation.tick(300)` warm-up freezes the UI. Frame times degrade above ~500 nodes.

2. **Layout quality**: In 2D, clusters collapse on top of each other — d3-force has no cluster awareness and only 2 dimensions to spread nodes. Adding a third dimension dramatically increases the available space for clusters to separate naturally.

3. **Immersion**: A flat 2D graph of a knowledge base feels like a diagram. A 3D graph feels like a navigable space — users can orbit around clusters, zoom into neighborhoods, and build spatial intuition about their vault's structure.

## Goals

- Full 3D force-directed graph rendered via WebGL (ThreeJS under the hood)
- Built-in d3-force-3d simulation (no manual tick loop, no warm-up freeze)
- Transparent cluster enclosure spheres that visually group related nodes
- Directional arrows on edges (document mode) with directional coloring (cyan out, red in, green bidi)
- Edge labels visible on hover showing relationship type and strength
- Preserve ALL existing interactions: click-to-select, click-to-open, drag, right-click context menu, Escape
- Preserve ALL visual features: cluster/folder/none coloring, semantic edge styling, node sizing by degree
- HTML overlays for legend, level switcher, badges, context menu
- Smooth 60fps at 2000+ nodes
- Document AND chunk mode support

## Non-Goals

- Sophisticated PBR shading or realistic lighting (simple Lambert/Phong is fine)
- VR/AR support
- Curved or bundled edges (straight lines with arrows)
- WebGPU (stick with WebGL via ThreeJS)
- Changes to LocalGraph.svelte sidebar widget (stays SVG + d3-force 2D)
- Changes to Rust backend or IPC channels

---

## Technical Design

### Dependencies

**Add**: `3d-force-graph` (MIT, ~latest)
**Remove**: `d3-force` from GraphView.svelte imports (stays for LocalGraph.svelte)

`3d-force-graph` bundles ThreeJS internally — no separate three.js install needed. It also includes `d3-force-3d` for the simulation engine.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│ GraphView.svelte (Container div, position: relative)  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 3d-force-graph WebGL Canvas (z-index: 0)         │ │
│  │  → ThreeJS Scene + WebGLRenderer                 │ │
│  │  → Node spheres (color, size, opacity, glow)     │ │
│  │  → Edge lines/cylinders + directional arrows     │ │
│  │  → Cluster enclosure spheres (transparent mesh)  │ │
│  │  → d3-force-3d simulation (built-in)             │ │
│  │  → Orbit camera controls (built-in)              │ │
│  │  → Node drag (built-in)                          │ │
│  │  → Raycaster hit detection (built-in)            │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ HTML Overlays (z-index: 1+, pointer-events: none)│ │
│  │  → Node tooltip (on hover, HTML content)         │ │
│  │  → Edge tooltip (on hover, HTML content)         │ │
│  │  → Legend panel (cluster/folder/edge types)       │ │
│  │  → Level switcher tabs (Document/Chunk)           │ │
│  │  → Path filter badge, folder highlight badge      │ │
│  │  → Context menu (right-click, pointer-events)     │ │
│  │  → Graph notices (no links, performance warning)  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
└──────────────────────────────────────────────────────┘
```

### File Changes

| File | Action | Scope |
|------|--------|-------|
| `app/src/renderer/components/GraphView.svelte` | **Rewrite** | Replace Canvas 2D + d3-force with 3d-force-graph + HTML overlays |
| `app/src/renderer/lib/graph-3d-bridge.ts` | **New** | Data conversion (GraphData → 3d-force-graph format), color computation, cluster sphere geometry |
| `app/src/renderer/lib/edge-utils.ts` | **Modify** | Keep color/width/visibility utils. Remove `pointToSegmentDist` (raycaster handles hit detection). Add 3D-specific helpers. |
| `app/src/renderer/lib/convex-hull.ts` | **Keep but unused** | Not needed for 3D (cluster spheres replace 2D hulls). Keep for LocalGraph.svelte. |
| `app/src/renderer/stores/graph.ts` | **Keep** | No changes — stores work identically |
| `app/src/renderer/components/GraphPreview.svelte` | **Keep** | Side panel unchanged |
| `app/src/renderer/components/LocalGraph.svelte` | **Keep** | Stays SVG + d3-force 2D |
| `app/src/renderer/types/cli.ts` | **Keep** | Data types unchanged |

### 1. Graph Initialization

```typescript
import ForceGraph3D from '3d-force-graph';

// In onMount:
const graph = new ForceGraph3D(containerEl, {
  controlType: 'orbit',
  rendererConfig: { antialias: true, alpha: true },
})
  .backgroundColor('#0a0a0b')
  .showNavInfo(false)
  .nodeId('id')
  .linkSource('source')
  .linkTarget('target')

  // Node styling
  .nodeVal(d => nodeSizeValue(d))
  .nodeColor(d => nodeColor(d, coloringMode))
  .nodeOpacity(0.9)
  .nodeResolution(12)
  .nodeLabel(d => nodeTooltipHtml(d))

  // Edge styling
  .linkColor(d => edgeLinkColor(d, selectedNode))
  .linkWidth(d => edgeLinkWidth(d))
  .linkOpacity(0.4)
  .linkLabel(d => edgeTooltipHtml(d))

  // Directional arrows (document mode)
  .linkDirectionalArrowLength(d => isDocumentMode ? 4 : 0)
  .linkDirectionalArrowColor(d => edgeArrowColor(d, selectedNode))
  .linkDirectionalArrowRelPos(0.85)

  // Directional particles (optional: animated flow)
  .linkDirectionalParticles(d => hasSelection && isNeighborEdge(d) ? 2 : 0)
  .linkDirectionalParticleSpeed(0.005)
  .linkDirectionalParticleWidth(1.5)
  .linkDirectionalParticleColor(d => edgeArrowColor(d, selectedNode))

  // Force engine
  .d3AlphaDecay(0.02)
  .d3VelocityDecay(0.4)
  .warmupTicks(100)
  .cooldownTime(5000)

  // Interactions
  .onNodeClick(handleNodeClick)
  .onNodeRightClick(handleNodeRightClick)
  .onNodeHover(handleNodeHover)
  .onNodeDragEnd(handleNodeDragEnd)
  .onLinkClick(handleLinkClick)
  .onLinkHover(handleLinkHover)
  .onBackgroundClick(handleBackgroundClick)
  .onBackgroundRightClick(handleBackgroundRightClick)
  .enableNodeDrag(true)
  .enableNavigationControls(true);
```

### 2. Data Bridge (`graph-3d-bridge.ts`)

Convert our `GraphData` to the format 3d-force-graph expects:

```typescript
interface Graph3DData {
  nodes: Graph3DNode[];
  links: Graph3DLink[];
}

interface Graph3DNode {
  id: string;
  path: string;
  label: string | null;
  cluster_id: number | null;
  chunk_index: number | null;
  size: number | null;
  // Computed:
  val: number;           // sphere volume (from degree or content size)
  color: string;         // hex color based on coloring mode
  __dimmed?: boolean;    // flag for selection dimming
}

interface Graph3DLink {
  source: string;
  target: string;
  weight: number | null;
  relationship_type?: string | null;
  strength?: number | null;
  context_text?: string | null;
  edge_cluster_id?: number | null;
  // Computed:
  color: string;         // edge color
  width: number;         // edge width from strength
}

function buildGraph3DData(
  data: GraphData,
  coloringMode: GraphColoringMode,
  edgeFilter: Set<number>,
  selectedNode: GraphNode | null,
  level: GraphLevel
): Graph3DData
```

**Node values (sphere size)**:
- Document mode: degree-based. `val = 1 + degree * 2` (quadratic volume scaling by 3d-force-graph)
- Chunk mode: content-size-based. `val = 1 + (size / maxSize) * 8`

**Node colors**: Same palette logic as current — 12-color cluster palette, folder hash, or per-file hash.

**Edge filtering**: Excluded edges (by `graphEdgeFilter`) are omitted from the links array entirely.

**Edge colors**: Same directional logic — cyan (out), red (in), green (bidi) for selected node neighbors. Semantic cluster coloring for unselected edges. Dimmed gray for non-neighbor edges during selection.

### 3. Cluster Enclosure Spheres

Replace 2D convex hulls with 3D transparent spheres that enclose each cluster's nodes.

**Implementation**: Use ThreeJS `scene()` access to add custom `Mesh` objects:

```typescript
function updateClusterSpheres(graph: ForceGraph3DInstance, nodes: Graph3DNode[], clusters: GraphCluster[]) {
  // Remove previous cluster meshes
  clearClusterMeshes(scene);

  // Group nodes by cluster_id
  const clusterGroups = groupByCluster(nodes);

  for (const [clusterId, clusterNodes] of clusterGroups) {
    // Compute 3D centroid
    const cx = avg(clusterNodes.map(n => n.x));
    const cy = avg(clusterNodes.map(n => n.y));
    const cz = avg(clusterNodes.map(n => n.z));

    // Compute enclosing radius (max distance from centroid + padding)
    const maxDist = Math.max(...clusterNodes.map(n =>
      Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2)
    ));
    const radius = maxDist + 20; // padding

    // Create transparent sphere
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshLambertMaterial({
      color: clusterPaletteColor(clusterId),
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,  // render inside faces so visible from within
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, cz);
    scene.add(mesh);

    // Optional: wireframe outline for definition
    const wireGeo = new THREE.SphereGeometry(radius, 16, 12);
    const wireMat = new THREE.MeshBasicMaterial({
      color: clusterPaletteColor(clusterId),
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    wireMesh.position.set(cx, cy, cz);
    scene.add(wireMesh);
  }
}
```

**Update frequency**: Recompute on `onEngineTick` every ~30 ticks (throttled), and once on `onEngineStop`.

**Cluster labels**: Use CSS2DRenderer (via `extraRenderers`) to render cluster name labels at each sphere centroid. These track with 3D position but render as crisp HTML text.

### 4. Interaction Porting

**Node click (select/open)** — direct mapping:
```typescript
function handleNodeClick(node: Graph3DNode | null, event: MouseEvent) {
  if (!node) { selectGraphNode(null); return; }
  const graphNode = toGraphNode(node);
  const alreadySelected = currentSelected?.path === node.path;
  if (alreadySelected) {
    openGraphNode(graphNode);  // Second click → open side panel
  } else {
    selectGraphNode(graphNode);  // First click → select only
  }
  updateVisualState(); // recolor nodes/edges for selection
}
```

**Node right-click context menu**:
```typescript
function handleNodeRightClick(node: Graph3DNode, event: MouseEvent) {
  event.preventDefault();
  contextMenuNode = toGraphNode(node);
  contextMenuX = event.clientX;
  contextMenuY = event.clientY;
}
```

**Node hover tooltip**: Use `nodeLabel()` accessor returning HTML string. 3d-force-graph renders this as a floating div automatically.

**Edge hover tooltip**: Use `linkLabel()` accessor returning HTML string with relationship type, strength bar, and context text excerpt.

**Edge click**: Use `onLinkClick()` for edge selection/info display.

**Node drag**: Built-in (`enableNodeDrag: true`). `onNodeDragEnd` can be used to pin nodes if desired.

**Background click**: `onBackgroundClick()` → clear selection.

**Keyboard (Escape)**: `keydown` listener on container div — clear selection, close context menu.

**Camera controls**: Built-in orbit controls. Scroll to zoom, drag to rotate, right-drag to pan.

### 5. Coloring Modes & Node Visual Meaning

On mode switch (`graphColoringMode` store change):
1. Recompute node colors in the data objects
2. Call `graph.nodeColor(d => newColorFn(d))` to trigger re-render
3. Update cluster spheres (add/remove based on cluster mode)
4. Rebuild legend HTML

Same 3 modes:
- **Cluster**: 12-color palette by `cluster_id`, cluster enclosure spheres visible, cluster labels at centroids
- **Folder**: Top-level folder extraction, per-folder color, no cluster spheres
- **None**: Per-file hash coloring, no cluster spheres

#### Node Glow for High-Degree Hubs

High-degree nodes (hubs) are the most important nodes in the graph. Use `nodeThreeObject` to add a glow effect:

```typescript
.nodeThreeObject(node => {
  const degree = degreeMap.get(node.id) ?? 0;
  if (degree < 5) return false; // use default sphere

  // Create sphere + point light for glow
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(node.__radius, 16, 12);
  const material = new THREE.MeshLambertMaterial({
    color: node.color,
    transparent: true,
    opacity: 0.9,
  });
  const sphere = new THREE.Mesh(geometry, material);
  group.add(sphere);

  // Subtle point light for glow
  const light = new THREE.PointLight(node.color, 0.5, node.__radius * 5);
  group.add(light);

  return group;
})
```

This makes hub documents visually prominent — they glow, drawing the eye to the most connected pieces of your knowledge base.

### 6. Selection Visual State

When a node is selected:
1. Compute neighbor set from edge data
2. Update node rendering:
   - Selected node: full opacity + slightly larger `val`
   - Neighbor nodes: full opacity
   - Other nodes: `nodeOpacity` reduced to 0.15 (dimmed)
3. Update edge rendering:
   - Neighbor edges: directional coloring (cyan/red/green) + arrows + particles
   - Other edges: very low opacity (0.05) or hidden
4. Update cluster spheres: only show the selected node's cluster sphere (if cluster mode)

Implementation: Set `nodeOpacity`, `nodeColor`, `linkColor`, `linkWidth`, `linkOpacity` accessor functions that read from selection state, then call `graph.refresh()` or re-set the accessors.

### 7. Document / Chunk Mode Switch

On level change:
1. Fetch new graph data from CLI (`mdvdb graph --json --level chunk`)
2. Rebuild Graph3DData from new GraphData
3. Update graph via `graph.graphData(newData)`
4. Reconfigure mode-specific settings:
   - Document: arrows enabled, degree-based sizing
   - Chunk: arrows disabled, size-based sizing, tighter forces
5. Update cluster spheres and legend

### 8. Edge Semantic Styling & Directionality

#### 8a. Directional Arrows (Document Mode)

Document mode edges are **directional** — they represent outgoing links from source to target. When a node is selected, edges are classified and colored:

- **Outgoing edges** (selected → neighbor): **Cyan** (`#00E5FF`). Arrow points toward target.
- **Incoming edges** (neighbor → selected): **Red** (`#FF6B6B`). Arrow points toward selected.
- **Bidirectional edges** (both files link to each other): **Green** (`#51CF66`). **Arrows on BOTH ends** — two `linkDirectionalArrowLength` entries, or rendered via `linkThreeObject` as a custom line with two arrowheads.

**Implementation for bidirectional arrows**: Since `3d-force-graph` only supports one arrow direction per link, bidirectional edges need special handling:
```typescript
// Option A: Duplicate bidirectional edges (one per direction)
// When building links array, if A→B and B→A both exist, keep both as separate links
// Each renders with its own arrow naturally

// Option B: Custom linkThreeObject for bidi edges
.linkThreeObject(link => {
  if (link.__bidi) {
    // Create custom geometry with arrows on both ends
    return createBidirectionalArrowLine(link);
  }
  return false; // use default for non-bidi
})
```

Option A (duplicate links) is simpler and recommended — it naturally produces two arrows.

**Directional particles**: When a node is selected, animate particles on neighbor edges to show information flow direction:
```typescript
.linkDirectionalParticles(link => {
  if (!selectedNode) return 0;
  const isOut = link.source.id === selectedNode.id;
  const isIn = link.target.id === selectedNode.id;
  return (isOut || isIn) ? 2 : 0;
})
.linkDirectionalParticleSpeed(0.005)
.linkDirectionalParticleWidth(1.5)
.linkDirectionalParticleColor(link => edgeArrowColor(link, selectedNode))
```

#### 8b. Chunk Mode Edges (No Arrows)

Chunk mode edges represent **symmetric similarity** — no directionality. All edges rendered as simple lines, colored by weight.

#### 8c. Semantic Edge Properties

**Width**: `linkWidth(d => edgeLinkWidth(d))` — strength-mapped [0.5, 3.0] using `edgeLineWidth()` from `edge-utils.ts`
**Color**: `linkColor(d => edgeLinkColor(d))` — edge cluster color palette from `edgeClusterColor()`
**Weak edges**: Low opacity instead of dashed (3D lines don't support dash patterns). `linkOpacity` or per-link color alpha channel.

#### 8d. Edge Labels on Hover

```typescript
.linkLabel(link => {
  if (!link.relationship_type && !link.strength) return '';
  const type = link.relationship_type ? `<div class="edge-label-type">${link.relationship_type}</div>` : '';
  const strength = link.strength != null
    ? `<div class="edge-label-strength">Strength: ${Math.round(link.strength * 100)}%</div>`
    : '';
  const context = link.context_text
    ? `<div class="edge-label-context">${link.context_text.slice(0, 120)}${link.context_text.length > 120 ? '…' : ''}</div>`
    : '';
  return `<div class="edge-label">${type}${strength}${context}</div>`;
})
```

### 9. Cluster-Aware Force Configuration

The current 2D graph places nodes randomly (`Math.random() * width/height`) and has zero cluster awareness. This is the root cause of the "hairball" layout. The 3D migration must fix this with cluster-aware seeding and forces, adapted from Phase 25's analysis.

#### 9a. Cluster-Aware Initial Seeding (Pre-simulation)

Before feeding data to the graph, pre-compute initial positions:

```typescript
function seedClusterPositions(nodes: Graph3DNode[], clusters: GraphCluster[]): void {
  // Arrange K cluster centroids on a sphere surface (Fibonacci sphere)
  const K = clusters.length || 1;
  const spreadRadius = 200; // graph-space units
  const clusterCentroids = new Map<number, {x: number, y: number, z: number}>();

  for (let i = 0; i < K; i++) {
    // Fibonacci sphere: evenly distributed points on a sphere
    const phi = Math.acos(1 - 2 * (i + 0.5) / K);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    clusterCentroids.set(clusters[i]?.id ?? i, {
      x: spreadRadius * Math.sin(phi) * Math.cos(theta),
      y: spreadRadius * Math.sin(phi) * Math.sin(theta),
      z: spreadRadius * Math.cos(phi),
    });
  }

  // Place each node near its cluster centroid using golden-angle spiral
  const clusterCounters = new Map<number, number>();
  for (const node of nodes) {
    if (node.cluster_id != null && clusterCentroids.has(node.cluster_id)) {
      const center = clusterCentroids.get(node.cluster_id)!;
      const idx = clusterCounters.get(node.cluster_id) ?? 0;
      clusterCounters.set(node.cluster_id, idx + 1);

      // 3D golden-angle spiral around centroid
      const goldenAngle = 2.399963;
      const r = 15 * Math.sqrt(idx); // spacing
      const theta = idx * goldenAngle;
      const phi = idx * goldenAngle * 0.7; // offset for 3D spread
      node.x = center.x + r * Math.sin(phi) * Math.cos(theta);
      node.y = center.y + r * Math.sin(phi) * Math.sin(theta);
      node.z = center.z + r * Math.cos(phi);
    } else {
      // Unclustered: center with random jitter
      node.x = (Math.random() - 0.5) * 100;
      node.y = (Math.random() - 0.5) * 100;
      node.z = (Math.random() - 0.5) * 100;
    }
  }
}
```

This gives the simulation spatially separated clusters **before tick 1**.

#### 9b. Document Mode Forces — Knowledge Graph of Files

Document mode represents the **knowledge graph**: each node is a file, each edge is a link reference between files. The layout should reveal which documents are intellectually related and how information flows.

```typescript
// Cluster-aware link distances
graph.d3Force('link')
  .distance(link => {
    const sCluster = link.source.cluster_id;
    const tCluster = link.target.cluster_id;
    if (sCluster != null && tCluster != null && sCluster === tCluster) return 50;  // same cluster: tight
    if (sCluster != null && tCluster != null) return 150;  // different clusters: far apart
    return 100;  // unclustered
  })
  .strength(0.3);

// Degree-dependent repulsion: hubs push harder, preventing center collapse
graph.d3Force('charge')
  .strength(node => Math.max(-300, -80 - (degreeMap.get(node.id) ?? 0) * 5))
  .distanceMax(500)
  .theta(0.8);

// Cluster attraction: custom force pulling nodes toward live cluster centroids
// Use d3Force to add forceX/forceY/forceZ targeting cluster centroids
graph.d3Force('clusterX', d3.forceX().x(node => {
  return clusterCentroids.get(node.cluster_id)?.x ?? 0;
}).strength(node => node.cluster_id != null ? 0.15 : 0.02));
graph.d3Force('clusterY', d3.forceY().y(node => {
  return clusterCentroids.get(node.cluster_id)?.y ?? 0;
}).strength(node => node.cluster_id != null ? 0.15 : 0.02));
graph.d3Force('clusterZ', d3.forceZ().z(node => {
  return clusterCentroids.get(node.cluster_id)?.z ?? 0;
}).strength(node => node.cluster_id != null ? 0.15 : 0.02));

// Remove forceCenter — it fights cluster separation
// The cluster attraction forces provide centering for clustered nodes
// Unclustered nodes get weak 0.02 pull toward origin

graph.d3AlphaDecay(0.02)
  .d3VelocityDecay(0.4)
  .warmupTicks(100)
  .cooldownTime(5000);
```

**Semantic meaning**: In document mode, you're looking at your vault's intellectual structure. Clusters = topic groups. Arrows = information flow direction. Hub nodes (large spheres) = central documents that connect multiple topics. Isolated nodes = orphan files.

#### 9c. Chunk Mode Forces — Content Similarity

Chunk mode represents **content similarity**: each node is a section of a document, edges connect semantically similar content. The layout should reveal which ideas across your vault are related at a content level.

```typescript
// Chunk mode: tighter, no directional arrows (similarity is symmetric)
graph.d3Force('link')
  .distance(link => {
    const sCluster = link.source.cluster_id;
    const tCluster = link.target.cluster_id;
    if (sCluster != null && tCluster != null && sCluster === tCluster) return 30;
    if (sCluster != null && tCluster != null) return 100;
    return 60;
  })
  .strength(0.5);

graph.d3Force('charge')
  .strength(-80)
  .distanceMax(300);

// Same cluster attraction forces but tighter
graph.d3Force('clusterX', d3.forceX().x(node => {
  return clusterCentroids.get(node.cluster_id)?.x ?? 0;
}).strength(node => node.cluster_id != null ? 0.2 : 0.02));
// ... same for Y, Z

graph.d3AlphaDecay(0.03)
  .d3VelocityDecay(0.4)
  .warmupTicks(80)
  .cooldownTime(4000);
```

**Semantic meaning**: In chunk mode, you're looking at your vault's idea landscape. Clusters = concept groups. Node size = content volume. Edge opacity = semantic similarity strength. Nodes from the same file share color — revealing how a single document spans multiple concept clusters.

#### 9d. Live Cluster Centroid Recomputation

During simulation, recompute cluster centroids from actual node positions so the cluster attraction forces track where clusters actually settle:

```typescript
graph.onEngineTick(() => {
  // Recompute centroids every 10 ticks (throttled)
  tickCount++;
  if (tickCount % 10 !== 0) return;

  const sums = new Map<number, {sx: number, sy: number, sz: number, count: number}>();
  for (const node of nodes) {
    if (node.cluster_id == null) continue;
    const s = sums.get(node.cluster_id) ?? {sx: 0, sy: 0, sz: 0, count: 0};
    s.sx += node.x; s.sy += node.y; s.sz += node.z; s.count++;
    sums.set(node.cluster_id, s);
  }
  for (const [id, s] of sums) {
    clusterCentroids.set(id, {
      x: s.sx / s.count,
      y: s.sy / s.count,
      z: s.sz / s.count,
    });
  }

  // Also update cluster spheres periodically
  updateClusterSpheres(graph, nodes, clusters);
});
```

The 3rd dimension naturally provides better cluster separation — nodes have 3x the degrees of freedom to spread out. Combined with cluster-aware seeding and attraction forces, this produces dramatically better layouts than the current random-seeded 2D approach.

### 10. Camera Utilities

**Zoom to fit**: `graph.zoomToFit(400, 50)` on initial load and data change.

**Focus on node**: When selecting a node, optionally animate camera:
```typescript
const distance = 200;
const { x, y, z } = node;
graph.cameraPosition(
  { x: x + distance, y: y + distance, z: z + distance },
  { x, y, z },  // lookAt
  1000           // ms transition
);
```

**Coordinate conversion**: `graph.graph2ScreenCoords(x, y, z)` for positioning HTML overlays at node locations.

### 11. Resize Handling

`ResizeObserver` on container:
```typescript
graph.width(containerEl.clientWidth).height(containerEl.clientHeight);
```

### 12. Performance Safeguards

**Large graphs (>500 nodes)**:
- Reduce `nodeResolution` to 6 (fewer polygons per sphere)
- Disable `linkDirectionalParticles`
- Reduce `cooldownTime` to 3000ms
- Show performance notice

**Very large graphs (>2000 nodes)**:
- Set `linkWidth(0)` → renders as ThreeJS Line (constant 1px, much cheaper)
- Reduce `nodeOpacity` to differentiate density
- Disable edge labels on hover

**Selection dimming**: Only recolor visible nodes (viewport frustum check via `getGraphBbox`).

---

## Migration Strategy

### Phase A: Core 3D Rendering (MVP)
1. Install `3d-force-graph`
2. Create `graph-3d-bridge.ts` with data conversion
3. Rewrite GraphView.svelte: init graph, feed data, basic node/edge rendering
4. Port click-to-select, click-to-open, Escape, background click
5. Port node coloring (cluster/folder/none modes)
6. Port document/chunk mode switching
7. **Milestone**: 3D graph renders, nodes clickable, orbit camera works

### Phase B: Visual Features
8. Add cluster enclosure spheres (transparent + wireframe)
9. Add directional arrows on edges
10. Add directional particles for selected node edges
11. Port semantic edge styling (width by strength, color by cluster)
12. Port selection dimming (opacity reduction for non-neighbors)
13. Add edge labels on hover (relationship type, strength, context)
14. Add node labels on hover (path, cluster, heading)
15. **Milestone**: Full visual feature parity in 3D

### Phase C: Interactions & Overlays
16. Port right-click context menu (HTML overlay)
17. Port legend panel (cluster, folder, edge type filtering)
18. Port level switcher tabs
19. Port path filter badge and folder highlight badge
20. Port graph notices (no links, performance warnings)
21. Add camera zoom-to-fit on data load
22. Add optional camera focus animation on node select
23. **Milestone**: Full interaction parity, polish complete

---

## Acceptance Criteria

- [ ] Graph renders in 3D via WebGL (ThreeJS / 3d-force-graph)
- [ ] Force simulation runs via d3-force-3d (no manual tick loop)
- [ ] 3D orbit camera controls: rotate (drag), zoom (scroll), pan (right-drag)
- [ ] Clusters form spatially separated groups (cluster-aware seeding + attraction forces)
- [ ] Cluster enclosure spheres visible in cluster coloring mode (transparent + wireframe)
- [ ] Cluster labels rendered at sphere centroids via CSS2DRenderer
- [ ] Click node → select (first click). Click selected → open side panel (second click)
- [ ] Node drag works (built-in)
- [ ] Right-click context menu on nodes
- [ ] Escape clears selection and context menu
- [ ] Cluster / folder / none coloring modes all work
- [ ] Edge directional arrows: cyan (out), red (in), green (bidi with arrows on BOTH ends) in document mode
- [ ] Edge labels on hover: relationship type, strength, context excerpt
- [ ] Semantic edge styling: width by strength, color by edge cluster
- [ ] Weak edges rendered at low opacity
- [ ] Directional particles animate on selected node's edges
- [ ] Edge filtering by cluster (toggle visibility)
- [ ] Selection dimming: non-neighbor nodes/edges fade
- [ ] Hub nodes glow (degree ≥ 5, point light effect)
- [ ] Document mode: knowledge graph layout with degree-dependent repulsion
- [ ] Chunk mode: content similarity layout with symmetric edges, no arrows
- [ ] Legend panel with cluster/folder items + edge type filtering
- [ ] Level switcher tabs, path filter badge, folder highlight badge
- [ ] Node hover tooltip (path, cluster label, heading in chunk mode)
- [ ] Side panel (GraphPreview) works on node open
- [ ] 60fps at 2000+ nodes
- [ ] LocalGraph.svelte sidebar widget unaffected (stays 2D SVG + d3-force)
- [ ] Background color matches app theme (#0a0a0b)
- [ ] No random initial placement — Fibonacci sphere seeding by cluster

## Verification

1. `cd app && npm install 3d-force-graph && npm run dev`
2. Open collection with multiple clusters
3. Graph renders in 3D with orbit controls
4. Rotate, zoom, pan all work smoothly
5. Clusters visually separated in 3D space (not overlapping)
6. Cluster enclosure spheres visible with labels in cluster coloring mode
7. Click, drag, right-click, Escape all work
8. Toggle cluster/folder/none coloring
9. Switch Document/Chunk mode — arrows present in document, absent in chunk
10. Select node → dimming + directional arrows (cyan/red/green) + particles
11. Hover edge → label with relationship type, strength, context
12. Bidirectional edges show arrows on both ends (green)
13. Hub nodes (high degree) glow visibly
14. Toggle edge type filters in legend
15. Large graph (500+ nodes) stays responsive
16. LocalGraph sidebar widget unchanged
