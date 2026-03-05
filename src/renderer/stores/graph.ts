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

/** Whether cluster coloring is enabled. */
export const graphClusterColoring = writable<boolean>(true)

/** Current graph detail level (document or chunk). */
export const graphLevel = writable<GraphLevel>('document')

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
    const data = await window.api.graphData(collection.path, level)

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

/** Select a node in the graph, or clear selection with null. */
export function selectGraphNode(node: GraphNode | null): void {
  graphSelectedNode.set(node)
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
