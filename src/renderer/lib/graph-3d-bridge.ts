/**
 * Data bridge between GraphData (Rust CLI output) and 3d-force-graph input format.
 * All functions are pure — no DOM, WebGL, or side effects.
 */

import type { GraphCluster, GraphData, GraphEdge, GraphLevel, GraphNode } from '../types/cli'
import { edgeLinkColor, edgeLinkWidth, isEdgeVisible } from './edge-utils'

// ─── Constants ───────────────────────────────────────────────────────

/** 12-color cluster palette, matching GraphView 2D cluster colors. */
const CLUSTER_COLORS: string[] = [
  '#E879F9',
  '#FF6B6B',
  '#51CF66',
  '#FFD43B',
  '#845EF7',
  '#FF922B',
  '#20C997',
  '#F06595',
  '#339AF0',
  '#B2F2BB',
  '#D0BFFF',
  '#FFC078'
]

/** Default node color for unclustered nodes or 'none' document mode. */
const DEFAULT_NODE_COLOR = '#E4E4E7'

/** Directional arrow color: outgoing edge from selected node. */
const ARROW_CYAN = '#00E5FF'

/** Directional arrow color: incoming edge to selected node. */
const ARROW_RED = '#FF6B6B'

/** Directional arrow color: bidirectional edge with selected node. */
const ARROW_GREEN = '#51CF66'

/** Directional arrow color: no selection or non-neighbor edge. */
const ARROW_GRAY = '#555555'

// ─── Interfaces ──────────────────────────────────────────────────────

/** A node formatted for 3d-force-graph consumption. */
export interface Graph3DNode {
  id: string
  path: string
  label: string | null
  cluster_id: number | null
  chunk_index: number | null
  size: number | null
  /** Sphere size value for 3d-force-graph. */
  val: number
  /** Hex color string for the node sphere. */
  color: string
  /** Optional pre-seeded X position (set by seedClusterPositions). */
  x?: number
  /** Optional pre-seeded Y position (set by seedClusterPositions). */
  y?: number
  /** Optional pre-seeded Z position (set by seedClusterPositions). */
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
  /** Hex color string for the link line. */
  color: string
  /** Line width derived from strength. */
  width: number
}

/** Complete graph data formatted for 3d-force-graph. */
export interface Graph3DData {
  nodes: Graph3DNode[]
  links: Graph3DLink[]
}

// ─── Types ───────────────────────────────────────────────────────────

/** Coloring mode controlling node color assignment. */
export type ColoringMode = 'cluster' | 'folder' | 'none'

/** Options for buildGraph3DData conversion. */
export interface BuildGraph3DOptions {
  coloringMode: ColoringMode
  edgeFilter: Set<number> | null
  weakThreshold: number
  level: GraphLevel
}

// ─── Private Helpers ─────────────────────────────────────────────────

/**
 * Deterministic hash-based color for a file path.
 * Maps any string to one of the 12 cluster palette colors via djb2 hash.
 */
function fileColor(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  }
  return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length]
}

/**
 * Extract the top-level folder from a file path.
 * Returns '(root)' for files without a directory separator.
 */
function getTopLevelFolder(path: string): string {
  const idx = path.indexOf('/')
  return idx >= 0 ? path.substring(0, idx) : '(root)'
}

/**
 * Compute the node color based on coloring mode, cluster assignment, and level.
 */
function nodeColor(
  node: GraphNode,
  mode: ColoringMode,
  folderColorMap: Map<string, string> | null,
  isChunk: boolean
): string {
  if (mode === 'cluster') {
    if (node.cluster_id != null) {
      return CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length]
    }
    return isChunk ? fileColor(node.path) : DEFAULT_NODE_COLOR
  }

  if (mode === 'folder') {
    return folderColorMap?.get(getTopLevelFolder(node.path)) ?? DEFAULT_NODE_COLOR
  }

  // 'none' mode: per-file hash color for chunks, default for documents
  return isChunk ? fileColor(node.path) : DEFAULT_NODE_COLOR
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
 * Displays: relationship type (if present), strength as percentage bar,
 * and context text excerpt (truncated at 120 characters).
 */
