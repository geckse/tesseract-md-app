import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import type { LinksOutput, BacklinksOutput } from '../../src/renderer/types/cli'
import { buildLocalGraph } from '../../src/renderer/utils/local-graph'

// Mock d3-force to avoid jsdom issues with simulation
function makeForceMock() {
  const f: any = {}
  ;['id', 'distance', 'strength', 'distanceMax'].forEach((m) => {
    f[m] = vi.fn().mockReturnValue(f)
  })
  return f
}

vi.mock('d3-force', () => ({
  forceSimulation: vi.fn(() => ({
    force: vi.fn().mockReturnThis(),
    alphaDecay: vi.fn().mockReturnThis(),
    velocityDecay: vi.fn().mockReturnThis(),
    tick: vi.fn(),
    stop: vi.fn(),
    on: vi.fn().mockReturnThis(),
  })),
  forceLink: vi.fn(() => makeForceMock()),
  forceManyBody: vi.fn(() => makeForceMock()),
  forceCenter: vi.fn(() => makeForceMock()),
  forceCollide: vi.fn(() => makeForceMock()),
}))

// Mock window.api before importing component
const mockApi = {
  getFile: vi.fn(),
  backlinks: vi.fn(),
  links: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  readFile: vi.fn(),
  tree: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import LocalGraph from '@renderer/components/LocalGraph.svelte'

// Helper to create valid link entries
function makeLink(source: string, target: string, state: 'Valid' | 'Broken' = 'Valid') {
  return {
    entry: { source, target, text: `link to ${target}`, line_number: 1, is_wikilink: false },
    state,
  }
}

function makeLinksOutput(file: string, outgoing: ReturnType<typeof makeLink>[]): LinksOutput {
  return {
    file,
    links: { file, outgoing, incoming: [] },
  }
}

function makeBacklinksOutput(file: string, backlinks: ReturnType<typeof makeLink>[]): BacklinksOutput {
  return {
    file,
    backlinks,
    total_backlinks: backlinks.length,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('buildLocalGraph utility', () => {
  it('returns empty graph when center is null', () => {
    const result = buildLocalGraph(null, null, null)
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('returns only center node when linksInfo and backlinksInfo are null', () => {
    const result = buildLocalGraph('docs/test.md', null, null)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].path).toBe('docs/test.md')
    expect(result.nodes[0].isCenter).toBe(true)
    expect(result.edges).toHaveLength(0)
  })

  it('creates nodes from outgoing links', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
      makeLink('docs/test.md', 'docs/api.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, null)
    expect(result.nodes).toHaveLength(3) // center + 2 targets
    expect(result.nodes.find((n) => n.path === 'docs/guide.md')).toBeTruthy()
    expect(result.nodes.find((n) => n.path === 'docs/api.md')).toBeTruthy()
  })

  it('creates correct edges for outgoing links', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, null)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('docs/test.md')
    expect(result.edges[0].target).toBe('docs/guide.md')
  })

  it('creates nodes from incoming backlinks', () => {
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('notes/standup.md', 'docs/test.md'),
    ])
    const result = buildLocalGraph('docs/test.md', null, backlinks)
    expect(result.nodes).toHaveLength(2) // center + 1 backlink source
    expect(result.nodes.find((n) => n.path === 'notes/standup.md')).toBeTruthy()
  })

  it('creates correct edges for backlinks', () => {
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('notes/standup.md', 'docs/test.md'),
    ])
    const result = buildLocalGraph('docs/test.md', null, backlinks)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('notes/standup.md')
    expect(result.edges[0].target).toBe('docs/test.md')
  })

  it('deduplicates nodes when same file in both links and backlinks', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('docs/guide.md', 'docs/test.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, backlinks)
    // center + guide.md (deduplicated)
    expect(result.nodes).toHaveLength(2)
    const guidePaths = result.nodes.filter((n) => n.path === 'docs/guide.md')
    expect(guidePaths).toHaveLength(1)
  })

  it('deduplicates edges when same connection in both directions', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('docs/guide.md', 'docs/test.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, backlinks)
    // Only one edge, not two
    expect(result.edges).toHaveLength(1)
  })

  it('filters out broken links', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md', 'Valid'),
      makeLink('docs/test.md', 'docs/missing.md', 'Broken'),
    ])
    const result = buildLocalGraph('docs/test.md', links, null)
    expect(result.nodes).toHaveLength(2) // center + guide.md only
    expect(result.nodes.find((n) => n.path === 'docs/missing.md')).toBeUndefined()
  })

  it('filters out broken backlinks', () => {
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('notes/standup.md', 'docs/test.md', 'Broken'),
    ])
    const result = buildLocalGraph('docs/test.md', null, backlinks)
    expect(result.nodes).toHaveLength(1) // center only
  })

  it('excludes self-links from outgoing', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/test.md'),
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, null)
    expect(result.nodes).toHaveLength(2) // center + guide.md
    expect(result.edges).toHaveLength(1)
  })

  it('excludes self-links from backlinks', () => {
    const backlinks = makeBacklinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/test.md'),
    ])
    const result = buildLocalGraph('docs/test.md', null, backlinks)
    expect(result.nodes).toHaveLength(1) // center only
    expect(result.edges).toHaveLength(0)
  })

  it('handles empty outgoing array', () => {
    const links = makeLinksOutput('docs/test.md', [])
    const backlinks = makeBacklinksOutput('docs/test.md', [])
    const result = buildLocalGraph('docs/test.md', links, backlinks)
    expect(result.nodes).toHaveLength(1) // center only
    expect(result.edges).toHaveLength(0)
  })

  it('center node is positioned at center coordinates', () => {
    const result = buildLocalGraph('docs/test.md', null, null)
    expect(result.nodes[0].x).toBe(125) // WIDTH/2
    expect(result.nodes[0].y).toBe(100) // HEIGHT/2
  })

  it('neighbor nodes are not marked as center', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const result = buildLocalGraph('docs/test.md', links, null)
    const neighbor = result.nodes.find((n) => n.path === 'docs/guide.md')
    expect(neighbor?.isCenter).toBe(false)
  })
})

