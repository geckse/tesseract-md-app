import { writable, get } from 'svelte/store'
import type { GraphData, GraphLevel, GraphNode, NeighborhoodResult, NeighborhoodNode } from '../types/cli'
import { activeCollection } from './collections'

/** Whether the graph view is currently active. */
export const graphViewActive = writable<boolean>(false)

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

/** Graph coloring mode: cluster-based, folder-based, or none. */
export type GraphColoringMode = 'cluster' | 'folder' | 'none'

/** Current graph coloring mode. */
export const graphColoringMode = writable<GraphColoringMode>('cluster')

/** Currently highlighted folder path in the graph. */
export const graphHighlightedFolder = writable<string | null>(null)

/** File path hovered in search results — transient highlight for graph view. */
export const graphHoveredFilePath = writable<string | null>(null)

/** Current graph detail level (document or chunk). */
export const graphLevel = writable<GraphLevel>('document')

/** Optional path filter to scope graph to a subdirectory. */
export const graphPathFilter = writable<string | null>(null)

/** Set of edge cluster IDs to filter (show only these). Empty set means show all. */
export const graphEdgeFilter = writable<Set<number>>(new Set())

/** Whether semantic edge styling (thickness, color, dash) is enabled. */
export const graphSemanticEdgesEnabled = writable<boolean>(true)

/** Strength threshold below which edges are considered "weak" (rendered dashed). */
export const graphEdgeWeakThreshold = writable<number>(0.3)

/** Generation counter to discard stale async results. */
let loadGeneration = 0

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

/** Toggle the graph view on/off. Loads data when activating. */
export function toggleGraphView(): void {
  const isActive = get(graphViewActive)
  if (isActive) {
    graphViewActive.set(false)
    graphSelectedNode.set(null)
    graphOpenedNode.set(null)
  } else {
    graphViewActive.set(true)
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

/** Cycle graph coloring mode: cluster → folder → none → cluster. */
export function cycleColoringMode(): void {
  const current = get(graphColoringMode)
  const next: GraphColoringMode =
    current === 'cluster' ? 'folder' :
    current === 'folder' ? 'none' :
    'cluster'
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
  graphViewActive.set(true)
  graphError.set(null)
  graphLoading.set(false)
}

/** Reset all graph state. */
export function resetGraphState(): void {
  loadGeneration++
  graphViewActive.set(false)
  graphData.set(null)
  graphLoading.set(false)
  graphError.set(null)
  graphSelectedNode.set(null)
  graphOpenedNode.set(null)
  graphColoringMode.set('cluster')
  graphHighlightedFolder.set(null)
  graphHoveredFilePath.set(null)
  graphLevel.set('document')
  graphPathFilter.set(null)
  graphEdgeFilter.set(new Set())
  graphSemanticEdgesEnabled.set(true)
  graphEdgeWeakThreshold.set(0.3)
}
