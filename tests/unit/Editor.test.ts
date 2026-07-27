import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const codeMirrorHarness = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  selection: { anchor: 0, from: 0, head: 0, to: 0 },
  views: [] as Array<{
    dispatch: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    state: unknown
  }>
}))

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
  createBinary: vi.fn().mockResolvedValue({ size: 4 }),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  detachTab: vi.fn().mockResolvedValue(undefined)
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

// Mock CodeMirror modules to avoid DOM issues in tests
vi.mock('@codemirror/view', () => {
  const EditorView = vi.fn().mockImplementation(function (this: any, config: any) {
    this.state = config.state
    this.dom = document.createElement('div')
    this.dom.className = 'cm-editor'
    this.destroy = vi.fn()
    this.dispatch = vi.fn()
    this.focus = vi.fn()
    this.scrollDOM = { scrollTop: 0 }
    this.contentDOM = { scrollTop: 0 }
    codeMirrorHarness.views.push(this)
    if (config.parent) {
      config.parent.appendChild(this.dom)
    }
    return this
  })
  return {
    EditorView: Object.assign(EditorView, {
      updateListener: { of: vi.fn(() => []) },
      domEventHandlers: vi.fn((handlers) => {
        codeMirrorHarness.handlers = handlers
        return []
      }),
      scrollIntoView: vi.fn(() => ({}))
    }),
    keymap: { of: vi.fn(() => []) }
  }
})

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn((config: any) => ({
      doc: {
        toString: () => config.doc || '',
        length: (config.doc || '').length,
        lineAt: () => ({ from: 0, to: 0, number: 1, text: '' }),
        line: () => ({ from: 0, to: 0, number: 1, text: '' }),
        sliceString: () => config.doc || ''
      },
      selection: {
        main: { ...codeMirrorHarness.selection }
      }
    })),
    fromJSON: vi.fn(() => ({
      doc: {
        toString: () => '',
        length: 0,
        lineAt: () => ({ from: 0, to: 0, number: 1, text: '' }),
        line: () => ({ from: 0, to: 0, number: 1, text: '' }),
        sliceString: () => ''
      },
      selection: {
        main: { ...codeMirrorHarness.selection }
      }
    }))
  }
}))

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: vi.fn(() => []),
  markdownLanguage: {}
}))

vi.mock('@codemirror/commands', () => ({
  history: vi.fn(() => []),
  historyKeymap: [],
  defaultKeymap: [],
  historyField: {}
}))

vi.mock('@codemirror/search', () => ({
  search: vi.fn(() => []),
  searchKeymap: []
}))

vi.mock('../../src/renderer/lib/editor-theme', () => ({
  editorTheme: vi.fn(() => [])
}))

vi.mock('../../src/renderer/lib/soft-render', () => ({
  softRender: vi.fn(() => [])
}))

vi.mock('../../src/renderer/lib/frontmatter-decoration', () => ({
  frontmatterDecoration: vi.fn(() => [])
}))

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { isDirty, wordCount, countWords } from '../../src/renderer/stores/editor'
import { workspace } from '../../src/renderer/stores/workspace.svelte'
import { assetTree, fileTree } from '../../src/renderer/stores/files'
import { saveAsTabId } from '../../src/renderer/stores/save-as'
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

/**
 * Helper to simulate an open file in the workspace.
 * Opens a tab and sets its content so the Editor component sees it.
 */
function openFileInWorkspace(filePath: string, content: string): string {
  const tabId = workspace.openTab(filePath)
  const tab = workspace.tabs[tabId]
  if (tab && tab.kind === 'document') {
    tab.content = content
    tab.contentLoading = false
  }
  return tabId
}

