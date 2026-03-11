# PRD: Search Result → Graph Node Hover Highlighting

## Overview

Connect the search results overlay with the full graph view so that hovering over a search result highlights the corresponding file's node(s) in the graph. This provides instant spatial context — users can see where a search hit lives in the knowledge graph without clicking, enabling rapid visual exploration of search results across the graph topology.

## Problem Statement

The app currently has two powerful views — semantic search results and a force-directed graph — but they operate independently. When a user searches and gets results, there's no way to see where those results sit in the graph without clicking each one (which navigates the editor and closes search). Users exploring a large knowledge base want to quickly scan "where do my search hits cluster in the graph?" without committing to opening each file.

The graph view already supports file-level highlighting via `selectedFilePath` (cyan glow + dimming), but this is tied to the editor's currently open file and cannot be driven by transient hover gestures from other components.

## Goals

- Hovering over any search result card highlights the corresponding file's node(s) in the graph view with the existing cyan glow + dimming pattern
- Moving the mouse away from a result clears the highlight immediately
- Closing the search overlay clears any lingering highlight
- The hover highlight works for both regular search results and graph context cards (linked documents shown with `--expand`)
- The hover highlight integrates cleanly into the existing highlight priority chain without breaking selection, file highlight, or folder highlight behaviors

## Non-Goals

- **Backend changes** — This is purely a renderer-side feature. No Rust API or CLI changes needed.
- **Local graph highlighting** — The small LocalGraph widget in the properties panel is not affected; only the full GraphView canvas.
- **Click-to-select from search** — Clicking a search result already navigates to the file. This PRD only adds hover highlighting.
- **Persistent highlight** — The highlight is strictly transient (mouseenter/mouseleave). No "pin" or "keep highlighted" behavior.
- **Highlight in non-graph views** — When GraphView is not active, the store is still updated but nothing renders. No visual effect in the editor or file tree.

## Technical Design

### Data Model Changes

**`app/src/renderer/stores/graph.ts`** — Add a new transient store:

```typescript
/** File path hovered in search results — transient highlight for graph view. */
export const graphHoveredFilePath = writable<string | null>(null)

export function setGraphHoveredFilePath(path: string | null): void {
  graphHoveredFilePath.set(path)
}
```

Update `resetGraphState()` to clear the new store:

```typescript
export function resetGraphState(): void {
  // ... existing resets ...
  graphHoveredFilePath.set(null)
}
```

No new types needed. The store holds a plain file path string (same format as `selectedFilePath`).

### Interface Changes

**`app/src/renderer/components/SearchResults.svelte`** — No new props. The component directly imports the graph store setter (same pattern used by other components that write to graph stores).

**`app/src/renderer/components/GraphView.svelte`** — No new props. Subscribes to the new store internally (same subscription pattern as `selectedFilePath`, `graphHighlightedFolder`).

### Highlight Priority Chain

The `draw()` function in GraphView uses a priority chain where higher-priority highlights suppress lower ones. Insert the new hover highlight at priority 2:

| Priority | Mode | Trigger | Behavior |
|----------|------|---------|----------|
| 1 (highest) | Selection | Click node in graph | Highlight node + neighbors, colored directional edges |
| **2** | **Hover highlight** | **Hover search result** | **Cyan glow on file nodes, dim others** |
| 3 | File highlight | Select file in editor/tree | Cyan glow on file nodes, dim others |
| 4 (lowest) | Folder highlight | Click folder in file tree | Cyan glow on folder's nodes, dim others |

Hover takes priority over file highlight because it's an active user gesture — the user is pointing at something specific and wants to see it, temporarily overriding the passive "currently open file" glow.

### New Commands / API / UI

No new UI elements. The feature is entirely behavior-driven: mouse hover events on existing search result cards trigger visual changes on the existing graph canvas.

### Migration Strategy

No migration needed. The new store defaults to `null` (no highlight), so existing behavior is unchanged until a hover occurs.

## Implementation Steps

1. **Add `graphHoveredFilePath` store** — In `app/src/renderer/stores/graph.ts`:
   - Add `graphHoveredFilePath` writable store (`string | null`, default `null`).
   - Add `setGraphHoveredFilePath(path)` setter function.
   - Clear it in `resetGraphState()`.

2. **Clear hover on search close** — In `app/src/renderer/stores/search.ts`:
   - Import `graphHoveredFilePath` from `./graph`.
   - In `clearSearch()`, set `graphHoveredFilePath` to `null`.

3. **Add hover handlers to SearchResults** — In `app/src/renderer/components/SearchResults.svelte`:
   - Import `setGraphHoveredFilePath` from `../stores/graph`.
   - Add `handleResultHover(result)` → calls `setGraphHoveredFilePath(result.file.path)`.
   - Add `handleResultLeave()` → calls `setGraphHoveredFilePath(null)`.
   - Attach `onmouseenter` / `onmouseleave` to all result card elements:
     - Normal list result cards
     - Virtual list result cards (if virtual scrolling is used)
     - Graph context cards (linked documents from `--expand`)
   - In `onDestroy`, call `setGraphHoveredFilePath(null)` to clean up on unmount.

