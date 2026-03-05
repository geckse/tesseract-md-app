# PRD: Local Graph Widget

## Overview

Add a compact, interactive local graph widget to the Properties Panel that shows the currently open file and its direct neighbors (depth=1 ego graph). This gives users peripheral awareness of a file's link context while editing, without leaving the editor. A button expands into the full-screen graph view from Phase 14.

## Problem Statement

Phase 14 introduces a full-collection graph view, but it replaces the editor — you can't see the graph and edit at the same time. When editing a file, users want to glance at its immediate neighborhood: what links to it, what it links to, and how those neighbors relate. The Properties Panel already shows links as a flat text list (incoming/outgoing tabs), but a visual graph communicates structure much faster than a list of filenames.

The data needed is already available: `cli:links` and `cli:backlinks` return outgoing and incoming links for the selected file. The local graph just needs to visualize this data as a small force-directed graph within the existing Properties Panel.

## Goals

- Show a local ego graph (selected file + direct neighbors) as a collapsible section in the Properties Panel
- Render inline alongside existing sections (Metadata, Links, Outline) — no layout disruption
- Click a neighbor node to navigate to that file in the editor
- Provide an "Expand" button that opens the full-screen graph view (Phase 14) centered on the current file
- Keep the widget lightweight — SVG is fine here since ego graphs have at most ~30 nodes

## Non-Goals

- ~~**Depth > 1**~~ — *Now implemented:* 2-hop neighbors (depth=2) are fetched asynchronously and displayed with dimmer styling.
- **Cluster coloring in the widget** — The widget is too small for a cluster legend. Cluster visualization is a full graph view feature.
- **Editable edges** — Read-only, same as Phase 14.
- **New Rust API** — This phase reuses existing `links()` and `backlinks()` data already fetched by the Properties Panel. No new CLI commands needed.

## Technical Design

### Data Source

The Properties Panel already fetches link data for the selected file:

```typescript
// stores/properties.ts (existing)
backlinksInfo: Writable<BacklinksOutput | null>   // { backlinks: ResolvedLink[], total_backlinks }
linksInfo: Writable<LinksOutput | null>           // { links: LinkQueryResult }
```

The local graph builds its node/edge model directly from these existing stores — no additional IPC calls.

**Graph model construction (client-side):**

```typescript
interface LocalGraphNode {
  path: string
  label: string       // filename extracted from path
  isCenterNode: boolean
}

interface LocalGraphEdge {
  source: string      // path
  target: string      // path
}

function buildLocalGraph(
  centerPath: string,
  linksInfo: LinksOutput | null,
  backlinksInfo: BacklinksOutput | null
): { nodes: LocalGraphNode[], edges: LocalGraphEdge[] } {
  const nodeMap = new Map<string, LocalGraphNode>()

  // Center node (the currently open file)
  nodeMap.set(centerPath, {
    path: centerPath,
    label: getFileName(centerPath),
    isCenterNode: true,
  })

  // Outgoing link targets
  if (linksInfo?.links.outgoing) {
    for (const link of linksInfo.links.outgoing) {
      if (link.state === 'Valid') {
        nodeMap.set(link.entry.target, {
          path: link.entry.target,
          label: getFileName(link.entry.target),
          isCenterNode: false,
        })
      }
    }
  }

  // Incoming link sources
  if (backlinksInfo?.backlinks) {
    for (const link of backlinksInfo.backlinks) {
      if (link.state === 'Valid') {
        nodeMap.set(link.entry.source, {
          path: link.entry.source,
          label: getFileName(link.entry.source),
          isCenterNode: false,
        })
      }
    }
  }

  // Build edges
  const edges: LocalGraphEdge[] = []
  if (linksInfo?.links.outgoing) {
    for (const link of linksInfo.links.outgoing) {
      if (link.state === 'Valid' && nodeMap.has(link.entry.target)) {
        edges.push({ source: centerPath, target: link.entry.target })
      }
    }
  }
  if (backlinksInfo?.backlinks) {
    for (const link of backlinksInfo.backlinks) {
      if (link.state === 'Valid' && nodeMap.has(link.entry.source)) {
        edges.push({ source: link.entry.source, target: centerPath })
      }
    }
  }

  return { nodes: [...nodeMap.values()], edges }
}
```

### LocalGraph Component

New file: `app/src/renderer/components/LocalGraph.svelte`

**Rendering approach: SVG** (not Canvas)

SVG is the right choice here because:
- Ego graphs have at most ~30 nodes — no performance concern
- SVG elements are DOM nodes — easier click/hover handling, cursor changes, accessibility
- Integrates naturally with Svelte's reactive rendering
- Stays consistent with the rest of the UI (styled via CSS, not pixel drawing)

