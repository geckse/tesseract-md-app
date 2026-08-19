import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

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
  neighborhood: vi.fn(),
  fileInfo: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  writeToClipboard: vi.fn(),
  openExternalFile: vi.fn(),
  revealExternalFile: vi.fn(),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  detachTab: vi.fn().mockResolvedValue(undefined)
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  documentInfo,
  backlinksInfo,
  linksInfo,
  propertiesLoading,
  propertiesError,
  propertiesFileContent
} from '../../src/renderer/stores/properties'
import { syncFileStoresFromTab } from '../../src/renderer/stores/files'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { schema } from '../../src/renderer/stores/schema'
import { workspace } from '../../src/renderer/stores/workspace.svelte'
import PropertiesPanel from '@renderer/components/PropertiesPanel.svelte'
import type { DocumentInfo, BacklinksOutput, LinksOutput } from '../../src/renderer/types/cli'

const sampleDoc: DocumentInfo = {
  path: 'docs/test.md',
  content_hash: 'abc123',
  frontmatter: {
    status: 'in-progress',
    tags: ['design', 'v1'],
    title: 'Test Document'
  },
  chunk_count: 3,
  file_size: 1024,
  indexed_at: 1704067200,
  modified_at: 1704153600
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
        is_wikilink: false
      },
      state: 'Valid'
    },
    {
      entry: {
        source: 'notes/standup.md',
        target: 'docs/test.md',
        text: 'Discussed test doc',
        line_number: 12,
        is_wikilink: true
      },
      state: 'Valid'
    }
  ],
  total_backlinks: 2
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
          is_wikilink: false
        },
        state: 'Valid'
      },
      {
        entry: {
          source: 'docs/test.md',
          target: 'docs/api.md',
          text: 'API reference',
          line_number: 15,
          is_wikilink: true
        },
        state: 'Valid'
      }
    ],
    incoming: []
  }
}

/** Open a file tab in the workspace and sync derived stores so selectedFilePath updates.
 *  Pre-fills the tab content to prevent auto-loading via syncFileStoresFromTab. */
function selectFilePath(filePath: string): void {
  const tabId = workspace.openTab(filePath)
  // Pre-fill content so syncFileStoresFromTab doesn't trigger _autoLoadTabContent
  const tab = workspace.tabs[tabId]
  if (tab && tab.kind === 'document') {
    tab.content = ''
  }
  syncFileStoresFromTab()
}

function selectAssetPath(
  filePath: string,
  mimeCategory: 'image' | 'pdf' | 'video' | 'audio' | 'other'
): void {
  workspace.openAssetTab(filePath, mimeCategory, 2048)
  syncFileStoresFromTab()
}

