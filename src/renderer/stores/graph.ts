import { writable, derived, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { GraphData, GraphLevel, GraphNode, NeighborhoodResult, NeighborhoodNode } from '../types/cli'
import { activeCollection } from './collections'
import { workspace } from './workspace.svelte'
import type { GraphTab, GraphColoringMode } from './workspace.svelte'

// Re-export the type for backward compat (consumers import it from graph.ts)
export type { GraphColoringMode }

// ─── Workspace-derived graph stores ──────────────────────────────────
//
// graphViewActive, graphLevel, graphColoringMode, graphPathFilter are
// now derived from the workspace's focused pane's graph tab state.
// They use a notification trigger (_graphSync) rather than Svelte 5
// rune reactivity so they work in plain .ts.
//
// Call syncGraphStoresFromTab() after any workspace mutation that
// changes the active tab (switchTab, closeTab, tab bar click, etc.).

/**
 * Internal notification trigger. Derived stores re-evaluate when this
 * writable is bumped, pulling fresh values from workspace state.
 */
const _graphSync = writable(0)

/**
 * Notify backward-compat derived stores that the workspace focus has changed.
 * Call this after any workspace mutation that changes the active tab.
 */
export function syncGraphStoresFromTab(): void {
  _graphSync.update((n) => n + 1)
}

// ─── Helper: find the focused pane's graph tab ──────────────────────

/** Get the graph tab for the currently focused pane. */
function getFocusedGraphTab(): GraphTab | undefined {
  const pane = workspace.focusedPane
  if (!pane) return undefined
  const tab = workspace.tabs[pane.graphTabId]
  if (tab && tab.kind === 'graph') return tab
  return undefined
}

// ─── graphViewActive: derived from whether focused tab is a GraphTab ─

/**
 * Whether the graph view is currently active — derived from whether the
 * focused pane's active tab is the graph tab.
 */
export const graphViewActive = derived(_graphSync, () => {
  const tab = workspace.focusedTab
  return tab?.kind === 'graph'
})

// ─── graphLevel: derived from focused pane's graph tab ──────────────

/**
 * Current graph detail level (document or chunk) — derived from focused
 * pane's graph tab. Retains .set()/.update() for backward compat.
 */
export const graphLevel: Writable<GraphLevel> = {
  subscribe: derived(_graphSync, () => {
    return getFocusedGraphTab()?.graphLevel ?? 'document'
  }).subscribe,
  set(value: GraphLevel) {
    const graphTab = getFocusedGraphTab()
    if (graphTab) {
      graphTab.graphLevel = value
    }
    _graphSync.update((n) => n + 1)
  },
  update(fn: (value: GraphLevel) => GraphLevel) {
    const graphTab = getFocusedGraphTab()
    const current = graphTab?.graphLevel ?? 'document'
    const newValue = fn(current)
    if (graphTab) {
      graphTab.graphLevel = newValue
    }
    _graphSync.update((n) => n + 1)
  },
}

// ─── graphColoringMode: derived from focused pane's graph tab ───────

/**
 * Current graph coloring mode — derived from focused pane's graph tab.
 * Retains .set()/.update() for backward compat.
 */
export const graphColoringMode: Writable<GraphColoringMode> = {
  subscribe: derived(_graphSync, () => {
    return getFocusedGraphTab()?.graphColoringMode ?? 'cluster'
  }).subscribe,
  set(value: GraphColoringMode) {
    const graphTab = getFocusedGraphTab()
    if (graphTab) {
      graphTab.graphColoringMode = value
    }
    _graphSync.update((n) => n + 1)
  },
  update(fn: (value: GraphColoringMode) => GraphColoringMode) {
    const graphTab = getFocusedGraphTab()
    const current = graphTab?.graphColoringMode ?? 'cluster'
    const newValue = fn(current)
    if (graphTab) {
      graphTab.graphColoringMode = newValue
    }
    _graphSync.update((n) => n + 1)
  },
}

// ─── graphPathFilter: derived from focused pane's graph tab ─────────

/**
 * Optional path filter to scope graph to a subdirectory — derived from
 * focused pane's graph tab. Retains .set()/.update() for backward compat.
 */
export const graphPathFilter: Writable<string | null> = {
  subscribe: derived(_graphSync, () => {
    return getFocusedGraphTab()?.graphPathFilter ?? null
  }).subscribe,
  set(value: string | null) {
    const graphTab = getFocusedGraphTab()
    if (graphTab) {
      graphTab.graphPathFilter = value
    }
    _graphSync.update((n) => n + 1)
  },
  update(fn: (value: string | null) => string | null) {
    const graphTab = getFocusedGraphTab()
    const current = graphTab?.graphPathFilter ?? null
    const newValue = fn(current)
    if (graphTab) {
      graphTab.graphPathFilter = newValue
    }
    _graphSync.update((n) => n + 1)
  },
}

// ─── Shared transient state (not per-tab) ───────────────────────────
//
// These remain plain writables because they represent transient UI
// state within the graph view that doesn't need per-tab isolation.

/** Graph data from the last successful load. */
export const graphData = writable<GraphData | null>(null)

/** Whether graph data is currently loading. */
export const graphLoading = writable<boolean>(false)

/** Error message if graph data loading failed. */
export const graphError = writable<string | null>(null)

/** Currently selected node in the graph (highlighted, no side panel). */
export const graphSelectedNode = writable<GraphNode | null>(null)

/** Currently opened node in the graph (shown in side panel preview). */
export const graphOpenedNode = writable<GraphNode | null>(null)

/** Currently highlighted folder path in the graph. */
export const graphHighlightedFolder = writable<string | null>(null)

/** File path hovered in search results — transient highlight for graph view. */
export const graphHoveredFilePath = writable<string | null>(null)

/** Set of edge cluster IDs to filter (show only these). Empty set means show all. */
export const graphEdgeFilter = writable<Set<number>>(new Set())

/** Whether semantic edge styling (thickness, color, dash) is enabled. */
export const graphSemanticEdgesEnabled = writable<boolean>(true)

/** Strength threshold below which edges are considered "weak" (rendered dashed). */
export const graphEdgeWeakThreshold = writable<number>(0.3)

// ─── Generation counter for async staleness ─────────────────────────

/** Generation counter to discard stale async results. */
let loadGeneration = 0

// ─── Actions ────────────────────────────────────────────────────────

/** Load graph data for the active collection. */
export async function loadGraphData(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) {
    graphLoading.set(false)
    return
  }

  const generation = ++loadGeneration

  graphLoading.set(true)
  graphError.set(null)

  try {
    const level = get(graphLevel)
    const pathFilter = get(graphPathFilter)
    const data = await window.api.graphData(collection.path, level, pathFilter ?? undefined)

    // Ignore stale results
    if (generation !== loadGeneration) return

    graphData.set(data)
    graphError.set(null)
  } catch (err) {
    if (generation !== loadGeneration) return
    graphError.set(err instanceof Error ? err.message : String(err))
    graphData.set(null)
  } finally {
    if (generation === loadGeneration) {
      graphLoading.set(false)
    }
  }
}

