export interface GraphLegendNode {
  path: string
  cluster_id?: number | null
  custom_cluster_ids?: readonly number[]
}

export type GraphLegendHighlight =
  | { kind: 'cluster'; id: number }
  | { kind: 'topic'; id: number }
  | { kind: 'folder'; path: string }

export type GraphLegendLinkMatch = 'both' | 'incident' | 'none'

function normalizedGraphPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
}

/** Match a folder boundary without treating `docs-old` as a child of `docs`. */
export function graphNodeBelongsToFolder(nodePath: string, folderPath: string): boolean {
  const node = normalizedGraphPath(nodePath)
  const folder = normalizedGraphPath(folderPath)
  if (folder === '' || folder === '.') return true
  if (folder === '(root)') return !node.includes('/')
  return node === folder || node.startsWith(`${folder}/`)
}

/** Whether a graph node belongs to the active legend selection. */
export function graphNodeMatchesLegendHighlight(
  node: GraphLegendNode,
  highlight: GraphLegendHighlight
): boolean {
  if (highlight.kind === 'cluster') return node.cluster_id === highlight.id
  if (highlight.kind === 'topic') return node.custom_cluster_ids?.includes(highlight.id) ?? false
  return graphNodeBelongsToFolder(node.path, highlight.path)
}

/** Classify a link for group highlighting without coupling to renderer objects. */
export function graphLegendLinkMatch(
  source: GraphLegendNode | undefined,
  target: GraphLegendNode | undefined,
  highlight: GraphLegendHighlight
): GraphLegendLinkMatch {
  const sourceMatches = source ? graphNodeMatchesLegendHighlight(source, highlight) : false
  const targetMatches = target ? graphNodeMatchesLegendHighlight(target, highlight) : false
  if (sourceMatches && targetMatches) return 'both'
  if (sourceMatches || targetMatches) return 'incident'
  return 'none'
}

/**
 * Toggle one edge type using `null = all visible`, allowing an empty set to
 * represent the useful "hide every typed edge" state.
 */
export function toggleVisibleEdgeCluster(
  current: ReadonlySet<number> | null,
  availableClusterIds: Iterable<number>,
  clusterId: number
): Set<number> | null {
  const available = new Set(availableClusterIds)
  if (!available.has(clusterId)) return current === null ? null : new Set(current)

  const next =
    current === null
      ? new Set(available)
      : new Set([...current].filter((candidate) => available.has(candidate)))
  if (next.has(clusterId)) next.delete(clusterId)
  else next.add(clusterId)

  if (next.size === available.size && [...available].every((id) => next.has(id))) return null
  return next
}
