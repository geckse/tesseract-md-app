import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

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
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  fileTree,
  fileTreeLoading,
  fileTreeError,
} from '../../src/renderer/stores/files'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { ingestRunning } from '../../src/renderer/stores/ingest'
import FileTree from '@renderer/components/FileTree.svelte'
import type { FileTree as FileTreeType } from '../../src/renderer/types/cli'

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
            children: [],
          },
        ],
      },
      {
        name: 'readme.md',
        path: 'readme.md',
        is_dir: false,
        state: 'modified',
        children: [],
      },
      {
        name: 'new-file.md',
        path: 'new-file.md',
        is_dir: false,
        state: 'new',
        children: [],
      },
    ],
  },
  total_files: 3,
  indexed_count: 1,
  modified_count: 1,
  new_count: 1,
  deleted_count: 0,
}

const testCollection = { id: '1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

function setActiveCollection() {
  collections.set([testCollection])
  activeCollectionId.set('1')
}

function resetStores() {
  fileTree.set(null)
  fileTreeLoading.set(false)
  fileTreeError.set(null)
  collections.set([])
  activeCollectionId.set(null)
  ingestRunning.set(false)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
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
      deleted_count: 0,
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
      files_indexed: 0, files_skipped: 0, files_removed: 0,
      chunks_created: 0, api_calls: 0, files_failed: 0,
      errors: [], duration_secs: 0, cancelled: false,
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
      files_indexed: 0, files_skipped: 0, files_removed: 0,
      chunks_created: 0, api_calls: 0, files_failed: 0,
      errors: [], duration_secs: 0, cancelled: false,
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
})
