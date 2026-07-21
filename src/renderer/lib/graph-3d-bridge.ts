/**
 * Data bridge between GraphData (Rust CLI output) and 3d-force-graph input format.
 * All functions are pure — no DOM, WebGL, or side effects.
 */

import type { GraphCluster, GraphData, GraphEdge, GraphLevel, GraphNode } from '../types/cli'
import {
  edgeLinkColor,
  edgeLinkWidth,
  isEdgeVisible,
  isFrontmatterEdge,
  FRONTMATTER_EDGE_COLOR
} from './edge-utils'
import { paletteColor, type HarmonicPalette } from './harmonic-palette'
import { linkKey } from './graph-delta'
import {
  graphGroupIdForMode,
  graphTopLevelFolder,
  type GraphGroupId,
  type GraphGroupingMode
} from './graph-grouping'

// ─── Constants ───────────────────────────────────────────────────────

/** Directional arrow color: no selection or non-neighbor edge. Reads from CSS variable. */
function getArrowGray(): string {
  if (typeof document !== 'undefined') {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-text-dim')
      .trim()
    if (val) return val
  }
  return '#555555'
}

/** Default node color for unclustered nodes or 'none' document mode. Reads from CSS variable. */
function getDefaultNodeColor(): string {
  if (typeof document !== 'undefined') {
    const val = getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim()
    if (val) return val
  }
  return '#E4E4E7'
}

// ─── Interfaces ──────────────────────────────────────────────────────

/** A node formatted for 3d-force-graph consumption. */
export interface Graph3DNode {
  id: string
  path: string
  label: string | null
  cluster_id: number | null
  /** PRIMARY topic (custom cluster) id — null = Unassigned. */
  custom_cluster_id: number | null
  /** All topic memberships, score-descending (empty when none). */
  custom_cluster_ids: number[]
  /** Scores parallel to custom_cluster_ids (empty when none). */
  custom_cluster_scores: number[]
  chunk_index: number | null
  size: number | null
  /** Sphere size value for 3d-force-graph. */
  val: number
  /** Hex color string for the node sphere. */
  color: string
  /** Optional pre-seeded X position (set by the active grouping mode). */
  x?: number
  /** Optional pre-seeded Y position (set by the active grouping mode). */
  y?: number
  /** Optional pre-seeded Z position (set by the active grouping mode). */
  z?: number
}

/** A link formatted for 3d-force-graph consumption. */
export interface Graph3DLink {
  source: string
  target: string
  relationship_type: string | null
  strength: number | null
  context_text: string | null
  edge_cluster_id: number | null
  /** Originating frontmatter field (phase 42); null = body/similarity edge. */
  field: string | null
  /** Hex color string for the link line. */
  color: string
  /** Line width derived from strength. */
  width: number
  /** Stable compact multiset key reused by incremental refreshes. */
  content_key?: string
}

/** Complete graph data formatted for 3d-force-graph. */
export interface Graph3DData {
  nodes: Graph3DNode[]
  links: Graph3DLink[]
}

// ─── Types ───────────────────────────────────────────────────────────

/** Coloring mode controlling node color assignment and spatial grouping. */
export type ColoringMode = GraphGroupingMode

/** Options for buildGraph3DData conversion. */
export interface BuildGraph3DOptions {
  coloringMode: ColoringMode
  edgeFilter: Set<number> | null
  weakThreshold: number
  level: GraphLevel
  /** Harmonic palette for cluster/folder/file-hash node colors */
  clusterPalette: HarmonicPalette
  /** Harmonic palette for custom cluster node colors */
  customClusterPalette: HarmonicPalette
  /** Harmonic palette for edge cluster colors */
  edgePalette: HarmonicPalette
}

// ─── Private Helpers ─────────────────────────────────────────────────

/**
 * Deterministic hash-based color for a file path.
 * Maps any string to one of the palette colors via djb2 hash.
 */
