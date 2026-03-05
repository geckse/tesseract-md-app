# PRD: Chunk-Level Graph View

## Overview

Add a Document/Chunk toggle to the graph view that switches between the existing file-level graph (Phase 14) and a new chunk-level graph. In chunk mode, each indexed chunk becomes a node, edges represent cross-file embedding similarity (kNN), and nodes are colored by their source file. A tab switcher at the top-center of the graph canvas lets users flip between modes. This requires a new Rust backend method that extracts per-chunk embedding vectors and computes kNN similarity, a new CLI flag (`--level document|chunk`), and frontend rendering adaptations.

## Problem Statement

Phase 14's graph view shows one node per file with edges from explicit markdown links. This is useful for navigating file relationships, but doesn't reveal semantic connections — files about similar topics that don't link to each other are invisible. More importantly, files often contain multiple conceptually distinct sections (chunks), and the file-level view hides this internal structure.

The index already stores per-chunk embedding vectors in the HNSW index, and those vectors encode semantic similarity. By surfacing chunk-level nodes with similarity-based edges, users can see which sections across different files are semantically related — even when there are no explicit links.

The data is already available: `StoredChunk` in the index has `source_path`, `heading_hierarchy`, and `chunk_index`. The HNSW index stores per-chunk embedding vectors accessible via `id_to_key` + `hnsw.get()`. The kNN query infrastructure exists in `Index::search_vectors()`. This feature just needs to wire these together into a new graph mode.

## Goals

- Add a `--level document|chunk` flag to the `mdvdb graph` CLI command
- Implement `graph_data_chunks()` Rust method that builds chunk-level graph topology via kNN similarity
- Render chunk nodes colored by source file (all chunks from the same file share a color)
- Show heading hierarchy as chunk node labels (e.g., "Authentication > OAuth Setup")
- Vary edge opacity by cosine similarity weight (stronger connections more visible)
- Provide a tab switcher UI at the top-center of the graph view to toggle modes
- Exclude intra-file edges (only cross-file chunk connections)

## Non-Goals

- **Intra-file edges** — Connecting chunks within the same file (sequential chain) is explicitly excluded. File grouping is conveyed via color.
- **Chunk-level clustering** — Clustering remains document-level. Chunk nodes inherit no cluster assignment.
- **Link-based chunk edges** — Resolving markdown links to specific chunks via line numbers or heading fragments is deferred. This phase uses embedding similarity only.
- **Configurable k** — The number of kNN neighbors (k=5) is hardcoded. A user-facing slider could be added later.
- **Chunk preview editing** — The preview panel remains read-only. Clicking a chunk node shows the file content.

## Technical Design

### Extended Rust Types

Extend existing structs in `src/lib.rs` (currently lines 236-276). All additions are backward-compatible (new fields are `Option` or have defaults).

```rust
/// Level of detail for graph visualization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
pub enum GraphLevel {
    /// One node per indexed file, edges from markdown links.
    Document,
    /// One node per chunk, edges from embedding similarity (cross-file kNN).
    Chunk,
}

impl Default for GraphLevel {
    fn default() -> Self { GraphLevel::Document }
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    /// Unique node identifier.
    /// Document mode: relative file path. Chunk mode: chunk ID ("path.md#0").
    pub id: String,
    /// Relative file path (always present — source file for chunks).
    pub path: String,
    /// Cluster assignment (document mode only).
    pub cluster_id: Option<usize>,
    /// Heading hierarchy label (chunk mode only). E.g. "Authentication > OAuth Setup".
    pub label: Option<String>,
    /// Chunk index within the file (chunk mode only).
    pub chunk_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    /// Source node ID.
    pub source: String,
    /// Target node ID.
    pub target: String,
    /// Cosine similarity score (chunk mode only, 0.0–1.0).
    pub weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    /// Which mode produced this data: "document" or "chunk".
    pub level: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub clusters: Vec<GraphCluster>,
}
```

The existing `graph_data()` method is updated to populate the new fields with defaults: `id = path.clone()`, `label = None`, `chunk_index = None`, `weight = None`, `level = "document"`.

### New Index Method: `get_chunk_vectors()`

New method in `src/index/state.rs` (after existing `get_document_vectors()` at line 398):

