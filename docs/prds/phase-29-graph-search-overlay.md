# PRD: Graph Search Overlay

## Overview

Add a floating, draggable search bar to the 3D graph view that runs real `mdvdb search` queries (semantic, hybrid, or lexical) and visualizes the results directly on the graph. Matching nodes light up with opacity proportional to their search score. Edges between matched nodes glow. Non-matching elements fade to near-invisible. Graph context expansion (`--expand`) shows linked files at attenuated opacity. The result is a live "search heatmap" on the knowledge graph — users can type a query and immediately see which clusters, neighborhoods, and connections are relevant.

## Problem Statement

The graph view and search currently operate in isolation. Search produces a ranked list of results in the sidebar, and the graph shows the full topology — but there's no way to project search relevance onto the graph. Users exploring a knowledge base want to ask "where does this topic live in my graph?" and see the answer spatially: which clusters light up, how results are connected, whether relevant files are scattered or grouped.

The existing search-to-graph hover highlighting (phase 20) handles single-result mouseover. This feature is different — it visualizes the entire result set simultaneously with score-proportional opacity, turning the graph into a search relevance heatmap.

## Goals

- Floating search bar overlay in the graph view with a drag handle for repositioning
- Runs the real `mdvdb search` CLI engine via `window.api.search()` — not client-side fuzzy matching
- Supports hybrid, semantic, and lexical search modes
- Maps each search result's score (0–1) to node opacity — stronger matches are brighter
- Graph context expansion (`--expand 1`) shows linked files at attenuated opacity, revealing the neighborhood around search hits
- Edges between matched nodes are visible and colored by strength; edges to/from unmatched nodes fade
- Shows result count (matched files) and loading state
- Keyboard shortcut to toggle: `Cmd+F` (macOS) / `Ctrl+F` (Windows/Linux), or `/`
- Escape closes the search and restores normal graph rendering
- Search dimming takes visual priority over selection dimming — clicking a node during search still selects it (camera focus), but search controls the opacity
- Debounced input (400ms) to avoid hammering the CLI during typing
- Persists position within the session (not across restarts)

## Non-Goals

- **Replacing the sidebar search** — This is a graph-specific overlay for visual exploration. The existing Search panel in the sidebar remains the primary search interface for reading results and opening files.
- **Search mode picker in the overlay** — Hardcode hybrid mode for simplicity. A mode toggle can be added later if needed.
- **Chunk-level result highlighting** — In chunk mode, all chunks from a matching file light up together. Highlighting individual chunks within a file (based on which chunk matched) is out of scope.
- **Result list in the overlay** — The overlay shows only the search input, result count, and loading state. The actual result list stays in the sidebar search panel.
- **Backend changes** — No Rust CLI changes needed. Uses the existing `search --json` output.
- **Persistent overlay position** — Position resets on each graph mount. Persisting across sessions can be added later.

## Technical Design

### Data Flow

```
User types query in graph search overlay
  → debounce 400ms
  → window.api.search(collection.path, query, { mode: 'hybrid', boostLinks: true, expand: 1, limit: 50 })
  → IPC → execFile('mdvdb', ['search', '--json', '--root', root, query, ...])
  → SearchOutput { results: SearchResult[], graph_context?: GraphContextItem[] }
  → Build score maps:
      - graphSearchScores: Map<filePath, bestScore>     (direct matches, 0–1)
      - graphSearchContextScores: Map<filePath, score>   (linked files, attenuated by hop distance)
  → Apply search dimming:
      - Matched nodes: opacity = 0.3 + 0.7 × score
      - Context nodes: opacity = 0.3 + 0.7 × attenuatedScore
      - Unmatched nodes: opacity = 0.05
      - Edges between matched nodes: cyan at score-based alpha
      - Other edges: nearly invisible
  → graph.refresh()
```

### Score Mapping

**Direct matches**: Each `SearchResult` has a normalized `score` field (0–1). Multiple chunks from the same file may appear; take the max score per file path. Store in `graphSearchScores: Map<string, number>`.

**Graph context (expansion)**: Each `GraphContextItem` has a `hop_distance` (1, 2, …). Attenuate by hop: `0.4 / hop_distance`. Skip files already in direct matches. Store in `graphSearchContextScores: Map<string, number>`.

**Node opacity**: For a matched node with score `s`: `opacity = 0.3 + 0.7 × s`. This gives a floor of 0.3 for weak matches (still clearly visible) and a ceiling of 1.0 for perfect matches. Unmatched nodes get `0.05` (barely visible ghost).

**Edge opacity**: If both endpoints match, the edge gets `alpha = 0.2 + 0.8 × min(srcScore, tgtScore)` in cyan. If only one endpoint matches, a faint hint at `alpha = 0.08`. Unmatched edges get `rgba(80, 80, 80, 0.02)`.

### Node Identity Mapping