function fileColor(path: string, palette: HarmonicPalette): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  }
  return paletteColor(palette, Math.abs(hash))
}

/**
 * Escape HTML special characters for safe tooltip rendering.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Exported Functions ──────────────────────────────────────────────

/**
 * Compute the node color based on coloring mode, cluster assignment, and level.
 *
 * Single source of truth for node coloring — used both at build time
 * (buildGraph3DData) and by the live nodeColor accessor in GraphView.
 *
 * - cluster: palette by auto cluster_id; unclustered docs → default color
 * - custom-cluster: custom palette by PRIMARY topic (custom_cluster_id);
 *   Unassigned (null) docs → default color; chunks keep file-hash color
 * - folder: folderColorMap by top-level directory
 * - none: file-hash color for chunks, default for documents
 */
export function nodeColorForMode(
  node: Pick<GraphNode, 'path' | 'cluster_id' | 'custom_cluster_id'>,
  mode: ColoringMode,
  folderColorMap: Map<string, string> | null,
  isChunk: boolean,
  palette: HarmonicPalette,
  customPalette: HarmonicPalette,
  defaultColor = getDefaultNodeColor()
): string {
  if (mode === 'cluster') {
    if (node.cluster_id != null) {
      return paletteColor(palette, node.cluster_id)
    }
    return isChunk ? fileColor(node.path, palette) : defaultColor
  }

  if (mode === 'custom-cluster') {
    if (node.custom_cluster_id != null) {
      return paletteColor(customPalette, node.custom_cluster_id)
    }
    return isChunk ? fileColor(node.path, palette) : defaultColor
  }

  if (mode === 'folder') {
    return folderColorMap?.get(graphTopLevelFolder(node.path)) ?? defaultColor
  }

  // 'none' mode: per-file hash color for chunks, default for documents
  return isChunk ? fileColor(node.path, palette) : defaultColor
}

/**
 * Compute a degree map from graph edges.
 * Returns a Map where each key is a node ID and the value is its total degree
 * (number of edges connected to it, counting both source and target).
 */
export function computeDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const edge of edges) {
    map.set(edge.source, (map.get(edge.source) ?? 0) + 1)
    map.set(edge.target, (map.get(edge.target) ?? 0) + 1)
  }
  return map
}

/**
 * Return node IDs with no incoming or outgoing edges in the supplied topology.
 * Edge visibility filters are intentionally ignored by callers so hiding an
 * edge type does not make connected content appear unconnected.
 */
export function findUnconnectedNodeIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const degreeMap = computeDegreeMap(edges)
  return new Set(nodes.filter((node) => !degreeMap.has(node.id)).map((node) => node.id))
}

/**
 * Compute the sphere size value for a node based on the graph level.
 *
 * - Document mode: `1 + degree * 2` — hub nodes appear larger.
 * - Chunk mode: `1 + (size / maxSize) * 8` — content-rich chunks appear larger.
 *
 * Returns at least 1 to ensure all nodes are visible.
 * Handles maxSize of 0 gracefully (returns 1).
 */
export function nodeSizeValue(
  level: GraphLevel,
  degree: number,
  size: number,
  maxSize: number
): number {
  if (level === 'document') {
    return 1 + degree * 2
  }
  // chunk mode
  if (maxSize <= 0) return 1
  return 1 + (size / maxSize) * 8
}

/**
 * Generate HTML tooltip content for a node on hover.
 *
 * Displays: file path (always), cluster label (if present),
 * and chunk heading (for chunk-level nodes with a label).
 */
export function nodeTooltipHtml(node: Graph3DNode, clusterLabel?: string | null): string {
  let html = `<div class="graph-tooltip-title">${escapeHtml(node.path)}</div>`

  if (clusterLabel) {
    html += `<div class="graph-tooltip-meta">Cluster: ${escapeHtml(clusterLabel)}</div>`
  }

  if (node.chunk_index != null && node.label) {
    html += `<div class="graph-tooltip-meta">${escapeHtml(node.label)}</div>`
  }

  return html
}