```rust
/// Information about a single chunk for graph visualization.
pub struct ChunkVectorInfo {
    pub chunk_id: String,
    pub source_path: String,
    pub heading_hierarchy: Vec<String>,
    pub chunk_index: usize,
    pub vector: Vec<f32>,
}

impl Index {
    /// Get all chunk vectors with their metadata.
    ///
    /// Iterates all chunks in the index, reads each embedding from the HNSW
    /// index, and returns the vector alongside chunk metadata needed for the
    /// chunk-level graph.
    pub fn get_chunk_vectors(&self) -> Vec<ChunkVectorInfo> {
        let state = self.state.read();
        let dims = state.metadata.embedding_config.dimensions;
        let mut result = Vec::new();

        for (chunk_id, chunk) in &state.metadata.chunks {
            if let Some(&key) = state.id_to_key.get(chunk_id) {
                let mut buf = vec![0.0f32; dims];
                if state.hnsw.get(key, &mut buf).is_ok() {
                    result.push(ChunkVectorInfo {
                        chunk_id: chunk_id.clone(),
                        source_path: chunk.source_path.clone(),
                        heading_hierarchy: chunk.heading_hierarchy.clone(),
                        chunk_index: chunk.chunk_index,
                        vector: buf,
                    });
                }
            }
        }

        result
    }
}
```

This follows the exact same pattern as `get_document_vectors()` (line 367-398) which iterates `id_to_key` and calls `hnsw.get(key, &mut buf)`. The read lock is acquired once and held for the duration.

### New Library Method: `graph_data_chunks()`

New method in `src/lib.rs` (after existing `graph_data()` at line 1234):

```rust
impl MarkdownVdb {
    /// Return chunk-level graph data with embedding similarity edges.
    ///
    /// Each chunk becomes a node. Edges connect chunks from different files
    /// via kNN search in the HNSW index. Intra-file edges are excluded.
    pub fn graph_data_chunks(&self, k: usize) -> Result<GraphData> {
        let chunk_infos = self.index.get_chunk_vectors();

        // 1. Build nodes with heading labels
        let nodes: Vec<GraphNode> = chunk_infos.iter().map(|info| {
            let label = if info.heading_hierarchy.is_empty() {
                let filename = info.source_path.rsplit('/').next()
                    .unwrap_or(&info.source_path);
                format!("{}#{}", filename, info.chunk_index)
            } else {
                info.heading_hierarchy.join(" > ")
            };

            GraphNode {
                id: info.chunk_id.clone(),
                path: info.source_path.clone(),
                cluster_id: None,
                label: Some(label),
                chunk_index: Some(info.chunk_index),
            }
        }).collect();

        // 2. Build edges via kNN search per chunk (cross-file only)
        let search_k = k + 20; // over-fetch to compensate for same-file filtering
        let mut edges = Vec::new();
        let mut seen: HashSet<(String, String)> = HashSet::new();

        for info in &chunk_infos {
            let results = self.index.search_vectors(&info.vector, search_k)?;
            let mut count = 0;
            for (neighbor_id, score) in results {
                if count >= k { break; }
                if neighbor_id == info.chunk_id { continue; }

                // Skip intra-file edges
                if let Some(neighbor) = self.index.get_chunk(&neighbor_id) {
                    if neighbor.source_path == info.source_path { continue; }
                }

                // Deduplicate bidirectional pairs
                let key = if info.chunk_id < neighbor_id {
                    (info.chunk_id.clone(), neighbor_id.clone())
                } else {
                    (neighbor_id.clone(), info.chunk_id.clone())
                };

                if seen.insert(key) {
                    edges.push(GraphEdge {
                        source: info.chunk_id.clone(),
                        target: neighbor_id,
                        weight: Some(score),
                    });
                    count += 1;
                }
            }
        }

        Ok(GraphData {
            level: "chunk".to_string(),
            nodes,
            edges,
            clusters: Vec::new(),
        })
    }

    /// Return graph data at the specified level of detail.
    pub fn graph(&self, level: GraphLevel) -> Result<GraphData> {
        match level {
            GraphLevel::Document => self.graph_data(),
            GraphLevel::Chunk => self.graph_data_chunks(5),
        }
    }
}
```