Search results provide `result.file.path` (relative file path). Graph nodes have a `path` field. The mapping is `node.path === result.file.path`.

- **Document mode**: `node.id === node.path`, so this is a direct 1:1 match.
- **Chunk mode**: Multiple chunk nodes share the same `node.path` but have different `node.id` (chunk IDs). All chunks from a matching file light up together — this is intentional, as it shows the full file's presence in the graph.

### Search Dimming Priority

Search dimming takes full visual priority when active. The existing `applySelectionDimming()` function is guarded: if the search overlay has active results, selection dimming becomes a no-op. Node click-selection still works (the store updates, camera focuses), but the graph's opacity is controlled entirely by search scores.

When the search is cleared, `applySelectionDimming()` runs normally — if a node was selected during search, its selection dimming kicks in immediately.

### Drag Behavior

The overlay uses pointer events (`pointerdown` / `pointermove` / `pointerup`) on the drag handle with `setPointerCapture` for reliable tracking even when the cursor leaves the handle. The position is clamped to the `.graph-view` container bounds. `touch-action: none` prevents scroll interference on touch devices.

Initial position: bottom-left of the container (16px from left, 64px from bottom), computed on first show via container's `getBoundingClientRect()`.

### Keyboard

- **`Cmd+F` / `Ctrl+F`**: Toggle search overlay. On show, focus the input. On hide, clear search and restore graph.
- **`/`** (when search not visible and not typing in an input): Open search overlay.
- **`Escape`**: Close search overlay and clear results (before existing Escape handling for selection/context menu).
- **Input field**: `stopPropagation()` on `keydown` for all keys except Escape and `Cmd+F` — prevents arrow key navigation and other graph shortcuts from firing while typing.

### Stale Result Handling

A generation counter guards against stale results. Each search execution increments the counter; when the async result returns, it checks that its generation still matches. This prevents out-of-order results when the user types quickly.

When graph data reloads (level switch, path filter change), the search re-runs automatically against the new data.

### Performance

