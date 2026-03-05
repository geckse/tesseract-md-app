# PRD: Graph + Cluster View

## Overview

Add a unified graph visualization to the desktop app that shows all files in a collection as an interactive force-directed graph. Nodes represent files, edges represent markdown links between files, and cluster membership is visualized via node color. The graph replaces the main content area (editor + properties panel) and is toggled via a titlebar button. Clicking a node opens a rendered Markdown preview panel alongside the graph.

## Problem Statement

The app currently provides a file tree for navigating collections and a properties panel that shows links for the selected file. But there's no way to see the full relationship structure of a collection at a glance — how files link to each other, which files form natural clusters, and which are orphaned. Users working with interconnected note collections (e.g., knowledge bases, research vaults) need a visual map to understand and navigate relationships.

The Rust CLI already computes and stores both the full `LinkGraph` (all inter-file links) and `ClusterState` (k-means document clusters) in the index. However:
- The `links(path)` API only returns links for a single file
- The `clusters()` API returns `ClusterSummary` which strips member lists
- There is no endpoint that returns the complete graph topology in one call

## Goals

- Provide a full-collection graph view showing all indexed files as nodes and all links as edges
- Visualize cluster membership via node coloring with a toggleable legend
- Enable performant rendering for collections up to 500+ files using Canvas 2D + d3-force
- Allow clicking a node to see a rendered Markdown preview with frontmatter metadata
- Support "Open in Editor" to navigate from graph → editor seamlessly
- Add a new Rust API endpoint (`graph_data()`) that returns the complete graph topology in a single call

## Non-Goals

- **Local/ego graph mode** — This phase implements full-collection graph only. A depth-limited local graph around a selected file could be added later.
- **Graph editing** — Nodes and edges are read-only. No creating/deleting links from the graph view.
- **3D visualization** — Canvas 2D is sufficient for the target scale. WebGL/3D can be explored in a future phase if needed.
- **Real-time graph updates** — The graph loads data on activation. Live updates from the file watcher are out of scope (user can refresh).
- **Editable preview** — The preview panel is read-only. Users click "Open in Editor" to edit.

## Technical Design

### Data Model: New Rust Structs

New types in `src/lib.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub clusters: Vec<GraphCluster>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub path: String,              // Relative file path (unique ID)
    pub cluster_id: Option<usize>, // Cluster assignment, if any
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub source: String,            // Source file path
    pub target: String,            // Target file path
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphCluster {
    pub id: usize,
    pub label: String,             // Auto-generated from top keywords
    pub keywords: Vec<String>,     // Cross-cluster TF-IDF keywords
    pub member_count: usize,
}
```

### New Rust API Method

```rust
impl MarkdownVdb {
    pub fn graph_data(&self) -> Result<GraphData> {
        // 1. Get all indexed file paths from file_hashes
        // 2. Get ClusterState, build path → cluster_id map
        // 3. Get LinkGraph.forward, filter edges to only include
        //    edges where both source and target exist in the index
        // 4. Return combined GraphData
    }
}
```

This method reads data already stored in the index — no recomputation needed. It combines:
- `index.get_file_hashes()` → all node paths
- `index.get_clusters()` → cluster membership mapping
- `index.get_link_graph()` → all edges

### New CLI Subcommand

```
mdvdb graph [--json]
```

Add `Graph` variant to the `Commands` enum in `src/main.rs`. JSON output returns `GraphData`. Human-readable output shows summary: `Nodes: N, Edges: N, Clusters: N`.

### IPC Bridge

New TypeScript types mirroring the Rust structs:

```typescript
export interface GraphNode { path: string; cluster_id: number | null }
export interface GraphEdge { source: string; target: string }
export interface GraphCluster { id: number; label: string; keywords: string[]; member_count: number }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; clusters: GraphCluster[] }
```

New IPC channel:

```typescript
// ipc-handlers.ts
ipcMain.handle('cli:graph', (_event, root: string) =>
  wrapHandler(() => execCommand<GraphData>('graph', [], root))
)

// preload/index.ts
graphData: (root: string) => invoke('cli:graph', root)

// preload/api.d.ts
graphData(root: string): Promise<GraphData>
```

### New Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `d3-force` | `^3.0` | ~30KB | Force-directed layout simulation (no DOM dependency) |
| `@types/d3-force` | `^3.0` | — | TypeScript types |
| `marked` | `^12.0` | ~40KB | Markdown → HTML rendering for preview panel |

### Graph Store

New file: `app/src/renderer/stores/graph.ts`

```typescript
graphViewActive: Writable<boolean>         // Toggle between editor and graph
graphData: Writable<GraphData | null>      // Data from CLI
graphLoading: Writable<boolean>
graphError: Writable<string | null>
graphSelectedNode: Writable<string | null> // Currently clicked node
graphClusterColoring: Writable<boolean>    // Toggle cluster colors (default: true)
```