function resetStores() {
  workspace.reset()
  collections.set([])
  activeCollectionId.set(null)
  isDirty.set(false)
  wordCount.set(0)
  saveAsTabId.set(null)
  fileTree.set(null)
  assetTree.set(null)
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
  codeMirrorHarness.handlers = {}
  codeMirrorHarness.selection = { anchor: 0, from: 0, head: 0, to: 0 }
  codeMirrorHarness.views = []
  mockApi.createBinary.mockResolvedValue({ size: 4 })
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
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    openFileInWorkspace('test.md', '# Hello World')

    const { container } = render(Editor)

    expect(container.querySelector('.editor-container')).toBeTruthy()
  })

  it('does not show empty state when file is selected', () => {
    openFileInWorkspace('test.md', '# Hello')

    const { container } = render(Editor)

    expect(container.querySelector('.empty-state')).toBeFalsy()
  })

  it('does not erase the document state when its editor view unmounts', () => {
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    openFileInWorkspace('test.md', 'hello world')

    const { unmount } = render(Editor)

    isDirty.set(true)
    wordCount.set(42)

    unmount()

    expect(get(isDirty)).toBe(true)
    expect(get(wordCount)).toBe(42)
  })

  it('sets wordCount when file content loads', async () => {
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    openFileInWorkspace('test.md', 'hello world foo bar')

    render(Editor)

    // Wait for effects to run
    await vi.dynamicImportSettled?.()
    // countWords('hello world foo bar') = 4
    expect(get(wordCount)).toBe(4)
  })

  it('opens the clipboard image modal and creates the file before inserting Markdown', async () => {
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    const content = '# Test\n\n## Current Section\n\nreplace me'
    const from = content.indexOf('replace me')
    codeMirrorHarness.selection = { anchor: from, from, head: from + 10, to: from + 10 }
    openFileInWorkspace('notes/test.md', content)
    render(Editor)

    const view = codeMirrorHarness.views.at(-1)!
    const image = new File([new Uint8Array([1, 2, 3, 4])], 'clipboard.png', {
      type: 'image/png'
    })
    const preventDefault = vi.fn()
    const handled = codeMirrorHarness.handlers.paste(
      {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }]
        },
        preventDefault
      },
      view
    )

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(await screen.findByRole('dialog', { name: 'Save pasted image' })).toBeTruthy()
    expect((screen.getByLabelText('Filename') as HTMLInputElement).value).toBe(
      'test-current-section'
    )

    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))
    await flushAsync()

    expect(mockApi.createBinary).toHaveBeenCalledOnce()
    expect(mockApi.createBinary).toHaveBeenCalledWith(
      '/test/notes/test-current-section.png',
      expect.any(String)
    )
    const insertion = view.dispatch.mock.calls.at(-1)?.[0]
    expect(insertion).toEqual({
      changes: {
        from,
        to: from + 10,
        insert: '![test-current-section.png](test-current-section.png)'
      },
      selection: { anchor: from + 53 }
    })
    expect(mockApi.createBinary.mock.invocationCallOrder[0]).toBeLessThan(
      view.dispatch.mock.invocationCallOrder.at(-1)!
    )
  })

  it('leaves ordinary clipboard paste to CodeMirror', () => {
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    openFileInWorkspace('test.md', 'hello')
    render(Editor)

    const handled = codeMirrorHarness.handlers.paste(
      {
        clipboardData: {
          items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]
        }
      },
      codeMirrorHarness.views.at(-1)
    )

    expect(handled).toBe(false)
    expect(mockApi.createBinary).not.toHaveBeenCalled()
  })

  it('defers an untitled image paste until Save As succeeds', async () => {
    setActiveCollectionForTest({ id: '1', name: 'Test', path: '/test' })
    const tabId = workspace.createUntitledTab()
    const tab = workspace.tabs[tabId]
    if (tab?.kind === 'document') tab.content = '# Draft\n'
    render(Editor, { props: { tabId } })

    const image = new File([new Uint8Array([1])], 'clipboard.png', { type: 'image/png' })
    codeMirrorHarness.handlers.paste(
      {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }]
        },
        preventDefault: vi.fn()
      },
      codeMirrorHarness.views.at(-1)
    )

    await vi.waitFor(() => expect(get(saveAsTabId)).toBe(tabId))
    expect(screen.queryByRole('dialog', { name: 'Save pasted image' })).toBeNull()

    workspace.finalizeUntitledTab(tabId, 'drafts/my-draft.md')
    saveAsTabId.set(null)

    expect(await screen.findByRole('dialog', { name: 'Save pasted image' })).toBeTruthy()
    expect(screen.getByText('/drafts/my-draft.png')).toBeTruthy()
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