- 400ms debounce (slightly higher than sidebar search's 300ms, since this is exploratory)
- Minimum 2 characters before firing a search
- `limit: 50` caps result count — sufficient for visualization without overloading
- `nodeThreeObject` creates THREE.Group objects per matched node — for large graphs (500+ matches), this creates garbage. A future optimization could cache mesh objects keyed by `nodeId + opacity`, but this is not needed for MVP.

## Interface Changes

### `GraphView.svelte`

**New state variables:**
- `graphSearchVisible: boolean` — overlay visibility
- `graphSearchQuery: string` — current input value
- `graphSearchLoading: boolean` — API request in progress
- `graphSearchError: string | null` — error message
- `graphSearchScores: Map<string, number>` — file path → best score for direct matches
- `graphSearchContextScores: Map<string, number>` — file path → attenuated score for graph context
- `graphSearchResultCount: number` — count of matched files
- `searchPanelX, searchPanelY: number` — drag position
- `isDraggingSearch: boolean` — dragging state

**New functions:**
- `onGraphSearchInput(query)` — debounced input handler
- `executeGraphSearch(query)` — calls `window.api.search()`, builds score maps, applies dimming
- `clearGraphSearch()` — resets all search state, restores normal rendering
- `applySearchDimming()` — sets node/link accessors based on search scores
- `getNodePath(endpoint)` — extracts `path` from a link endpoint (like `linkNodeId` but for `path`)
- Drag handlers: `onDragHandlePointerDown/Move/Up`

**New imports:**
- `activeCollection` from `../stores/collections`
- `get` from `svelte/store` (if not already imported)

**Modified functions:**
- `applySelectionDimming()` — add guard at top: skip if graph search is active
- `handleKeyDown()` — add `Cmd+F` / `/` / Escape-for-search handling

### HTML Markup

Floating overlay inside the `{#if currentData ...}` block:

```
┌─────────────────────────────────────────────────┐
│ ⠿  🔍  Search...                    ✕  12 files │
│ drag    icon  input field         clear  count   │
└─────────────────────────────────────────────────┘
```

- Drag handle: `drag_indicator` Material Symbol
- Search icon: `search` Material Symbol
- Input: transparent background, mono font, placeholder "Search..."
- Clear button: `close` icon (only when query non-empty)
- Loading spinner: `progress_activity` spinning icon (only during API call)
- Result count: "N files" or "No matches" (only after search completes)
- Error indicator: `error` icon with title tooltip (only on failure)

### CSS

- `z-index: 15` — above legend (10), below tooltips (40) and context menu (50)
- Dark glass: `background: var(--color-surface)`, `border: 1px solid var(--color-border)`, `border-radius: 0.375rem`
- `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4)`
- `min-width: 280px`
- Drag handle: `cursor: grab` / `grabbing`, `touch-action: none`
- Input: `font-family: var(--font-mono)`, `font-size: var(--text-sm)`
- Result count: `color: var(--color-text-dim)`, left-border separator
- `@media (prefers-reduced-motion: reduce)` fallback on transitions

## Implementation Steps

1. **State & imports** — Add all new state variables and imports to GraphView.svelte.

2. **Helper function** — Add `getNodePath(endpoint)` to extract file path from link endpoints (mirrors `linkNodeId` pattern but for the `path` field).

3. **Search execution** — Implement `onGraphSearchInput()` (debounce + min length guard), `executeGraphSearch()` (calls `window.api.search`, builds score maps, applies dimming), and `clearGraphSearch()` (resets state, restores rendering).

4. **Search dimming** — Implement `applySearchDimming()` following the `applySelectionDimming()` accessor-override pattern: set `nodeOpacity`, `nodeThreeObject`, `linkColor`, disable arrows/particles, call `graph.refresh()`.

5. **Selection dimming guard** — Add early return at top of `applySelectionDimming()` when graph search is active.

6. **Keyboard shortcuts** — Extend `handleKeyDown()` with `Cmd+F`/`Ctrl+F` toggle, `/` open, Escape close.

7. **Drag behavior** — Implement pointer event handlers for the drag handle. Compute initial Y on first show.

8. **HTML markup** — Add the floating overlay element inside the data-ready conditional block.

9. **CSS styles** — Add all styles for the search panel, drag handle, input, result count, spinner, and error states.

10. **Data change handling** — In the `graphData` subscription callback, re-run search if active when graph data reloads.

## Validation Criteria

- [ ] `Cmd+F` in graph view opens the floating search bar; second press closes it
- [ ] `/` key opens the search bar (when not already visible)
- [ ] Escape closes the search bar and restores normal graph rendering
- [ ] Typing a query (2+ chars) triggers a search after 400ms debounce
- [ ] Loading spinner shows during the CLI search request
- [ ] Matched nodes brighten proportionally to their search score — top results are brightest
- [ ] Graph context nodes (linked files from `--expand`) appear at reduced but visible opacity
- [ ] Unmatched nodes fade to near-invisible (0.05 opacity)
- [ ] Edges between matched nodes glow in cyan; edges between unmatched nodes are nearly invisible
- [ ] Result count shows number of matched files (e.g., "12 files")
- [ ] "No matches" shown when search returns no results
- [ ] Clearing the input (× button or selecting all + delete) restores normal rendering
- [ ] Drag handle repositions the panel within the graph container bounds
- [ ] Clicking a node during active search still selects it (camera focus) but doesn't break search dimming
- [ ] Closing search with a node selected → selection dimming applies immediately
- [ ] Switching graph level (document ↔ chunk) during active search re-runs the search
- [ ] Typing while search is open does not trigger arrow key navigation or other graph shortcuts
- [ ] Error state (CLI failure) shows error icon with tooltip; does not break the graph
- [ ] Rapid typing produces only one search result (stale results discarded)
- [ ] Works in both document and chunk graph modes
- [ ] No visual regressions to existing selection dimming, legend, tooltips, or context menu

## Anti-Patterns to Avoid

- **Don't use client-side fuzzy matching** — The entire point is to use the real `mdvdb search` engine with semantic embeddings, BM25, and hybrid scoring. Client-side fuzzy match on node labels would miss the semantic dimension entirely.
- **Don't reuse the sidebar search store** — The sidebar search and graph search are independent features. Sharing state would create unwanted coupling (opening graph search shouldn't close/affect the sidebar search, and vice versa).
- **Don't use HTML5 drag API for the panel** — HTML5 drag creates a ghost image and doesn't allow live repositioning. Pointer events with `setPointerCapture` are the correct pattern for movable panels.
- **Don't create THREE objects on every `refresh()` call without reason** — The `nodeThreeObject` accessor fires on refresh. If scores haven't changed, avoid recreating meshes. Check for score changes before triggering a full dimming recalculation.

## Patterns to Follow

- **`applySelectionDimming()` accessor pattern** — The new `applySearchDimming()` should follow the same structure: set global opacity, override `nodeThreeObject` per-node, override `linkColor` per-link, control arrows/particles, call `graph.refresh()`.
- **`linkNodeId()` helper** — After simulation starts, 3d-force-graph replaces string IDs with object references in links. The new `getNodePath()` must handle both cases (same as `linkNodeId` does for `id`).
- **Store subscription + `applySelectionDimming()` pattern** — When search clears, call `applySelectionDimming()` to hand rendering back to the normal priority chain.
- **Search generation counter** — Mirror the `searchGeneration` pattern from `stores/search.ts` to discard stale async results.
- **Overlay z-index layering** — Follow the existing hierarchy: proximity labels (1) < legend (10) < new search (15) < tooltips (40) < context menu (50).
