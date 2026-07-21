import type { GraphContextItem } from '../types/cli'
import type { Graph3DLink, Graph3DNode } from './graph-3d-bridge'

export const GRAPH_SEARCH_DIM_MS = 220
export const GRAPH_SEARCH_NODE_FADE_MS = 260
export const GRAPH_SEARCH_LINK_TRACE_MS = 220
export const GRAPH_SEARCH_MAX_BEATS = 120

/** Give a revealed parent time to become visible before its branch departs. */
const GRAPH_SEARCH_CHILD_FADE_DELAY_MS = 100
/** Let the traced connection lead its child node by a short presentation beat. */
const GRAPH_SEARCH_LINK_START_DELAY_MS = 80

export interface GraphSearchRevealStep {
  nodeId: string
  path: string
  score: number
  waveScore: number
  kind: 'direct' | 'context'
  parentNodeId: string | null
  depth: number
  component: number
  beat: number
}

export interface GraphSearchRevealConnection {
  linkIndex: number
  fromNodeId: string
  toNodeId: string
  /** 1 traces source → target; -1 traces target → source. */
  direction: 1 | -1
  beat: number
  /** Timeline offset after the global dim phase. */
  startMs: number
}

export interface GraphSearchRevealPlan {
  steps: GraphSearchRevealStep[]
  connections: GraphSearchRevealConnection[]
  relevantNodeIds: Set<string>
  relevantLinkIndices: Set<number>
  beatCount: number
  staggerMs: number
  totalDurationMs: number
}

export interface GraphSearchRevealFrame {
  phase: 'dimming' | 'revealing' | 'complete'
  dimProgress: number
  nodeProgress: Map<string, number>
  linkProgress: Map<number, number>
  revealedCount: number
  complete: boolean
}

interface RelevantNode {
  node: Graph3DNode
  score: number
  kind: 'direct' | 'context'
}

interface AdjacentLink {
  neighborId: string
  linkIndex: number
  /** True when this node is the link source and the neighbor is the target. */
  outgoing: boolean
  strength: number
}

interface ParentCandidate {
  parent: GraphSearchRevealStep
  link: AdjacentLink
  explicit: boolean
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function endpointId(endpoint: unknown): string {
  if (typeof endpoint === 'object' && endpoint != null && 'id' in endpoint) {
    return String((endpoint as { id: unknown }).id)
  }
  return String(endpoint ?? '')
}

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Preserve the backend's graph-expansion parent hint. Duplicate context rows
 * choose the nearest hop, then a stable lexical parent.
 */
export function buildGraphSearchContextParents(items: GraphContextItem[]): Map<string, string> {
  const chosen = new Map<string, { parent: string; hop: number }>()
  for (const item of items) {
    const path = item.file.path
    const parent = item.linked_from
    if (!path || !parent) continue
    const hop = Number.isFinite(item.hop_distance) ? Math.max(0, item.hop_distance) : Infinity
    const previous = chosen.get(path)
    if (
      !previous ||
      hop < previous.hop ||
      (hop === previous.hop && lexical(parent, previous.parent) < 0)
    ) {
      chosen.set(path, { parent, hop })
    }
  }
  return new Map([...chosen].map(([path, value]) => [path, value.parent]))
}

function bestParentForNode(
  candidate: RelevantNode,
  adjacency: Map<string, AdjacentLink[]>,
  revealed: Map<string, GraphSearchRevealStep>,
  contextParentByPath: ReadonlyMap<string, string>
): ParentCandidate | null {
  const options: ParentCandidate[] = []
  for (const link of adjacency.get(candidate.node.id) ?? []) {
    const parent = revealed.get(link.neighborId)
    if (!parent) continue
    options.push({
      parent,
      link,
      explicit: contextParentByPath.get(candidate.node.path) === parent.path
    })
  }
  options.sort((a, b) => {
    if (a.explicit !== b.explicit) return a.explicit ? -1 : 1
    // Prefer graph direction flowing from the revealed parent into the child.
    if (a.link.outgoing !== b.link.outgoing) return a.link.outgoing ? 1 : -1
    if (a.parent.waveScore !== b.parent.waveScore) return b.parent.waveScore - a.parent.waveScore
    if (a.link.strength !== b.link.strength) return b.link.strength - a.link.strength
    const parentOrder = lexical(a.parent.nodeId, b.parent.nodeId)
    return parentOrder || a.link.linkIndex - b.link.linkIndex
  })
  return options[0] ?? null
}

/**
 * Build a deterministic relevance-first forest over only search-bearing nodes.
 * Direct hits lead. Context nodes then follow real topology, preferring the
 * backend's `linked_from` hint and higher-relevance revealed branches.
 */
export function buildGraphSearchRevealPlan(
  nodes: Graph3DNode[],
  links: Graph3DLink[],
  directScores: ReadonlyMap<string, number>,
  contextScores: ReadonlyMap<string, number>,
  contextParentByPath: ReadonlyMap<string, string> = new Map()
): GraphSearchRevealPlan {
  const relevant = new Map<string, RelevantNode>()
  for (const node of nodes) {
    const direct = directScores.get(node.path)
    const context = contextScores.get(node.path)
    if (direct === undefined && context === undefined) continue
    relevant.set(node.id, {
      node,
      score: clamp01(direct ?? context ?? 0),
      kind: direct !== undefined ? 'direct' : 'context'
    })
  }

  const adjacency = new Map<string, AdjacentLink[]>()
  for (const id of relevant.keys()) adjacency.set(id, [])
  for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
    const link = links[linkIndex]
    const source = endpointId(link.source)
    const target = endpointId(link.target)
    if (source === target || !relevant.has(source) || !relevant.has(target)) continue
    const strength = clamp01(link.strength ?? 0.5)
    adjacency.get(source)?.push({ neighborId: target, linkIndex, outgoing: true, strength })
    adjacency.get(target)?.push({ neighborId: source, linkIndex, outgoing: false, strength })
  }