export function edgeTooltipHtml(link: Graph3DLink): string {
  let html = ''

  if (link.relationship_type) {
    html += `<div class="graph-tooltip-title">${escapeHtml(link.relationship_type)}</div>`
  }

  if (link.strength != null) {
    const pct = Math.round(link.strength * 100)
    html += `<div class="graph-tooltip-meta">Strength: ${pct}%</div>`
  }

  if (link.context_text) {
    const text =
      link.context_text.length > 120
        ? link.context_text.slice(0, 120) + '\u2026'
        : link.context_text
    html += `<div class="graph-tooltip-context">${escapeHtml(text)}</div>`
  }

  return html
}

/**
 * Determine the directional arrow color for an edge relative to the selected node.
 *
 * Color logic:
 * - No selection: gray (#555555)
 * - Bidirectional (selected node on either end): green (#51CF66)
 * - Outgoing (source === selected): cyan (#00E5FF)
 * - Incoming (target === selected): red (#FF6B6B)
 * - Non-neighbor (selected but edge not connected): gray (#555555)
 */
export function edgeArrowColor(
  sourceId: string,
  targetId: string,
  selectedNodeId: string | null,
  isBidirectional: boolean
): string {
  if (selectedNodeId == null) return ARROW_GRAY

  const isSource = sourceId === selectedNodeId
  const isTarget = targetId === selectedNodeId

  if (!isSource && !isTarget) return ARROW_GRAY

  if (isBidirectional) return ARROW_GREEN
  if (isSource) return ARROW_CYAN
  return ARROW_RED
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
export function seedClusterPositions(
  nodes: Graph3DNode[],
  clusters: GraphCluster[],
  spreadRadius: number = 200
): void {
  if (nodes.length === 0) return

  // Compute Fibonacci sphere centroids for each cluster
  const clusterCentroids = new Map<number, { x: number; y: number; z: number }>()
  const n = clusters.length

  if (n > 0) {
    const goldenAngle = Math.PI * (1 + Math.sqrt(5))

    for (let i = 0; i < n; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n)
      const theta = goldenAngle * i

      clusterCentroids.set(clusters[i].id, {
        x: Math.cos(theta) * Math.sin(phi) * spreadRadius,
        y: Math.sin(theta) * Math.sin(phi) * spreadRadius,
        z: Math.cos(phi) * spreadRadius
      })
    }
  }

  // Place each node near its cluster centroid or near origin
  const jitterScale = spreadRadius * 0.15

  for (const node of nodes) {
    const centroid = node.cluster_id != null ? clusterCentroids.get(node.cluster_id) : undefined

    if (centroid) {
      node.x = centroid.x + (Math.random() - 0.5) * jitterScale
      node.y = centroid.y + (Math.random() - 0.5) * jitterScale
      node.z = centroid.z + (Math.random() - 0.5) * jitterScale
    } else {
      // Unclustered: near origin with jitter
      node.x = (Math.random() - 0.5) * jitterScale
      node.y = (Math.random() - 0.5) * jitterScale
      node.z = (Math.random() - 0.5) * jitterScale
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
  const maxSize = Math.max(1, ...data.nodes.map((n) => n.size ?? 0))

  // 4. Build folder color map if in folder mode
  let folderColorMap: Map<string, string> | null = null
  if (options.coloringMode === 'folder') {
    folderColorMap = new Map<string, string>()
    const folders = new Set(data.nodes.map((n) => getTopLevelFolder(n.path)))
    let i = 0
    for (const folder of folders) {
      folderColorMap.set(folder, CLUSTER_COLORS[i % CLUSTER_COLORS.length])
      i++
    }
  }

  const isChunk = options.level === 'chunk'

  // 5. Map nodes to Graph3DNode format
  const nodes: Graph3DNode[] = data.nodes.map((node) => {
    const degree = degreeMap.get(node.id) ?? 0
    const val = nodeSizeValue(options.level, degree, node.size ?? 0, maxSize)
    const color = nodeColor(node, options.coloringMode, folderColorMap, isChunk)

    return {
      id: node.id,
      path: node.path,
      label: node.label,
      cluster_id: node.cluster_id,
      chunk_index: node.chunk_index,
      size: node.size ?? null,
      val,
      color
    }
  })

  // 6. Map edges to Graph3DLink format
  const links: Graph3DLink[] = visibleEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relationship_type: edge.relationship_type ?? null,
    strength: edge.strength ?? null,
    context_text: edge.context_text ?? null,
    edge_cluster_id: edge.edge_cluster_id ?? null,
    color: edgeLinkColor(edge.edge_cluster_id, edge.strength ?? 0.5, options.weakThreshold),
    width: edgeLinkWidth(edge.strength ?? 0.5)
  }))

  return { nodes, links }
}
