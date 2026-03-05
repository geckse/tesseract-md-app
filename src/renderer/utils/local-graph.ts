import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import type { LinksOutput, BacklinksOutput } from '../types/cli'

export interface LocalNode extends SimulationNodeDatum {
  path: string
  isCenter: boolean
  x: number
  y: number
}

export interface LocalEdge extends SimulationLinkDatum<LocalNode> {
  source: LocalNode | string
  target: LocalNode | string
}

export interface LocalGraphData {
  nodes: LocalNode[]
  edges: LocalEdge[]
}

const WIDTH = 250
const HEIGHT = 200

export function buildLocalGraph(
  center: string | null,
  links: LinksOutput | null,
  backlinks: BacklinksOutput | null,
): LocalGraphData {
  if (!center) return { nodes: [], edges: [] }

  const nodeMap = new Map<string, LocalNode>()

  // Center node
  nodeMap.set(center, {
    path: center,
    isCenter: true,
    x: WIDTH / 2,
    y: HEIGHT / 2,
  })

  const edges: LocalEdge[] = []

  // Outgoing links (center -> target)
  if (links?.links?.outgoing) {
    for (const resolved of links.links.outgoing) {
      if (resolved.state !== 'Valid') continue
      const target = resolved.entry.target
      if (target === center) continue // skip self-links
      if (!nodeMap.has(target)) {
        nodeMap.set(target, {
          path: target,
          isCenter: false,
          x: WIDTH / 2 + (Math.random() - 0.5) * 100,
          y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
        })
      }
      edges.push({ source: center, target })
    }
  }

  // Incoming backlinks (source -> center)
  if (backlinks?.backlinks) {
    for (const resolved of backlinks.backlinks) {
      if (resolved.state !== 'Valid') continue
      const source = resolved.entry.source
      if (source === center) continue
      if (!nodeMap.has(source)) {
        nodeMap.set(source, {
          path: source,
          isCenter: false,
          x: WIDTH / 2 + (Math.random() - 0.5) * 100,
          y: HEIGHT / 2 + (Math.random() - 0.5) * 100,
        })
      }
      // Avoid duplicate edges
      const alreadyExists = edges.some(
        (e) =>
          (e.source === source && e.target === center) ||
          (e.source === center && e.target === source),
      )
      if (!alreadyExists) {
        edges.push({ source, target: center })
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges }
}