describe('LocalGraph component rendering', () => {
  it('shows "No file selected" when centerPath is null', () => {
    render(LocalGraph, { props: { centerPath: null, linksInfo: null, backlinksInfo: null } })
    expect(screen.getByText('No file selected')).toBeTruthy()
  })

  it('renders Graph header', () => {
    render(LocalGraph, { props: { centerPath: null, linksInfo: null, backlinksInfo: null } })
    expect(screen.getByText('Graph')).toBeTruthy()
  })

  it('shows "Loading…" when centerPath set but no link data', () => {
    render(LocalGraph, {
      props: { centerPath: 'docs/test.md', linksInfo: null, backlinksInfo: null },
    })
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows "No connections" when links are empty', () => {
    const links = makeLinksOutput('docs/test.md', [])
    const backlinks = makeBacklinksOutput('docs/test.md', [])
    render(LocalGraph, {
      props: { centerPath: 'docs/test.md', linksInfo: links, backlinksInfo: backlinks },
    })
    expect(screen.getByText('No connections')).toBeTruthy()
  })

  it('renders SVG with nodes when valid links exist', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const backlinks = makeBacklinksOutput('docs/test.md', [])
    const { container } = render(LocalGraph, {
      props: { centerPath: 'docs/test.md', linksInfo: links, backlinksInfo: backlinks },
    })
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    // 2 circles: center + neighbor
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(2)
  })

  it('renders center node label', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const backlinks = makeBacklinksOutput('docs/test.md', [])
    render(LocalGraph, {
      props: { centerPath: 'docs/test.md', linksInfo: links, backlinksInfo: backlinks },
    })
    expect(screen.getByText('test.md')).toBeTruthy()
  })

  it('renders edge lines', () => {
    const links = makeLinksOutput('docs/test.md', [
      makeLink('docs/test.md', 'docs/guide.md'),
    ])
    const backlinks = makeBacklinksOutput('docs/test.md', [])
    const { container } = render(LocalGraph, {
      props: { centerPath: 'docs/test.md', linksInfo: links, backlinksInfo: backlinks },
    })
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBe(1)
  })
})

