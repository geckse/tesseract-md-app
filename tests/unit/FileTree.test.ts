import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { get } from 'svelte/store'

// Mock window.api before importing stores
const mockApi = {
  tree: vi.fn(),
  ingest: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  info: vi.fn(),
  graphData: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  readFile: vi.fn(),
  getCliVersion: vi.fn(),
  getFile: vi.fn(),
  backlinks: vi.fn(),
  links: vi.fn(),
  neighborhood: vi.fn(),
  addRecent: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import {
  assetTree,
  expandedPaths,
  fileTree,
  fileTreeLoading,
  fileTreeError
} from '../../src/renderer/stores/files'
import {
  collections,
  activeCollectionId,
  infoModalOpen,
  infoScope
} from '../../src/renderer/stores/collections'
import { ingestRunning } from '../../src/renderer/stores/ingest'
import {
  graphData,
  graphPathFilter,
  graphViewActive,
  syncGraphStoresFromTab
} from '../../src/renderer/stores/graph'
import { workspace } from '../../src/renderer/stores/workspace.svelte'
import { cliFeatures } from '../../src/renderer/lib/cli-features.svelte'
import FileTree from '@renderer/components/FileTree.svelte'
import type { FileTree as FileTreeType, GraphData } from '../../src/renderer/types/cli'

const sampleTree: FileTreeType = {
  root: {
    name: '.',
    path: '.',
    is_dir: true,
    state: null,
    children: [
      {
        name: 'docs',
        path: 'docs',
        is_dir: true,
        state: null,
        children: [
          {
            name: 'guide.md',
            path: 'docs/guide.md',
            is_dir: false,
            state: 'indexed',
            children: []
          }
        ]
      },
      {
        name: 'readme.md',
        path: 'readme.md',
        is_dir: false,
        state: 'modified',
        children: []
      },
      {
        name: 'new-file.md',
        path: 'new-file.md',
        is_dir: false,
        state: 'new',
        children: []
      }
    ]
  },
  total_files: 3,
  indexed_count: 1,
  modified_count: 1,
  new_count: 1,
  deleted_count: 0
}

const testCollection = { id: '1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

function setActiveCollection() {
  collections.set([testCollection])
  activeCollectionId.set('1')
}

function resetStores() {
  workspace.reset()
  syncGraphStoresFromTab()
  fileTree.set(null)
  assetTree.set(null)
  expandedPaths.set(new Set())
  fileTreeLoading.set(false)
  fileTreeError.set(null)
  collections.set([])
  activeCollectionId.set(null)
  ingestRunning.set(false)
  infoModalOpen.set(false)
  infoScope.set(null)
  graphData.set(null)
  cliFeatures.reset()
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  mockApi.createFile.mockResolvedValue(undefined)
  mockApi.createDirectory.mockResolvedValue(undefined)
  mockApi.readFile.mockResolvedValue('')
  mockApi.getCliVersion.mockResolvedValue('0.2.0')
})

describe('FileTree component', () => {
  it('shows empty state when no collection is selected', () => {
    render(FileTree)

    expect(screen.getByText('No collection selected')).toBeTruthy()
  })

  it('shows loading state when loading', () => {
    setActiveCollection()
    fileTreeLoading.set(true)

    render(FileTree)

    expect(screen.getByText('Loading files...')).toBeTruthy()
  })

  it('shows error state with retry button', () => {
    setActiveCollection()
    fileTreeError.set('Something went wrong')

    render(FileTree)

    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('shows empty files state when tree has no children', () => {
    setActiveCollection()
    fileTree.set({
      root: { name: '.', path: '.', is_dir: true, state: null, children: [] },
      total_files: 0,
      indexed_count: 0,
      modified_count: 0,
      new_count: 0,
      deleted_count: 0
    })

    render(FileTree)

    expect(screen.getByText('No markdown files found')).toBeTruthy()
  })

  it('renders the header with Files title', () => {
    render(FileTree)

    expect(screen.getByText('Files')).toBeTruthy()
  })

  it('renders action buttons in header', () => {
    render(FileTree)

    expect(screen.getByTitle('Index Collection')).toBeTruthy()
    expect(screen.getByTitle('More index options')).toBeTruthy()
    expect(screen.getByTitle('Collapse All')).toBeTruthy()
    expect(screen.getByTitle('Expand All')).toBeTruthy()
    expect(screen.getByTitle('Refresh')).toBeTruthy()
  })

  it('shows Index text label on the ingest button', () => {
    render(FileTree)

    expect(screen.getByText('Index')).toBeTruthy()
  })

  it('shows Indexing... text when ingest is running', () => {
    ingestRunning.set(true)

    render(FileTree)

    expect(screen.getByText('Indexing...')).toBeTruthy()
  })

  it('disables ingest button when no collection', () => {
    render(FileTree)

    const btn = screen.getByTitle('Index Collection') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('calls ingest with reindex=false on Index click', async () => {
    setActiveCollection()
    mockApi.ingest.mockResolvedValue({
      files_indexed: 0,
      files_skipped: 0,
      files_removed: 0,
      chunks_created: 0,
      api_calls: 0,
      files_failed: 0,
      errors: [],
      duration_secs: 0,
      cancelled: false
    })
    mockApi.tree.mockResolvedValue(sampleTree)
    mockApi.status.mockResolvedValue({})

    render(FileTree)

    await fireEvent.click(screen.getByTitle('Index Collection'))

    expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: false })
  })

  it('opens dropdown menu on chevron click and shows Reindex All', async () => {
    setActiveCollection()

    render(FileTree)

    expect(screen.queryByText('Reindex All')).toBeNull()

    await fireEvent.click(screen.getByTitle('More index options'))

    expect(screen.getByText('Reindex All')).toBeTruthy()
  })

  it('calls ingest with reindex=true on Reindex All click', async () => {
    setActiveCollection()
    mockApi.ingest.mockResolvedValue({
      files_indexed: 0,
      files_skipped: 0,
      files_removed: 0,
      chunks_created: 0,
      api_calls: 0,
      files_failed: 0,
      errors: [],
      duration_secs: 0,
      cancelled: false
    })
    mockApi.tree.mockResolvedValue(sampleTree)
    mockApi.status.mockResolvedValue({})

    render(FileTree)

    await fireEvent.click(screen.getByTitle('More index options'))
    await fireEvent.click(screen.getByText('Reindex All'))

    expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: true })
  })

  it('disables refresh button when loading', () => {
    setActiveCollection()
    fileTreeLoading.set(true)

    render(FileTree)

    const refreshBtn = screen.getByTitle('Refresh') as HTMLButtonElement
    expect(refreshBtn.disabled).toBe(true)
  })

  it('shows file count summary when tree is loaded', () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('shows modified count in summary', () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('1 modified')).toBeTruthy()
  })

  it('shows new count in summary', () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('1 new')).toBeTruthy()
  })

  it('renders tree nodes when data is available', () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByText('new-file.md')).toBeTruthy()
  })

  it('calls loadFileTree on retry click', async () => {
    setActiveCollection()
    fileTreeError.set('Failed to load')
    mockApi.tree.mockResolvedValue(sampleTree)

    render(FileTree)

    await fireEvent.click(screen.getByText('Retry'))

    expect(mockApi.tree).toHaveBeenCalledWith('/test', undefined)
  })

  it('keyboard Enter on a focused directory opens it as a table', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    const onfolderopen = vi.fn()

    const { container } = render(FileTree, { props: { onfolderopen } })
    const treeContainer = container.querySelector('[role="tree"]')!

    // The first flat node is the 'docs' directory; focus defaults to index 0
    await fireEvent.keyDown(treeContainer, { key: 'Enter' })

    expect(onfolderopen).toHaveBeenCalledWith({ path: 'docs' })
  })

  it('navigates visible rows with arrow keys and opens a file with Enter', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    const onfileselect = vi.fn()

    const { container } = render(FileTree, { props: { onfileselect } })
    const treeContainer = container.querySelector<HTMLElement>('[role="tree"]')!
    treeContainer.focus()

    await fireEvent.keyDown(treeContainer, { key: 'ArrowDown' })
    await fireEvent.keyDown(treeContainer, { key: 'Enter' })

    expect(onfileselect).toHaveBeenCalledWith({ path: 'new-file.md', forceNewTab: false })
    expect(treeContainer.getAttribute('aria-activedescendant')).toContain('new-file.md')
  })

  it('uses ArrowRight for expansion and child navigation, then opens the child', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    const onfileselect = vi.fn()

    const { container } = render(FileTree, { props: { onfileselect } })
    const treeContainer = container.querySelector<HTMLElement>('[role="tree"]')!
    treeContainer.focus()

    await fireEvent.keyDown(treeContainer, { key: 'ArrowRight' })
    await vi.waitFor(() => expect(screen.getByText('guide.md')).toBeTruthy())
    await fireEvent.keyDown(treeContainer, { key: 'ArrowRight' })
    await fireEvent.keyDown(treeContainer, { key: 'Enter' })

    expect(onfileselect).toHaveBeenCalledWith({ path: 'docs/guide.md', forceNewTab: false })
  })

  it('opens the focused row context menu with Shift+F10 and navigates its actions', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    const { container } = render(FileTree)
    const treeContainer = container.querySelector<HTMLElement>('[role="tree"]')!
    treeContainer.focus()

    await fireEvent.keyDown(treeContainer, { key: 'F10', shiftKey: true })

    const newFileAction = screen.getByRole('menuitem', { name: /New File/ })
    const newFolderAction = screen.getByRole('menuitem', { name: /New Folder/ })
    expect(document.activeElement).toBe(newFileAction)

    await fireEvent.keyDown(newFileAction, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(newFolderAction)
  })

  it('offers creation on a file and creates the new entry beside it', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)
    const readmeRow = screen.getByText('readme.md').closest('button')!
    await fireEvent.contextMenu(readmeRow, { clientX: 20, clientY: 20 })

    expect(screen.getByRole('menuitem', { name: /New File/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /New Folder/ })).toBeTruthy()

    await fireEvent.click(screen.getByRole('menuitem', { name: /New Folder/ }))
    const input = screen.getByRole('textbox', { name: 'New folder name' })
    await fireEvent.input(input, { target: { value: 'readme-notes' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(mockApi.createDirectory).toHaveBeenCalledWith('/test/readme-notes')
    )
  })

  it('creates a new file inside the right-clicked directory', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })
    await fireEvent.click(screen.getByRole('menuitem', { name: /New File/ }))

    const input = screen.getByRole('textbox', { name: 'New file name' })
    await fireEvent.input(input, { target: { value: 'keyboard-guide' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(mockApi.createFile).toHaveBeenCalledWith('/test/docs/keyboard-guide.md', '')
    })
  })

  it('creates a root folder from the empty-tree background menu', async () => {
    setActiveCollection()
    fileTree.set({
      root: { name: '.', path: '.', is_dir: true, state: null, children: [] },
      total_files: 0,
      indexed_count: 0,
      modified_count: 0,
      new_count: 0,
      deleted_count: 0
    })

    const { container } = render(FileTree)
    const content = container.querySelector<HTMLElement>('.file-tree-content')!
    await fireEvent.contextMenu(content, { clientX: 24, clientY: 40 })
    await fireEvent.click(screen.getByRole('menuitem', { name: /New Folder/ }))

    const input = screen.getByRole('textbox', { name: 'New folder name' })
    await fireEvent.input(input, { target: { value: 'notes' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => expect(mockApi.createDirectory).toHaveBeenCalledWith('/test/notes'))
  })

  it('keeps the inline creator open and reports invalid names', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)

    render(FileTree)
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })
    await fireEvent.click(screen.getByRole('menuitem', { name: /New Folder/ }))

    const input = screen.getByRole('textbox', { name: 'New folder name' })
    await fireEvent.input(input, { target: { value: '../outside' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Name contains invalid characters'
    )
    expect(mockApi.createDirectory).not.toHaveBeenCalled()
  })

  it('offers scoped Information from a Markdown directory menu', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    mockApi.info.mockResolvedValue({ scope: 'docs/' })

    render(FileTree)
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })

    await fireEvent.click(screen.getByText('Information'))

    expect(get(infoModalOpen)).toBe(true)
    expect(get(infoScope)).toBe('docs')
    expect(mockApi.info).toHaveBeenCalledWith('/test', 'docs')
  })

  it('opens a Markdown directory as a scoped graph from a non-graph view', async () => {
    const scopedGraphData: GraphData = {
      nodes: [],
      edges: [],
      clusters: [],
      level: 'document'
    }

    setActiveCollection()
    fileTree.set(sampleTree)
    workspace.openFile('readme.md')
    syncGraphStoresFromTab()
    mockApi.graphData.mockResolvedValue(scopedGraphData)

    expect(get(graphViewActive)).toBe(false)

    render(FileTree)
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })
    await fireEvent.click(screen.getByText('Show in Graph'))

    await vi.waitFor(() => {
      expect(mockApi.graphData).toHaveBeenCalledWith('/test', 'document', 'docs')
    })
    expect(get(graphViewActive)).toBe(true)
    expect(get(graphPathFilter)).toBe('docs')
    expect(workspace.focusedTab).toMatchObject({ kind: 'graph', graphPathFilter: 'docs' })
    expect(get(graphData)).toEqual(scopedGraphData)
  })
})
