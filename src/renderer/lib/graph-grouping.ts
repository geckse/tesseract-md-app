/** Shared node-group resolution for graph colors, seeding, and force layout. */

export type GraphGroupingMode = 'cluster' | 'custom-cluster' | 'folder' | 'none'

/** Stable, namespaced key consumed by the layout engine and position cache. */
export type GraphGroupId = string

export interface GraphGroupableNode {
  path: string
  cluster_id: number | null
  custom_cluster_id?: number | null
}

/** Extract the top-level folder from a path, or the synthetic root bucket. */
export function graphTopLevelFolder(path: string): string {
  const separator = path.indexOf('/')
  return separator >= 0 ? path.substring(0, separator) : '(root)'
}

/**
 * Resolve the single spatial group represented by a graph view mode.
 * Topic layout deliberately follows the primary topic, matching node colors
 * and enclosure hulls; secondary memberships remain a highlighting concern.
 */
export function graphGroupIdForMode(
  node: GraphGroupableNode,
  mode: GraphGroupingMode
): GraphGroupId | null {
  if (mode === 'cluster') {
    return node.cluster_id == null ? null : `cluster:${node.cluster_id}`
  }
  if (mode === 'custom-cluster') {
    return node.custom_cluster_id == null ? null : `topic:${node.custom_cluster_id}`
  }
  if (mode === 'folder') {
    return `folder:${graphTopLevelFolder(node.path)}`
  }
  return null
}