/**
 * Generate HTML tooltip content for an edge on hover.
 *
 * Returns empty string — edge tooltips are handled by the custom Svelte
 * overlay in GraphView.svelte, so the 3d-force-graph built-in tooltip
 * is intentionally suppressed to avoid showing two popovers.
 */
export function edgeTooltipHtml(_link: Graph3DLink): string {
  return ''
}

/**
 * Determine the directional arrow color for an edge relative to the selected node.
 *
 * Color logic (using 3-color arrow palette):
 * - No selection: gray (from CSS --color-text-dim)
 * - Bidirectional (selected node on either end): arrowPalette[2]
 * - Outgoing (source === selected): arrowPalette[0] (primary)
 * - Incoming (target === selected): arrowPalette[1]
 * - Non-neighbor (selected but edge not connected): gray
 */
export function edgeArrowColor(
  sourceId: string,
  targetId: string,
  selectedNodeId: string | null,
  isBidirectional: boolean,
  arrowPalette?: HarmonicPalette
): string {
  const gray = getArrowGray()
  if (selectedNodeId == null) return gray

  const isSource = sourceId === selectedNodeId
  const isTarget = targetId === selectedNodeId

  if (!isSource && !isTarget) return gray

  if (arrowPalette) {
    if (isBidirectional) return paletteColor(arrowPalette, 2)
    if (isSource) return paletteColor(arrowPalette, 0)
    return paletteColor(arrowPalette, 1)
  }

  // Fallback when no palette provided (e.g., in tests)
  if (isBidirectional) return '#51CF66'
  if (isSource) return '#00E5FF'
  return '#FF6B6B'
}

/**
 * Pre-seed node positions using Fibonacci sphere distribution by cluster.
 *
 * Each cluster is assigned a centroid on a sphere of radius `spreadRadius`.
 * Centroids are evenly distributed using the Fibonacci sphere algorithm.
 * Nodes within a cluster are placed near their cluster centroid with small jitter.
 * Nodes without a cluster_id are placed near the origin with random jitter.
 *
 * Mutates the `x`, `y`, `z` fields of each node in place.
 */
function seedPositionsByGroup(
  nodes: Graph3DNode[],
  groupIds: readonly GraphGroupId[],
  groupIdForNode: (node: Graph3DNode) => GraphGroupId | null,
  spreadRadius: number
): void {
  if (nodes.length === 0) return

  // Compute Fibonacci sphere centroids for each active layout group.
  const groupCentroids = new Map<GraphGroupId, { x: number; y: number; z: number }>()
  const n = groupIds.length

  if (n > 0) {
    const goldenAngle = Math.PI * (1 + Math.sqrt(5))

    for (let i = 0; i < n; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n)
      const theta = goldenAngle * i

      groupCentroids.set(groupIds[i], {
        x: Math.cos(theta) * Math.sin(phi) * spreadRadius,
        y: Math.sin(theta) * Math.sin(phi) * spreadRadius,
        z: Math.cos(phi) * spreadRadius
      })
    }
  }

  // Place each node near its group centroid or near origin.
  const jitterScale = spreadRadius * 0.15

  for (const node of nodes) {
    const groupId = groupIdForNode(node)
    const centroid = groupId == null ? undefined : groupCentroids.get(groupId)

    if (centroid) {
      node.x = centroid.x + (Math.random() - 0.5) * jitterScale
      node.y = centroid.y + (Math.random() - 0.5) * jitterScale
      node.z = centroid.z + (Math.random() - 0.5) * jitterScale
    } else {
      // Ungrouped: near origin with jitter.
      node.x = (Math.random() - 0.5) * jitterScale
      node.y = (Math.random() - 0.5) * jitterScale
      node.z = (Math.random() - 0.5) * jitterScale
    }
  }
}

