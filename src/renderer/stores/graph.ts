import { writable, get } from 'svelte/store'
import type { GraphData, GraphLevel, GraphNode } from '../types/cli'
import { activeCollection } from './collections'

/** Whether the graph view is currently active. */
export const graphViewActive = writable<boolean>(false)

/** Graph data from the last successful load. */
export const graphData = writable<GraphData | null>(null)

/** Whether graph data is currently loading. */
export const graphLoading = writable<boolean>(false)

/** Error message if graph data loading failed. */
export const graphError = writable<string | null>(null)

/** Currently selected node in the graph. */
export const graphSelectedNode = writable<GraphNode | null>(null)

/** Graph coloring mode: cluster-based, folder-based, or none. */
export type GraphColoringMode = 'cluster' | 'folder' | 'none'

/** Current graph coloring mode. */
export const graphColoringMode = writable<GraphColoringMode>('cluster')

/** Currently highlighted folder path in the graph. */
export const graphHighlightedFolder = writable<string | null>(null)

/** Current graph detail level (document or chunk). */
export const graphLevel = writable<GraphLevel>('document')

/** Optional path filter to scope graph to a subdirectory. */
export const graphPathFilter = writable<string | null>(null)

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
  } else {
    graphViewActive.set(true)
    loadGraphData()
  }
}

/** Set the graph detail level and reload data. */
export function setGraphLevel(level: GraphLevel): void {
  graphLevel.set(level)
  graphSelectedNode.set(null)
  if (get(graphViewActive)) {
    loadGraphData()
  }
}

/** Set the path filter and reload graph data. */
export function setGraphPathFilter(path: string | null): void {
  graphPathFilter.set(path)
  graphSelectedNode.set(null)
  if (get(graphViewActive)) {
    loadGraphData()
  }
}

/** Select a node in the graph, or clear selection with null. */
export function selectGraphNode(node: GraphNode | null): void {
  graphSelectedNode.set(node)
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

/** Set or toggle the highlighted folder. If the same path is set again, clears it. */
export function setGraphHighlightedFolder(path: string | null): void {
  const current = get(graphHighlightedFolder)
  graphHighlightedFolder.set(current === path ? null : path)
}

/** Reset all graph state. */
export function resetGraphState(): void {
  loadGeneration++
  graphViewActive.set(false)
  graphData.set(null)
  graphLoading.set(false)
  graphError.set(null)
  graphSelectedNode.set(null)
  graphColoringMode.set('cluster')
  graphHighlightedFolder.set(null)
  graphLevel.set('document')
  graphPathFilter.set(null)
}
