# PRD: Chunk Graph View Improvements

## Overview

Improve the chunk-level graph view with three changes: (1) color chunk nodes by their parent document's cluster assignment instead of by source file, (2) add file-tree-to-graph cross-highlighting so clicking a file highlights its chunks, and (3) add folder-scoped graph filtering via right-click context menu on directories in the file tree, with a visible folder path indicator on the graph view. These changes make the chunk graph more meaningful by surfacing semantic groupings (clusters) and letting users focus on specific areas of their knowledge base.

## Problem Statement

Phase 16 delivered a functional chunk-level graph, but it has usability issues:

1. **Node coloring is arbitrary.** Chunks are colored by source file using a hash-based palette. This creates visually distinct groups, but the groups aren't semantically meaningful — knowing that 5 nodes came from the same file doesn't reveal *what* they're about. The index already has document-level cluster assignments with TF-IDF keyword labels (from Phase 9), but chunk nodes don't inherit them (`cluster_id: null`).

2. **No connection between file tree and graph.** Users can browse files in the sidebar and see chunks in the graph, but there's no way to ask "where are this file's chunks in the graph?" The file tree selection (`selectedFilePath`) and graph rendering are completely independent.

3. **No way to scope the graph to a folder.** For large collections, the full graph is overwhelming. Users can't focus on a subtree (e.g., `docs/guides/`) without mentally filtering. The search system already supports `--path` prefix filtering, but the graph doesn't.

The data and infrastructure for all three features already exists: cluster assignments in `ClusterState`, `selectedFilePath` store, `starts_with` path filtering in search, and the context menu system in `FileTree.svelte`.

## Goals

- Chunk nodes inherit `cluster_id` from their parent document's cluster assignment
- Cluster legend (with labels and keywords) appears in chunk mode
- Backend returns non-empty `clusters` array for chunk-level graph data
- Clicking a file in the sidebar highlights its chunks in the graph with a glow effect and shows their similarity edges
- File highlighting composes with single-node selection (node click takes priority)
- Right-click a directory in the file tree shows "Show in Graph" context menu item
- "Show in Graph" switches to graph view and filters to that folder's files/chunks
- `--path` CLI flag on `mdvdb graph` for path-prefix filtering
- Folder path indicator in top-left corner of graph view, clearable with × button
- Path filter works in both document and chunk graph modes
- In chunk mode, selected-node edges use a single color (no fake in/out directionality — similarity is symmetric)
- Default (unselected) chunk edges are significantly dimmer — only bright when selected or file-highlighted

## Non-Goals

- **Chunk-level clustering** — Clusters remain document-level. Chunks inherit their parent document's assignment; there is no independent chunk clustering.
- **Edge filtering or threshold controls** — Similarity edges remain as-is (k=5 neighbors, opacity by weight). No slider or threshold UI.
- **Bidirectional graph-to-tree sync** — Clicking a node in the graph does NOT select the corresponding file in the tree. Only tree→graph direction.
- **Folder-scoped graph as a separate view** — The folder filter is applied to the existing graph view, not a new page or component.

## Technical Design

### Backend: Cluster Inheritance in `graph_data_chunks()`

Modify `graph_data_chunks()` in `src/lib.rs` (currently lines 1265-1351). Before the node-building loop, build a `path_to_cluster` map from `self.index.get_clusters()` — the same pattern used in `graph_data()` at lines 1205-1220:

```rust
let cluster_state = self.index.get_clusters();
let mut path_to_cluster: HashMap<String, usize> = HashMap::new();
let mut clusters = Vec::new();
if let Some(ref state) = cluster_state {
    for cluster in &state.clusters {
        for member in &cluster.members {
            path_to_cluster.insert(member.clone(), cluster.id);
        }
        clusters.push(GraphCluster {
            id: cluster.id,
            label: cluster.label.clone(),
            keywords: cluster.keywords.clone(),
            member_count: cluster.members.len(),
        });
    }
}
```

Then in the node-building closure, change `cluster_id: None` to:

```rust
cluster_id: path_to_cluster.get(&cv.source_path).copied(),
```

And in the return value, change `clusters: Vec::new()` to `clusters`.

### Backend: Path Filter for Graph Functions

Add a `path_filter` parameter to all three graph functions:

```rust
pub fn graph_data(&self, path_filter: Option<&str>) -> Result<GraphData>
pub fn graph_data_chunks(&self, k: usize, path_filter: Option<&str>) -> Result<GraphData>
pub fn graph(&self, level: GraphLevel, path_filter: Option<&str>) -> Result<GraphData>
```

The filtering logic follows the established pattern from `search.rs:375-377`:

```rust
// In graph_data(): skip files not matching prefix
if let Some(prefix) = path_filter {
    if !file.path.starts_with(prefix) { continue; }
}

// In graph_data_chunks(): skip chunks not matching prefix
if let Some(prefix) = path_filter {
    if !cv.source_path.starts_with(prefix) { continue; }
}
```

For chunk mode, edges must also be filtered — only include edges where both source and target nodes passed the path filter. Build a `HashSet<String>` of included node IDs after filtering, then filter edges:

```rust
let included_ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
edges.retain(|e| included_ids.contains(e.source.as_str()) && included_ids.contains(e.target.as_str()));
```

For document mode, edges (from link graph) are already keyed by file path, so the same prefix check applies.

The `graph()` dispatcher passes `path_filter` through to whichever function it routes to.

### CLI: Add `--path` Flag

Update `GraphArgs` in `src/main.rs` (currently lines 235-246):

```rust
#[derive(Parser)]
struct GraphArgs {
    /// Graph granularity level
    #[arg(long, value_enum, default_value = "document")]
    level: GraphLevelArg,

    /// Filter to files under this path prefix
    #[arg(long)]
    path: Option<String>,
}
```

Update the handler to pass it through:

```rust
let data = vdb.graph(level, args.path.as_deref())?;
```

### IPC Bridge Updates

Update IPC handler in `app/src/main/ipc-handlers.ts` (lines 213-218):

```typescript
ipcMain.handle('cli:graph', (_event, root: string, level?: string, path?: string) => {
  const args: string[] = []
  if (level) args.push('--level', level)
  if (path) args.push('--path', path)
  return wrapHandler(() => execCommand<GraphData>('graph', args, root))
})
```

Update preload in `app/src/preload/index.ts` (line 43):

```typescript
graphData: (root, level?, path?) => invoke('cli:graph', root, level, path),
```

Update type declaration in `app/src/preload/api.d.ts` (line 69):

```typescript
graphData(root: string, level?: GraphLevel, path?: string): Promise<GraphData>
```

### Graph Store: Path Filter State

Add to `app/src/renderer/stores/graph.ts`:

```typescript
/** Current folder path filter for the graph view. Null = show all. */
export const graphPathFilter = writable<string | null>(null)

/** Set the graph path filter and reload data. */
export function setGraphPathFilter(path: string | null): void {
  graphPathFilter.set(path)
  loadGraphData()
}
```

Update `loadGraphData()` to pass the filter:

```typescript
const pathFilter = get(graphPathFilter)
const data = await window.api.graphData(collection.path, level, pathFilter ?? undefined)
```

Update `resetGraphState()` to clear the filter:

```typescript
graphPathFilter.set(null)
```

### Frontend: Cluster Coloring in Chunk Mode

In `GraphView.svelte`, modify the chunk-mode node fill color logic (currently lines 422-424) from:

```typescript
} else if (chunk) {
    ctx.fillStyle = fileColor(node.path);
```

To:

```typescript
} else if (chunk) {
    if (currentColoring && node.cluster_id != null) {
        ctx.fillStyle = CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length];
    } else {
        ctx.fillStyle = fileColor(node.path);
    }
```

When cluster coloring is toggled off (via the eye icon), it falls back to `fileColor(path)` — preserving file-based coloring as an alternative view.

The cluster legend will automatically appear in chunk mode because `getClusters()` reads `currentData.clusters`, which the backend now populates.

Update the tooltip (around line 654) to also show cluster label in chunk mode when `cluster_id` is present:

```svelte
{#if isChunkMode() && hoveredNode.label}
  <div class="tooltip-heading">{hoveredNode.label}</div>
  {#if hoveredNode.cluster_id != null && currentData}
    {@const cluster = currentData.clusters.find(c => c.id === hoveredNode.cluster_id)}
    {#if cluster}
      <div class="tooltip-cluster">{cluster.label}</div>
    {/if}
  {/if}
{:else if hoveredNode.cluster_id != null && currentData}
```