**Performance:** Each kNN query uses `Index::search_vectors()` which calls `hnsw.search()` — an O(log n) HNSW query. For N chunks, total cost is O(N log N). With 1000 chunks, this completes in well under 1 second. The `search_k = k + 20` over-fetch compensates for same-file results that get filtered out.

**Concurrency:** `get_chunk_vectors()` acquires a `parking_lot` read lock on the index state, then releases it. Each subsequent `search_vectors()` call acquires its own read lock. Multiple concurrent readers are supported by `parking_lot::RwLock`.

### CLI Flag

Update `GraphArgs` in `src/main.rs` (currently empty struct at line 236):

```rust
#[derive(Parser)]
struct GraphArgs {
    /// Graph detail level: document (one node per file) or chunk (one node per section)
    #[arg(long, value_name = "LEVEL", default_value = "document")]
    level: GraphLevel,
}
```

Update the handler (lines 639-648):

```rust
Some(Commands::Graph(args)) => {
    let vdb = MarkdownVdb::open_readonly_with_config(cwd, config)?;
    let data = vdb.graph(args.level)?;
    if json {
        serde_json::to_writer_pretty(std::io::stdout(), &data)?;
        writeln!(std::io::stdout())?;
    } else {
        format::print_graph_summary(&data);
    }
}
```

### IPC Bridge Updates

Updated TypeScript types in `app/src/renderer/types/cli.ts`:

```typescript
export type GraphLevel = 'document' | 'chunk'

export interface GraphNode {
  id: string
  path: string
  cluster_id: number | null
  label: string | null
  chunk_index: number | null
}

export interface GraphEdge {
  source: string
  target: string
  weight: number | null
}

export interface GraphData {
  level: GraphLevel
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
}
```

Updated IPC handler in `app/src/main/ipc-handlers.ts`:

```typescript
ipcMain.handle('cli:graph', (_event, root: string, level?: string) => {
  const args = level ? ['--level', level] : []
  return wrapHandler(() => execCommand<GraphData>('graph', args, root))
})
```

Updated preload in `app/src/preload/index.ts`:

```typescript
graphData: (root, level?) => invoke('cli:graph', root, level),
```

Updated type declaration in `app/src/preload/api.d.ts`:

```typescript
graphData(root: string, level?: GraphLevel): Promise<GraphData>
```

### Graph Store Updates

Updated `app/src/renderer/stores/graph.ts`:

```typescript
import type { GraphLevel } from '../types/cli'

/** Current graph detail level. */
export const graphLevel = writable<GraphLevel>('document')

/** Load graph data at the current level. */
export async function loadGraphData(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) { graphLoading.set(false); return }

  const generation = ++loadGeneration
  const level = get(graphLevel)
  graphLoading.set(true)
  graphError.set(null)

  try {
    const data = await window.api.graphData(collection.path, level)
    if (generation !== loadGeneration) return
    graphData.set(data)
    graphError.set(null)
  } catch (err) {
    if (generation !== loadGeneration) return
    graphError.set(err instanceof Error ? err.message : String(err))
    graphData.set(null)
  } finally {
    if (generation === loadGeneration) graphLoading.set(false)
  }
}

/** Switch graph level and reload. */
export function setGraphLevel(level: GraphLevel): void {
  graphLevel.set(level)
  graphSelectedNode.set(null)
  loadGraphData()
}

/** Reset all graph state. */
export function resetGraphState(): void {
  loadGeneration++
  graphViewActive.set(false)
  graphData.set(null)
  graphLoading.set(false)
  graphError.set(null)
  graphSelectedNode.set(null)
  graphClusterColoring.set(true)
  graphLevel.set('document')
}
```

### GraphView Component Updates

Updated `app/src/renderer/components/GraphView.svelte`:

**Tab switcher UI** — Absolutely positioned overlay at top-center, inside the `{:else}` data block:

```
┌──────────────────────────────────────────────────────┐
│                 [Documents | Chunks]                  │  ← tab switcher
│                                                      │
│          ● ──── ●            Clusters  [eye] [^]     │
│          │      │            ● services / error  8   │
│     ●    ● ──── ●●──●       ● markdown / marcus 4   │
│                 │                                    │
│                 ●                                    │
│                                                      │
│          No link connections found.                   │
└──────────────────────────────────────────────────────┘
```

