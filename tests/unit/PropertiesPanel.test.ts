import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing stores
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
import type { DocumentInfo, BacklinksOutput, LinksOutput } from '../../src/renderer/types/cli'

const sampleDoc: DocumentInfo = {
  path: 'docs/test.md',
  content_hash: 'abc123',
  frontmatter: {
    status: 'in-progress',
    tags: ['design', 'v1'],
    title: 'Test Document',
  },
  chunk_count: 3,
  file_size: 1024,
  indexed_at: 1704067200,
  modified_at: 1704153600,
}

const sampleBacklinks: BacklinksOutput = {
  file: 'docs/test.md',
  backlinks: [
    {
      entry: {
        source: 'docs/roadmap.md',
        target: 'docs/test.md',
        text: 'See test document',
        line_number: 5,
        is_wikilink: false,
      },
      state: 'Valid',
    },
    {
      entry: {
        source: 'notes/standup.md',
        target: 'docs/test.md',
        text: 'Discussed test doc',
        line_number: 12,
        is_wikilink: true,
      },
      state: 'Valid',
    },
  ],
  total_backlinks: 2,
}

const sampleLinks: LinksOutput = {
  file: 'docs/test.md',
  links: {
    file: 'docs/test.md',
    outgoing: [
      {
        entry: {
          source: 'docs/test.md',
          target: 'docs/guide.md',
          text: 'see guide',
          line_number: 10,
          is_wikilink: false,
        },
        state: 'Valid',
      },
      {
        entry: {
          source: 'docs/test.md',
          target: 'docs/api.md',
          text: 'API reference',
          line_number: 15,
          is_wikilink: true,
        },
        state: 'Valid',
      },
    ],
    incoming: [],
  },
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

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
})

