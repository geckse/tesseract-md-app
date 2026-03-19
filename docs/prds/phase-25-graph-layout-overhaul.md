# PRD: Graph Layout & Rendering Overhaul

## Overview

Overhaul the graph view's force layout and rendering pipeline to produce professional, well-clustered layouts where related nodes visually group together — comparable to tools like Obsidian Graph View and Cosmograph. The current layout initializes nodes randomly and has zero cluster awareness, producing a "hairball". This phase adds cluster-aware seeding, cluster-attraction forces, degree-dependent repulsion, and rendering polish (background depth, node glow, label pills, improved hulls).

## Problem Statement

The graph view uses a basic d3-force configuration: `forceLink` (flat distance 80), `forceManyBody` (flat strength -60/-120), `forceCenter`, and `forceCollide`. Nodes are initialized at `Math.random() * width/height`. There are no forces pulling same-cluster nodes together, no initial position seeding by cluster, and no repulsion tuning by node degree.

The result: clusters overlap randomly, high-degree hubs collapse into the center, and the layout requires extreme zoom to distinguish structure. The cluster coloring and convex hull overlays help visually but can't compensate for a spatially jumbled layout.

## Goals

- Nodes in the same cluster should form visually distinct spatial groups with clear separation
- High-degree hub nodes should be prominent, not crushed into the center
- Initial layout should stabilize quickly (cluster-seeded starting positions)
- Background, glow, and label rendering should feel polished and professional
- Existing interactivity preserved: drag (physics only on movement), pan, zoom, select, context menu
- Performance maintained for 2000+ node graphs
- No new npm dependencies — use existing `d3-force` exports (`forceX`, `forceY`)
- Edges remain straight lines (no curves)

## Non-Goals

- WebGL migration (stay Canvas 2D)
- Curved or bundled edges
- Web Worker for simulation (future phase)
- Changes to chunk mode layout (focus is document mode)
- New IPC channels or Rust backend changes

---

## Technical Design

### File Changes

| File | Scope |
|------|-------|
| `app/src/renderer/components/GraphView.svelte` | Layout forces, seeding, rendering |

### 1. Import Change

```diff
- import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
+ import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
```

Remove `forceCenter` — it moves all nodes rigidly toward center, fighting cluster separation. Replace with targeted `forceX`/`forceY`.

### 2. Cluster-Aware Initial Seeding

Replace `Math.random() * width/height` (lines 412-413 in `buildSimulation()`) with cluster-seeded placement:

1. Compute K cluster centroids arranged in a circle: radius `min(width, height) * 0.3`, center at `(width/2, height/2)`, angle `2 * PI * i / K`.
2. Place each cluster's nodes in a golden-angle spiral around its centroid: `angle_i = i * 2.399963` (golden angle radians), `radius_i = spacing * sqrt(i)`, spacing ~15px.
3. Unclustered nodes (`cluster_id === null`): canvas center with random jitter `(Math.random() - 0.5) * 100`.

This gives the simulation spatially separated clusters before tick 1.

### 3. Cluster-Aware Force Configuration (Document Mode)

Replace the existing document-mode force setup (lines 468-490) with:

**`forceLink`**: Cluster-aware distances.
- Same cluster: distance `50`, tighter grouping
- Different clusters: distance `150`, push apart
- Either unclustered: distance `100`
- Strength: `0.3`

**`forceManyBody`**: Degree-dependent repulsion.
- `strength(d => Math.max(-300, -80 - (degreeMap.get(d.id) ?? 0) * 5))`
- `distanceMax(500)` (increased from 200/400)
- `theta(0.8)` (Barnes-Hut precision)
- High-degree nodes push harder, preventing hub collapse

**`forceX` / `forceY` (cluster attraction)**:
- Target: live cluster centroid (recomputed from actual node positions each tick)
- Strength: `0.15` for clustered nodes, `0.02` for unclustered (weak centering)
- Maintain a `clusterCentroids: Map<number, {x, y}>` recomputed in the `tick` callback
- Accessor closures read from this map so centroids are always current