// --- Integration tests: LocalGraph within PropertiesPanel ---
import { fireEvent } from '@testing-library/svelte'
import {
  documentInfo,
  backlinksInfo,
  linksInfo,
  propertiesLoading,
  propertiesError,
  propertiesFileContent,
} from '../../src/renderer/stores/properties'
import { selectedFilePath } from '../../src/renderer/stores/files'
import PropertiesPanel from '@renderer/components/PropertiesPanel.svelte'
import type { LinksOutput as LinksOutputType, BacklinksOutput as BacklinksOutputType } from '../../src/renderer/types/cli'

const sampleLinks: LinksOutputType = {
  file: 'docs/test.md',
  links: {
    file: 'docs/test.md',
    outgoing: [
      {
        entry: { source: 'docs/test.md', target: 'docs/guide.md', text: 'see guide', line_number: 10, is_wikilink: false },
        state: 'Valid',
      },
    ],
    incoming: [],
  },
}

const sampleBacklinks: BacklinksOutputType = {
  file: 'docs/test.md',
  backlinks: [
    {
      entry: { source: 'notes/standup.md', target: 'docs/test.md', text: 'Discussed test doc', line_number: 12, is_wikilink: true },
      state: 'Valid',
    },
  ],
  total_backlinks: 1,
}

function resetStores() {
  documentInfo.set(null)
  backlinksInfo.set(null)
  linksInfo.set(null)
  propertiesLoading.set(false)
  propertiesError.set(null)
  propertiesFileContent.set(null)
  selectedFilePath.set(null)
}

describe('LocalGraph integration in PropertiesPanel', () => {
  beforeEach(() => {
    resetStores()
    vi.resetAllMocks()
  })

  it('shows "Local Graph" section header when a file is selected', () => {
    selectedFilePath.set('docs/test.md')
    render(PropertiesPanel)
    expect(screen.getByText('Local Graph')).toBeTruthy()
  })

  it('collapses and expands Local Graph section on header click', async () => {
    selectedFilePath.set('docs/test.md')
    linksInfo.set(sampleLinks)
    backlinksInfo.set(sampleBacklinks)

    render(PropertiesPanel)

    // Local Graph section should be open by default — the Graph header inside LocalGraph should be visible
    const graphHeader = screen.getByText('Graph')
    expect(graphHeader).toBeTruthy()

    // Collapse
    await fireEvent.click(screen.getByText('Local Graph'))
    expect(screen.queryByText('Graph')).toBeNull()

    // Re-expand
    await fireEvent.click(screen.getByText('Local Graph'))
    expect(screen.getByText('Graph')).toBeTruthy()
  })

  it('has expand button with correct title attribute', () => {
    selectedFilePath.set('docs/test.md')
    render(PropertiesPanel)

    const expandBtn = screen.getByTitle('Open in full graph view')
    expect(expandBtn).toBeTruthy()
  })

  it('fires onfileselect with correct path when a graph node is clicked', async () => {
    // Set stores BEFORE render so subscriptions fire during initialization
    selectedFilePath.set('docs/test.md')
    linksInfo.set(sampleLinks)
    backlinksInfo.set(sampleBacklinks)

    const handler = vi.fn()
    const { container } = render(PropertiesPanel, { props: { onfileselect: handler } })

    // Neighbor labels only appear on hover, so click a neighbor node circle directly
    const graphNodes = container.querySelectorAll('.graph-node')
    // First graph-node is center (test.md), second and third are neighbors
    expect(graphNodes.length).toBeGreaterThanOrEqual(2)

    // Click the second node (a neighbor — either guide.md or standup.md)
    await fireEvent.click(graphNodes[1])

    // Handler should be called with one of the neighbor paths
    expect(handler).toHaveBeenCalledTimes(1)
    const calledPath = handler.mock.calls[0][0].path
    expect(['docs/guide.md', 'notes/standup.md']).toContain(calledPath)
  })
})
