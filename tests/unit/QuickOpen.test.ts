import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import type { FileTreeNode } from '@renderer/types/cli'

// Mock functions that can be accessed in tests
const mockSelectFile = vi.fn()
const mockCloseQuickOpen = vi.fn()

// Mock the stores module with factory functions
vi.mock('@renderer/stores/quickopen', () => {
  let currentValue = false
  const subscribers = new Set<(value: boolean) => void>()

  return {
    quickOpenModalOpen: {
      subscribe: (callback: (value: boolean) => void) => {
        subscribers.add(callback)
        callback(currentValue)
        return () => subscribers.delete(callback)
      },
      set: (value: boolean) => {
        currentValue = value
        subscribers.forEach(cb => cb(value))
      }
    },
    openQuickOpen: vi.fn(() => {
      currentValue = true
      subscribers.forEach(cb => cb(true))
    }),
    closeQuickOpen: () => {
      mockCloseQuickOpen()
      currentValue = false
      subscribers.forEach(cb => cb(false))
    }
  }
})

vi.mock('@renderer/stores/files', () => {
  let currentFiles: FileTreeNode[] = []
  const subscribers = new Set<(value: FileTreeNode[]) => void>()

  return {
    flatFileList: {
      subscribe: (callback: (value: FileTreeNode[]) => void) => {
        subscribers.add(callback)
        callback(currentFiles)
        return () => subscribers.delete(callback)
      },
      set: (value: FileTreeNode[]) => {
        currentFiles = value
        subscribers.forEach(cb => cb(value))
      }
    },
    selectFile: (path: string) => mockSelectFile(path)
  }
})

// Import after mocking
import QuickOpen from '@renderer/components/QuickOpen.svelte'
import { quickOpenModalOpen } from '@renderer/stores/quickopen'
import { flatFileList } from '@renderer/stores/files'

describe('QuickOpen component', () => {
  let mockFiles: FileTreeNode[]

  beforeEach(() => {
    mockFiles = [
      { path: 'readme.md', is_dir: false, children: [], state: 'indexed' },
      { path: 'docs/api.md', is_dir: false, children: [], state: 'modified' },
      { path: 'src/index.ts', is_dir: false, children: [], state: 'new' },
      { path: 'tests/unit.test.ts', is_dir: false, children: [] }
    ]

    // Reset stores
    vi.mocked(quickOpenModalOpen).set(false)
    vi.mocked(flatFileList).set(mockFiles)
    mockSelectFile.mockClear()
    mockCloseQuickOpen.mockClear()
  })

  it('does not render when modal is closed', () => {
    vi.mocked(quickOpenModalOpen).set(false)
    render(QuickOpen)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders when modal is open', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search files...')).toBeTruthy()
  })

  it('displays file list when query is empty', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByText('docs/api.md')).toBeTruthy()
  })

  it('limits results to 50 items when query is empty', () => {
    const manyFiles: FileTreeNode[] = Array.from({ length: 100 }, (_, i) => ({
      path: `file-${i}.md`,
      is_dir: false,
      children: []
    }))

    vi.mocked(flatFileList).set(manyFiles)
    vi.mocked(quickOpenModalOpen).set(true)

    render(QuickOpen)

    // Should only render first 50
    expect(screen.getByText('file-0.md')).toBeTruthy()
    expect(screen.getByText('file-49.md')).toBeTruthy()
    expect(screen.queryByText('file-50.md')).toBeNull()
  })

  it('displays file state badges', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    expect(screen.getByText('indexed')).toBeTruthy()
    expect(screen.getByText('modified')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
  })

  it('renders search input', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const input = screen.getByPlaceholderText('Search files...')
    expect(input).toBeTruthy()
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('autocomplete')).toBe('off')
  })

  it('renders modal backdrop', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const backdrop = document.querySelector('.modal-backdrop')
    expect(backdrop).toBeTruthy()
  })

  it('renders modal content', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const content = document.querySelector('.modal-content')
    expect(content).toBeTruthy()
  })

  it('renders search icon', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const searchIcon = document.querySelector('.search-icon')
    expect(searchIcon).toBeTruthy()
    expect(searchIcon?.textContent).toContain('search')
  })

  it('renders results container', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const resultsContainer = document.querySelector('.results-container')
    expect(resultsContainer).toBeTruthy()
  })

  it('renders results list with files', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const resultsList = document.querySelector('.results-list')
    expect(resultsList).toBeTruthy()

    const resultItems = document.querySelectorAll('.result-item')
    expect(resultItems.length).toBeGreaterThan(0)
  })

  it('renders file paths in results', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const filePaths = document.querySelectorAll('.file-path')
    expect(filePaths.length).toBeGreaterThan(0)
  })

  it('renders footer with keyboard hints', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const footer = document.querySelector('.footer')
    expect(footer).toBeTruthy()

    expect(screen.getByText('Navigate')).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })

  it('renders kbd elements for shortcuts', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const kbdElements = document.querySelectorAll('kbd')
    expect(kbdElements.length).toBeGreaterThan(0)
  })

  it('first result item has selected class by default', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const firstItem = document.querySelector('.result-item')
    expect(firstItem?.classList.contains('selected')).toBe(true)
  })

  it('renders file icons', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const fileIcons = document.querySelectorAll('.file-icon')
    expect(fileIcons.length).toBeGreaterThan(0)
  })

  it('shows no results message when file list is empty', () => {
    vi.mocked(flatFileList).set([])
    vi.mocked(quickOpenModalOpen).set(true)

    render(QuickOpen)

    expect(screen.getByText('No files found')).toBeTruthy()
  })

  it('renders state badges with correct classes', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const indexedBadge = document.querySelector('.state-indexed')
    const modifiedBadge = document.querySelector('.state-modified')
    const newBadge = document.querySelector('.state-new')

    expect(indexedBadge).toBeTruthy()
    expect(modifiedBadge).toBeTruthy()
    expect(newBadge).toBeTruthy()
  })

  it('renders search box with icon', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const searchBox = document.querySelector('.search-box')
    expect(searchBox).toBeTruthy()

    const icon = searchBox?.querySelector('.material-symbols-outlined')
    expect(icon).toBeTruthy()
  })

  it('applies correct ARIA attributes to modal', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Quick Open')
  })

  it('applies correct classes to modal elements', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    expect(document.querySelector('.modal-backdrop')).toBeTruthy()
    expect(document.querySelector('.modal-content')).toBeTruthy()
    expect(document.querySelector('.search-box')).toBeTruthy()
    expect(document.querySelector('.results-container')).toBeTruthy()
    expect(document.querySelector('.footer')).toBeTruthy()
  })

  it('renders hints section in footer', () => {
    vi.mocked(quickOpenModalOpen).set(true)
    render(QuickOpen)

    const hints = document.querySelector('.hints')
    expect(hints).toBeTruthy()

    const hintElements = hints?.querySelectorAll('.hint')
    expect(hintElements?.length).toBeGreaterThan(0)
  })
})
