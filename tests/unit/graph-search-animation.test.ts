import { describe, expect, it } from 'vitest'

import {
  GRAPH_SEARCH_DIM_MS,
  GRAPH_SEARCH_MAX_BEATS,
  buildGraphSearchContextParents,
  buildGraphSearchRevealPlan,
  changedGraphSearchRevealNodeIds,
  sampleGraphSearchReveal
} from '@renderer/lib/graph-search-animation'
import type { Graph3DLink, Graph3DNode } from '@renderer/lib/graph-3d-bridge'
import type { GraphContextItem } from '@renderer/types/cli'

function node(id: string, path = `${id}.md`): Graph3DNode {
  return {
    id,
    path,
    label: null,
    cluster_id: null,
    custom_cluster_id: null,
    custom_cluster_ids: [],
    custom_cluster_scores: [],
    chunk_index: null,
    size: null,
    val: 1,
    color: '#ffffff'
  }
}

function link(source: string, target: string, strength = 0.5): Graph3DLink {
  return {
    source,
    target,
    relationship_type: null,
    strength,
    context_text: null,
    edge_cluster_id: null,
    field: null,
    color: '#ffffff',
    width: 1
  }
}

function context(path: string, linkedFrom: string, hop = 1): GraphContextItem {
  return {
    file: {
      path,
      frontmatter: null,
      file_size: 1,
      path_components: [path],
      modified_at: null
    },
    chunk: {
      chunk_id: `${path}#0`,
      heading_hierarchy: [],
      content: '',
      start_line: 0,
      end_line: 1
    },
    linked_from: linkedFrom,
    hop_distance: hop
  }
}

describe('buildGraphSearchContextParents', () => {
  it('chooses the nearest then lexical backend parent deterministically', () => {
    const parents = buildGraphSearchContextParents([
      context('child.md', 'z.md', 2),
      context('child.md', 'b.md', 1),
      context('child.md', 'a.md', 1)
    ])
    expect(parents.get('child.md')).toBe('a.md')
  })
})

describe('buildGraphSearchRevealPlan', () => {
  it('reveals direct matches by relevance before following linked context', () => {
    const nodes = [node('top'), node('second'), node('context')]
    const links = [link('top', 'context'), link('context', 'second')]
    const plan = buildGraphSearchRevealPlan(
      nodes,
      links,
      new Map([
        ['top.md', 0.95],
        ['second.md', 0.7]
      ]),
      new Map([['context.md', 0.4]]),
      new Map([['context.md', 'top.md']])
    )

    expect(plan.steps.map((step) => step.nodeId)).toEqual(['top', 'second', 'context'])
    expect(plan.steps[2].parentNodeId).toBe('top')
    expect(plan.steps[2].depth).toBe(1)
  })

  it('uses a later relevance root for disconnected context components', () => {
    const plan = buildGraphSearchRevealPlan(
      [node('root'), node('linked'), node('loose')],
      [link('root', 'linked')],
      new Map([['root.md', 0.9]]),
      new Map([
        ['linked.md', 0.2],
        ['loose.md', 0.4]
      ])
    )
    const loose = plan.steps.find((step) => step.nodeId === 'loose')!
    const linked = plan.steps.find((step) => step.nodeId === 'linked')!
    expect(linked.parentNodeId).toBe('root')
    expect(loose.parentNodeId).toBeNull()
    expect(loose.component).not.toBe(linked.component)
  })

  it('is deterministic across shuffled node input and safe around invalid cycles', () => {
    const graphLinks = [
      link('a', 'b', 0.9),
      link('b', 'c', 0.8),
      link('c', 'a', 0.7),
      link('missing', 'a'),
      link('a', 'a')
    ]
    const scores = new Map([
      ['a.md', 0.9],
      ['b.md', 0.4],
      ['c.md', 0.4]
    ])
    const first = buildGraphSearchRevealPlan(
      [node('c'), node('a'), node('b')],
      graphLinks,
      new Map([['a.md', 0.9]]),
      scores
    )
    const second = buildGraphSearchRevealPlan(
      [node('b'), node('c'), node('a')],
      graphLinks,
      new Map([['a.md', 0.9]]),
      scores
    )
    expect(first.steps.map((step) => step.nodeId)).toEqual(second.steps.map((step) => step.nodeId))
    expect(new Set(first.steps.map((step) => step.nodeId))).toEqual(new Set(['a', 'b', 'c']))
    expect(first.connections).toHaveLength(3)
  })

  it('supports multiple chunk nodes sharing one scored file path', () => {
    const plan = buildGraphSearchRevealPlan(
      [node('doc#0', 'doc.md'), node('doc#1', 'doc.md'), node('other#0', 'other.md')],
      [link('doc#0', 'other#0'), link('doc#1', 'other#0')],
      new Map([['doc.md', 0.8]]),
      new Map([['other.md', 0.4]])
    )
    expect(plan.steps.filter((step) => step.path === 'doc.md')).toHaveLength(2)
    expect(plan.relevantNodeIds.size).toBe(3)
  })

  it('bounds huge graphs to at most 120 reveal beats', () => {
    const nodes = Array.from({ length: 1_001 }, (_, index) => node(`n${index}`))
    const links = nodes.slice(1).map((current, index) => link(nodes[index].id, current.id))
    const contextScores = new Map(nodes.slice(1).map((current) => [current.path, 0.4]))
    const plan = buildGraphSearchRevealPlan(
      nodes,
      links,
      new Map([[nodes[0].path, 1]]),
      contextScores
    )
    expect(plan.beatCount).toBeLessThanOrEqual(GRAPH_SEARCH_MAX_BEATS)
    expect(plan.steps).toHaveLength(nodes.length)
  })

  it('activates every relevant cross-link from the earlier endpoint', () => {
    const plan = buildGraphSearchRevealPlan(
      [node('a'), node('b'), node('c')],
      [link('a', 'b'), link('c', 'a'), link('b', 'c')],
      new Map([
        ['a.md', 0.9],
        ['b.md', 0.8],
        ['c.md', 0.7]
      ]),
      new Map()
    )
    expect(plan.connections).toHaveLength(3)
    expect(plan.connections.find((item) => item.linkIndex === 1)).toMatchObject({
      fromNodeId: 'a',
      toNodeId: 'c',
      direction: -1
    })
  })

  it('keeps a zero-result search visually empty instead of inventing roots', () => {
    const plan = buildGraphSearchRevealPlan(
      [node('a'), node('b')],
      [link('a', 'b')],
      new Map(),
      new Map()
    )
    expect(plan.steps).toEqual([])
    expect(plan.connections).toEqual([])
    expect(sampleGraphSearchReveal(plan, 0).complete).toBe(true)
  })
})