function resetStores() {
  documentInfo.set(null)
  backlinksInfo.set(null)
  linksInfo.set(null)
  propertiesLoading.set(false)
  propertiesError.set(null)
  propertiesFileContent.set(null)
  workspace.reset()
  syncFileStoresFromTab()
  collections.set([])
  activeCollectionId.set(null)
  schema.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  mockApi.fileInfo.mockResolvedValue({ size: 4096, mtime: '2026-08-16T12:30:00.000Z' })
  mockApi.openPath.mockResolvedValue(undefined)
  mockApi.showItemInFolder.mockResolvedValue(undefined)
  mockApi.writeToClipboard.mockResolvedValue(undefined)
  mockApi.openExternalFile.mockResolvedValue(undefined)
  mockApi.revealExternalFile.mockResolvedValue(undefined)
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
      selectFilePath('docs/test.md')
      propertiesLoading.set(true)

      render(PropertiesPanel)

      expect(screen.getByText('Loading...')).toBeTruthy()
    })
  })

  describe('error state', () => {
    it('shows error message', () => {
      selectFilePath('docs/test.md')
      propertiesError.set('Something went wrong')

      render(PropertiesPanel)

      expect(screen.getByText('Something went wrong')).toBeTruthy()
    })
  })

  describe('metadata section', () => {
    it('renders section headers', () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('Frontmatter')).toBeTruthy()
      expect(screen.getByText('Links')).toBeTruthy()
      expect(screen.getByText('Outline')).toBeTruthy()
    })

    it('shows "No frontmatter" when no document info', () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No frontmatter')).toBeTruthy()
    })

    it('renders frontmatter property labels', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('status')).toBeTruthy()
      expect(screen.getByText('tags')).toBeTruthy()
      expect(screen.getByText('title')).toBeTruthy()
    })

    it('renders status value as a badge', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('in-progress')).toBeTruthy()
    })

    it('renders tag values as badges', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('design')).toBeTruthy()
      expect(screen.getByText('v1')).toBeTruthy()
    })

    it('renders plain string frontmatter values', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('Test Document')).toBeTruthy()
    })

    it('does not crash when legacy schema data has no fields array', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)
      schema.set({ last_updated: 0 } as never)

      render(PropertiesPanel)

      expect(screen.getByText('Test Document')).toBeTruthy()
    })

    it('shows date labels', () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      expect(screen.getByText('Modified')).toBeTruthy()
      expect(screen.getByText('Indexed')).toBeTruthy()
    })

    it('shows em dash for dates when no document info', () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('file information', () => {
    it('places Markdown file information last and keeps it collapsible', async () => {
      selectFilePath('docs/test.md')

      const { container } = render(PropertiesPanel)

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map((title) =>
        title.textContent?.trim()
      )
      expect(sectionTitles.at(-1)).toBe('File information')

      const fileInfoToggle = screen.getByRole('button', { name: 'File information' })
      expect(fileInfoToggle.getAttribute('aria-expanded')).toBe('true')

      await fireEvent.click(fileInfoToggle)

      expect(fileInfoToggle.getAttribute('aria-expanded')).toBe('false')
      expect(container.querySelector('#properties-file-information')).toBeNull()
    })

    it.each([
      ['image', 'assets/photo.png', 'Image', 'PNG'],
      ['pdf', 'documents/spec.pdf', 'PDF document', 'PDF'],
      ['video', 'media/demo.mp4', 'Video', 'MP4'],
      ['audio', 'media/theme.mp3', 'Audio', 'MP3'],
      ['other', 'archives/data.bin', 'File', 'BIN']
    ] as const)(
      'shows useful details for an opened %s file',
      async (category, path, label, format) => {
        collections.set([
          { id: 'col-1', name: 'Vault', path: '/vault', addedAt: 0, lastOpenedAt: 0 }
        ])
        activeCollectionId.set('col-1')
        selectAssetPath(path, category)

        render(PropertiesPanel)

        await Promise.resolve()
        await tick()
        expect(mockApi.fileInfo).toHaveBeenCalledWith(`/vault/${path}`)
        expect(screen.getByText('File information')).toBeTruthy()
        expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(format).length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('4.0 KB')).toBeTruthy()
        expect(screen.getByText(path)).toBeTruthy()
        expect(screen.queryByText('Frontmatter')).toBeNull()
        expect(screen.queryByText('Links')).toBeNull()
        expect(screen.queryByText('Outline')).toBeNull()
      }
    )

    it('provides reveal, default-app, and copy-path actions for collection files', async () => {
      collections.set([{ id: 'col-1', name: 'Vault', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
      activeCollectionId.set('col-1')
      selectAssetPath('media/demo.mp4', 'video')
      render(PropertiesPanel)

      await fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder/File Explorer' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Copy Path' }))

      expect(mockApi.showItemInFolder).toHaveBeenCalledWith('/vault/media/demo.mp4')
      expect(mockApi.openPath).toHaveBeenCalledWith('/vault/media/demo.mp4')
      expect(mockApi.writeToClipboard).toHaveBeenCalledWith('media/demo.mp4')
    })

    it('shows external asset information without exposing its path to collection APIs', async () => {
      workspace.openExternalAssetTab({
        id: 'grant-1',
        path: '/outside/demo.webm',
        name: 'demo.webm',
        mimeCategory: 'video',
        fileSize: 8192,
        objectUrl: 'blob:demo'
      })
      syncFileStoresFromTab()
      render(PropertiesPanel)

      expect(screen.getByText('External file')).toBeTruthy()
      expect(screen.getByText('/outside/demo.webm')).toBeTruthy()
      expect(screen.getByText('8.0 KB')).toBeTruthy()
      expect(mockApi.fileInfo).not.toHaveBeenCalled()

      await fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder/File Explorer' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
      expect(mockApi.revealExternalFile).toHaveBeenCalledWith('grant-1')
      expect(mockApi.openExternalFile).toHaveBeenCalledWith('grant-1')
      expect(mockApi.openPath).not.toHaveBeenCalled()
    })
  })

  describe('links section', () => {
    it('shows Incoming and Outgoing tabs', () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('Incoming')).toBeTruthy()
      expect(screen.getByText('Outgoing')).toBeTruthy()
    })

    it('shows "No incoming links" when none exist', () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No incoming links')).toBeTruthy()
    })

    it('renders incoming link file names on incoming tab', () => {
      selectFilePath('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('roadmap.md')).toBeTruthy()
      expect(screen.getByText('standup.md')).toBeTruthy()
    })

    it('renders incoming link snippets', () => {
      selectFilePath('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('See test document')).toBeTruthy()
      expect(screen.getByText('Discussed test doc')).toBeTruthy()
    })

    it('shows total link count in section header', () => {
      selectFilePath('docs/test.md')
      backlinksInfo.set(sampleBacklinks)
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      // 2 incoming + 2 outgoing = 4 (shown in both Local Graph and Links sections)
      const counts = screen.getAllByText('4')
      expect(counts.length).toBeGreaterThanOrEqual(1)
    })

    it('fires onfileselect when an incoming link is clicked', async () => {
      selectFilePath('docs/test.md')
      backlinksInfo.set(sampleBacklinks)
      const handler = vi.fn()

      render(PropertiesPanel, { props: { onfileselect: handler } })

      await fireEvent.click(screen.getByText('roadmap.md'))

      expect(handler).toHaveBeenCalledWith({ path: 'docs/roadmap.md' })
    })

    it('switches to outgoing tab and shows outgoing links', async () => {
      selectFilePath('docs/test.md')
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      // Click Outgoing tab
      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('guide.md')).toBeTruthy()
      expect(screen.getByText('api.md')).toBeTruthy()
    })

    it('renders outgoing link snippets', async () => {
      selectFilePath('docs/test.md')
      linksInfo.set(sampleLinks)

      render(PropertiesPanel)

      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('see guide')).toBeTruthy()
      expect(screen.getByText('API reference')).toBeTruthy()
    })

    it('shows "No outgoing links" when none exist', async () => {
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      await fireEvent.click(screen.getByText('Outgoing'))

      expect(screen.getByText('No outgoing links')).toBeTruthy()
    })

    it('fires onfileselect when an outgoing link is clicked', async () => {
      selectFilePath('docs/test.md')
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
      selectFilePath('docs/test.md')

      render(PropertiesPanel)

      expect(screen.getByText('No headings')).toBeTruthy()
    })

    it('renders headings from file content', () => {
      selectFilePath('docs/test.md')
      propertiesFileContent.set('# Introduction\n\n## Getting Started\n\n### Installation\n')

      render(PropertiesPanel)

      expect(screen.getByText('Introduction')).toBeTruthy()
      expect(screen.getByText('Getting Started')).toBeTruthy()
      expect(screen.getByText('Installation')).toBeTruthy()
    })

    it('skips frontmatter when parsing headings', () => {
      selectFilePath('docs/test.md')
      propertiesFileContent.set('---\ntitle: Test\n---\n\n# Real Heading\n')

      render(PropertiesPanel)

      expect(screen.getByText('Real Heading')).toBeTruthy()
      expect(screen.queryByText('title: Test')).toBeNull()
    })

    it('skips headings inside code blocks', () => {
      selectFilePath('docs/test.md')
      propertiesFileContent.set('# Real\n\n```\n# Fake\n```\n\n## Also Real\n')

      render(PropertiesPanel)

      expect(screen.getByText('Real')).toBeTruthy()
      expect(screen.getByText('Also Real')).toBeTruthy()
      expect(screen.queryByText('Fake')).toBeNull()
    })

    it('outline items have clickable cursor style', () => {
      selectFilePath('docs/test.md')
      propertiesFileContent.set('# Title\n')

      render(PropertiesPanel)

      const item = screen.getByText('Title').closest('[role="button"]')
      expect(item).toBeTruthy()
    })
  })

  describe('section collapse', () => {
    it('collapses metadata section on header click', async () => {
      selectFilePath('docs/test.md')
      documentInfo.set(sampleDoc)

      render(PropertiesPanel)

      // Status value should be visible initially
      expect(screen.getByText('in-progress')).toBeTruthy()

      // Click the Frontmatter header to collapse
      await fireEvent.click(screen.getByText('Frontmatter'))

      // Status value should no longer be visible
      expect(screen.queryByText('in-progress')).toBeNull()
    })

    it('collapses links section on header click', async () => {
      selectFilePath('docs/test.md')
      backlinksInfo.set(sampleBacklinks)

      render(PropertiesPanel)

      expect(screen.getByText('roadmap.md')).toBeTruthy()

      await fireEvent.click(screen.getByText('Links'))

      expect(screen.queryByText('roadmap.md')).toBeNull()
    })

    it('collapses outline section on header click', async () => {
      selectFilePath('docs/test.md')
      propertiesFileContent.set('# Title\n')

      render(PropertiesPanel)

      expect(screen.getByText('Title')).toBeTruthy()

      await fireEvent.click(screen.getByText('Outline'))

      expect(screen.queryByText('Title')).toBeNull()
    })

    it('re-expands section on second click', async () => {
      selectFilePath('docs/test.md')
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
