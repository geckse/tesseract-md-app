import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import type { LinksOutput, BacklinksOutput } from '../types/cli'

export interface LocalNode extends SimulationNodeDatum {
  path: string
  isCenter: boolean
  /** 0 = center, 1 = direct neighbor, 2 = second-hop neighbor */
  depth: number
  x: number
  y: number
}

export interface LocalEdge extends SimulationLinkDatum<LocalNode> {
  source: LocalNode | string
  target: LocalNode | string
  /** true if there's also a link in the reverse direction */
  bidirectional: boolean
}

export interface LocalGraphData {
  nodes: LocalNode[]
  edges: LocalEdge[]
}

/** Links/backlinks data for a neighbor, used to build the 2nd hop. */
export interface NeighborLinks {
  links: LinksOutput | null
  backlinks: BacklinksOutput | null
}

const WIDTH = 250
const HEIGHT = 200

export function buildLocalGraph(
  center: string | null,
  links: LinksOutput | null,
  backlinks: BacklinksOutput | null,
  neighborLinksMap?: Map<string, NeighborLinks>,
): LocalGraphData {
  if (!center) return { nodes: [], edges: [] }

  const nodeMap = new Map<string, LocalNode>()

  // Center node (depth 0)
  nodeMap.set(center, {
    path: center,
    isCenter: true,
    depth: 0,
    x: WIDTH / 2,
    y: HEIGHT / 2,
  })

  const edges: LocalEdge[] = []
  const edgeSet = new Set<string>()

  function addEdge(source: string, target: string) {
    const key = `${source}->${target}`
    const reverseKey = `${target}->${source}`
    if (edgeSet.has(key)) return
    if (edgeSet.has(reverseKey)) {
      // Mark existing reverse edge as bidirectional
      const existing = edges.find(
        (e) => e.source === target && e.target === source,
      )
      if (existing) existing.bidirectional = true
      return
    }
    edgeSet.add(key)
    edges.push({ source, target, bidirectional: false })
  }

  function addNode(path: string, depth: number) {
    if (nodeMap.has(path)) return
    nodeMap.set(path, {
      path,
      isCenter: false,
      depth,
      x: WIDTH / 2 + (Math.random() - 0.5) * 100,
      y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
    })
  }

  // --- Depth 1: direct neighbors of center ---

  // Outgoing links (center -> target)
  if (links?.links?.outgoing) {
    for (const resolved of links.links.outgoing) {
      if (resolved.state !== 'Valid') continue
      const target = resolved.entry.target
      if (target === center) continue
      addNode(target, 1)
      addEdge(center, target)
    }
  }

  // Incoming backlinks (source -> center)
  if (backlinks?.backlinks) {
    for (const resolved of backlinks.backlinks) {
      if (resolved.state !== 'Valid') continue
      const source = resolved.entry.source
      if (source === center) continue
      addNode(source, 1)
      addEdge(source, center)
    }
  }

  // --- Depth 2: neighbors of neighbors ---
  if (neighborLinksMap) {
    // Collect depth-1 paths first (avoid iterating a changing map)
    const depth1Paths = Array.from(nodeMap.values())
      .filter((n) => n.depth === 1)
      .map((n) => n.path)

    for (const neighborPath of depth1Paths) {
      const neighborData = neighborLinksMap.get(neighborPath)
      if (!neighborData) continue

      // Outgoing from neighbor
      if (neighborData.links?.links?.outgoing) {
        for (const resolved of neighborData.links.links.outgoing) {
          if (resolved.state !== 'Valid') continue
          const target = resolved.entry.target
          if (target === neighborPath) continue
          addNode(target, 2) // won't overwrite if already depth 0 or 1
          addEdge(neighborPath, target)
        }
      }

      // Incoming to neighbor
      if (neighborData.backlinks?.backlinks) {
        for (const resolved of neighborData.backlinks.backlinks) {
          if (resolved.state !== 'Valid') continue
          const source = resolved.entry.source
          if (source === neighborPath) continue
          addNode(source, 2)
          addEdge(source, neighborPath)
        }
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges }
}
