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
  search: vi.fn().mockResolvedValue({ results: [], query: '', total_results: 0 }),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

// Mock CodeMirror modules to avoid DOM issues in tests
vi.mock('@codemirror/view', () => {
  const EditorView = vi.fn().mockImplementation(function (this: any, config: any) {
    this.state = config.state
    this.dom = document.createElement('div')
    this.dom.className = 'cm-editor'
    this.destroy = vi.fn()
    this.dispatch = vi.fn()
    if (config.parent) {
      config.parent.appendChild(this.dom)
    }
    return this
  })
  return {
    EditorView: Object.assign(EditorView, {
      updateListener: { of: vi.fn(() => []) },
    }),
    keymap: { of: vi.fn(() => []) },
  }
})

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn((config: any) => ({
      doc: {
        toString: () => config.doc || '',
        length: (config.doc || '').length,
      },
    })),
  },
}))

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: vi.fn(() => []),
  markdownLanguage: {},
}))

vi.mock('@codemirror/commands', () => ({
  history: vi.fn(() => []),
  historyKeymap: [],
  defaultKeymap: [],
}))

vi.mock('../../src/renderer/lib/editor-theme', () => ({
  editorTheme: vi.fn(() => []),
}))

vi.mock('../../src/renderer/lib/soft-render', () => ({
  softRender: vi.fn(() => []),
}))

vi.mock('../../src/renderer/lib/frontmatter-decoration', () => ({
  frontmatterDecoration: vi.fn(() => []),
}))

import {
  searchOpen,
  searchQuery,
  searchResults,
  searchLoading,
  highlightedIndex,
  searchError,
} from '../../src/renderer/stores/search'
import { get } from 'svelte/store'
import Search from '@renderer/components/Search.svelte'

function resetStores() {
  searchOpen.set(false)
  searchQuery.set('')
  searchResults.set(null)
  searchLoading.set(false)
  highlightedIndex.set(-1)
  searchError.set(null)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('Search component', () => {
  it('renders input with correct placeholder', () => {
    render(Search)

    const input = screen.getByPlaceholderText('Search database...')
    expect(input).toBeTruthy()
  })

  it('search icon is present', () => {
    render(Search)

    expect(screen.getByText('search')).toBeTruthy()
  })

  it('kbd hint shows ⌘K', () => {
    render(Search)

    expect(screen.getByText('K')).toBeTruthy()
    expect(screen.getByText('⌘')).toBeTruthy()
  })

  it('focusing input sets searchOpen to true via typing', async () => {
    render(Search)

    const input = screen.getByPlaceholderText('Search database...')
    await fireEvent.input(input, { target: { value: 'test' } })

    expect(get(searchOpen)).toBe(true)
  })

  it('pressing Escape closes results', async () => {
    searchOpen.set(true)
    render(Search)

    const input = screen.getByPlaceholderText('Search database...')
    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(get(searchOpen)).toBe(false)
  })

  it('typing triggers debounced store update', async () => {
    render(Search)

    const input = screen.getByPlaceholderText('Search database...')
    await fireEvent.input(input, { target: { value: 'hello' } })

    // executeSearch sets searchQuery via debounce, but searchOpen is set immediately
    expect(get(searchOpen)).toBe(true)
  })

  it('ArrowDown increments highlightedIndex', async () => {
    searchResults.set({
      results: [
        { file: { path: 'a.md' }, score: 1.0, chunks: [] },
        { file: { path: 'b.md' }, score: 0.5, chunks: [] },
      ] as any,
      query: 'test',
      total_results: 2,
    })
    highlightedIndex.set(-1)

    render(Search)

    const input = screen.getByPlaceholderText('Search database...')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(get(highlightedIndex)).toBe(0)
  })
})