/**
 * Toggle the graph view on/off.
 *
 * In the tab model, "toggling graph on" means switching to the graph tab
 * in the focused pane; "toggling off" means switching away (to the
 * previously active document tab, or clearing the active tab).
 * Loads data when activating.
 *
 * Backward-compat shim — kept for consumers like Titlebar.svelte.
 */
export function toggleGraphView(): void {
  const isActive = get(graphViewActive)
  if (isActive) {
    // Switch away from the graph tab — activate the first document tab, or null
    const pane = workspace.focusedPane
    if (pane) {
      const docTabId = pane.tabOrder.find(
        (id) => workspace.tabs[id]?.kind === 'document'
      )
      if (docTabId) {
        workspace.switchTab(docTabId, pane.id)
      } else {
        pane.activeTabId = null
      }
    }
    graphSelectedNode.set(null)
    graphOpenedNode.set(null)
    syncGraphStoresFromTab()
  } else {
    workspace.switchToGraphTab()
    syncGraphStoresFromTab()
    loadGraphData()
  }
}

/** Set the graph detail level and reload data. */
export function setGraphLevel(level: GraphLevel): void {
  graphLevel.set(level)
  graphSelectedNode.set(null)
  graphOpenedNode.set(null)
  if (get(graphViewActive)) {
    loadGraphData()
  }
}

/** Set the path filter and reload graph data. */
export function setGraphPathFilter(path: string | null): void {
  graphPathFilter.set(path)
  graphSelectedNode.set(null)
  graphOpenedNode.set(null)
  if (get(graphViewActive)) {
    loadGraphData()
  }
}

/** Select a node in the graph, or clear selection with null. */
export function selectGraphNode(node: GraphNode | null): void {
  graphSelectedNode.set(node)
  if (!node) graphOpenedNode.set(null)
}