  const remaining = new Set(relevant.keys())
  const revealed = new Map<string, GraphSearchRevealStep>()
  const steps: GraphSearchRevealStep[] = []
  let nextComponent = 0

  const append = (candidate: RelevantNode, parentChoice: ParentCandidate | null): void => {
    const parent = parentChoice?.parent ?? null
    const waveScore = parent
      ? Math.min(parent.waveScore, Math.max(candidate.score, parent.waveScore * 0.72))
      : candidate.score
    const step: GraphSearchRevealStep = {
      nodeId: candidate.node.id,
      path: candidate.node.path,
      score: candidate.score,
      waveScore,
      kind: candidate.kind,
      parentNodeId: parent?.nodeId ?? null,
      depth: parent ? parent.depth + 1 : 0,
      component: parent ? parent.component : nextComponent++,
      beat: 0
    }
    remaining.delete(step.nodeId)
    revealed.set(step.nodeId, step)
    steps.push(step)
  }

  const direct = [...relevant.values()]
    .filter((item) => item.kind === 'direct')
    .sort((a, b) => b.score - a.score || lexical(a.node.id, b.node.id))
  for (const candidate of direct) {
    append(candidate, bestParentForNode(candidate, adjacency, revealed, contextParentByPath))
  }

  while (remaining.size > 0) {
    const connected = [...remaining]
      .map((id) => {
        const candidate = relevant.get(id)!
        const parentChoice = bestParentForNode(candidate, adjacency, revealed, contextParentByPath)
        if (!parentChoice) return null
        const waveScore = Math.min(
          parentChoice.parent.waveScore,
          Math.max(candidate.score, parentChoice.parent.waveScore * 0.72)
        )
        return { candidate, parentChoice, waveScore }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        if (a.waveScore !== b.waveScore) return b.waveScore - a.waveScore
        if (a.parentChoice.explicit !== b.parentChoice.explicit) {
          return a.parentChoice.explicit ? -1 : 1
        }
        if (a.candidate.score !== b.candidate.score) return b.candidate.score - a.candidate.score
        return lexical(a.candidate.node.id, b.candidate.node.id)
      })

    if (connected.length > 0) {
      append(connected[0].candidate, connected[0].parentChoice)
      continue
    }

    const root = [...remaining]
      .map((id) => relevant.get(id)!)
      .sort((a, b) => b.score - a.score || lexical(a.node.id, b.node.id))[0]
    append(root, null)
  }

  const batchSize = Math.max(1, Math.ceil(steps.length / GRAPH_SEARCH_MAX_BEATS))
  for (let index = 0; index < steps.length; index++) {
    steps[index].beat = Math.floor(index / batchSize)
  }
  const beatCount = steps.length === 0 ? 0 : steps.at(-1)!.beat + 1
  const staggerMs =
    beatCount <= 1 ? 0 : Math.max(28, Math.min(80, 2_200 / Math.max(1, beatCount - 1)))

