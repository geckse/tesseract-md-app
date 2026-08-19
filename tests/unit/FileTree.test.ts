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
  importDroppedFiles: vi.fn(),
  showConfirmation: vi.fn(),
  showMessage: vi.fn(),
  readFile: vi.fn(),
  getCliVersion: vi.fn(),
  getFile: vi.fn(),
  backlinks: vi.fn(),
  links: vi.fn(),
  neighborhood: vi.fn(),
  addRecent: vi.fn(),
  setActiveShardId: vi.fn()
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
import {
  activeShardId,
  clearShardState,
  shardsByCollection
} from '../../src/renderer/stores/shards'
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
  clearShardState()
  cliFeatures.reset()
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  mockApi.createFile.mockResolvedValue(undefined)
  mockApi.createDirectory.mockResolvedValue(undefined)
  mockApi.importDroppedFiles.mockResolvedValue([])
  mockApi.showConfirmation.mockResolvedValue(true)
  mockApi.showMessage.mockResolvedValue(undefined)
  mockApi.readFile.mockResolvedValue('')
  mockApi.getCliVersion.mockResolvedValue('0.2.0')
  mockApi.setActiveShardId.mockResolvedValue(undefined)
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

  it('offers to build a missing index without exposing the raw CLI error', async () => {
    setActiveCollection()
    fileTreeError.set(
      "[CliExecutionError] CLI command 'tree' failed: error: index not found: /test/.markdownvdb/index"
    )

    render(FileTree)

    expect(screen.getByText('Index this collection')).toBeTruthy()
    expect(screen.queryByText(/CliExecutionError/)).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Build index' }))
    await vi.waitFor(() => {
      expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: false })
    })
  })

  it('offers a full rebuild for an incompatible index', async () => {
    setActiveCollection()
    fileTreeError.set(
      "[CliExecutionError] CLI command 'tree' failed: error: index corrupted: index format is incompatible or corrupted — run an unscoped `mdvdb ingest` to rebuild it"
    )

    render(FileTree)

    expect(screen.getByText('Rebuild the collection index')).toBeTruthy()
    expect(
      screen.getByText('The existing index can’t be read. Rebuild it from your Markdown files.')
    ).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }))
    await vi.waitFor(() => {
      expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: true })
    })
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

  it('does not show deleted files in the tree or file count', async () => {
    setActiveCollection()
    const treeWithDeleted = structuredClone(sampleTree)
    treeWithDeleted.root.children[0].children.push({
      name: 'removed-guide.md',
      path: 'docs/removed-guide.md',
      is_dir: false,
      state: 'deleted',
      children: []
    })
    treeWithDeleted.root.children.push({
      name: 'removed-root.md',
      path: 'removed-root.md',
      is_dir: false,
      state: 'deleted',
      children: []
    })
    treeWithDeleted.total_files = 5
    treeWithDeleted.deleted_count = 2
    fileTree.set(treeWithDeleted)
    expandedPaths.set(new Set(['docs']))

    render(FileTree)

    expect(screen.getByText('3 files')).toBeTruthy()
    expect(screen.queryByText('removed-root.md')).toBeNull()
    expect(screen.queryByText('removed-guide.md')).toBeNull()
    expect(screen.getByText('guide.md')).toBeTruthy()
  })

  it('shows the empty state when the tree only contains deleted files', () => {
    setActiveCollection()
    fileTree.set({
      root: {
        name: '.',
        path: '.',
        is_dir: true,
        state: null,
        children: [
          {
            name: 'removed.md',
            path: 'removed.md',
            is_dir: false,
            state: 'deleted',
            children: []
          }
        ]
      },
      total_files: 1,
      indexed_count: 0,
      modified_count: 0,
      new_count: 0,
      deleted_count: 1
    })

    render(FileTree)

    expect(screen.getByText('0 files')).toBeTruthy()
    expect(screen.getByText('No markdown files found')).toBeTruthy()
    expect(screen.queryByText('removed.md')).toBeNull()
  })

  it('marks configured Shard folders without marking ordinary folders', () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    shardsByCollection.set({
      '1': [
        {
          id: 'docs',
          name: 'Docs',
          path: 'docs',
          parent_id: null,
          exists: true
        }
      ]
    })

    const { container } = render(FileTree)

    const docsNode = screen.getByText('docs').closest('.tree-node')
    expect(
      docsNode?.querySelector('.shard-indicator [data-shard-icon="faceted-gem-outline"]')
    ).toBeTruthy()
    expect(container.querySelectorAll('.shard-indicator')).toHaveLength(1)
  })

  it('opens a Shard from its icon and navigates back to the main collection', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    shardsByCollection.set({
      '1': [
        {
          id: 'docs',
          name: 'Docs',
          path: 'docs',
          parent_id: null,
          exists: true
        }
      ]
    })
    const onfolderopen = vi.fn()

    render(FileTree, { props: { onfolderopen } })

    expect(screen.queryByRole('button', { name: 'Back to Test collection' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Open docs Shard' }))

    await vi.waitFor(() => {
      expect(get(activeShardId)).toBe('docs')
      expect(mockApi.setActiveShardId).toHaveBeenCalledWith('1', 'docs')
    })
    expect(onfolderopen).not.toHaveBeenCalled()
    expect(screen.queryByText('docs')).toBeNull()
    expect(screen.getByText('guide.md')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Test collection' }))

    await vi.waitFor(() => {
      expect(get(activeShardId)).toBeNull()
      expect(mockApi.setActiveShardId).toHaveBeenLastCalledWith('1', null)
    })
    expect(screen.getByText('docs')).toBeTruthy()
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

  it('offers Shard creation for a folder without a Shard definition', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    const oncreateshard = vi.fn()

    render(FileTree, { props: { oncreateshard } })
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })

    await fireEvent.click(screen.getByRole('menuitem', { name: /Create Shard from Folder/ }))

    expect(oncreateshard).toHaveBeenCalledWith({ path: 'docs' })
  })

  it('hides Shard creation for a folder that is already a Shard', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    shardsByCollection.set({
      '1': [
        {
          id: 'docs',
          name: 'Docs',
          path: 'docs',
          parent_id: null,
          exists: true
        }
      ]
    })

    render(FileTree)
    const docsRow = screen.getByText('docs').closest('button')!
    await fireEvent.contextMenu(docsRow, { clientX: 20, clientY: 20 })

    expect(screen.queryByRole('menuitem', { name: /Create Shard from Folder/ })).toBeNull()
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

  it('opens the active Shard from the background as a recursive table', async () => {
    setActiveCollection()
    fileTree.set(sampleTree)
    shardsByCollection.set({
      '1': [
        {
          id: 'docs',
          name: 'Docs',
          path: 'docs',
          parent_id: null,
          exists: true
        }
      ]
    })
    activeShardId.set('docs')
    const onfolderopen = vi.fn()

    const { container } = render(FileTree, { props: { onfolderopen } })
    const content = container.querySelector<HTMLElement>('.file-tree-content')!
    await fireEvent.contextMenu(content, { clientX: 24, clientY: 40 })
    await fireEvent.click(screen.getByRole('menuitem', { name: /Open Shard as Table/ }))

    expect(onfolderopen).toHaveBeenCalledWith({ path: 'docs', recursive: true })
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
      expect(mockApi.graphData).toHaveBeenCalledWith('/test', 'document', 'docs', undefined)
    })
    expect(get(graphViewActive)).toBe(true)
    expect(get(graphPathFilter)).toBe('docs')
    expect(workspace.focusedTab).toMatchObject({ kind: 'graph', graphPathFilter: 'docs' })
    expect(get(graphData)).toEqual(scopedGraphData)
  })

  describe('external file drops', () => {
    function externalTransfer(files: File[]): DataTransfer {
      return {
        types: ['Files'],
        files,
        dropEffect: 'none',
        getData: () => ''
      } as unknown as DataTransfer
    }

    function internalTransfer(files: File[] = []): DataTransfer {
      return {
        types: ['text/plain', 'application/x-mdvdb-path', 'Files'],
        files,
        dropEffect: 'none',
        getData: (type: string) =>
          type === 'application/x-mdvdb-path' ? 'docs/guide.md' : '[[guide]]'
      } as unknown as DataTransfer
    }

    function emptyAssetTree() {
      assetTree.set({
        root: { name: '', path: '', is_dir: true, children: [] },
        totalAssets: 0,
        scanDurationMs: 0
      })
    }

    it('shows a copy affordance and cancellation performs no import', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      mockApi.showConfirmation.mockResolvedValue(false)
      const note = new File(['# Outside'], 'outside.md', { type: 'text/markdown' })
      const transfer = externalTransfer([note])

      const { container } = render(FileTree)
      const content = container.querySelector<HTMLElement>('.file-tree-content')!
      const bubbledDrop = vi.fn()
      container.addEventListener('drop', bubbledDrop)

      await fireEvent.dragOver(content, { dataTransfer: transfer })
      expect(content.classList.contains('external-file-drag')).toBe(true)
      expect(screen.getByText('Copy to the collection root')).toBeTruthy()
      expect(transfer.dropEffect).toBe('copy')

      await fireEvent.drop(content, { dataTransfer: transfer })
      await vi.waitFor(() => expect(mockApi.showConfirmation).toHaveBeenCalledTimes(1))

      expect(mockApi.showConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Copy “outside.md” into the collection root?',
          confirmLabel: 'Copy File',
          cancelLabel: 'Cancel'
        })
      )
      expect(mockApi.importDroppedFiles).not.toHaveBeenCalled()
      expect(bubbledDrop).not.toHaveBeenCalled()
      expect(content.classList.contains('external-file-drag')).toBe(false)
    })

    it('confirms before importing a background drop into the collection root', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      const note = new File(['# Outside'], 'outside.md', { type: 'text/markdown' })
      const calls: string[] = []
      mockApi.showConfirmation.mockImplementation(async () => {
        calls.push('confirm')
        expect(mockApi.importDroppedFiles).not.toHaveBeenCalled()
        return true
      })
      mockApi.importDroppedFiles.mockImplementation(async () => {
        calls.push('import')
        return []
      })

      const { container } = render(FileTree)
      const content = container.querySelector<HTMLElement>('.file-tree-content')!
      await fireEvent.drop(content, { dataTransfer: externalTransfer([note]) })

      await vi.waitFor(() => expect(mockApi.importDroppedFiles).toHaveBeenCalledTimes(1))
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([note], '1', '')
      expect(calls).toEqual(['confirm', 'import'])
    })

    it('copies multiple files into a dropped-on folder with one prompt', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      const note = new File(['# Outside'], 'outside.md', { type: 'text/markdown' })
      const image = new File(['image'], 'photo.png', { type: 'image/png' })

      render(FileTree)
      const folderRow = screen.getByText('docs').closest('button')!
      await fireEvent.drop(folderRow, { dataTransfer: externalTransfer([note, image]) })

      await vi.waitFor(() => expect(mockApi.importDroppedFiles).toHaveBeenCalledTimes(1))
      expect(mockApi.showConfirmation).toHaveBeenCalledTimes(1)
      expect(mockApi.showConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Copy 2 files into “docs”?', confirmLabel: 'Copy Files' })
      )
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([note, image], '1', 'docs')
    })

    it('uses the containing directory when files are dropped on a file row', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      expandedPaths.set(new Set(['docs']))
      const image = new File(['image'], 'photo.png', { type: 'image/png' })

      render(FileTree)
      const fileRow = await screen.findByText('guide.md')
      await fireEvent.drop(fileRow, { dataTransfer: externalTransfer([image]) })

      await vi.waitFor(() => expect(mockApi.importDroppedFiles).toHaveBeenCalledTimes(1))
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([image], '1', 'docs')
    })

    it('ignores internal file-tree payloads even if a Files type is present', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      const file = new File(['# Existing'], 'guide.md', { type: 'text/markdown' })
      const transfer = internalTransfer([file])

      const { container } = render(FileTree)
      const content = container.querySelector<HTMLElement>('.file-tree-content')!
      await fireEvent.dragOver(content, { dataTransfer: transfer })
      await fireEvent.drop(content, { dataTransfer: transfer })

      expect(content.classList.contains('external-file-drag')).toBe(false)
      expect(mockApi.showConfirmation).not.toHaveBeenCalled()
      expect(mockApi.importDroppedFiles).not.toHaveBeenCalled()
    })

    it('patches Markdown, media, and generic asset results into the trees', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      emptyAssetTree()
      const note = new File(['# Imported'], 'imported.md', { type: 'text/markdown' })
      const image = new File(['image'], 'photo.png', { type: 'image/png' })
      const archive = new File(['data'], 'bundle.zip', { type: 'application/zip' })
      mockApi.importDroppedFiles.mockResolvedValue([
        {
          sourceName: 'imported.md',
          relativePath: 'imported.md',
          size: 10,
          kind: 'markdown',
          mimeCategory: 'other'
        },
        {
          sourceName: 'photo.png',
          relativePath: 'photo.png',
          size: 20,
          kind: 'asset',
          mimeCategory: 'image'
        },
        {
          sourceName: 'bundle.zip',
          relativePath: 'bundle.zip',
          size: 30,
          kind: 'other',
          mimeCategory: 'other'
        }
      ])

      const { container } = render(FileTree)
      await fireEvent.drop(container.querySelector('.file-tree-content')!, {
        dataTransfer: externalTransfer([note, image, archive])
      })

      await vi.waitFor(() => {
        expect(get(fileTree)?.root.children.some((node) => node.path === 'imported.md')).toBe(true)
        expect(get(assetTree)?.root.children.some((node) => node.path === 'photo.png')).toBe(true)
        expect(get(assetTree)?.root.children.some((node) => node.path === 'bundle.zip')).toBe(true)
      })
      expect(get(fileTree)?.root.children.find((node) => node.path === 'imported.md')?.state).toBe(
        'new'
      )
      expect(get(assetTree)?.root.children.find((node) => node.path === 'photo.png')).toMatchObject(
        {
          mimeCategory: 'image',
          fileSize: 20
        }
      )
      expect(
        get(assetTree)?.root.children.find((node) => node.path === 'bundle.zip')
      ).toMatchObject({
        mimeCategory: 'other',
        fileSize: 30
      })
    })

    it('surfaces import failures through the native message dialog', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      const note = new File(['# Outside'], 'outside.md', { type: 'text/markdown' })
      mockApi.importDroppedFiles.mockRejectedValue(new Error('Destination is no longer available'))

      const { container } = render(FileTree)
      await fireEvent.drop(container.querySelector('.file-tree-content')!, {
        dataTransfer: externalTransfer([note])
      })

      await vi.waitFor(() => {
        expect(mockApi.showMessage).toHaveBeenCalledWith({
          title: 'Copy to Collection Failed',
          message: 'Destination is no longer available',
          type: 'error'
        })
      })
    })

    it('does not patch the active tree if the collection changes while importing', async () => {
      setActiveCollection()
      fileTree.set(structuredClone(sampleTree))
      const note = new File(['# Outside'], 'outside.md', { type: 'text/markdown' })
      let finishImport!: (value: unknown[]) => void
      mockApi.importDroppedFiles.mockReturnValue(
        new Promise((resolve) => {
          finishImport = resolve
        })
      )

      const { container } = render(FileTree)
      await fireEvent.drop(container.querySelector('.file-tree-content')!, {
        dataTransfer: externalTransfer([note])
      })
      await vi.waitFor(() => expect(mockApi.importDroppedFiles).toHaveBeenCalledTimes(1))

      collections.set([{ id: '2', name: 'Other', path: '/other', addedAt: 2, lastOpenedAt: 2 }])
      activeCollectionId.set('2')
      fileTree.set(structuredClone(sampleTree))
      finishImport([
        {
          sourceName: 'outside.md',
          relativePath: 'outside.md',
          size: 10,
          kind: 'markdown',
          mimeCategory: 'other'
        }
      ])

      await Promise.resolve()
      await Promise.resolve()
      expect(get(fileTree)?.root.children.some((node) => node.path === 'outside.md')).toBe(false)
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([note], '1', '')
    })
  })
})