describe('PropertiesPanel component', () => {
  describe('empty state', () => {
    it('shows empty message when no file is selected', () => {
      render(PropertiesPanel)

      expect(screen.getByText('Select a file to view properties')).toBeTruthy()
    })
  })

  describe('loading state', () => {
    it('shows loading indicator when loading', () => {
      selectedFilePath.set('docs/test.md')
      propertiesLoading.set(true)

      render(PropertiesPanel)

      expect(screen.getByText('Loading...')).toBeTruthy()
    })
  })

  describe('error state', () => {
    it('shows error message', () => {
      selectedFilePath.set('docs/test.md')
      propertiesError.set('Something went wrong')

      render(PropertiesPanel)

      expect(screen.getByText('Something went wrong')).toBeTruthy()
    })
  })

  describe('metadata section', () => {
    it('renders section headers', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('Metadata')).toBeTruthy()
      expect(screen.getByText('Links')).toBeTruthy()
      expect(screen.getByText('Outline')).toBeTruthy()
    })

    it('shows "No frontmatter" when no document info', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No frontmatter')).toBeTruthy()
    })

    it('renders frontmatter property labels', () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('status')).toBeTruthy()
      expect(screen.getByText('tags')).toBeTruthy()
      expect(screen.getByText('title')).toBeTruthy()
    })

    it('renders status value as a badge', () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('in-progress')).toBeTruthy()
    })

    it('renders tag values as badges', () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('design')).toBeTruthy()
      expect(screen.getByText('v1')).toBeTruthy()
    })

    it('renders plain string frontmatter values', () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('Test Document')).toBeTruthy()
    })

    it('shows date labels', () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('Modified')).toBeTruthy()
      expect(screen.getByText('Indexed')).toBeTruthy()
    })

    it('shows em dash for dates when no document info', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('links section', () => {
    it('shows Incoming and Outgoing tabs', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('Incoming')).toBeTruthy()
      expect(screen.getByText('Outgoing')).toBeTruthy()
    })

    it('shows "No incoming links" when none exist', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No incoming links')).toBeTruthy()
    })

    it('renders incoming link file names on incoming tab', () => {
      selectedFilePath.set('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('roadmap.md')).toBeTruthy()
      expect(screen.getByText('standup.md')).toBeTruthy()
    })

    it('renders incoming link snippets', () => {
      selectedFilePath.set('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('See test document')).toBeTruthy()
      expect(screen.getByText('Discussed test doc')).toBeTruthy()
    })

    it('shows total link count in section header', () => {
      selectedFilePath.set('docs/test.md')
      backlinksInfo.set(sampleBacklinks)
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      // 2 incoming + 2 outgoing = 4 (shown in both Local Graph and Links sections)
      const counts = screen.getAllByText('4')
      expect(counts.length).toBeGreaterThanOrEqual(1)
    })

    it('fires onfileselect when an incoming link is clicked', async () => {
      selectedFilePath.set('docs/test.md')
      backlinksInfo.set(sampleBacklinks)
      const handler = vi.fn()

      render(PropertiesPanel, { props: { onfileselect: handler } })

      await fireEvent.click(screen.getByText('roadmap.md'))

      expect(handler).toHaveBeenCalledWith({ path: 'docs/roadmap.md' })
    })

    it('switches to outgoing tab and shows outgoing links', async () => {
      selectedFilePath.set('docs/test.md')
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      // Click Outgoing tab
      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('guide.md')).toBeTruthy()
      expect(screen.getByText('api.md')).toBeTruthy()
    })

    it('renders outgoing link snippets', async () => {
      selectedFilePath.set('docs/test.md')
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('see guide')).toBeTruthy()
      expect(screen.getByText('API reference')).toBeTruthy()
    })

    it('shows "No outgoing links" when none exist', async () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('No outgoing links')).toBeTruthy()
    })

    it('fires onfileselect when an outgoing link is clicked', async () => {
      selectedFilePath.set('docs/test.md')
      linksInfo.set(sampleLinks)
      const handler = vi.fn()

      render(PropertiesPanel, { props: { onfileselect: handler } })

      await fireEvent.click(screen.getByText('Outgoing'))
      await fireEvent.click(screen.getByText('guide.md'))

      expect(handler).toHaveBeenCalledWith({ path: 'docs/guide.md' })
    })
  })

  describe('outline section', () => {
    it('shows "No headings" when no content', () => {
      selectedFilePath.set('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No headings')).toBeTruthy()
    })

    it('renders headings from file content', () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('# Introduction\n\n## Getting Started\n\n### Installation\n')

      render(PropertiesPanel)

      expect(screen.getByText('Introduction')).toBeTruthy()
      expect(screen.getByText('Getting Started')).toBeTruthy()
      expect(screen.getByText('Installation')).toBeTruthy()
    })

    it('skips frontmatter when parsing headings', () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('---\ntitle: Test\n---\n\n# Real Heading\n')

      render(PropertiesPanel)

      expect(screen.getByText('Real Heading')).toBeTruthy()
      expect(screen.queryByText('title: Test')).toBeNull()
    })

    it('skips headings inside code blocks', () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('# Real\n\n```\n# Fake\n```\n\n## Also Real\n')

      render(PropertiesPanel)

      expect(screen.getByText('Real')).toBeTruthy()
      expect(screen.getByText('Also Real')).toBeTruthy()
      expect(screen.queryByText('Fake')).toBeNull()
    })

    it('outline items have clickable cursor style', () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('# Title\n')

      render(PropertiesPanel)

      const item = screen.getByText('Title').closest('[role="button"]')
      expect(item).toBeTruthy()
    })
  })

  describe('section collapse', () => {
    it('collapses metadata section on header click', async () => {
      selectedFilePath.set('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      // Status value should be visible initially
      expect(screen.getByText('in-progress')).toBeTruthy()

      // Click the Metadata header to collapse
      await fireEvent.click(screen.getByText('Metadata'))

      // Status value should no longer be visible
      expect(screen.queryByText('in-progress')).toBeNull()
    })

    it('collapses links section on header click', async () => {
      selectedFilePath.set('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('roadmap.md')).toBeTruthy()

      await fireEvent.click(screen.getByText('Links'))

      expect(screen.queryByText('roadmap.md')).toBeNull()
    })

    it('collapses outline section on header click', async () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('# Title\n')

      render(PropertiesPanel)

      expect(screen.getByText('Title')).toBeTruthy()

      await fireEvent.click(screen.getByText('Outline'))

      expect(screen.queryByText('Title')).toBeNull()
    })

    it('re-expands section on second click', async () => {
      selectedFilePath.set('docs/test.md')
      propertiesFileContent.set('# Title\n')

      render(PropertiesPanel)

      // Collapse
      await fireEvent.click(screen.getByText('Outline'))
      expect(screen.queryByText('Title')).toBeNull()

      // Re-expand
      await fireEvent.click(screen.getByText('Outline'))
      expect(screen.getByText('Title')).toBeTruthy()
    })
  })
})