```svelte
<div class="graph-level-switcher" role="tablist">
  <button class="level-tab" class:active={currentLevel === 'document'}
    onclick={() => setGraphLevel('document')}>Documents</button>
  <button class="level-tab" class:active={currentLevel === 'chunk'}
    onclick={() => setGraphLevel('chunk')}>Chunks</button>
</div>
```

**SimNode interface** — Add `id`, `label`, `chunk_index` fields:

```typescript
interface SimNode extends SimulationNodeDatum {
  id: string              // unique key (was path-only in Phase 14)
  path: string            // source file path
  cluster_id: number | null
  label: string | null
  chunk_index: number | null
  x: number
  y: number
}
```

**buildSimulation changes:**
- Use `node.id` as the force-link ID (not `path`)
- Detect chunk mode from `data.level === 'chunk'`
- Chunk mode: smaller `distance(60)`, weaker `charge(-80)`, smaller `collide(10)`
- Chunk mode: smaller warm-up `tick(200)` since more nodes

**draw() changes:**

Node coloring in chunk mode — Hash `node.path` to a palette index so all chunks from the same file share a color:

```typescript
function fileColor(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length]
}
```

In chunk mode, use `fileColor(node.path)` instead of cluster coloring.

Node radius — chunk mode: base=3 (vs document's base=5). More nodes need smaller dots.

Labels — chunk mode shows last segment of `node.label` (deepest heading): `node.label?.split(' > ').pop()`. Document mode shows filename as before.

Edge opacity — when `weight` exists (chunk mode), set stroke alpha proportional to score:

```typescript
const alpha = 0.15 + (weight ?? 0) * 0.6  // range: 0.15 (low similarity) to 0.75 (high)
ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
```

Selection matching — `getSelectedNeighbors()` compares against `node.id` instead of `node.path`.

"No link connections found" notice — hide in chunk mode (similarity edges are always present unless index is empty).

**Tooltip update:**

```svelte
{#if hoveredNode}
  <div class="graph-tooltip" ...>
    <div class="tooltip-path">{hoveredNode.path}</div>
    {#if hoveredNode.label}
      <div class="tooltip-heading">{hoveredNode.label}</div>
    {/if}
    ...
  </div>
{/if}
```

### Tab Switcher CSS

```css
.graph-level-switcher {
  position: absolute;
  top: var(--space-3, 0.75rem);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  background: var(--color-surface, #161617);
  border: 1px solid var(--color-border, #27272a);
  border-radius: var(--radius-md, 0.375rem);
  z-index: var(--z-base, 10);
  overflow: hidden;
}

.level-tab {
  display: flex;
  align-items: center;
  gap: var(--space-1, 0.25rem);
  padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
  background: none;
  border: none;
  color: var(--color-text-dim, #71717a);
  font-family: var(--font-display, 'Space Grotesk', sans-serif);
  font-size: var(--text-xs, 0.625rem);
  cursor: pointer;
  transition: all var(--transition-fast, 150ms ease);
}

.level-tab:not(:last-child) {
  border-right: 1px solid var(--color-border, #27272a);
}

.level-tab.active {
  color: var(--color-primary, #00E5FF);
  background: rgba(0, 229, 255, 0.08);
}
```

## Migration Strategy

No migration needed. All changes are additive. The `graph_data()` method gains new optional fields with backward-compatible defaults. The existing `mdvdb graph` command without `--level` defaults to `document` mode (identical to current behavior). Frontend code that only reads `path` and `cluster_id` continues to work.

## Implementation Steps

1. Add `GraphLevel` enum and extend `GraphNode`, `GraphEdge`, `GraphData` structs in `src/lib.rs`
2. Update existing `graph_data()` to populate new fields with defaults
3. Add re-export for `GraphLevel` in `src/lib.rs`
4. Add `ChunkVectorInfo` struct and `get_chunk_vectors()` method in `src/index/state.rs`
5. Add `graph_data_chunks()` and `graph()` dispatcher methods in `src/lib.rs`
6. Add `--level` flag to `GraphArgs` and update handler in `src/main.rs`
7. Update `print_graph_summary()` in `src/format.rs` for new fields
8. Write Rust tests in `tests/graph_test.rs` (chunk graph tests)
9. Add CLI test for `--level chunk` in `tests/cli_test.rs`
10. Run `cargo test` and `cargo clippy --all-targets` — must pass clean
11. Install updated `mdvdb` binary to PATH
12. Update TypeScript interfaces in `app/src/renderer/types/cli.ts`
13. Update IPC handler in `app/src/main/ipc-handlers.ts` to accept `level` param
14. Update preload in `app/src/preload/index.ts` and `app/src/preload/api.d.ts`
15. Add `graphLevel` store and `setGraphLevel()` in `app/src/renderer/stores/graph.ts`
16. Add tab switcher, chunk rendering, file coloring, and edge opacity to `GraphView.svelte`
17. Verify in app: toggle graph, switch tabs, click nodes, check colors and edges

## Validation Criteria

- [ ] `cargo test` passes with all existing + new chunk graph tests
- [ ] `cargo clippy --all-targets` reports zero warnings
- [ ] `mdvdb graph --json` returns document-level data with `id`, `level` fields (backward compat)
- [ ] `mdvdb graph --level chunk --json` returns chunk-level nodes with `label`, `chunk_index`, and weighted edges
- [ ] `mdvdb graph --level document --json` returns same result as `mdvdb graph --json`
- [ ] No intra-file edges appear in chunk mode output
- [ ] Chunk nodes have heading hierarchy labels (or "filename#N" fallback)
- [ ] All chunk edges have non-null `weight` values
- [ ] Tab switcher appears centered at top of graph view
- [ ] Clicking "Documents" tab loads file-level graph (same as Phase 14)
- [ ] Clicking "Chunks" tab loads chunk-level graph with similarity edges
- [ ] Chunk nodes from the same file share the same color
- [ ] Edge opacity varies by similarity weight in chunk mode
- [ ] Chunk labels show deepest heading segment
- [ ] Tooltip shows full heading hierarchy for chunk nodes
- [ ] Node drag, pan, zoom, and selection work in both modes
- [ ] Arrow highlighting on selection works in both modes
- [ ] "No link connections found" notice only shows in document mode
- [ ] Switching tabs clears selection and reloads data
- [ ] Graph renders within 2s for 500+ chunk collections

## Anti-Patterns to Avoid

- **All-pairs cosine similarity** — Computing O(N^2) pairwise similarity between all chunks is wasteful. Use the existing HNSW kNN search (`search_vectors()`) which is O(log N) per query. The HNSW index already has the vectors loaded.
- **Loading chunk vectors in the frontend** — Embedding vectors should never leave the Rust backend. All similarity computation happens in `graph_data_chunks()`. The frontend only receives nodes and edges.
- **Intra-file edges** — Connecting chunks within the same file would dominate the graph with uninformative edges. They share content context by definition. File grouping is conveyed via shared node color.
- **Separate API endpoints** — Don't create a separate `cli:graph-chunks` IPC channel. Use the existing `cli:graph` channel with a `level` parameter to keep the interface consistent with `mdvdb graph --level`.
- **Re-rendering full graph on tab switch** — When switching between document and chunk mode, destroy the old simulation and build a new one from scratch. Don't try to morph between the two layouts.

## Patterns to Follow

- **Index method pattern** — `get_chunk_vectors()` follows the same `state.read()` + `hnsw.get(key, &mut buf)` pattern as `get_document_vectors()` in `src/index/state.rs:367`
- **IPC bridge pattern** — Follow the existing `execCommand<T>()` → `wrapHandler()` → preload `invoke()` pattern from `ipc-handlers.ts`
- **CLI value enum** — `GraphLevel` with `clap::ValueEnum` follows the same pattern as `SearchMode` / `VectorQuantization` in the codebase
- **Store pattern** — `graphLevel` writable + `setGraphLevel()` follows the existing store conventions in `stores/graph.ts`
- **Graph rendering** — Build on the existing Canvas 2D + d3-force + `requestAnimationFrame` architecture from Phase 14's `GraphView.svelte`
- **Design tokens** — Tab switcher uses `--color-primary`, `--color-surface`, `--color-border` from `tokens.css`
- **Test pattern** — Chunk graph tests follow the existing `tests/graph_test.rs` pattern: `mock_config()` + `TempDir` + write markdown + ingest + assert on `GraphData`
