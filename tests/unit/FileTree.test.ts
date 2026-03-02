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
import { activeCollection } from '../../src/renderer/stores/collections'
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

function resetStores() {
  fileTree.set(null)
  fileTreeLoading.set(false)
  fileTreeError.set(null)
  activeCollection.set(null)
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
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTreeLoading.set(true)

    render(FileTree)

    expect(screen.getByText('Loading files...')).toBeTruthy()
  })

  it('shows error state with retry button', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTreeError.set('Something went wrong')

    render(FileTree)

    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('shows empty files state when tree has no children', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
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

    expect(screen.getByTitle('Collapse All')).toBeTruthy()
    expect(screen.getByTitle('Expand All')).toBeTruthy()
    expect(screen.getByTitle('Refresh')).toBeTruthy()
  })

  it('disables refresh button when loading', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTreeLoading.set(true)

    render(FileTree)

    const refreshBtn = screen.getByTitle('Refresh')
    expect(refreshBtn).toBeDisabled()
  })

  it('shows file count summary when tree is loaded', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('shows modified count in summary', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('1 modified')).toBeTruthy()
  })

  it('shows new count in summary', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('1 new')).toBeTruthy()
  })

  it('renders tree nodes when data is available', () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTree.set(sampleTree)

    render(FileTree)

    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByText('new-file.md')).toBeTruthy()
  })

  it('calls loadFileTree on retry click', async () => {
    activeCollection.set({ id: '1', name: 'Test', path: '/test' })
    fileTreeError.set('Failed to load')
    mockApi.tree.mockResolvedValue(sampleTree)

    render(FileTree)

    await fireEvent.click(screen.getByText('Retry'))

    expect(mockApi.tree).toHaveBeenCalledWith('/test', undefined)
  })
})