/** Open a node in the side panel preview (must already be selected). */
export function openGraphNode(node: GraphNode): void {
  graphSelectedNode.set(node)
  graphOpenedNode.set(node)
}

/** Cycle graph coloring mode: cluster → custom-cluster → folder → none → cluster.
 *  Skips custom-cluster if no custom clusters are defined. */
export function cycleColoringMode(): void {
  const current = get(graphColoringMode)
  const data = get(graphData)
  const hasCustomClusters = (data?.custom_clusters?.length ?? 0) > 0
  let next: GraphColoringMode
  if (current === 'cluster') {
    next = hasCustomClusters ? 'custom-cluster' : 'folder'
  } else if (current === 'custom-cluster') {
    next = 'folder'
  } else if (current === 'folder') {
    next = 'none'
  } else {
    next = 'cluster'
  }
  graphColoringMode.set(next)
}

/** Set the hovered file path (from search result hover). */
export function setGraphHoveredFilePath(path: string | null): void {
  graphHoveredFilePath.set(path)
}

/** Set or toggle the highlighted folder. If the same path is set again, clears it. */
export function setGraphHighlightedFolder(path: string | null): void {
  const current = get(graphHighlightedFolder)
  graphHighlightedFolder.set(current === path ? null : path)
}

/** Toggle an edge cluster ID in the filter set. If present, remove it; if absent, add it. */
export function toggleEdgeClusterFilter(clusterId: number): void {
  const current = get(graphEdgeFilter)
  const next = new Set(current)
  if (next.has(clusterId)) {
    next.delete(clusterId)
  } else {
    next.add(clusterId)
  }
  graphEdgeFilter.set(next)
}

/** Clear all edge cluster filters (show all edges). */
export function clearEdgeFilter(): void {
  graphEdgeFilter.set(new Set())
}

/** Toggle semantic edge styling on/off. */
export function toggleSemanticEdges(): void {
  graphSemanticEdgesEnabled.set(!get(graphSemanticEdgesEnabled))
}

/** Open graph view with neighborhood data converted to GraphData. */
export function openGraphWithNeighborhood(filePath: string, neighborhood: NeighborhoodResult): void {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphData['edges'] = []

  // Add center node
  nodes.set(filePath, { id: filePath, path: filePath, label: null, cluster_id: null, chunk_index: null })

  // Walk neighborhood tree and collect nodes + edges
  function walk(items: NeighborhoodNode[], parentPath: string, direction: 'out' | 'in'): void {
    for (const item of items) {
      if (!nodes.has(item.path)) {
        nodes.set(item.path, { id: item.path, path: item.path, label: null, cluster_id: null, chunk_index: null })
      }
      const src = direction === 'out' ? parentPath : item.path
      const tgt = direction === 'out' ? item.path : parentPath
      // Avoid duplicate edges
      if (!edges.some(e => e.source === src && e.target === tgt)) {
        edges.push({ source: src, target: tgt, weight: null })
      }
      walk(item.children, item.path, direction)
    }
  }

  walk(neighborhood.outgoing ?? [], filePath, 'out')
  walk(neighborhood.incoming ?? [], filePath, 'in')

  const data: GraphData = {
    nodes: [...nodes.values()],
    edges,
    clusters: [],
    level: 'document',
  }

  loadGeneration++
  graphData.set(data)
  const nodeData: GraphNode = { id: filePath, path: filePath, label: null, cluster_id: null, chunk_index: null }
  graphSelectedNode.set(nodeData)
  graphOpenedNode.set(nodeData)

  // Switch to the graph tab in the focused pane
  workspace.switchToGraphTab()
  syncGraphStoresFromTab()

  graphError.set(null)
  graphLoading.set(false)
}

/** Reset all graph state. */
export function resetGraphState(): void {
  loadGeneration++
  graphData.set(null)
  graphLoading.set(false)
  graphError.set(null)
  graphSelectedNode.set(null)
  graphOpenedNode.set(null)
  graphHighlightedFolder.set(null)
  graphHoveredFilePath.set(null)
  graphEdgeFilter.set(new Set())
  graphSemanticEdgesEnabled.set(true)
  graphEdgeWeakThreshold.set(0.3)
  // Per-tab state (graphLevel, graphColoringMode, graphPathFilter) resets
  // with workspace.reset() — no need to reset here.
  syncGraphStoresFromTab()
}
