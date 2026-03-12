# PRD: Semantic Edge Visualization

## Overview

Visualize auto-inferred semantic edges in the Electron app's graph views. Edges gain variable thickness (by relationship strength), color (by auto-discovered relationship cluster), dashed/solid styling (weak vs strong), hover tooltips with context text, and a clickable edge-type legend for filtering. Depends on the Rust backend from `docs/prds/phase-22-semantic-edges.md` which provides semantic edge data in the `mdvdb graph --json` output.

## Problem Statement

The graph view currently renders all edges as uniform thin white lines with directional coloring (cyan/red/green for out/in/bidi). Every link looks identical regardless of whether it represents a hard dependency, a casual reference, or a contradiction. Users see a web of connections but cannot distinguish meaningful relationships from noise.

The Rust backend (Phase 22) auto-discovers relationship types by clustering edge context embeddings and computes per-edge strength scores. This rich data is available in the `graph --json` output but the app does not yet consume or visualize it.

## Goals

- Render edges with variable thickness based on relationship strength (0–1 → thin to thick)
- Color edges by auto-discovered relationship cluster using a dedicated pastel palette
- Dashed line rendering for weak edges (strength below configurable threshold)
- Edge hover detection with tooltip showing relationship type, strength bar, and context excerpt
- Edge type legend section in the graph panel with click-to-filter by relationship cluster
- Lightweight semantic edge styling in the local sidebar graph (SVG)
- Graceful degradation: when semantic edge data is absent, render edges exactly as before
- No new IPC channels — consume extended `GraphData` JSON from existing `cli:graph` channel

## Non-Goals

- Visual diagram editor or manual edge labeling
- Edge-first search result visualization (future feature)
- Edge details panel with full context text (future feature)
- Edge-influenced force layout (clustering edges of same type together)
- Legend or filtering in the local sidebar graph (keep it simple)
- Custom edge color configuration in settings

---

## Technical Design

### Data Model Changes

**Extend `GraphEdge` in `app/src/renderer/types/cli.ts`:**

```typescript
export interface GraphEdge {
  source: string;
  target: string;
  weight: number | null;
  // Semantic edge fields (nullable for backward compat)
  relationship_type?: string | null;
  strength?: number | null;
  context_text?: string | null;
  edge_cluster_id?: number | null;
}
```

**New `GraphEdgeCluster` interface:**

```typescript
export interface GraphEdgeCluster {
  id: number;
  label: string;
  count: number;
}
```

**Extend `GraphData`:**

```typescript
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  level: GraphLevel;
  edge_clusters?: GraphEdgeCluster[];
}
```

All new fields are optional/nullable. No IPC handler changes needed — the existing `cli:graph` channel passes through whatever JSON the CLI emits.

### Interface Changes

**New design tokens in `app/src/renderer/styles/tokens.css`:**

8 dedicated pastel edge cluster colors, distinct from the node cluster palette to avoid visual confusion:

```css
--color-edge-cluster-0: #7C9FE5;
--color-edge-cluster-1: #E5A07C;
--color-edge-cluster-2: #7CE5B8;
--color-edge-cluster-3: #E57CB8;
--color-edge-cluster-4: #C5E57C;
--color-edge-cluster-5: #7CCFE5;
--color-edge-cluster-6: #E5D47C;
--color-edge-cluster-7: #B87CE5;
```

**New store state in `app/src/renderer/stores/graph.ts`:**

```typescript
graphEdgeFilter: Set<number> | null   // visible edge cluster IDs (null = show all)
graphSemanticEdgesEnabled: boolean    // user toggle (default true)
graphEdgeWeakThreshold: number        // strength below which edges are dashed (default 0.4)
```

Actions: `toggleEdgeClusterFilter(id)`, `clearEdgeFilter()`, `toggleSemanticEdges()`

**New pure utility module `app/src/renderer/lib/edge-utils.ts`:**

```typescript
export function edgeClusterColor(clusterId: number): string
export function isEdgeVisible(edge: GraphEdge, filter: Set<number> | null): boolean
export function edgeLineWidth(strength: number, zoom: number): number
export function isWeakEdge(strength: number, threshold: number): boolean
export function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number
```

### Edge Rendering (`app/src/renderer/components/GraphView.svelte`)

When semantic edge data is present on an edge:

- **Thickness**: map `strength` [0, 1] → canvas line width [0.5, 3.0] in graph-space
- **Color**: edge cluster color from the pastel palette, indexed by `edge_cluster_id`
- **Dash pattern**: `ctx.setLineDash([4/zoom, 4/zoom])` for edges with `strength < weakThreshold`
- **Performance**: batch all solid edges first, then switch to dashed — only 2 `setLineDash` calls total, not O(n)

When a node is selected, directional colors (in/out/bidi) take precedence for highlighted edges, but thickness and dash still reflect strength.

Extend the internal `SimEdge` interface to carry semantic fields through the D3 simulation:

```typescript
interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  weight: number | null;
  relationship_type?: string | null;
  strength?: number | null;
  context_text?: string | null;
  edge_cluster_id?: number | null;
}
```

Propagate these fields in `buildSimulation()` when constructing `simEdges` from `data.edges`.

### Edge Hit Detection

Currently only nodes are hoverable via `simulation.find()`. Add edge hover detection:

