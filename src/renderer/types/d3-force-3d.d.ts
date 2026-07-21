declare module 'd3-force-3d' {
  export interface SimulationNodeDatum3D {
    index?: number
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    fx?: number | null
    fy?: number | null
    fz?: number | null
  }

  export interface SimulationLinkDatum3D<NodeDatum extends SimulationNodeDatum3D> {
    source: NodeDatum | string | number
    target: NodeDatum | string | number
    index?: number
  }

  export interface Force3D<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void
    initialize?: (nodes: NodeDatum[], random: () => number, dimensions: number) => void
  }

  export interface Simulation3D<NodeDatum extends SimulationNodeDatum3D> {
    tick(iterations?: number): this
    restart(): this
    stop(): this
    numDimensions(): number
    numDimensions(dimensions: number): this
    nodes(): NodeDatum[]
    nodes(nodes: NodeDatum[]): this
    alpha(): number
    alpha(alpha: number): this
    alphaMin(): number
    alphaMin(alphaMin: number): this
    alphaDecay(): number
    alphaDecay(alphaDecay: number): this
    alphaTarget(): number
    alphaTarget(alphaTarget: number): this
    velocityDecay(): number
    velocityDecay(velocityDecay: number): this
    force(name: string): Force3D<NodeDatum> | undefined
    force(name: string, force: Force3D<NodeDatum> | null): this
    find(x: number, y?: number, z?: number, radius?: number): NodeDatum | undefined
    on(typenames: string): ((this: Simulation3D<NodeDatum>) => void) | undefined
    on(typenames: string, listener: ((this: Simulation3D<NodeDatum>) => void) | null): this
  }

  export interface ForceCenter3D<
    NodeDatum extends SimulationNodeDatum3D
  > extends Force3D<NodeDatum> {
    x(): number
    x(value: number): this
    y(): number
    y(value: number): this
    z(): number
    z(value: number): this
    strength(): number
    strength(value: number): this
  }

  export interface ForceCollide3D<
    NodeDatum extends SimulationNodeDatum3D
  > extends Force3D<NodeDatum> {
    radius(): (node: NodeDatum, index: number, nodes: NodeDatum[]) => number
    radius(radius: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)): this
    strength(): number
    strength(strength: number): this
    iterations(): number
    iterations(iterations: number): this
  }

  export interface ForceLink3D<
    NodeDatum extends SimulationNodeDatum3D,
    LinkDatum extends SimulationLinkDatum3D<NodeDatum>
  > extends Force3D<NodeDatum> {
    links(): LinkDatum[]
    links(links: LinkDatum[]): this
    id(): (node: NodeDatum, index: number, nodes: NodeDatum[]) => string | number
    id(id: (node: NodeDatum, index: number, nodes: NodeDatum[]) => string | number): this
    distance(): (link: LinkDatum, index: number, links: LinkDatum[]) => number
    distance(
      distance: number | ((link: LinkDatum, index: number, links: LinkDatum[]) => number)
    ): this
    strength(): (link: LinkDatum, index: number, links: LinkDatum[]) => number
    strength(
      strength: number | ((link: LinkDatum, index: number, links: LinkDatum[]) => number)
    ): this
    iterations(): number
    iterations(iterations: number): this
  }

  export interface ForceManyBody3D<
    NodeDatum extends SimulationNodeDatum3D
  > extends Force3D<NodeDatum> {
    strength(): (node: NodeDatum, index: number, nodes: NodeDatum[]) => number
    strength(
      strength: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)
    ): this
    distanceMin(): number
    distanceMin(distance: number): this
    distanceMax(): number
    distanceMax(distance: number): this
    theta(): number
    theta(theta: number): this
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum3D>(
    nodes?: NodeDatum[],
    dimensions?: number
  ): Simulation3D<NodeDatum>

  export function forceCenter<NodeDatum extends SimulationNodeDatum3D>(
    x?: number,
    y?: number,
    z?: number
  ): ForceCenter3D<NodeDatum>

  export function forceCollide<NodeDatum extends SimulationNodeDatum3D>(
    radius?: number | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number)
  ): ForceCollide3D<NodeDatum>

  export function forceLink<
    NodeDatum extends SimulationNodeDatum3D,
    LinkDatum extends SimulationLinkDatum3D<NodeDatum>
  >(links?: LinkDatum[]): ForceLink3D<NodeDatum, LinkDatum>

  export function forceManyBody<
    NodeDatum extends SimulationNodeDatum3D
  >(): ForceManyBody3D<NodeDatum>
}