Functions:
- `loadGraphData()` — fetches via `window.api.graphData()`, manages loading/error state
- `toggleGraphView()` — toggles view, loads data when activating
- `selectGraphNode(path | null)` — sets selected node

### GraphView Component

New file: `app/src/renderer/components/GraphView.svelte`

Architecture: `d3-force` computes positions → `requestAnimationFrame` → Canvas 2D draws.

**d3-force configuration:**

```typescript
forceSimulation(nodes)
  .force('link', forceLink(edges).id(d => d.path).distance(80).strength(0.4))
  .force('charge', forceManyBody().strength(-120).distanceMax(400))
  .force('center', forceCenter(width / 2, height / 2))
  .force('collide', forceCollide(16))
  .alphaDecay(0.02)
  .velocityDecay(0.3)
```

For large collections (300+ nodes), adjust: `charge.strength(-60)`, `distanceMax(200)`, `alphaDecay(0.04)`.

**Canvas rendering:**

- Edges: `rgba(255, 255, 255, 0.08)` thin lines
- Nodes: Circles, 5px radius (7px hovered, 8px selected)
- Node fill: Cluster color when coloring enabled, otherwise `rgba(228, 228, 231, 0.6)`
- Selected node: `#00E5FF` stroke ring (2px)
- Labels: Filename text, only rendered when `zoom > 0.8`

**Cluster color palette (12 colors, cycling):**

```
#00E5FF (cyan)    #FF6B6B (red)      #51CF66 (green)
#FFD43B (yellow)  #845EF7 (purple)   #FF922B (orange)
#20C997 (teal)    #F06595 (pink)     #339AF0 (blue)
#B2F2BB (lt green) #D0BFFF (lt purple) #FFC078 (peach)
```

**Interaction:**

- **Click node**: Select → loads preview
- **Hover node**: Tooltip (filename, path, cluster label), cursor change
- **Drag background**: Pan (mousedown + mousemove)
- **Scroll wheel**: Zoom (centered on cursor)
- **Hit detection**: Distance-based search, transform canvas coords → world coords accounting for pan/zoom

**Cluster legend** — Floating overlay, top-right:
- Color dot + cluster label + member count per cluster
- Toggle visibility button (eye icon)
- Only shown when clusters exist

**Performance:**

- Warm-up: `simulation.tick(300)` synchronously before first render
- Render throttling: Only redraw on tick or interaction via `requestAnimationFrame` + dirty flag
- Large vaults (500+): Labels hidden at default zoom, `forceManyBody().theta(0.9)` for Barnes-Hut
- 1000+ nodes: Show warning, offer to filter to connected subgraph only

**Empty states:**

- No files indexed → "No files indexed. Run ingest to build the graph."
- No links → Nodes positioned by force, notice "No link connections found."
- No clusters → Default gray fill, legend hidden
- Loading → Spinner
- Error → Error message + retry button

### GraphPreview Component

New file: `app/src/renderer/components/GraphPreview.svelte`

Right-side panel alongside the graph canvas when a node is selected.

**Layout:**

```
┌────────────────────────────────────────────────────────────────────┐
│  GRAPH CANVAS (flex: 1)            │  PREVIEW PANEL (360px)       │
│                                    │                              │
│   ● ──── ●                         │  filename.md    [Open in Ed] │
│   │      │                         │  ──────────────────────────  │
│   ● ──── ●●──● ← selected         │  #tag1  #tag2   Oct 24, 23  │
│          │                         │                              │
│          ●                         │  # Heading                   │
│                                    │  Body text rendered as       │
│                                    │  styled HTML...              │
│                                    │                              │
│                                    │  > Blockquote                │
│                                    │                              │
└────────────────────────────────────────────────────────────────────┘
```

**Features:**

- Header: Filename + "Open in Editor" button
- Frontmatter: Tags as badges, dates formatted (matching PropertiesPanel style)
- Body: Rendered HTML via `marked`. Strips YAML frontmatter before rendering.
- Dark theme CSS: Headings, code blocks, blockquotes, links styled with design tokens
- Resizable: Left edge drag handle, 240–600px range, persisted to localStorage
- Scroll-to-chunk: Can scroll to specific heading when navigating from search

**"Open in Editor" action:**

```typescript
graphViewActive.set(false)   // Switch back to editor mode
selectFile(selectedPath)     // Open the file in the editor
```

### App Shell Integration

**`App.svelte` changes** — Conditional rendering in `.content-area`:

```svelte
<div class="content-area">
  {#if graphViewActive}
    <GraphView />
    {#if graphSelectedNode}
      <GraphPreview />
    {/if}
  {:else}
    <Editor />
    {#if propertiesOpen}
      <PropertiesPanel />
    {/if}
  {/if}
</div>
```

**`Titlebar.svelte` changes** — Add graph toggle button in `.titlebar-right` before properties toggle:

```svelte
<button class="icon-button" class:active={graphActive} title="Toggle Graph View" onclick={toggleGraph}>
  <span class="material-symbols-outlined">hub</span>
</button>
```