describe('sampleGraphSearchReveal', () => {
  const plan = buildGraphSearchRevealPlan(
    [node('root'), node('child')],
    [link('root', 'child')],
    new Map([['root.md', 1]]),
    new Map([['child.md', 0.4]])
  )

  it('finishes the dim phase before revealing nodes or connections', () => {
    const frame = sampleGraphSearchReveal(plan, GRAPH_SEARCH_DIM_MS / 2)
    expect(frame.phase).toBe('dimming')
    expect(frame.dimProgress).toBeGreaterThan(0)
    expect(frame.nodeProgress.size).toBe(0)
    expect(frame.linkProgress.size).toBe(0)
  })

  it('traces the parent connection before the child finishes fading', () => {
    const connection = plan.connections[0]
    const frame = sampleGraphSearchReveal(plan, GRAPH_SEARCH_DIM_MS + connection.startMs + 40)
    expect(frame.phase).toBe('revealing')
    expect(frame.linkProgress.get(0)).toBeGreaterThan(0)
    expect(frame.nodeProgress.get('child')).toBeGreaterThan(0)
    expect(frame.nodeProgress.get('child')).toBeLessThan(1)
  })

  it('does not trace a deeper branch out of a completely hidden parent', () => {
    const deepPlan = buildGraphSearchRevealPlan(
      [node('root'), node('parent'), node('child')],
      [link('root', 'parent'), link('parent', 'child')],
      new Map([['root.md', 1]]),
      new Map([
        ['parent.md', 0.4],
        ['child.md', 0.3]
      ])
    )
    const connection = deepPlan.connections.find((item) => item.toNodeId === 'child')!
    const frame = sampleGraphSearchReveal(deepPlan, GRAPH_SEARCH_DIM_MS + connection.startMs + 1)
    expect(frame.linkProgress.get(connection.linkIndex)).toBeGreaterThan(0)
    expect(frame.nodeProgress.get('parent')).toBeGreaterThan(0)
  })

  it('clamps negative/long frames and reduced motion to stable states', () => {
    expect(sampleGraphSearchReveal(plan, -100).dimProgress).toBe(0)
    const complete = sampleGraphSearchReveal(plan, 1_000_000)
    expect(complete.complete).toBe(true)
    expect([...complete.nodeProgress.values()].every((value) => value === 1)).toBe(true)
    expect(sampleGraphSearchReveal(plan, 0, true).complete).toBe(true)
  })

  it('keeps node and connection progress monotonic throughout playback', () => {
    const samples = [
      GRAPH_SEARCH_DIM_MS,
      GRAPH_SEARCH_DIM_MS + 80,
      GRAPH_SEARCH_DIM_MS + 160,
      GRAPH_SEARCH_DIM_MS + 320,
      plan.totalDurationMs
    ].map((time) => sampleGraphSearchReveal(plan, time))
    for (let index = 1; index < samples.length; index++) {
      for (const nodeId of ['root', 'child']) {
        expect(samples[index].nodeProgress.get(nodeId) ?? 0).toBeGreaterThanOrEqual(
          samples[index - 1].nodeProgress.get(nodeId) ?? 0
        )
      }
      expect(samples[index].linkProgress.get(0) ?? 0).toBeGreaterThanOrEqual(
        samples[index - 1].linkProgress.get(0) ?? 0
      )
    }
  })

  it('reports only nodes touched by changed node/edge progress', () => {
    const before = sampleGraphSearchReveal(plan, GRAPH_SEARCH_DIM_MS)
    const after = sampleGraphSearchReveal(plan, GRAPH_SEARCH_DIM_MS + 40)
    expect(changedGraphSearchRevealNodeIds(plan, before, after)).toEqual(new Set(['root']))
  })

  it('retains a final node change across skipped, non-rendered samples', () => {
    const singleNodePlan = buildGraphSearchRevealPlan(
      [node('root')],
      [],
      new Map([['root.md', 1]]),
      new Map()
    )
    const lastRendered = sampleGraphSearchReveal(singleNodePlan, GRAPH_SEARCH_DIM_MS + 240)
    const skipped = sampleGraphSearchReveal(singleNodePlan, GRAPH_SEARCH_DIM_MS + 260)
    const nextRendered = sampleGraphSearchReveal(singleNodePlan, GRAPH_SEARCH_DIM_MS + 280)

    expect(lastRendered.nodeProgress.get('root')).toBeLessThan(1)
    expect(skipped.nodeProgress.get('root')).toBe(1)
    expect(nextRendered.nodeProgress.get('root')).toBe(1)
    expect(changedGraphSearchRevealNodeIds(singleNodePlan, lastRendered, nextRendered)).toContain(
      'root'
    )
    expect(changedGraphSearchRevealNodeIds(singleNodePlan, skipped, nextRendered)).not.toContain(
      'root'
    )
  })
})