```typescript
function findEdgeAt(sx: number, sy: number): SimEdge | null
```

Uses `pointToSegmentDist()` to compute perpendicular distance from cursor to each visible edge line segment. Threshold: 6px in screen space. Only active when semantic edges are present.

In `handleMouseMove()`: after the existing node hover check, if no node is hovered, check for edge hover. Track `hoveredEdge` state separately from `hoveredNode`.

**Performance**: O(E) per mouse move. Acceptable for <1000 document-level edges. For chunk-mode graphs with many more edges, skip edge hover detection entirely (semantic edges are document-level relationships).

### Edge Tooltip

HTML overlay below the existing node tooltip in the template:

```
┌─────────────────────────────────────┐
│ ● references / elaborates           │
│ Strength: 82% ████████░░            │
│ "As discussed in the design doc,    │
│  the authentication flow requires..." │
└─────────────────────────────────────┘
```

Shows:
- Colored dot + relationship type (cluster label)
- Strength percentage + visual bar
- Context text excerpt (first 120 chars, italic)

Positioned relative to cursor, same style as existing `graph-tooltip` class.

### Edge Legend

Below existing cluster/folder legend items in the legend panel:

- Separator line
- Section header: "Edge Types" (uppercase, dim, small)
- One entry per edge cluster from `data.edge_clusters`:
  - Colored horizontal line (not dot — distinguishes from node legend items)
  - Label text
  - Count badge
  - Click to toggle visibility via `toggleEdgeClusterFilter()`
  - Muted appearance (opacity 0.35) when filtered out

Only shown when `graphSemanticEdgesEnabled` is true and `data.edge_clusters` has entries.

### Edge Filtering

`isEdgeVisible(edge)` checks the `graphEdgeFilter` store:
- `null` → all edges visible
- `Set<number>` → only edges with `edge_cluster_id` in the set are visible
- Edges with no `edge_cluster_id` (legacy) → always visible

Applied before drawing in the render loop and before hit detection.

### Local Graph (`app/src/renderer/components/LocalGraph.svelte`)

Lightweight SVG-only changes:

- `stroke-width` proportional to `strength` when present
- `stroke-dasharray="3 3"` for weak edges
- Native `<title>` element on each edge line for browser tooltip: `"{relationship_type} ({strength}%)"`
- No legend, no filtering, no custom tooltip popup — keep sidebar simple

Extend `LocalEdge` in `app/src/renderer/utils/local-graph.ts` with optional semantic fields. Initially these won't be populated (neighborhood API doesn't return semantic data), so edges degrade gracefully to existing rendering.

### CSS Additions

New styles for edge tooltip and legend:

```css
.tooltip-edge-type { display: flex; align-items: center; gap: 6px; }
.tooltip-edge-dot { width: 8px; height: 8px; border-radius: 50%; }
.tooltip-edge-strength { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); }
.strength-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.strength-fill { display: block; height: 100%; background: var(--color-primary); border-radius: 2px; }
.tooltip-edge-context { font-size: var(--text-xs); font-style: italic; line-height: 1.4; }
.legend-separator { height: 1px; background: var(--color-border); margin: 6px 0; }
.legend-section-title { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; }
.legend-line { width: 16px; height: 2px; border-radius: 1px; }
.edge-legend-item { cursor: pointer; }
.legend-item-muted { opacity: 0.35; }
```

### Migration Strategy

No migration needed. All new `GraphEdge` fields are optional. When the backend has not been re-ingested with semantic edges, the fields are absent and the app renders edges exactly as before.

---

## Acceptance Criteria

1. Graph view edges show variable thickness based on strength when semantic data is present
2. Graph view edges are colored by relationship cluster using the pastel palette
3. Weak edges (strength below threshold) render as dashed lines
4. Hovering an edge shows tooltip with relationship type, strength bar, and context excerpt
5. Edge legend section shows discovered relationship types with click-to-filter
6. Clicking an edge type in the legend toggles its visibility
7. Local sidebar graph shows strength-based stroke-width and dash patterns via SVG attributes
8. All edge features degrade gracefully when semantic data is absent (backward compat)
9. Canvas rendering performance is acceptable: batch solid/dashed edges to minimize state switches
10. Edge hover detection works at document-level graph, skipped at chunk-level

---

## Files Modified

- `app/src/renderer/types/cli.ts` — `GraphEdge` semantic fields, `GraphEdgeCluster`, `GraphData` extension
- `app/src/renderer/styles/tokens.css` — edge cluster color palette (8 colors)
- `app/src/renderer/stores/graph.ts` — edge filter state, semantic toggle, weak threshold, actions
- `app/src/renderer/components/GraphView.svelte` — edge rendering (thickness/color/dash), hit detection, tooltip, legend extension
- `app/src/renderer/components/LocalGraph.svelte` — SVG stroke-width and dash-array for semantic edges
- `app/src/renderer/utils/local-graph.ts` — `LocalEdge` type extension with optional semantic fields
- `app/src/renderer/lib/edge-utils.ts` — NEW: pure utility functions for edge rendering logic

### Tests
- `app/tests/unit/edge-utils.test.ts` — NEW: `pointToSegmentDist` correctness, `edgeClusterColor` cycling, `isEdgeVisible` filter logic, `edgeLineWidth` mapping, `isWeakEdge` threshold