### Frontend: File-to-Graph Cross-Highlighting

In `GraphView.svelte`, subscribe to `selectedFilePath` from `stores/files.ts`:

```typescript
import { selectedFilePath } from '../stores/files';

let currentSelectedFilePath: string | null = $state(null);

// In onMount:
const unsubFilePath = selectedFilePath.subscribe((p) => {
    currentSelectedFilePath = p;
    dirty = true;
});

// In onDestroy:
unsubFilePath();
```

Add a helper to compute highlighted nodes and edges:

```typescript
function getFileHighlight(filePath: string | null): {
    fileNodeIds: Set<string>;
    fileEdges: Set<SimEdge>;
} {
    const fileNodeIds = new Set<string>();
    const fileEdges = new Set<SimEdge>();
    if (!filePath || !isChunkMode()) return { fileNodeIds, fileEdges };

    for (const node of simNodes) {
        if (node.path === filePath) fileNodeIds.add(node.id);
    }
    if (fileNodeIds.size === 0) return { fileNodeIds, fileEdges };

    for (const edge of simEdges) {
        const s = (edge.source as SimNode).id;
        const t = (edge.target as SimNode).id;
        if (fileNodeIds.has(s) || fileNodeIds.has(t)) fileEdges.add(edge);
    }

    return { fileNodeIds, fileEdges };
}
```

Integrate into `draw()`:

```typescript
const { fileNodeIds, fileEdges } = getFileHighlight(currentSelectedFilePath);
const hasFileHighlight = fileNodeIds.size > 0;
```

**Node dimming** — single-node selection takes priority:

```typescript
const dimmed = hasSelection
    ? (!isSelected && !isNeighbor)
    : hasFileHighlight
        ? !fileNodeIds.has(node.id)
        : false;
```

**Glow effect** for file-highlighted nodes (after fill, before selected ring):

```typescript
if (!hasSelection && hasFileHighlight && fileNodeIds.has(node.id)) {
    ctx.save();
    ctx.shadowColor = '#00E5FF';
    ctx.shadowBlur = 12 / zoom;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();
    ctx.restore();
}
```

**Edge highlighting** — when file is highlighted, edges connected to file nodes draw with higher opacity; others dim:

```typescript
const isFileEdge = !hasSelection && hasFileHighlight && fileEdges.has(edge);
// If isFileEdge: draw with full opacity
// If hasFileHighlight && !isFileEdge: draw with very low opacity (0.03)
```

### Frontend: Reduce Default Edge Brightness in Chunk Mode

The current default edge opacity formula is `alpha = 0.15 + weight * 0.6` (range 0.15–0.75), which makes the chunk graph look cluttered with bright white lines. Reduce the default (non-selected, non-highlighted) edge brightness significantly so the graph feels calmer. Edges should only become bright when a node is selected or a file is highlighted.

Update the non-highlighted edge drawing in `draw()`:

```typescript
// Default edges (no selection, no file highlight active):
const alpha = 0.05 + (weight ?? 0) * 0.2  // range: 0.05 to 0.25 (was 0.15 to 0.75)
ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
```

When a node IS selected or a file IS highlighted, the connected edges draw at full brightness (cyan 0.7 for selected/file-highlighted edges). The contrast between dim background edges and bright highlighted edges makes the graph much more readable.

### Frontend: Remove Fake Edge Directionality in Chunk Mode

Currently, when a node is selected in the graph, `getSelectedNeighbors()` classifies edges as "outgoing" (cyan, source === selected) or "incoming" (red, target === selected). For document mode this is meaningful — edges represent directional markdown links (`[text](target.md)`). But in chunk mode, edges represent symmetric cosine similarity. The in/out distinction is an artifact of kNN graph construction (A found B as a neighbor, but B may not have found A), not a real semantic direction.

In `GraphView.svelte`, modify the edge highlighting logic in `draw()` to detect chunk mode:

**When `isChunkMode()` and a node is selected:**
- Draw ALL connected edges in a single color (cyan `#00E5FF`) with uniform width
- Do NOT draw arrows — just lines
- Do NOT split into outgoing/incoming sets

