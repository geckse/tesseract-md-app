# PRD: Graph View Enhancements — Folder Coloring, Folder Highlight, Cluster Hulls

## Overview

Enhance the graph view with three features that improve spatial understanding: (1) a folder-based coloring mode so nodes can be colored by directory structure instead of only by semantic cluster, (2) cross-highlighting from the file tree so clicking a folder highlights its files in the graph, and (3) semi-transparent convex hull overlays that visually delineate cluster boundaries with labels — replacing the need to mentally map legend colors to scattered dots. Together these make the graph a true spatial map of a knowledge base.

## Problem Statement

The graph view (Phases 14, 16, 17) renders nodes with cluster-based coloring and a legend panel. This has three shortcomings:

1. **No folder awareness.** Clusters are semantic (K-means on embeddings), but users also think in terms of directory structure. There's no way to see "are files in `docs/api/` clustered together or spread across the graph?" Obsidian provides folder-based coloring as a baseline — we should too. Additionally, folder coloring works without ingestion (no embeddings needed), making the graph useful immediately.

2. **No folder-to-graph connection.** Clicking a folder in the FileTree only toggles expand/collapse. Right-click offers "Show in Graph" which applies a path filter (reloads data scoped to that folder), but there's no lightweight way to just *highlight* a folder's files on the existing graph without reloading. The file highlight pattern (cyan glow when `selectedFilePath` changes) already exists for individual files but not for folders.

3. **Cluster boundaries are invisible.** The legend maps colors to cluster labels, but the user must visually scan the entire graph to see which dots share a color. There's no spatial region boundary. Convex hull overlays — semi-transparent colored regions drawn behind node groups — would make cluster structure instantly visible, showing cluster area, density, and overlap at a glance.

## Goals

- Tri-state coloring mode: `cluster` (default), `folder`, `none` — replacing the current boolean toggle
- Folder mode colors nodes by top-level directory, with the legend showing folder names and counts
- Folder mode works without ingestion (clusters not required)
- Cycle button in the legend header to switch modes (icon changes per mode)
- Left-clicking a folder in the FileTree highlights all matching nodes in the graph (glow + dim pattern)
- Folder highlight is a toggle (click same folder to clear) and composable with existing highlight priority
- Convex hull overlays drawn behind each cluster's nodes when in cluster coloring mode
- Hulls use smooth bezier curves with ~10% opacity fill and subtle border stroke
- Cluster label rendered at hull centroid, always visible, font size proportional to hull area
- Single-node clusters rendered as circles; two-node clusters as capsules
- Hull computation cached and only recomputed when simulation ticks (performance safe)

## Non-Goals