  const orderIndex = new Map(steps.map((step, index) => [step.nodeId, index]))
  const nodeStartById = new Map(
    steps.map((step) => [
      step.nodeId,
      step.beat * staggerMs + (step.parentNodeId ? GRAPH_SEARCH_CHILD_FADE_DELAY_MS : 0)
    ])
  )
  const connections: GraphSearchRevealConnection[] = []
  const relevantLinkIndices = new Set<number>()
  for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
    const link = links[linkIndex]
    const source = endpointId(link.source)
    const target = endpointId(link.target)
    const sourceOrder = orderIndex.get(source)
    const targetOrder = orderIndex.get(target)
    if (source === target || sourceOrder === undefined || targetOrder === undefined) continue
    relevantLinkIndices.add(linkIndex)
    const sourceFirst = sourceOrder < targetOrder
    const laterStep = steps[Math.max(sourceOrder, targetOrder)]
    const fromNodeId = sourceFirst ? source : target
    connections.push({
      linkIndex,
      fromNodeId,
      toNodeId: sourceFirst ? target : source,
      direction: sourceFirst ? 1 : -1,
      beat: laterStep.beat,
      // In bounded/batched plans a parent and child can share a beat. Taking
      // the parent node's actual start prevents a branch from drawing out of
      // a completely hidden source while preserving the capped beat count.
      startMs: Math.max(
        laterStep.beat * staggerMs + GRAPH_SEARCH_LINK_START_DELAY_MS,
        nodeStartById.get(fromNodeId) ?? 0
      )
    })
  }
  connections.sort((a, b) => a.beat - b.beat || a.linkIndex - b.linkIndex)

  const lastNodeEnd = steps.reduce(
    (latest, step) =>
      Math.max(latest, (nodeStartById.get(step.nodeId) ?? 0) + GRAPH_SEARCH_NODE_FADE_MS),
    0
  )
  const lastLinkEnd = connections.reduce(
    (latest, connection) => Math.max(latest, connection.startMs + GRAPH_SEARCH_LINK_TRACE_MS),
    0
  )
  const totalDurationMs =
    steps.length === 0 ? 0 : GRAPH_SEARCH_DIM_MS + Math.max(lastNodeEnd, lastLinkEnd)

  return {
    steps,
    connections,
    relevantNodeIds: new Set(steps.map((step) => step.nodeId)),
    relevantLinkIndices,
    beatCount,
    staggerMs,
    totalDurationMs
  }
}

function easeOutCubic(value: number): number {
  const t = clamp01(value)
  return 1 - (1 - t) ** 3
}

function smoothstep(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** Sample the complete visual state at an absolute elapsed time. */
export function sampleGraphSearchReveal(
  plan: GraphSearchRevealPlan,
  elapsedMs: number,
  reducedMotion: boolean = false
): GraphSearchRevealFrame {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  const final = reducedMotion || plan.steps.length === 0 || elapsed >= plan.totalDurationMs
  if (final) {
    return {
      phase: 'complete',
      dimProgress: 1,
      nodeProgress: new Map(plan.steps.map((step) => [step.nodeId, 1])),
      linkProgress: new Map(plan.connections.map((connection) => [connection.linkIndex, 1])),
      revealedCount: plan.steps.length,
      complete: true
    }
  }

  const dimProgress = smoothstep(elapsed / GRAPH_SEARCH_DIM_MS)
  if (elapsed < GRAPH_SEARCH_DIM_MS) {
    return {
      phase: 'dimming',
      dimProgress,
      nodeProgress: new Map(),
      linkProgress: new Map(),
      revealedCount: 0,
      complete: false
    }
  }

  const revealElapsed = elapsed - GRAPH_SEARCH_DIM_MS
  const nodeProgress = new Map<string, number>()
  let revealedCount = 0
  for (const step of plan.steps) {
    const start =
      step.beat * plan.staggerMs + (step.parentNodeId ? GRAPH_SEARCH_CHILD_FADE_DELAY_MS : 0)
    const progress = easeOutCubic((revealElapsed - start) / GRAPH_SEARCH_NODE_FADE_MS)
    nodeProgress.set(step.nodeId, progress)
    if (progress > 0) revealedCount++
  }

  const linkProgress = new Map<number, number>()
  for (const connection of plan.connections) {
    linkProgress.set(
      connection.linkIndex,
      easeOutCubic((revealElapsed - connection.startMs) / GRAPH_SEARCH_LINK_TRACE_MS)
    )
  }

  return {
    phase: 'revealing',
    dimProgress: 1,
    nodeProgress,
    linkProgress,
    revealedCount,
    complete: false
  }
}

/** IDs whose node opacity or incident connection trace changed between frames. */
export function changedGraphSearchRevealNodeIds(
  plan: GraphSearchRevealPlan,
  previous: GraphSearchRevealFrame,
  next: GraphSearchRevealFrame
): Set<string> {
  const changed = new Set<string>()
  for (const step of plan.steps) {
    if (
      (previous.nodeProgress.get(step.nodeId) ?? 0) !== (next.nodeProgress.get(step.nodeId) ?? 0)
    ) {
      changed.add(step.nodeId)
    }
  }
  for (const connection of plan.connections) {
    if (
      (previous.linkProgress.get(connection.linkIndex) ?? 0) !==
      (next.linkProgress.get(connection.linkIndex) ?? 0)
    ) {
      changed.add(connection.fromNodeId)
      changed.add(connection.toNodeId)
    }
  }
  return changed
}