**d3-force configuration (lighter than full graph):**

```typescript
forceSimulation(nodes)
  .force('link', forceLink(edges).id(d => d.path).distance(50).strength(0.6))
  .force('charge', forceManyBody().strength(-80))
  .force('center', forceCenter(width / 2, height / 2))
  .force('collide', forceCollide(12))
  .alphaDecay(0.05)   // faster stabilization (small graph)
```

Warm-up with `simulation.tick(100)` before first render — small graph stabilizes quickly.

**Layout within the Properties Panel:**

```
┌─────────────────────────────────┐
│  ▸ Metadata                     │  ← existing collapsible section
├─────────────────────────────────┤
│  ▾ Local Graph           [⛶]   │  ← NEW section, [⛶] = expand button
│  ┌─────────────────────────┐   │
│  │         ●               │   │
│  │        / \              │   │
│  │   ●───● ●───●          │   │
│  │        \ /              │   │
│  │         ●               │   │
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│  ▸ Links                        │  ← existing collapsible section
├─────────────────────────────────┤
│  ▸ Outline                      │  ← existing collapsible section
└─────────────────────────────────┘
```

**Section placement:** Between Metadata and Links. The graph provides a visual complement to the Links text list below it.

**SVG container sizing:**
- Width: Fills the panel width (minus padding) — typically ~250px
- Height: Fixed 200px (compact but usable). Collapsible to 0 when section is closed.
- Background: `var(--color-surface-dark)` with subtle border, matching the panel aesthetic

**Node rendering:**

```svelte
{#each simulationNodes as node}
  <circle
    cx={node.x}
    cy={node.y}
    r={node.isCenterNode ? 6 : 4}
    fill={node.isCenterNode ? 'var(--color-primary)' : 'var(--color-text-dim)'}
    stroke={hoveredNode === node.path ? 'var(--color-primary)' : 'none'}
    stroke-width="1.5"
    class="graph-node"
    class:center={node.isCenterNode}
    role="button"
    tabindex="0"
    aria-label={node.label}
    onclick={() => handleNodeClick(node)}
    onmouseenter={() => hoveredNode = node.path}
    onmouseleave={() => hoveredNode = null}
  />
{/each}
```

- Center node: Larger (6px radius), cyan fill (`--color-primary`), always labeled
- Neighbor nodes: Smaller (4px radius), dim fill (`--color-text-dim`)
- Hovered node: Cyan stroke highlight

**Edge rendering:**

```svelte
{#each simulationEdges as edge}
  <line
    x1={edge.source.x} y1={edge.source.y}
    x2={edge.target.x} y2={edge.target.y}
    stroke="rgba(255, 255, 255, 0.12)"
    stroke-width="1"
  />
{/each}
```

**Labels:**

- Center node: Always show filename label (below node, 10px font, `--color-text`)
- Neighbor nodes: Show label on hover only (tooltip or inline)
- Truncate long filenames to ~15 chars with ellipsis

**Interaction:**

- **Click neighbor node** → `selectFile(node.path)` — navigates to that file in the editor. The local graph then rebuilds around the newly selected file.
- **Hover node** → Highlight stroke + show full filename tooltip
- **No pan/zoom** — Widget is fixed-size. The full graph view handles exploration.

### Expand to Full Graph

The section header includes an "expand" button:

```svelte
<div class="section-header" onclick={() => (localGraphOpen = !localGraphOpen)}>
  <span class="material-symbols-outlined section-chevron" class:rotated={localGraphOpen}>
    chevron_right
  </span>
  <h3 class="section-title">Local Graph</h3>
  {#if nodeCount > 0}
    <span class="section-count">{nodeCount}</span>
  {/if}
  <button
    class="expand-button"
    title="Open full graph view"
    onclick|stopPropagation={() => expandToFullGraph()}
  >
    <span class="material-symbols-outlined">open_in_full</span>
  </button>
</div>
```

The `expandToFullGraph()` function:

```typescript
function expandToFullGraph() {
  // Activate the full graph view (Phase 14)
  graphViewActive.set(true)
  // Pre-select the current file in the full graph
  graphSelectedNode.set(selectedFilePath)
}
```

This bridges Phase 15 → Phase 14: the user sees a local context in the sidebar, clicks expand, and the full graph opens centered on that file.

### Empty States

- **No file selected** → Section shows "Select a file to see its connections"
- **File has no links** → Show the center node alone with message "No connections"
- **Properties panel closed** → Widget not rendered (parent controls visibility)
- **Links still loading** → Show small spinner (reuse `propertiesLoading` state)

