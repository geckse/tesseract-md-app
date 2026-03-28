import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing stores
const mockApi = {
  tree: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  search: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

// Mock localStorage for setSearchMode persistence
const localStorageMock: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageMock[key] = value }),
    removeItem: vi.fn((key: string) => { delete localStorageMock[key] }),
  },
  writable: true,
})

import {
  searchQuery,
  searchResults,
  searchLoading,
  searchMode,
  searchError,
  highlightedIndex,
} from '../../src/renderer/stores/search'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import type { SearchOutput, SearchResult } from '../../src/renderer/types/cli'
import SearchResults from '@renderer/components/SearchResults.svelte'

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    score: 0.85,
    chunk: {
      chunk_id: 'test.md#0',
      heading_hierarchy: ['Introduction', 'Overview'],
      content: 'This is a test snippet of content.',
      start_line: 1,
      end_line: 10,
    },
    file: {
      path: 'docs/test.md',
      frontmatter: null,
      file_size: 1024,
      path_components: ['docs', 'test.md'],
      modified_at: null,
    },
    ...overrides,
  }
}

function makeSearchOutput(results: SearchResult[]): SearchOutput {
  return {
    results,
    query: 'test query',
    total_results: results.length,
    mode: 'hybrid',
  }
}

function resetStores() {
  searchQuery.set('')
  searchResults.set(null)
  searchLoading.set(false)
  searchMode.set('hybrid')
  searchError.set(null)
  highlightedIndex.set(-1)
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('SearchResults component', () => {
  it('renders result cards with file path text', async () => {
    const r1 = makeResult({ file: { path: 'notes/alpha.md', frontmatter: null, file_size: 100, path_components: ['notes', 'alpha.md'], modified_at: null } })
    const r2 = makeResult({ file: { path: 'docs/beta.md', frontmatter: null, file_size: 200, path_components: ['docs', 'beta.md'], modified_at: null } })
    searchQuery.set('test query')
    searchResults.set(makeSearchOutput([r1, r2]))

    render(SearchResults)

    expect(screen.getByText('notes/alpha.md')).toBeTruthy()
    expect(screen.getByText('docs/beta.md')).toBeTruthy()
  })

  it('shows heading breadcrumb joined with " > "', async () => {
    const r = makeResult({
      chunk: {
        chunk_id: 'test.md#0',
        heading_hierarchy: ['Getting Started', 'Installation', 'Prerequisites'],
        content: 'Some content',
        start_line: 1,
        end_line: 5,
      },
    })
    searchQuery.set('test query')
    searchResults.set(makeSearchOutput([r]))

    render(SearchResults)

    expect(screen.getByText('Getting Started > Installation > Prerequisites')).toBeTruthy()
  })

  it('score bar width is proportional to score', async () => {
    const r = makeResult({ score: 0.72 })
    searchQuery.set('test query')
    searchResults.set(makeSearchOutput([r]))

    const { container } = render(SearchResults)

    const fill = container.querySelector('.score-bar-fill') as HTMLElement
    expect(fill).toBeTruthy()
    expect(fill.style.width).toBe('72%')
  })

  it('content snippet is present', async () => {
    const r = makeResult({
      chunk: {
        chunk_id: 'x.md#0',
        heading_hierarchy: [],
        content: 'Unique snippet text here',
        start_line: 1,
        end_line: 3,
      },
    })
    searchQuery.set('test query')
    searchResults.set(makeSearchOutput([r]))

    render(SearchResults)

    expect(screen.getByText('Unique snippet text here')).toBeTruthy()
  })

  it('clicking result card fires onresultclick callback with correct result', async () => {
    const r = makeResult()
    searchQuery.set('test query')
    searchResults.set(makeSearchOutput([r]))

    const handler = vi.fn()
    const { container } = render(SearchResults, { props: { onresultclick: handler } })

    const card = container.querySelector('.result-card') as HTMLElement
    expect(card).toBeTruthy()
    await fireEvent.click(card)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(r)
  })

  it('shows "No results" message when results array is empty', async () => {
    searchQuery.set('no match query')
    searchResults.set(makeSearchOutput([]))

    render(SearchResults)

    expect(screen.getByText('No results for "no match query"')).toBeTruthy()
  })

  it('shows loading indicator when searchLoading is true', async () => {
    searchLoading.set(true)

    const { container } = render(SearchResults)

    expect(screen.getByText('Searching…')).toBeTruthy()
    expect(container.querySelector('.spinner')).toBeTruthy()
  })

  it('clicking mode pill updates searchMode store', async () => {
    const { container } = render(SearchResults)

    const pills = container.querySelectorAll('.mode-pill')
    // pills are: hybrid, semantic, lexical, graph (expand toggle)
    expect(pills.length).toBe(4)

    // Click 'lexical' (index 2)
    await fireEvent.click(pills[2])

    // The store should be updated (setSearchMode calls searchMode.set internally)
    // We verify the pill becomes active
    expect(pills[2].classList.contains('active')).toBe(true)
  })

  it('results count displays correct number', async () => {
    const results = [makeResult(), makeResult({ score: 0.5 }), makeResult({ score: 0.3 })]
    searchQuery.set('test query')
    searchResults.set({
      results,
      query: 'test query',
      total_results: 3,
      mode: 'hybrid',
    })

    render(SearchResults)

    expect(screen.getByText('3 results')).toBeTruthy()
  })

  it('displays singular "result" for single result', async () => {
    searchQuery.set('test query')
    searchResults.set({
      results: [makeResult()],
      query: 'test query',
      total_results: 1,
      mode: 'hybrid',
    })

    render(SearchResults)

    expect(screen.getByText('1 result')).toBeTruthy()
  })
})