/** Pre-seed positions using the grouping represented by the selected graph mode. */
export function seedGroupedPositions(
  nodes: Graph3DNode[],
  mode: GraphGroupingMode,
  spreadRadius: number = 200
): void {
  const groupIds = [...new Set(nodes.map((node) => graphGroupIdForMode(node, mode)))].filter(
    (groupId): groupId is GraphGroupId => groupId != null
  )
  groupIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  seedPositionsByGroup(nodes, groupIds, (node) => graphGroupIdForMode(node, mode), spreadRadius)
}

/** Backward-compatible automatic-cluster seeding helper used by focused unit tests. */
export function seedClusterPositions(
  nodes: Graph3DNode[],
  clusters: GraphCluster[],
  spreadRadius: number = 200
): void {
  seedPositionsByGroup(
    nodes,
    clusters.map((cluster) => `cluster:${cluster.id}`),
    (node) => graphGroupIdForMode(node, 'cluster'),
    spreadRadius
  )
}

/** Compute current centroids for the active spatial grouping. */
export function computeGraphGroupCentroids(
  nodes: readonly Graph3DNode[],
  mode: GraphGroupingMode
): Map<GraphGroupId, { x: number; y: number; z: number }> {
  const sums = new Map<GraphGroupId, { x: number; y: number; z: number; count: number }>()
  for (const node of nodes) {
    const groupId = graphGroupIdForMode(node, mode)
    if (groupId == null) continue
    const existing = sums.get(groupId)
    if (existing) {
      existing.x += node.x ?? 0
      existing.y += node.y ?? 0
      existing.z += node.z ?? 0
      existing.count++
    } else {
      sums.set(groupId, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
        count: 1
      })
    }
  }

  return new Map(
    [...sums].map(([groupId, sum]) => [
      groupId,
      { x: sum.x / sum.count, y: sum.y / sum.count, z: sum.z / sum.count }
    ])
  )
}

/**
 * Seed positions for newly-added nodes near their already-positioned
 * neighbors, so an incremental patch drops nodes in a sensible place instead
 * of at the origin. Mutates x/y/z in place. Precedence:
 *   1. average of up to 3 positioned link-neighbors + jitter
 *   2. else the node's active layout-group centroid + jitter
 *   3. else origin + jitter
 */
export function seedNearNeighbors(
  newNodes: Graph3DNode[],
  allLinks: { sourceId: string; targetId: string }[],
  positions: Map<string, { x: number; y: number; z: number }>,
  groupCentroids: ReadonlyMap<GraphGroupId, { x: number; y: number; z: number }>,
  jitter: number = 25,
  mode: GraphGroupingMode = 'cluster'
): void {
  if (newNodes.length === 0) return

  // Build adjacency limited to the new nodes we need to place
  const newIds = new Set(newNodes.map((n) => n.id))
  const neighbors = new Map<string, string[]>()
  for (const link of allLinks) {
    if (newIds.has(link.sourceId)) {
      const arr = neighbors.get(link.sourceId) ?? []
      arr.push(link.targetId)
      neighbors.set(link.sourceId, arr)
    }
    if (newIds.has(link.targetId)) {
      const arr = neighbors.get(link.targetId) ?? []
      arr.push(link.sourceId)
      neighbors.set(link.targetId, arr)
    }
  }

  const jit = () => (Math.random() - 0.5) * jitter

  for (const node of newNodes) {
    const linked = neighbors.get(node.id) ?? []
    const anchors: { x: number; y: number; z: number }[] = []
    for (const id of linked) {
      const pos = positions.get(id)
      if (pos) anchors.push(pos)
      if (anchors.length >= 3) break
    }

    if (anchors.length > 0) {
      const sum = anchors.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), {
        x: 0,
        y: 0,
        z: 0
      })
      node.x = sum.x / anchors.length + jit()
      node.y = sum.y / anchors.length + jit()
      node.z = sum.z / anchors.length + jit()
      continue
    }

    const groupId = graphGroupIdForMode(node, mode)
    const centroid = groupId == null ? undefined : groupCentroids.get(groupId)
    if (centroid) {
      node.x = centroid.x + jit()
      node.y = centroid.y + jit()
      node.z = centroid.z + jit()
    } else {
      node.x = jit()
      node.y = jit()
      node.z = jit()
    }
  }
}