### Integration with Properties Panel

Modify `app/src/renderer/components/PropertiesPanel.svelte`:

1. Import `LocalGraph` component
2. Add `let localGraphOpen = $state(true)` state variable
3. Insert new collapsible section between Metadata and Links
4. Pass existing `linksInfo`, `backlinksInfo`, and `selectedFilePath` as props

```svelte
<!-- After Metadata section, before Links section -->
<section class="panel-section">
  <div class="section-header" onclick={() => (localGraphOpen = !localGraphOpen)}>
    <span class="material-symbols-outlined section-chevron" class:rotated={localGraphOpen}>
      chevron_right
    </span>
    <h3 class="section-title">Local Graph</h3>
    {#if localGraphNodeCount > 0}
      <span class="section-count">{localGraphNodeCount}</span>
    {/if}
    <button class="expand-button" title="Open full graph" onclick|stopPropagation={expandToFullGraph}>
      <span class="material-symbols-outlined">open_in_full</span>
    </button>
  </div>
  {#if localGraphOpen}
    <div class="section-content graph-section-content">
      <LocalGraph
        centerPath={currentSelectedFilePath}
        {linksInfo}
        {backlinksInfo}
        onfileselect={(path) => onfileselect?.({ path })}
      />
    </div>
  {/if}
</section>
```

The `.graph-section-content` class removes horizontal padding so the SVG fills the full section width.

## Migration Strategy

No migration. Purely additive — one new component and minor modifications to PropertiesPanel. Depends on Phase 14 being implemented first (for the `graphViewActive` store and full graph view to expand into).

## Implementation Steps

1. Create `app/src/renderer/components/LocalGraph.svelte` with SVG + d3-force ego graph
2. Add `buildLocalGraph()` utility function (can live inside the component or in a shared `lib/graph-utils.ts`)
3. Add collapsible "Local Graph" section to `app/src/renderer/components/PropertiesPanel.svelte` between Metadata and Links
4. Wire "Expand" button to `graphViewActive.set(true)` + `graphSelectedNode.set(currentPath)` from Phase 14's store
5. Add `.expand-button` CSS styling to PropertiesPanel (small icon button, right-aligned in section header)
6. Write component tests in `app/tests/unit/LocalGraph.test.ts`

## Validation Criteria

- [ ] "Local Graph" section appears in Properties Panel between Metadata and Links
- [ ] Section is collapsible with chevron toggle (matching existing section pattern)
- [ ] Center node (current file) renders with cyan fill and filename label
- [ ] Neighbor nodes render for both incoming and outgoing links
- [ ] Edges connect center node to neighbors
- [ ] Clicking a neighbor node navigates to that file in the editor
- [ ] Local graph rebuilds around the newly selected file after navigation
- [ ] Hovering a neighbor shows filename tooltip/highlight
- [ ] Section header shows node count badge
- [ ] "Expand" button in section header opens Phase 14's full graph view
- [ ] Full graph view opens with the current file pre-selected
- [ ] File with no links shows center node alone with "No connections" message
- [ ] No file selected shows "Select a file to see its connections"
- [ ] Widget renders within the panel width without overflow
- [ ] Graph stabilizes quickly (no visible "explosion" animation)
- [ ] App tests pass (`npm test` in `app/`)

## Enhancements (Implemented)

The following features were added beyond the original spec during development:

### 2-Hop Graph (Depth 2)

The original PRD specified depth=1 only. The widget now fetches and displays depth-2 (neighbors of neighbors) via additional `window.api.links()` / `window.api.backlinks()` calls for each depth-1 neighbor. This provides richer context without requiring the full graph view.

- **Node depths:** `depth=0` (center), `depth=1` (direct neighbor), `depth=2` (second-hop neighbor)
- **Async fetch:** Depth-2 data is fetched via `fetchNeighborLinks()` before rendering — no visual "jump" from depth-1 to depth-2
- **Fallback:** If no active collection or fetch fails, renders depth-1 only
- **Visual hierarchy:** Center (6px cyan) → depth-1 (4px gray) → depth-2 (3px dimmer)

### Directional Edges with Color Coding

Edges are color-coded by direction using design token CSS variables:

| Direction | Color | Token | Default |
|---|---|---|---|
| Outgoing (center → target) | Cyan | `--color-edge-out` | `#00E5FF` |
| Incoming (source → center) | Red | `--color-edge-in` | `#FF6B6B` |
| Bidirectional (both ways) | Green | `--color-edge-bidi` | `#51CF66` |
| Depth-2 / default | Dim white | — | `rgba(255,255,255,0.08–0.15)` |