- **Backend changes** — All three features use existing `node.path` and `cluster_id` data. No Rust API changes.
- **Nested folder depth** — Folder coloring uses top-level directory only (first path component). Nested subfolder coloring (e.g., depth 2) is out of scope.
- **Hull interaction** — Hulls are visual-only background overlays. No click, hover, or selection behavior on hulls themselves.
- **Folder highlight with path filter reload** — The folder highlight is a lightweight visual overlay on the existing graph. It does NOT reload graph data (that's what "Show in Graph" context menu already does).
- **Animating hull transitions** — Hulls update in real-time as nodes move during simulation, but there's no animated morph between states.

## Technical Design

### Data Model Changes

**`app/src/renderer/stores/graph.ts`** — Replace boolean with typed mode + add folder highlight store:

```typescript
// Replace: export const graphClusterColoring = writable<boolean>(true)
// With:
export type GraphColoringMode = 'cluster' | 'folder' | 'none'
export const graphColoringMode = writable<GraphColoringMode>('cluster')

// New:
export const graphHighlightedFolder = writable<string | null>(null)
```

No changes to `GraphData`, `GraphNode`, `GraphEdge`, or `GraphCluster` types — all existing fields are sufficient.

### Interface Changes

**`app/src/renderer/components/FileTreeNode.svelte`** — Add `onfolderclick` prop:

```typescript
interface FileTreeNodeProps {
  // ... existing props ...
  onfolderclick?: (folderPath: string) => void
}
```

**`app/src/renderer/stores/graph.ts`** — New exports:

```typescript
export function cycleColoringMode(): void
export function setGraphHighlightedFolder(path: string | null): void
export function resetGraphState(): void  // updated to reset new stores
```

### New Commands / API / UI

**Coloring mode cycle button** — Replaces the existing eye-icon visibility toggle in the legend header. Single button that cycles through modes on click:

| Mode | Icon | Legend Title | Legend Content |
|------|------|-------------|----------------|
| `cluster` | `category` | "Clusters" | Cluster labels + member counts |
| `folder` | `folder` | "Folders" | Folder names + file counts |
| `none` | `visibility_off` | (legend hidden) | — |

**Folder highlight** — Visual effect on the graph canvas (no new UI elements). Triggered by left-clicking a folder in the FileTree.

**Cluster hulls** — Canvas background layer (no new UI elements). Rendered automatically when coloring mode is `cluster`.

### Migration Strategy

The `graphClusterColoring` boolean store is replaced by `graphColoringMode`. Update all subscribers:

- `GraphView.svelte` — change `currentColoring` (boolean) to `currentColoringMode` (string), update all `if (currentColoring)` checks
- `resetGraphState()` — set `graphColoringMode` to `'cluster'` instead of `graphClusterColoring` to `true`
- No persistence migration needed — the store is in-memory only (no localStorage for this value)

## Implementation Steps

1. **Add convex hull utility** — Create `app/src/renderer/lib/convex-hull.ts` with pure functions:
   - `convexHull(points)` — Andrew's monotone chain algorithm, O(n log n). Takes `[number, number][]`, returns hull vertices in order.
   - `padHull(hull, padding)` — Expands each hull vertex outward from centroid by `padding` pixels.
   - `centroid(points)` — Average x/y of polygon vertices.
   - `polygonArea(points)` — Shoelace formula for polygon area.
   - `hexToRgb(hex)` — Parse `#RRGGBB` to `{r, g, b}` for alpha compositing.

2. **Update graph stores** — In `app/src/renderer/stores/graph.ts`:
   - Replace `graphClusterColoring` with `graphColoringMode` writable store (type `GraphColoringMode`, default `'cluster'`).
   - Add `cycleColoringMode()` — cycles `cluster` → `folder` → `none` → `cluster`.
   - Add `graphHighlightedFolder` writable store (type `string | null`, default `null`).
   - Add `setGraphHighlightedFolder(path)` — toggle behavior: if `path` equals current value, set to `null`; otherwise set to `path`.
   - Update `resetGraphState()` to reset both new stores.

3. **Add folder click prop to FileTreeNode** — In `app/src/renderer/components/FileTreeNode.svelte`:
   - Add `onfolderclick?: (folderPath: string) => void` to `FileTreeNodeProps`.
   - In `handleClick()`, when `node.is_dir`, call `onfolderclick?.(node.path)` after `toggleExpanded(node.path)`.
   - Pass `onfolderclick` through recursive child rendering.

4. **Wire folder click in FileTree** — In `app/src/renderer/components/FileTree.svelte`:
   - Import `setGraphHighlightedFolder` from `../stores/graph`.
   - Define `handleFolderClick(path: string)` that calls `setGraphHighlightedFolder(path)`.
   - Pass `onfolderclick={handleFolderClick}` to each `FileTreeNode` instance.

5. **Refactor GraphView coloring subscription** — In `app/src/renderer/components/GraphView.svelte`:
   - Replace `graphClusterColoring` import with `graphColoringMode`.
   - Replace `currentColoring` (boolean) with `currentColoringMode: GraphColoringMode` state variable.
   - Subscribe to `graphColoringMode` instead of `graphClusterColoring`.
   - Replace `toggleClusterColoring()` with `cycleColoringMode()` import from store.

6. **Add folder coloring logic to GraphView** — In `app/src/renderer/components/GraphView.svelte`:
   - Add `getTopLevelFolder(path: string): string` helper — returns substring before first `/`, or `"(root)"` if no slash.
   - Add `folderColorMap: Map<string, string>` cached variable, rebuilt in `buildSimulation()`. Sorts unique folders alphabetically, assigns `CLUSTER_COLORS[i % 12]`.
   - Update node fill logic in `draw()` to three-way branch:
     - `'cluster'`: existing cluster color logic (unchanged)
     - `'folder'`: `folderColorMap.get(getTopLevelFolder(node.path))`
     - `'none'`: `DEFAULT_NODE_COLOR` (document mode) or `fileColor(node.path)` (chunk mode)

7. **Add folder highlight logic to GraphView** — In `app/src/renderer/components/GraphView.svelte`:
   - Subscribe to `graphHighlightedFolder` store, track as `currentHighlightedFolder` state.
   - Add `getFolderHighlight(folderPath)` function — analogous to existing `getFileHighlight()`. Matches nodes where `node.path.startsWith(folderPath + '/')`. Returns `{ folderNodeIds: Set<string>, folderEdges: Set<SimEdge> }`.
   - In `draw()`, compute folder highlight after file highlight. Apply same dimming/glow pattern with priority: selection > file highlight > folder highlight > normal.
   - Update dimmed calculation to include `hasFolderHighlight && !folderNodeIds.has(node.id)`.
   - In `handleKeyDown` (Escape), also clear folder highlight.
   - In `handleMouseDown` when clicking empty space (no node hit, not panning), clear folder highlight.

8. **Add cluster hull rendering to GraphView** — In `app/src/renderer/components/GraphView.svelte`:
   - Import `convexHull`, `padHull`, `centroid`, `polygonArea`, `hexToRgb` from `../lib/convex-hull`.
   - Define `ClusterHull` interface: `{ clusterId, color, label, rawHull, centroid, area, nodeCount }`.
   - Add `cachedHulls: ClusterHull[]` and `hullsDirty: boolean` variables.
   - Add `computeClusterHulls()` function:
     - Group `simNodes` by `cluster_id` → collect `[x, y]` arrays per cluster.
     - For each cluster: compute raw convex hull, centroid, and area.
     - Handle degenerate cases: 1 node → store centroid only; 2 nodes → store both points.
   - Set `hullsDirty = true` in simulation `on('tick')` callback and in `buildSimulation()`.
   - Add `drawSmoothHull(ctx, points, r, g, b, fillAlpha, strokeAlpha)` — uses `quadraticCurveTo` through midpoints of hull edges for rounded appearance.
   - Add `drawCapsule(ctx, p1, p2, radius, r, g, b, fillAlpha, strokeAlpha)` — rounded shape between two points using `arc` + `closePath`.

9. **Integrate hull drawing into draw() render order** — In `app/src/renderer/components/GraphView.svelte`, in the `draw()` function:
   - Insert hull rendering right after `ctx.scale(zoom, zoom)` and BEFORE edge rendering.
   - Guard: only render when `currentColoringMode === 'cluster'`.
   - Recompute hulls if `hullsDirty`.
   - For each hull:
     - Apply padding at draw time: `const padding = 25 / zoom` (scales with zoom so visual padding stays constant).
     - 1 node → `ctx.arc()` circle with radius `30 / zoom`.
     - 2 nodes → `drawCapsule()`.
     - 3+ nodes → `padHull(rawHull, padding)` then `drawSmoothHull()`.
     - Fill: `rgba(r, g, b, 0.10)`. Stroke: `rgba(r, g, b, 0.25)`, lineWidth `1.5 / zoom`.
     - Label: `ctx.fillText(label, centroid.x, centroid.y)` at `rgba(r, g, b, 0.5)`. Font size: `clamp(10, sqrt(area) * 0.04, 14) / zoom` px.

10. **Update legend UI** — In `app/src/renderer/components/GraphView.svelte` template:
    - Replace the eye-icon toggle button with a cycle button calling `cycleColoringMode()`.
    - Icon: `category` (cluster) / `folder` (folder) / `visibility_off` (none).
    - Tooltip: "Color by clusters" / "Color by folders" / "No coloring".
    - Legend title: "Clusters" / "Folders" / (hidden).
    - Add `getFolderLegendItems()` function — counts nodes per top-level folder using `folderColorMap`, returns sorted array of `{ folder, color, count }`.
    - When `currentColoringMode === 'cluster'`: render existing cluster legend items.
    - When `currentColoringMode === 'folder'`: render folder legend items (dot + folder name + count).
    - When `currentColoringMode === 'none'`: hide the entire legend panel.

11. **Folder highlight badge** — In `app/src/renderer/components/GraphView.svelte` template:
    - Add a folder highlight badge (similar to the existing path filter badge) when `currentHighlightedFolder` is non-null.
    - Position below the path filter badge (or in the same slot if no path filter).
    - Shows folder icon + folder path + close button.
    - Close button calls `setGraphHighlightedFolder(null)`.

## Validation Criteria

- [ ] Cycle button rotates through cluster → folder → none → cluster
- [ ] In folder mode, nodes are colored by their top-level directory
- [ ] In folder mode, legend shows folder names with colors and file counts
- [ ] Folder coloring works in both document and chunk graph modes
- [ ] Folder coloring works when no clusters exist (pre-ingestion)
- [ ] Left-clicking a folder in FileTree highlights matching nodes (cyan glow, others dimmed)
- [ ] Clicking the same folder again clears the highlight
- [ ] Escape key clears folder highlight
- [ ] Folder highlight respects priority: selection > file highlight > folder highlight
- [ ] Folder highlight badge appears with close button when active
- [ ] Convex hulls render behind clusters with smooth bezier curves
- [ ] Hull fill is ~10% opacity, stroke is ~25% opacity, using cluster color
- [ ] Cluster labels render at hull centroids, always visible
- [ ] Single-node clusters render as circles, two-node as capsules
- [ ] Hulls update as nodes move during simulation, then cache when settled
- [ ] Hull rendering is skipped when coloring mode is not `cluster`
- [ ] No visual regressions to existing node selection, edge rendering, or tooltip behavior
- [ ] Performance: graph with 300+ nodes renders at 60fps with hulls enabled

## Anti-Patterns to Avoid

- **Don't recompute hulls every frame unconditionally** — Hull computation involves sorting and iteration over all nodes per cluster. Only recompute when `hullsDirty` is true (set by simulation tick). When the simulation settles, hulls are drawn from cache at zero cost.
- **Don't bake zoom-dependent padding into cached hulls** — Store raw (unpadded) hull vertices and apply padding at draw time using `25 / zoom`. Otherwise hulls must be recomputed on every zoom change.
- **Don't add a new coloring mode to the Rust backend** — All coloring logic is purely a renderer concern. The Rust CLI already provides `node.path` and `cluster_id`; no new fields are needed.
- **Don't break existing `graphClusterColoring` consumers silently** — The boolean store is replaced with a string store. Search for all imports of `graphClusterColoring` and update them to use `graphColoringMode`. There are consumers in `GraphView.svelte` and `resetGraphState()`.
- **Don't fire folder highlight on every folder click without toggle** — The `setGraphHighlightedFolder` function must check if the current value equals the new path and clear it (toggle off). Otherwise users can't dismiss the highlight without pressing Escape.
- **Don't render hull labels using the node label font size** — Hull labels should scale with hull area (larger clusters get larger labels) and inversely with zoom (so they don't dominate at close zoom). Use the formula: `clamp(10, sqrt(area) * 0.04, 14) / zoom`.

## Patterns to Follow

- **Existing file highlight pattern** — `getFileHighlight()` in `GraphView.svelte` (lines 323-353) builds `fileNodeIds` and `fileEdges` sets from `selectedFilePath`. The folder highlight should mirror this exactly, using path prefix matching instead of exact path matching.
- **Store subscription pattern** — Follow the same `let unsubX` / `onMount` / `onDestroy` pattern used for all other store subscriptions in `GraphView.svelte` (lines 81-176).
- **Path filter badge UI** — The existing `graph-path-badge` class (lines 812-819 in GraphView.svelte template) provides the exact pattern for the folder highlight badge: icon + text + close button, positioned in the top-left area.
- **Edge color CSS tokens** — `getEdgeColors()` reads CSS custom properties. Hull colors should use the same `hexToRgb` parsing approach (but from the `CLUSTER_COLORS` array, not CSS properties).
- **FileTreeNode prop drilling** — Existing `onfileselect` and `oncontextmenu` props show the pattern for passing event handlers through the tree. `onfolderclick` follows the same convention.
- **Canvas draw layer ordering** — The current `draw()` function follows a strict back-to-front order: edges (dim) → edges (highlighted) → nodes → labels. Insert hull rendering before all of these.
