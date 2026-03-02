import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

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
  frontmatter,
  outline,
  loadProperties,
  clearProperties,
} from '../../src/renderer/stores/properties'
import {
  activeCollectionId,
  collections,
} from '../../src/renderer/stores/collections'
import type { DocumentInfo, BacklinksOutput, LinksOutput } from '../../src/renderer/types/cli'

const col1 = { id: 'a', name: 'alpha', path: '/alpha', addedAt: 1, lastOpenedAt: 1 }

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
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
})

describe('properties store', () => {
  describe('loadProperties', () => {
    it('fetches document info, backlinks, and links sequentially', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.getFile.mockResolvedValue(sampleDoc)
      mockApi.backlinks.mockResolvedValue(sampleBacklinks)
      mockApi.links.mockResolvedValue(sampleLinks)

      await loadProperties('docs/test.md')

      expect(mockApi.getFile).toHaveBeenCalledWith('/alpha', 'docs/test.md')
      expect(mockApi.backlinks).toHaveBeenCalledWith('/alpha', 'docs/test.md')
      expect(mockApi.links).toHaveBeenCalledWith('/alpha', 'docs/test.md')
      expect(get(documentInfo)).toEqual(sampleDoc)
      expect(get(backlinksInfo)).toEqual(sampleBacklinks)
      expect(get(linksInfo)).toEqual(sampleLinks)
      expect(get(propertiesLoading)).toBe(false)
    })

    it('sets loading to true during fetch', async () => {
      collections.set([col1])
      activeCollectionId.set('a')

      let loadingDuringFetch = false
      mockApi.getFile.mockImplementation(async () => {
        loadingDuringFetch = get(propertiesLoading)
        return sampleDoc
      })
      mockApi.backlinks.mockResolvedValue(sampleBacklinks)
      mockApi.links.mockResolvedValue(sampleLinks)

      await loadProperties('docs/test.md')

      expect(loadingDuringFetch).toBe(true)
      expect(get(propertiesLoading)).toBe(false)
    })

    it('silently handles getFile error (file not indexed)', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.getFile.mockRejectedValue(new Error('file not in index'))
      mockApi.backlinks.mockResolvedValue(sampleBacklinks)
      mockApi.links.mockResolvedValue(sampleLinks)

      await loadProperties('docs/test.md')

      expect(get(documentInfo)).toBeNull()
      expect(get(backlinksInfo)).toEqual(sampleBacklinks)
      expect(get(linksInfo)).toEqual(sampleLinks)
      expect(get(propertiesLoading)).toBe(false)
    })

    it('silently handles backlinks error', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.getFile.mockResolvedValue(sampleDoc)
      mockApi.backlinks.mockRejectedValue(new Error('lock busy'))
      mockApi.links.mockResolvedValue(sampleLinks)

      await loadProperties('docs/test.md')

      expect(get(documentInfo)).toEqual(sampleDoc)
      expect(get(backlinksInfo)).toBeNull()
      expect(get(linksInfo)).toEqual(sampleLinks)
      expect(get(propertiesLoading)).toBe(false)
    })

    it('silently handles links error', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.getFile.mockResolvedValue(sampleDoc)
      mockApi.backlinks.mockResolvedValue(sampleBacklinks)
      mockApi.links.mockRejectedValue(new Error('fail'))

      await loadProperties('docs/test.md')

      expect(get(documentInfo)).toEqual(sampleDoc)
      expect(get(backlinksInfo)).toEqual(sampleBacklinks)
      expect(get(linksInfo)).toBeNull()
      expect(get(propertiesLoading)).toBe(false)
    })

    it('handles all API calls failing', async () => {
      collections.set([col1])
      activeCollectionId.set('a')
      mockApi.getFile.mockRejectedValue(new Error('fail'))
      mockApi.backlinks.mockRejectedValue(new Error('fail'))
      mockApi.links.mockRejectedValue(new Error('fail'))

      await loadProperties('docs/test.md')

      expect(get(documentInfo)).toBeNull()
      expect(get(backlinksInfo)).toBeNull()
      expect(get(linksInfo)).toBeNull()
      expect(get(propertiesLoading)).toBe(false)
    })

    it('clears properties when no active collection', async () => {
      documentInfo.set(sampleDoc)
      backlinksInfo.set(sampleBacklinks)
      linksInfo.set(sampleLinks)

      await loadProperties('docs/test.md')

      expect(get(documentInfo)).toBeNull()
      expect(get(backlinksInfo)).toBeNull()
      expect(get(linksInfo)).toBeNull()
      expect(mockApi.getFile).not.toHaveBeenCalled()
      expect(mockApi.backlinks).not.toHaveBeenCalled()
      expect(mockApi.links).not.toHaveBeenCalled()
    })
  })

  describe('clearProperties', () => {
    it('resets all stores to defaults', () => {
      documentInfo.set(sampleDoc)
      backlinksInfo.set(sampleBacklinks)
      linksInfo.set(sampleLinks)
      propertiesFileContent.set('# Hello')
      propertiesLoading.set(true)
      propertiesError.set('some error')

      clearProperties()

      expect(get(documentInfo)).toBeNull()
      expect(get(backlinksInfo)).toBeNull()
      expect(get(linksInfo)).toBeNull()
      expect(get(propertiesFileContent)).toBeNull()
      expect(get(propertiesLoading)).toBe(false)
      expect(get(propertiesError)).toBeNull()
    })
  })

  describe('frontmatter derived store', () => {
    it('extracts frontmatter object from documentInfo', () => {
      documentInfo.set(sampleDoc)

      const fm = get(frontmatter)
      expect(fm).toEqual({
        status: 'in-progress',
        tags: ['design', 'v1'],
        title: 'Test Document',
      })
    })

    it('returns null when documentInfo is null', () => {
      documentInfo.set(null)
      expect(get(frontmatter)).toBeNull()
    })

    it('returns null when frontmatter is null', () => {
      documentInfo.set({ ...sampleDoc, frontmatter: null })
      expect(get(frontmatter)).toBeNull()
    })

    it('returns null when frontmatter is a non-object value', () => {
      documentInfo.set({ ...sampleDoc, frontmatter: 'just a string' })
      expect(get(frontmatter)).toBeNull()
    })

    it('returns null when frontmatter is an array', () => {
      documentInfo.set({ ...sampleDoc, frontmatter: ['a', 'b'] })
      expect(get(frontmatter)).toBeNull()
    })
  })

  describe('outline derived store', () => {
    it('parses headings from markdown content', () => {
      propertiesFileContent.set('# Title\n\nSome text.\n\n## Section One\n\n### Subsection\n')

      expect(get(outline)).toEqual([
        { level: 1, heading: 'Title' },
        { level: 2, heading: 'Section One' },
        { level: 3, heading: 'Subsection' },
      ])
    })

    it('skips frontmatter block', () => {
      propertiesFileContent.set(
        '---\ntitle: Test\nstatus: draft\n---\n\n# Real Heading\n\n## Another\n'
      )

      expect(get(outline)).toEqual([
        { level: 1, heading: 'Real Heading' },
        { level: 2, heading: 'Another' },
      ])
    })

    it('returns empty array when content is null', () => {
      propertiesFileContent.set(null)
      expect(get(outline)).toEqual([])
    })

    it('returns empty array when content has no headings', () => {
      propertiesFileContent.set('Just a paragraph with no headings.\n\nAnother paragraph.\n')
      expect(get(outline)).toEqual([])
    })

    it('handles all heading levels (h1-h6)', () => {
      propertiesFileContent.set(
        '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n'
      )

      expect(get(outline)).toEqual([
        { level: 1, heading: 'H1' },
        { level: 2, heading: 'H2' },
        { level: 3, heading: 'H3' },
        { level: 4, heading: 'H4' },
        { level: 5, heading: 'H5' },
        { level: 6, heading: 'H6' },
      ])
    })

    it('does not treat lines without space after # as headings', () => {
      propertiesFileContent.set('#NotAHeading\n\n# Real Heading\n')

      expect(get(outline)).toEqual([{ level: 1, heading: 'Real Heading' }])
    })
  })
})