- **Bidirectional detection:** `buildLocalGraph()` tracks when A→B and B→A both exist, marks the edge `bidirectional: true`, and renders a single line (not two overlapping lines)
- **Arrowheads on hover only:** SVG marker arrowheads appear only when hovering a connected node, keeping the default view clean
- **Bidirectional arrows:** Bidirectional edges show green arrowheads on both ends (`marker-start` + `marker-end`) on hover

These same tokens are also applied in:
- `GraphView.svelte` — global graph uses the same bidi detection and green color for canvas-drawn edges
- `PropertiesPanel.svelte` — incoming link icons use `--color-edge-in`, outgoing link icons use `--color-edge-out`

### Zoom & Pan Controls

Bottom-left overlay buttons:

- **Pan tool** (`pan_tool` icon): Toggle pan mode — click and drag to move the viewBox
- **Zoom in** (`add` icon): Increase zoom by 0.25 (max 3x)
- **Zoom out** (`remove` icon): Decrease zoom by 0.25 (min 0.3x)

Implemented via SVG `viewBox` manipulation (not CSS transform), using pointer events with `setPointerCapture` for smooth dragging. Zoom/pan state resets when the selected file changes.

### Spread In/Out Controls

Bottom-right overlay buttons:

- **Spread out** (`open_in_full` icon): Increase d3-force link distance by 15 (max 150)
- **Spread in** (`close_fullscreen` icon): Decrease link distance by 15 (min 30)

Changing spread re-runs the d3-force simulation with the new distance parameter.

### Label Backgrounds

Node labels have an opaque background `<rect>` behind the `<text>` element (`rgba(15, 15, 16, 0.85)`) for readability against dense edge clusters.

### Edge Sorting

Edges are rendered in a deliberate order for visibility: depth-2 edges first (background), then outgoing, then incoming last (on top). This ensures directional edges from/to the center node are always visible above the dim depth-2 edges.

### Files Modified

| File | Purpose |
|---|---|
| `app/src/renderer/utils/local-graph.ts` | Graph building utility — `LocalNode` (with `depth`), `LocalEdge` (with `bidirectional`), `NeighborLinks`, `buildLocalGraph()` |
| `app/src/renderer/components/LocalGraph.svelte` | SVG graph component with zoom/pan, spread, directional edges, hover arrowheads |
| `app/src/renderer/components/PropertiesPanel.svelte` | Direction-colored link icons (`.link-icon-in`, `.link-icon-out`) |
| `app/src/renderer/components/GraphView.svelte` | Bidirectional edge detection + green color in global canvas graph |
| `app/src/renderer/styles/tokens.css` | Design tokens: `--color-edge-out`, `--color-edge-in`, `--color-edge-bidi` |
| `app/src/renderer/styles/app.css` | Tailwind theme mapping for edge color tokens |
| `app/tests/unit/LocalGraph.test.ts` | 34 tests covering depth-2, bidirectional edges, component rendering |

## Anti-Patterns to Avoid

- **Canvas for the widget** — Canvas is overkill for ~30 nodes and makes click handling harder. SVG gives native DOM events, cursor changes, and accessibility for free.
- **Fetching extra data** — Don't add new IPC calls. The Properties Panel already fetches `linksInfo` and `backlinksInfo` for the selected file. Build the graph from existing store data.
- ~~**Pan/zoom on the widget**~~ — *Now implemented:* Zoom/pan controls were added (bottom-left buttons) since depth-2 graphs can be dense. ViewBox-based zoom keeps the SVG crisp at all levels.
- **Re-running simulation on every store update** — Only rebuild the simulation when the selected file path changes, not on every render. Use `$effect` keyed on `centerPath`.
- **Large fixed height** — Don't make the graph section taller than 200px. It should complement the other sections, not dominate the panel. Users who want more space use the expand button.

## Patterns to Follow

- **Collapsible section pattern** — Copy the existing `.panel-section` + `.section-header` + `.section-content` pattern from PropertiesPanel's Metadata/Links/Outline sections
- **Chevron animation** — Use `.section-chevron` + `.rotated` transform matching existing sections
- **Section count badge** — Use the `.section-count` span pattern from the Links section
- **File navigation** — Use the existing `onfileselect` callback pattern from PropertiesPanel for navigating to clicked nodes
- **Design tokens** — `--color-primary` for center node, `--color-text-dim` for neighbors, `--color-border` for SVG container border
- **Store subscription** — Subscribe to `linksInfo`/`backlinksInfo` with `$effect` for reactive graph updates, matching PropertiesPanel's existing reactive patterns