The existing `getSelectedNeighbors()` already returns a combined `neighbors` set. In chunk mode, use only that combined set. Skip the separate `outEdges`/`inEdges` iteration and draw all neighbor edges identically:

```typescript
// In the highlighted edge drawing section:
if (chunk) {
    // Chunk mode: symmetric similarity, single color, no arrows
    for (const edge of [...outEdges, ...inEdges]) {
        const s = edge.source as SimNode;
        const t = edge.target as SimNode;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
    }
} else {
    // Document mode: keep existing directional cyan/red + arrows
    // ... existing code ...
}
```

### Frontend: "Show in Graph" Context Menu

In `FileTree.svelte`, add a context menu item for directories (after the "Reveal in Finder" button, inside the `{#if contextMenuIsDir}` section or as a new dir-specific block):

```svelte
{#if contextMenuIsDir}
  <div class="context-menu-separator"></div>
  <button class="context-menu-item" onclick={handleShowInGraph}>
    <span class="material-symbols-outlined">hub</span>
    Show in Graph
  </button>
{/if}
```

The handler:

```typescript
import { setGraphPathFilter, graphViewActive } from '../stores/graph';

function handleShowInGraph(): void {
    if (!contextMenuPath) return;
    setGraphPathFilter(contextMenuPath);
    if (!get(graphViewActive)) {
        graphViewActive.set(true);
        // loadGraphData() already called by setGraphPathFilter
    }
    closeContextMenu();
}
```

### Frontend: Folder Path Indicator

In `GraphView.svelte`, subscribe to `graphPathFilter` and render a badge in the top-left:

```svelte
{#if currentPathFilter}
  <div class="graph-path-filter">
    <span class="material-symbols-outlined" style="font-size: 14px;">folder</span>
    <span class="graph-path-filter-text">{currentPathFilter}</span>
    <button class="graph-path-filter-clear" onclick={() => setGraphPathFilter(null)}>
      <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
    </button>
  </div>
{/if}
```

CSS:

```css
.graph-path-filter {
  position: absolute;
  top: var(--space-3, 0.75rem);
  left: var(--space-3, 0.75rem);
  display: flex;
  align-items: center;
  gap: var(--space-1, 0.25rem);
  padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
  background: var(--color-surface, #161617);
  border: 1px solid var(--color-border, #27272a);
  border-radius: var(--radius-md, 0.375rem);
  color: var(--color-text-dim, #71717a);
  font-size: var(--text-xs, 0.625rem);
  font-family: var(--font-mono, monospace);
  z-index: var(--z-base, 10);
}

.graph-path-filter-text {
  color: var(--color-primary, #00E5FF);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-path-filter-clear {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: var(--color-text-dim, #71717a);
  cursor: pointer;
  padding: 0;
}

.graph-path-filter-clear:hover {
  color: var(--color-text, #e4e4e7);
}
```

## Migration Strategy

No migration needed. All changes are additive:
- Chunk nodes gaining `cluster_id` is backward-compatible (was `null`, now `Some(id)`)
- `--path` flag is optional with no default
- New context menu item doesn't affect existing menu items
- Path filter defaults to `null` (show all — identical to current behavior)

## Implementation Steps

1. Build `path_to_cluster` map in `graph_data_chunks()` and populate chunk nodes' `cluster_id` from parent document
2. Return non-empty `clusters` vec from `graph_data_chunks()` instead of `Vec::new()`
3. Add `path_filter: Option<&str>` parameter to `graph_data()`, `graph_data_chunks()`, and `graph()`
4. Implement path-prefix filtering in both graph functions (skip non-matching paths, filter edges)
5. Add `--path` argument to `GraphArgs` in `src/main.rs` and pass through to `vdb.graph()`
6. Write Rust tests: cluster inheritance on chunk nodes, path-filtered graph output
7. Run `cargo test` and `cargo clippy --all-targets` — must pass clean
8. Update IPC handler to accept and pass `path` parameter
9. Update preload API signature to include `path` parameter
10. Add `graphPathFilter` store and `setGraphPathFilter()` to `stores/graph.ts`
11. Update `loadGraphData()` to pass path filter to API call
12. Change chunk mode node coloring from `fileColor(path)` to cluster-based coloring in `GraphView.svelte`
13. Enable cluster legend in chunk mode (automatic once backend returns clusters)
14. Update tooltip to show cluster label in chunk mode
15. Add `selectedFilePath` subscription and `getFileHighlight()` helper to `GraphView.svelte`
16. Integrate file highlighting into `draw()` — dimming, glow effect, edge highlighting
17. Remove fake edge directionality in chunk mode — single color, no arrows for selected node edges
18. Add "Show in Graph" context menu item for directories in `FileTree.svelte`
18. Add folder path indicator badge (top-left) with clear button in `GraphView.svelte`
19. Verify end-to-end in app