/**
 * Convert a `GraphData` payload from the Rust CLI into the format consumed
 * by 3d-force-graph.
 *
 * Handles:
 * - Edge filtering via `isEdgeVisible()`
 * - Degree computation from visible edges
 * - Node size (`val`) based on level (degree for documents, content size for chunks)
 * - Node color based on coloring mode (cluster / folder / none)
 * - Edge color and width based on cluster palette and strength
 */
export function buildGraph3DData(data: GraphData, options: BuildGraph3DOptions): Graph3DData {
  if (data.nodes.length === 0) {
    return { nodes: [], links: [] }
  }

  // 1. Filter edges by edge cluster visibility
  const visibleEdges = data.edges.filter((e) => isEdgeVisible(e, options.edgeFilter))

  // 2. Compute degree map from visible edges
  const degreeMap = computeDegreeMap(visibleEdges)

  // 3. Compute max values for normalization
  let maxSize = 1
  for (const node of data.nodes) maxSize = Math.max(maxSize, node.size ?? 0)

  // 4. Build folder color map if in folder mode
  let folderColorMap: Map<string, string> | null = null
  if (options.coloringMode === 'folder') {
    folderColorMap = new Map<string, string>()
    const folders = new Set(data.nodes.map((n) => graphTopLevelFolder(n.path)))
    let i = 0
    for (const folder of folders) {
      folderColorMap.set(folder, paletteColor(options.clusterPalette, i))
      i++
    }
  }

  const isChunk = options.level === 'chunk'
  const defaultNodeColor = getDefaultNodeColor()

  const edgeContext = (edge: GraphEdge): string | null => {
    if (edge.context_text != null) return edge.context_text
    if (edge.context_index == null) return null
    return data.contexts?.[edge.context_index] ?? null
  }

  // 5. Map nodes to Graph3DNode format
  const nodes: Graph3DNode[] = data.nodes.map((node) => {
    const degree = degreeMap.get(node.id) ?? 0
    const val = nodeSizeValue(options.level, degree, node.size ?? 0, maxSize)
    const color = nodeColorForMode(
      node,
      options.coloringMode,
      folderColorMap,
      isChunk,
      options.clusterPalette,
      options.customClusterPalette,
      defaultNodeColor
    )

    return {
      id: node.id,
      path: node.path,
      label: node.label,
      cluster_id: node.cluster_id,
      custom_cluster_id: node.custom_cluster_id ?? null,
      custom_cluster_ids: node.custom_cluster_ids ?? [],
      custom_cluster_scores: node.custom_cluster_scores ?? [],
      chunk_index: node.chunk_index,
      size: node.size ?? null,
      val,
      color
    }
  })

  // 6. Map edges to Graph3DLink format. Frontmatter relation edges (phase 42)
  // get a distinct hue; GraphView additionally renders them dashed.
  const links: Graph3DLink[] = visibleEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relationship_type: edge.relationship_type ?? null,
    strength: edge.strength ?? null,
    // Compact graph responses intern full contexts. Assigning the shared
    // string reference here preserves existing tooltips without duplicating
    // the serialized text once per edge.
    context_text: edgeContext(edge),
    edge_cluster_id: edge.edge_cluster_id ?? null,
    field: edge.field ?? null,
    color: isFrontmatterEdge(edge)
      ? FRONTMATTER_EDGE_COLOR
      : edgeLinkColor(
          edge.edge_cluster_id,
          edge.strength ?? 0.5,
          options.weakThreshold,
          options.edgePalette
        ),
    width: edgeLinkWidth(edge.strength ?? 0.5),
    content_key: linkKey(edge, data.contexts)
  }))

  return { nodes, links }
}