4. **Subscribe to hover store in GraphView** — In `app/src/renderer/components/GraphView.svelte`:
   - Import `graphHoveredFilePath` from `../stores/graph`.
   - Add `currentHoveredFilePath: string | null` state variable.
   - Add `unsubHoveredFilePath` subscription variable.
   - Subscribe in `onMount()`, unsubscribe in `onDestroy()`.
   - Set `dirty = true` on change to trigger re-render.

5. **Integrate hover highlight into draw() priority chain** — In `app/src/renderer/components/GraphView.svelte`, in the `draw()` function:
   - After computing `hasSelection`, compute hover highlight using existing `getFileHighlight()`:
     ```typescript
     const { fileNodeIds: hoverNodeIds, fileEdges: hoverEdges } = getFileHighlight(currentHoveredFilePath)
     const hasHoverHighlight = !hasSelection && hoverNodeIds.size > 0
     ```
   - Adjust existing file highlight to defer to hover:
     ```typescript
     const hasFileHighlight = !hasSelection && !hasHoverHighlight && fileNodeIds.size > 0
     ```
   - Adjust folder highlight to defer to both:
     ```typescript
     const hasFolderHighlight = !hasSelection && !hasHoverHighlight && !hasFileHighlight && folderNodeIds.size > 0
     ```
   - Skip hover-highlighted edges from the dim pass (same pattern as file edges).
   - Draw hover-highlighted edges with cyan color (same as file highlight edges).
   - Update node dimming to include `hasHoverHighlight && !isHoverNode`.
   - Update node radius to give hover-highlighted nodes the same enlarged size as file-highlighted nodes.
   - Add cyan glow effect for hover-highlighted nodes (same `shadowColor`/`shadowBlur` pattern as file highlight).
   - Update label dimming to include hover highlight awareness.

## Validation Criteria

- [ ] Hovering over a search result highlights the corresponding node(s) in the graph with cyan glow
- [ ] Non-matching nodes and edges are dimmed during hover
- [ ] Moving the mouse away from the result immediately clears the highlight
- [ ] Closing search (Escape or click outside) clears any hover highlight
- [ ] Hover highlight is suppressed when a node is click-selected in the graph (selection takes priority)
- [ ] Hover highlight takes priority over the editor's file highlight and folder highlight
- [ ] Graph context cards (linked documents) also trigger hover highlight for their file path
- [ ] When GraphView is not visible, hovering search results causes no errors or performance issues
- [ ] Files not present in the graph (not indexed) produce no visual effect (graceful no-op)
- [ ] Hover highlight works in both document and chunk graph modes
- [ ] Virtual-scrolled search results correctly attach hover handlers to recycled DOM elements
- [ ] No visual regressions to existing selection, file highlight, or folder highlight behavior

## Anti-Patterns to Avoid

- **Don't reuse `selectedFilePath` for hover** — That store drives the editor, properties panel, and file tree selection. Setting it on hover would cause unwanted side effects (file loads, panel refreshes, scroll jumps).
- **Don't add callback props to SearchResults for hover** — The graph store pattern (direct import + write) is simpler and matches how other components interact with graph state. Prop drilling through Titlebar → SearchResults adds unnecessary coupling.
- **Don't compute hover highlight when GraphView is not mounted** — The store can be set freely, but GraphView only subscribes while mounted. No wasted computation.
- **Don't add special hover styling to search result cards** — This PRD is about the graph reacting to search hover, not about changing how search results look. Any card hover styling is a separate concern.

## Patterns to Follow

- **`graphHighlightedFolder` store pattern** — The new `graphHoveredFilePath` store mirrors the existing folder highlight store exactly: writable, string|null, with a setter function and cleanup in `resetGraphState()`.
- **`getFileHighlight()` reuse** — The existing function already builds node/edge sets from a file path. Call it twice in `draw()`: once for hover, once for file highlight. No new highlight computation function needed.
- **Store subscription pattern in GraphView** — Follow the `let unsubX` / `onMount` subscribe / `onDestroy` unsubscribe pattern used for all other store subscriptions (lines 100-106, 230-256).
- **Cyan glow rendering** — The file highlight and folder highlight both use `ctx.save()` / `ctx.shadowColor = '#00E5FF'` / `ctx.shadowBlur = 12` / `ctx.restore()` for the glow effect. Apply the same pattern for hover-highlighted nodes.
- **`clearSearch()` cleanup** — Existing function already resets search-related state. Adding `graphHoveredFilePath.set(null)` follows the same cleanup convention.
