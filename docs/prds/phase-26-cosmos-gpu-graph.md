# PRD: GPU-Accelerated Graph View (Cosmos.gl Migration)

## Overview

Replace the Canvas 2D + d3-force graph renderer with Cosmos.gl (`@cosmos.gl/graph`), a GPU-accelerated WebGL force graph engine. All force simulation and node/edge rendering moves to the GPU. Cluster hulls render on a synced Canvas 2D overlay. HTML overlays handle tooltips, legend, badges, and context menu.

This eliminates the current performance bottleneck (Canvas 2D + CPU-based d3-force) and adds native cluster force support, solving the "hairball" layout problem where clusters overlap.

## Problem Statement

The current graph view has two fundamental issues:

1. **Performance**: Canvas 2D rendering and CPU-based d3-force simulation block the main thread. The `simulation.tick(300)` warm-up freezes the UI. Frame times degrade above ~500 nodes. Interaction (drag, pan, zoom) competes with simulation ticks for CPU time.

2. **Layout quality**: d3-force has no cluster awareness. Nodes are seeded randomly and settle by link structure alone, producing overlapping clusters. The Phase 25 PRD attempted to fix this with forceX/forceY cluster attraction — Cosmos.gl solves it natively with GPU-computed cluster forces.

## Goals

- All node/edge rendering on GPU via WebGL (Cosmos.gl)
- All force simulation on GPU (no CPU simulation ticks)
- Native cluster force for spatial separation (`setPointClusters()`)
- Preserve ALL existing interactions: click-to-select, click-to-open, drag, pan, zoom, right-click context menu, Escape
- Preserve ALL visual features: cluster/folder/none coloring, edge directionality (in/out/bidi), semantic edge styling, node sizing by degree
- Cluster convex hulls rendered on synced Canvas 2D overlay
- HTML overlays for tooltips, legend, badges, context menu, level switcher
- Smooth 60fps at 2000+ nodes
- Document AND chunk mode support

## Non-Goals

- Cosmograph commercial library (use MIT-licensed @cosmos.gl/graph only)
- Edge hover tooltips (replaced with click-based edge detection)
- Dashed edge rendering (use opacity for weak edges instead)
- Custom arrow styling (accept Cosmos defaults + directional coloring)
- WebGPU (stick with WebGL for now)

---

## Technical Design

### Dependencies

**Add**: `@cosmos.gl/graph` (MIT, v2.6.4, ~3.76MB)
**Remove**: None immediately (d3-force stays for LocalGraph.svelte sidebar widget)

### Architecture

```
┌──────────────────────────────────────────────────┐
│ GraphView.svelte (Container div, position:relative)│
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │ Hull Canvas (Canvas 2D, z-index: 1)         │  │
│  │  → Cluster convex hulls (our convex-hull.ts)│  │
│  │  → Cluster labels (text at hull centroids)  │  │
│  │  → Pan/zoom synced with Cosmos transform    │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │ Cosmos.gl WebGL Canvas (z-index: 0)         │  │
│  │  → Nodes (GPU circles, colors, sizes)       │  │
│  │  → Edges (GPU lines, colors, widths, arrows)│  │
│  │  → Force simulation (GPU-computed)          │  │
│  │  → Cluster force (GPU-computed)             │  │
│  │  → Pan/zoom/drag (built-in)                 │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │ HTML Overlays (z-index: 2+)                 │  │
│  │  → Node tooltips (on hover)                 │  │
│  │  → Edge info tooltip (on edge click)        │  │
│  │  → Legend panel (cluster/folder/edge types)  │  │
│  │  → Level switcher tabs (Document/Chunk)     │  │
│  │  → Path filter / folder highlight badges    │  │
│  │  → Context menu (right-click)               │  │
│  │  → Graph notices (no links, large graph)    │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
└──────────────────────────────────────────────────┘
```

### File Changes

| File | Action | Scope |
|------|--------|-------|
| `app/src/renderer/components/GraphView.svelte` | **Rewrite** | Replace Canvas 2D + d3-force with Cosmos.gl + overlay canvas + HTML overlays |
| `app/src/renderer/lib/cosmos-bridge.ts` | **New** | Typed wrapper: data conversion (GraphData → Float32Arrays), color computation, edge filtering |
| `app/src/renderer/stores/graph.ts` | **Modify** | Minor: may need to store Cosmos instance ref for imperative updates |
| `app/src/renderer/lib/convex-hull.ts` | **Keep** | Reused for hull overlay canvas |
| `app/src/renderer/lib/edge-utils.ts` | **Keep** | Reused for edge color computation, hit-testing |
| `app/src/renderer/components/GraphPreview.svelte` | **Keep** | Side panel unchanged |
| `app/src/renderer/components/LocalGraph.svelte` | **Keep** | Sidebar widget stays SVG + d3-force (small graphs) |
| `app/src/renderer/types/cli.ts` | **Keep** | Data types unchanged |