**`forceCollide`**: `radius = baseRadius + 3` (increased from +2)

**Decay**: `alphaDecay(0.02)` normal, `0.04` for >300 nodes. `velocityDecay(0.4)` (increased from 0.3 for more damping).

**Warm-up**: 300 ticks (unchanged).

**Chunk mode**: Leave existing forces. Only add cluster-aware link distances (same/different cluster logic).

### 4. Background Depth

At the top of the `draw()` function, replace flat `clearRect` with:

**Radial gradient**: `createRadialGradient` from canvas center, `#131315` at center → `#0a0a0b` at edges. Fills the entire canvas.

**Dot grid**: After pan/zoom transform, draw dots at 30px graph-space intervals. Only draw within visible viewport bounds. Dot radius: `0.5/zoom`. Color: `rgba(255,255,255,0.03)`.

### 5. Node Glow for High-Degree Nodes

In the node rendering loop, for nodes where `baseRadius > 8` and not dimmed:

```
ctx.save();
ctx.shadowColor = clusterColor;  // or default white
ctx.shadowBlur = 8 + baseRadius;
ctx.beginPath();
ctx.arc(x, y, radius, 0, TWO_PI);
ctx.fill();
ctx.restore();
```

Existing pattern at lines 1050-1087 (hover/selection glow) can be reused.

### 6. Label Background Pills

For important labels (selected, neighbor, hovered nodes), before drawing the text:

1. `ctx.measureText(label)` to get width
2. Draw rounded rect: `fillStyle = 'rgba(15, 15, 16, 0.85)'`, 3px padding, 3px corner radius
3. Then draw text on top

Regular labels at high zoom remain raw text (no pill).

### 7. Improved Hull Rendering

- Increase base padding from `20/zoom` to `35/zoom`
- Double-pass rendering: first pass at fill alpha `0.06` (full padding), second pass at fill alpha `0.12` (padding reduced by 10) — creates a soft density gradient effect
- Stroke alpha unchanged at `0.25`

### 8. Performance Safeguards

**Viewport culling**: Compute visible bounds from pan/zoom. Skip nodes/edges entirely outside bounds (with 50px margin for labels/glow).

**Edge thresholds**:
- `>500` edges: skip per-edge gradient coloring (flat color)
- `>2000` edges: render weak edges as thin solid instead of dashed

**Label occlusion**: When >100 visible nodes at intermediate zoom, sort by `baseRadius` descending, maintain placed-label bounding boxes, skip overlapping labels.

---

## Acceptance Criteria

- [ ] Clusters form visually distinct spatial groups in document mode
- [ ] High-degree hub nodes are visually prominent (larger + glow)
- [ ] Layout stabilizes within 300 ticks (no extended jitter)
- [ ] Drag only applies physics force on actual mouse movement (not on click)
- [ ] Background has subtle radial gradient and dot grid
- [ ] Important labels have background pills for readability
- [ ] Hull rendering has soft density gradient (double-pass)
- [ ] Performance: <16ms frame time at 1000 nodes (60fps)
- [ ] Existing features work: pan, zoom, select, open, context menu, coloring modes
- [ ] Chunk mode layout is not regressed
- [ ] `forceCenter` removed, replaced by targeted forceX/forceY

## Verification

1. `cd app && npm run dev`
2. Open collection with multiple clusters (20+ files)
3. Graph view: clusters should form separated spatial groups
4. Drag nodes: physics only on movement, not click
5. Toggle Document/Chunk: chunk mode unchanged
6. Toggle cluster/folder/none coloring: hulls wrap tighter groups
7. Large graph (300+ nodes): responsive pan/zoom
8. Node glow visible on high-degree hubs
9. Label pills on selected/hovered nodes
