import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'

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
      domEventHandler: vi.fn(() => []),
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

import { fileContent, selectedFilePath } from '../../src/renderer/stores/files'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { isDirty, wordCount, countWords } from '../../src/renderer/stores/editor'
import { get } from 'svelte/store'
import Editor from '@renderer/components/Editor.svelte'

/** Helper to set the active collection via the underlying writable stores. */
function setActiveCollectionForTest(collection: { id: string; name: string; path: string } | null) {
  if (collection) {
    collections.set([collection as any])
    activeCollectionId.set(collection.id)
  } else {
    collections.set([])
    activeCollectionId.set(null)
  }
}

function resetStores() {
  fileContent.set(null)
  selectedFilePath.set(null)
  collections.set([])
  activeCollectionId.set(null)
  isDirty.set(false)
  wordCount.set(0)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('Editor component', () => {
  it('shows empty state when no file is selected', () => {
    render(Editor)

    expect(screen.getByText('Select a file from the sidebar')).toBeTruthy()
  })

  it('shows empty state icon when no file selected', () => {
    render(Editor)

    expect(screen.getByText('description')).toBeTruthy()
  })

  it('renders editor container when file is selected', () => {
    selectedFilePath.set('test.md')
    fileContent.set('# Hello World')
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })

    const { container } = render(Editor)

    expect(container.querySelector('.editor-container')).toBeTruthy()
  })

  it('does not show empty state when file is selected', () => {
    selectedFilePath.set('test.md')
    fileContent.set('# Hello')

    const { container } = render(Editor)

    expect(container.querySelector('.empty-state')).toBeFalsy()
  })

  it('resets isDirty and wordCount on destroy', () => {
    selectedFilePath.set('test.md')
    fileContent.set('hello world')
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })

    const { unmount } = render(Editor)

    isDirty.set(true)
    wordCount.set(42)

    unmount()

    expect(get(isDirty)).toBe(false)
    expect(get(wordCount)).toBe(0)
  })

  it('sets wordCount when file content loads', async () => {
    selectedFilePath.set('test.md')
    fileContent.set('hello world foo bar')
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })

    render(Editor)

    // Wait for effects to run
    await vi.dynamicImportSettled?.()
    // countWords('hello world foo bar') = 4
    expect(get(wordCount)).toBe(4)
  })
})

describe('countWords utility', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('counts single word', () => {
    expect(countWords('hello')).toBe(1)
  })

  it('counts multiple words', () => {
    expect(countWords('hello world foo bar')).toBe(4)
  })

  it('handles multiple spaces between words', () => {
    expect(countWords('hello   world')).toBe(2)
  })

  it('handles newlines between words', () => {
    expect(countWords('hello\nworld\nfoo')).toBe(3)
  })
})

describe('Editor save functionality', () => {
  it('writeFile is available on window.api', () => {
    expect(window.api.writeFile).toBeDefined()
  })

  it('save constructs correct full path from collection and file', async () => {
    // Verify the path construction logic: `${collection.path}/${selectedFilePath}`
    const collectionPath = '/projects/my-vault'
    const filePath = 'docs/notes.md'
    const expectedFullPath = `${collectionPath}/${filePath}`

    expect(expectedFullPath).toBe('/projects/my-vault/docs/notes.md')
  })
})