### 1. Cosmos.gl Initialization

```typescript
import { Graph } from '@cosmos.gl/graph';

// In onMount:
const graph = new Graph(containerEl, {
  // Simulation
  simulationRepulsion: 1.0,
  simulationGravity: 0.1,
  simulationFriction: 0.85,
  spaceSize: 4096,
  fitViewOnInit: true,
  fitViewDelay: 300,

  // Interaction
  enableDrag: true,

  // Appearance
  renderHoveredNodeRing: true,
  hoveredNodeRingColor: '#00E5FF',
  focusedNodeRingColor: '#00E5FF',
  linkArrows: true, // document mode only

  // Events
  onClick: handleNodeClick,
  onPointMouseOver: handleNodeHover,
  // ... more callbacks
});
```

### 2. Data Bridge (`cosmos-bridge.ts`)

Convert our `GraphData` (objects with strings) to Cosmos's Float32Array format:

```typescript
interface CosmosArrays {
  positions: Float32Array;   // [x0, y0, x1, y1, ...] — initial or empty
  colors: Float32Array;      // [r0, g0, b0, a0, r1, ...] — RGBA per node
  sizes: Float32Array;       // [s0, s1, ...] — per node
  links: Float32Array;       // [src0, tgt0, src1, tgt1, ...] — index pairs
  linkColors: Float32Array;  // [r0, g0, b0, a0, ...] — per edge
  linkWidths: Float32Array;  // [w0, w1, ...] — per edge
  clusters: Float32Array;    // [c0, c1, ...] — cluster ID per node
  nodeIndexMap: Map<string, number>;  // node ID → array index
  indexNodeMap: Map<number, GraphNode>; // array index → GraphNode
}

function buildCosmosArrays(data: GraphData, coloringMode, edgeFilter, ...): CosmosArrays
```

**Node colors**: Compute based on coloring mode (cluster palette, folder palette, hash-based, or dimmed).
**Node sizes**: Degree-based (document) or content-size-based (chunk), same logic as current.
**Edge colors**: Directional coloring (cyan out / red in / green bidi) for selected node neighbors. Semantic cluster coloring for others. Low opacity for weak edges (replaces dashed).
**Edge widths**: Strength-based [0.5, 3.0] range via `edgeLineWidth()` from edge-utils.ts.
**Edge filtering**: Excluded edges simply omitted from the links array.

### 3. Hull Overlay Canvas

A Canvas 2D element sized identically to the Cosmos container, positioned behind the WebGL canvas (z-index 0, Cosmos at z-index 1 with transparent background). Cosmos renders nodes/edges over the hulls.

**Sync**: When Cosmos zoom/pan changes, read current transform via Cosmos's zoom/position API and apply to hull canvas via `ctx.setTransform()`.

**Hull computation**: On simulation settle or periodic interval:
1. Read node positions via `getTrackedNodePositionsMap()` or `getSampledNodePositionsMap()`
2. Group by `cluster_id`
3. Compute convex hulls using `convexHull()` from our existing lib
4. Draw with `padHull()` + smooth bezier rendering (existing `drawSmoothHull` logic)
5. Draw cluster labels at hull centroids

**Update frequency**: Not every frame — recompute hulls every ~500ms or when simulation energy drops below threshold.

### 4. Interaction Porting

**Node click (select/open)**:
- Cosmos `onClick(pointIndex)` → look up `indexNodeMap.get(pointIndex)` → get GraphNode
- If same node already selected: `openGraphNode(node)` (show side panel)
- If different node: `selectGraphNode(node)` (highlight only)
- If null/background: `selectGraphNode(null)` (deselect)

**Node hover**:
- Cosmos `onPointMouseOver(pointIndex)` → position HTML tooltip at cursor
- Show path, cluster label, heading (chunk mode)
- On mouse out: hide tooltip

**Edge click** (replaces edge hover):
- On canvas click where no node is hit: run `pointToSegmentDist()` against all edges using current node positions
- If edge found within hit radius: show edge info tooltip (relationship type, strength, context)
- Dismiss on next click or Escape

**Right-click context menu**:
- `contextmenu` event listener on container div
- Use Cosmos click detection or manual hit-test to find node
- Show HTML context menu (same items: "Open in side panel", "Select node")

**Keyboard (Escape)**:
- `keydown` listener on container div
- Clear selection, close context menu, close edge tooltip

**Drag**: Built into Cosmos (`enableDrag: true`). No custom code needed.

**Pan/Zoom**: Built into Cosmos. No custom code needed.

### 5. Coloring Modes

On mode switch (`graphColoringMode` store change):
1. Recompute color Float32Array based on mode:
   - **Cluster**: 12-color palette by `cluster_id`
   - **Folder**: Folder color map by top-level directory
   - **None**: Hash-based per-file color (document) or per-file (chunk)