## Validation Criteria

- [ ] `cargo test` passes with all existing + new tests
- [ ] `cargo clippy --all-targets` reports zero warnings
- [ ] `mdvdb graph --level chunk --json` returns chunk nodes with non-null `cluster_id` values
- [ ] `mdvdb graph --level chunk --json` returns non-empty `clusters` array
- [ ] `mdvdb graph --level chunk --path docs/ --json` returns only chunks from `docs/` subtree
- [ ] `mdvdb graph --path docs/ --json` returns only document nodes from `docs/` subtree
- [ ] Chunk graph nodes are colored by cluster (matching document mode colors)
- [ ] Toggling cluster coloring off switches chunk nodes to file-based coloring
- [ ] Cluster legend appears in chunk mode with labels and keywords
- [ ] Clicking a file in sidebar highlights its chunks with cyan glow in chunk graph
- [ ] Similarity edges for highlighted file's chunks are visible; other edges dim
- [ ] Clicking a node in the graph still works (takes priority over file highlight)
- [ ] In chunk mode, selected node edges are all cyan (no red/cyan directional split)
- [ ] In chunk mode, selected node edges have no arrows (just lines)
- [ ] In document mode, selected node edges still show cyan/red directional arrows (unchanged)
- [ ] Default (unselected) chunk edges are subtle/faint — not visually overwhelming
- [ ] Selected/highlighted edges are clearly brighter than default edges
- [ ] Right-click on a folder in file tree shows "Show in Graph" option
- [ ] "Show in Graph" switches to graph view with folder filter active
- [ ] Folder path badge appears in top-left of graph view
- [ ] Clicking × on folder badge clears filter and shows full graph
- [ ] Folder filter persists when switching between Documents/Chunks tabs
- [ ] Clearing folder filter via × button reloads full graph in current tab

## Anti-Patterns to Avoid

- **Chunk-level clustering computation** — Don't compute new clusters for chunks. Inherit the parent document's assignment. Clustering is an O(N) operation that should stay document-level.
- **Filtering in the frontend** — Don't fetch all graph data and filter on the client side. The `--path` filter runs in Rust so the frontend receives only the relevant subset. This keeps IPC payloads small for large collections.
- **Breaking single-node selection** — File highlighting must compose with, not replace, the existing click-to-select behavior. When a node is clicked, its selection takes priority over any file highlighting.
- **Navigating away from graph on context menu** — "Show in Graph" should activate the graph view if not already active, not navigate to a separate page.
- **Hardcoding folder paths** — The folder filter is a runtime-only state in the `graphPathFilter` store. It's not persisted to config or URL params.

## Patterns to Follow

- **Path-prefix filtering** — Follow the `starts_with` pattern from `search.rs:375-377` for graph path filtering
- **Store subscription** — Follow the existing `graphData.subscribe()` pattern in `GraphView.svelte` for the new `selectedFilePath` and `graphPathFilter` subscriptions
- **Context menu** — Follow the existing pattern in `FileTree.svelte` lines 435-485: button with `.context-menu-item` class, material icon, handler that calls `closeContextMenu()`
- **Graph overlay UI** — Follow the tab switcher pattern (absolute-positioned, `z-index: var(--z-base)`, surface background with border) for the folder path indicator
- **IPC parameter passing** — Follow the existing `if (path) args.push('--path', path)` pattern from the search IPC handler in `ipc-handlers.ts:149`
- **Coloring fallback** — Follow the document mode pattern where cluster coloring can be toggled off via the eye icon, falling back to an alternative coloring scheme