**Keyboard shortcuts** (registered in `App.svelte` `onMount`):

- `Cmd+G` / `Ctrl+G` — Toggle graph view
- `Escape` (in graph) — Deselect node, or exit graph if no node selected

## Migration Strategy

No migration needed. This is purely additive — new Rust API method, new CLI subcommand, new Svelte components and store. No existing behavior changes.

## Implementation Steps

1. Add `GraphData`, `GraphNode`, `GraphEdge`, `GraphCluster` structs to `src/lib.rs`
2. Implement `graph_data()` method on `MarkdownVdb` in `src/lib.rs`
3. Add re-exports for new types in `src/lib.rs`
4. Add `Graph` subcommand to `Commands` enum and handler in `src/main.rs`
5. Write Rust integration tests in `tests/graph_test.rs`
6. Add TypeScript `GraphData` types to `app/src/renderer/types/cli.ts`
7. Add `cli:graph` IPC handler in `app/src/main/ipc-handlers.ts`
8. Add `graphData()` to preload in `app/src/preload/index.ts` and `api.d.ts`
9. Install `d3-force`, `@types/d3-force`, `marked` in `app/`
10. Create `app/src/renderer/stores/graph.ts` with graph state management
11. Write store unit tests in `app/tests/unit/graph-store.test.ts`
12. Create `app/src/renderer/components/GraphView.svelte` with Canvas + d3-force
13. Create `app/src/renderer/components/GraphPreview.svelte` with rendered Markdown
14. Integrate graph view toggle into `app/src/renderer/App.svelte` (conditional rendering + keyboard shortcut)
15. Add graph toggle button to `app/src/renderer/components/Titlebar.svelte`

## Validation Criteria

- [ ] `cargo test` passes with all existing tests + new `graph_test.rs` tests
- [ ] `cargo clippy --all-targets` reports zero warnings
- [ ] `mdvdb graph --json` returns valid `GraphData` JSON for an indexed collection
- [ ] `mdvdb graph --json` returns `{"nodes":[],"edges":[],"clusters":[]}` for empty index
- [ ] Graph toggle button appears in titlebar with `hub` icon
- [ ] Clicking graph toggle loads and displays full-collection graph
- [ ] Nodes are positioned by d3-force layout (no overlapping pile)
- [ ] Edges visually connect linked files
- [ ] Cluster coloring applies distinct colors to nodes based on cluster membership
- [ ] Cluster legend shows all clusters with colors, labels, and counts
- [ ] Toggling cluster coloring off turns all nodes to default gray
- [ ] Hovering a node shows tooltip with filename, path, and cluster
- [ ] Clicking a node opens the preview panel with rendered Markdown
- [ ] Preview panel shows frontmatter tags and dates
- [ ] "Open in Editor" button switches to editor view with the file open
- [ ] Pan (drag background) and zoom (scroll wheel) work smoothly
- [ ] Graph renders within 2s for collections with 300+ files
- [ ] Empty collection shows appropriate empty state message
- [ ] `Cmd+G` toggles graph view on/off
- [ ] `Escape` deselects node or exits graph view
- [ ] App tests pass (`npm test` in `app/`)

## Anti-Patterns to Avoid

- **SVG for large graphs** — SVG creates a DOM node per element. At 500+ nodes this tanks performance. Use Canvas 2D with d3-force computing positions off-DOM.
- **Full d3 bundle** — Only import `d3-force`, not the full d3 library. The full bundle is 200KB+ and we only need force simulation.
- **Re-rendering on every tick** — Don't call `draw()` directly from the simulation tick callback. Use `requestAnimationFrame` with a dirty flag to batch renders at display refresh rate.
- **Fetching links per-file** — Don't call `cli:links` for every file in the collection. The new `cli:graph` endpoint returns everything in one subprocess call.
- **Blocking warm-up** — Run `simulation.tick(300)` in a `requestIdleCallback` or after initial render to avoid blocking the UI thread on large collections.

## Patterns to Follow

- **IPC bridge pattern** — Follow the existing `execCommand<T>()` → `wrapHandler()` → preload `invoke()` pattern from `ipc-handlers.ts`
- **Store pattern** — Use Svelte 5 writable stores with `get()` for synchronous reads, matching `stores/files.ts` and `stores/search.ts`
- **Conditional rendering** — Mirror the existing `{#if propertiesOpen}` pattern in `App.svelte` for toggling the preview panel
- **Design tokens** — Use CSS custom properties from `tokens.css` (`--color-primary`, `--color-surface`, `--color-text`, etc.) for all styling
- **Empty states** — Follow the existing centered empty-state pattern with icon + message used in Editor and FileTree
- **Resize handles** — Follow the existing resize handle pattern from PropertiesPanel (mousedown → mousemove → mouseup, persist to localStorage)
- **Error serialization** — Use `wrapHandler()` in IPC to ensure errors survive Electron's structured clone
