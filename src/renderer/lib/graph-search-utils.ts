/**
 * Utility functions for graph search overlay visualization.
 * All functions are pure — no DOM, WebGL, or side effects.
 */

import type { SearchResult, GraphContextItem } from '../types/cli'

// ─── Types ───────────────────────────────────────────────────────────

/** A force-graph node object with at least an id field. */
interface ForceNode {
  id: string
  [key: string]: unknown
}

// ─── Exported Functions ──────────────────────────────────────────────

/**
 * Extract the file path from a force-graph node endpoint.
 * Handles both string IDs and resolved ForceNode object references
 * (3d-force-graph replaces string IDs with node object refs).
 */
export function getNodePath(endpoint: unknown): string {
  if (typeof endpoint === 'object' && endpoint != null && 'id' in endpoint) {
    return String((endpoint as ForceNode).id)
  }
  return String(endpoint)
}

/**
 * Build a map of file path → max search score from search results.
 * Takes the maximum score per file path across all result chunks.
 */
export function buildSearchScoreMap(results: SearchResult[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const result of results) {
    const path = result.file.path
    const existing = map.get(path)
    if (existing === undefined || result.score > existing) {
      map.set(path, result.score)
    }
  }
  return map
}

/**
 * Build a map of file path → attenuated score from graph context items.
 * Score is attenuated by 0.4 / hop_distance. Skips paths that already
 * exist in the direct match score map (direct matches take priority).
 */
export function buildGraphContextMap(
  contextItems: GraphContextItem[],
  directMatchMap: Map<string, number>
): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of contextItems) {
    const path = item.file.path
    // Skip direct matches — they already have full scores
    if (directMatchMap.has(path)) continue
    const score = 0.4 / item.hop_distance
    const existing = map.get(path)
    if (existing === undefined || score > existing) {
      map.set(path, score)
    }
  }
  return map
}

/**
 * Compute the opacity for a search-highlighted node.
 *
 * - Matched nodes (score > 0): 0.3 + 0.7 * score
 * - Unmatched nodes (score undefined): 0.05
 */
export function computeSearchNodeOpacity(score: number | undefined): number {
  if (score === undefined) return 0.05
  return 0.3 + 0.7 * score
}

/**
 * Compute the alpha value for an edge during search visualization.
 *
 * - Both endpoints matched: 0.2 + 0.8 * min(srcScore, tgtScore)
 * - One endpoint matched: 0.08
 * - Neither endpoint matched: 0.02
 */
export function computeEdgeSearchAlpha(
  srcScore: number | undefined,
  tgtScore: number | undefined
): number {
  const srcMatched = srcScore !== undefined
  const tgtMatched = tgtScore !== undefined
  if (srcMatched && tgtMatched) {
    return 0.2 + 0.8 * Math.min(srcScore, tgtScore)
  }
  if (srcMatched || tgtMatched) {
    return 0.08
  }
  return 0.02
}