2. Call `graph.setPointColors(newColors)`
3. Redraw hull overlay if in cluster mode

### 6. Selection Visual State

When a node is selected:
1. Compute "neighbor" set from edge data
2. Recompute node colors: full opacity for selected + neighbors, dimmed (low alpha) for others
3. Recompute edge colors: directional coloring for selected edges, dimmed for others
4. Call `setPointColors()` + `setLinkColors()` + `setLinkWidths()`
5. Use Cosmos focus API for selection ring

### 7. Document / Chunk Mode Switch

On level change:
1. Fetch new graph data from CLI (`mdvdb graph --json --level chunk`)
2. Destroy current Cosmos instance
3. Rebuild all typed arrays from new data
4. Create new Cosmos instance with mode-appropriate config:
   - Document: `linkArrows: true`, larger repulsion
   - Chunk: `linkArrows: false`, tighter forces
5. Redraw hull overlay

### 8. Edge Filtering

When `graphEdgeFilter` store changes:
1. Rebuild link arrays excluding filtered edge clusters
2. Rebuild link color/width arrays
3. Call `graph.setLinks()` + `graph.setLinkColors()` + `graph.setLinkWidths()`

### 9. Resize Handling

`ResizeObserver` on container:
1. Resize hull overlay canvas (width/height + DPR)
2. Cosmos may auto-resize or need `graph.resize()` call
3. Redraw hulls

---

## Migration Strategy

### Phase A: Core Rendering (MVP)
1. Install `@cosmos.gl/graph`
2. Create `cosmos-bridge.ts` with data conversion
3. Rewrite GraphView.svelte: Cosmos init, node/edge rendering, pan/zoom/drag
4. Port click-to-select, click-to-open, Escape
5. Port coloring modes (cluster/folder/none)
6. Port document/chunk mode switching
7. **Milestone**: Graph renders with GPU, nodes clickable, colors work

### Phase B: Overlays & Interactions
8. Add hull overlay canvas with synced pan/zoom
9. Port hull rendering (convex-hull.ts reuse)
10. Port node hover tooltips (HTML overlay)
11. Port context menu (right-click)
12. Add edge click detection + edge info tooltip
13. Port legend panel (HTML, same as current)
14. Port level switcher, badges, notices
15. **Milestone**: Full feature parity minus minor visual differences

### Phase C: Polish
16. Port selection dimming (recompute colors for non-neighbors)
17. Port edge semantic styling (strength → width, cluster → color)
18. Port edge filtering (array rebuild on filter change)
19. Tune cluster force parameters (`setPointClusterStrength`)
20. Tune simulation parameters (repulsion, gravity, friction)
21. Add weak edge low-opacity rendering (replaces dashed)
22. **Milestone**: Visual parity, performance validated

---

## Acceptance Criteria

- [ ] Graph renders via WebGL (Cosmos.gl), not Canvas 2D
- [ ] Force simulation runs on GPU (no `simulation.tick()` blocking main thread)
- [ ] Clusters form spatially separated groups (native cluster force)
- [ ] Cluster convex hulls visible on overlay canvas, synced with pan/zoom
- [ ] Click node → select (highlight ring). Click selected → open side panel
- [ ] Drag node works (built-in Cosmos drag)
- [ ] Pan and zoom work smoothly
- [ ] Right-click context menu on nodes
- [ ] Escape deselects
- [ ] Cluster / folder / none coloring modes all work
- [ ] Edge directionality: cyan (out), red (in), green (bidi) with arrows
- [ ] Semantic edge styling: width by strength, color by cluster
- [ ] Weak edges rendered at low opacity (not dashed)
- [ ] Edge click shows relationship info tooltip
- [ ] Edge filtering by cluster (toggle visibility)
- [ ] Document and chunk modes both work
- [ ] Legend panel with cluster/folder items + edge type filtering
- [ ] Level switcher tabs, path filter badge, folder highlight badge
- [ ] Node hover tooltip (path, cluster, heading)
- [ ] Side panel (GraphPreview) works on node open
- [ ] 60fps at 2000+ nodes
- [ ] LocalGraph.svelte sidebar widget unaffected (stays d3-force + SVG)

## Verification

1. `cd app && npm install @cosmos.gl/graph && npm run dev`
2. Open collection with multiple clusters
3. Graph renders with clear cluster separation
4. Click, drag, pan, zoom all work
5. Right-click context menu works
6. Toggle cluster/folder/none coloring
7. Switch Document/Chunk mode
8. Select node → dimming + directional edges
9. Click edge → info tooltip
10. Toggle edge type filters in legend
11. Hull overlays track pan/zoom correctly
12. Large graph (500+ nodes) stays at 60fps
13. LocalGraph sidebar widget unchanged
