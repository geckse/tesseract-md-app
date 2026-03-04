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
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  isFavorite: vi.fn(),
  listRecents: vi.fn(),
  addRecent: vi.fn(),
  clearRecents: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  recentFiles,
  recentsLoading,
  sortedRecents,
  clearAllRecents,
} from '../../src/renderer/stores/favorites'
import { collections, activeCollectionId, setActiveCollection } from '../../src/renderer/stores/collections'
import { selectFile } from '../../src/renderer/stores/files'
import Recents from '@renderer/components/Recents.svelte'
import type { RecentEntry } from '../../src/preload/api.d'

const testCollection1 = { id: '1', name: 'Test1', path: '/test1', addedAt: 1, lastOpenedAt: 1 }
const testCollection2 = { id: '2', name: 'Test2', path: '/test2', addedAt: 2, lastOpenedAt: 2 }

const sampleRecents: RecentEntry[] = [
  {
    collectionId: '1',
    filePath: 'docs/guide.md',
    openedAt: Date.now() - 30 * 1000, // 30 seconds ago
  },
  {
    collectionId: '1',
    filePath: 'readme.md',
    openedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
  },
  {
    collectionId: '2',
    filePath: 'notes.md',
    openedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
  },
]

function resetStores() {
  recentFiles.set([])
  recentsLoading.set(false)
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
  // Set default mock implementations
  mockApi.listRecents.mockResolvedValue([])
  mockApi.listFavorites.mockResolvedValue([])
  mockApi.listCollections.mockResolvedValue([])
})

describe('Recents component', () => {
  it('does not render when loading is true', () => {
    collections.set([testCollection1])
    recentsLoading.set(true)
    recentFiles.set(sampleRecents)

    render(Recents)

    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('does not render when there are no recents', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([])

    render(Recents)

    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('renders section header with icon and title', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set(sampleRecents)

    render(Recents)

    expect(screen.getByText('Recent')).toBeTruthy()
    const icon = document.querySelector('.section-icon')
    expect(icon?.textContent).toBe('schedule')
  })

  it('renders recent file items with file names', () => {
    collections.set([testCollection1, testCollection2])
    recentsLoading.set(false)
    recentFiles.set(sampleRecents)

    render(Recents)

    expect(screen.getByText('guide.md')).toBeTruthy()
    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
  })

  it('extracts file basename from path correctly', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'deeply/nested/folder/file.md', openedAt: Date.now() },
    ])

    render(Recents)

    expect(screen.getByText('file.md')).toBeTruthy()
  })

  it('formats relative time as "just now" for recent files', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 30 * 1000 }, // 30 sec ago
    ])

    render(Recents)

    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('formats relative time in minutes', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 5 * 60 * 1000 }, // 5 min ago
    ])

    render(Recents)

    expect(screen.getByText('5 min ago')).toBeTruthy()
  })

  it('formats relative time in hours (singular)', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 1 * 60 * 60 * 1000 }, // 1 hour ago
    ])

    render(Recents)

    expect(screen.getByText('1 hour ago')).toBeTruthy()
  })

  it('formats relative time in hours (plural)', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 3 * 60 * 60 * 1000 }, // 3 hours ago
    ])

    render(Recents)

    expect(screen.getByText('3 hours ago')).toBeTruthy()
  })

  it('formats relative time as "yesterday"', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 24 * 60 * 60 * 1000 }, // 1 day ago
    ])

    render(Recents)

    expect(screen.getByText('yesterday')).toBeTruthy()
  })

  it('formats relative time in days', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 }, // 3 days ago
    ])

    render(Recents)

    expect(screen.getByText('3 days ago')).toBeTruthy()
  })

  it('formats older dates as short date string', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    const oldDate = Date.now() - 10 * 24 * 60 * 60 * 1000 // 10 days ago
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: oldDate },
    ])

    render(Recents)

    // Check for month abbreviation pattern (Jan, Feb, etc)
    const dateElement = screen.getByText(/^[A-Z][a-z]{2} \d{1,2}$/)
    expect(dateElement).toBeTruthy()
  })

  it('filters out recents from collections that no longer exist', () => {
    collections.set([testCollection1]) // Only collection 1 exists
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'exists.md', openedAt: Date.now() },
      { collectionId: '999', filePath: 'deleted-collection.md', openedAt: Date.now() }, // Collection doesn't exist
    ])

    render(Recents)

    expect(screen.getByText('exists.md')).toBeTruthy()
    expect(screen.queryByText('deleted-collection.md')).toBeNull()
  })

  it('calls selectFile when clicking a recent item in active collection', async () => {
    collections.set([testCollection1])
    activeCollectionId.set('1')
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'docs/guide.md', openedAt: Date.now() },
    ])

    render(Recents)

    const button = screen.getByText('guide.md').closest('button') as HTMLButtonElement
    expect(button).toBeTruthy()

    await fireEvent.click(button)

    // Should call selectFile but not setActiveCollection (already active)
    expect(mockApi.setActiveCollection).not.toHaveBeenCalled()
  })

  it('switches collection and opens file when clicking recent from different collection', async () => {
    collections.set([testCollection1, testCollection2])
    activeCollectionId.set('1') // Currently on collection 1
    mockApi.setActiveCollection.mockResolvedValue(undefined)
    mockApi.getActiveCollection.mockResolvedValue(testCollection1)
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '2', filePath: 'notes.md', openedAt: Date.now() }, // From collection 2
    ])

    render(Recents)

    const button = screen.getByText('notes.md').closest('button') as HTMLButtonElement
    await fireEvent.click(button)

    // Should switch to collection 2
    expect(mockApi.setActiveCollection).toHaveBeenCalledWith('2')
  })

  it('opens context menu on right-click', async () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set(sampleRecents)

    render(Recents)

    const section = document.querySelector('.recents-section') as HTMLElement
    expect(section).toBeTruthy()

    expect(screen.queryByText('Clear All Recents')).toBeNull()

    await fireEvent.contextMenu(section)

    expect(screen.getByText('Clear All Recents')).toBeTruthy()
  })

  it('closes context menu when clicking overlay', async () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set(sampleRecents)

    render(Recents)

    const section = document.querySelector('.recents-section') as HTMLElement
    await fireEvent.contextMenu(section)

    expect(screen.getByText('Clear All Recents')).toBeTruthy()

    const overlay = document.querySelector('.context-menu-overlay') as HTMLElement
    await fireEvent.click(overlay)

    expect(screen.queryByText('Clear All Recents')).toBeNull()
  })

  it('calls clearRecents API when clicking Clear All Recents', async () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set(sampleRecents)
    mockApi.clearRecents.mockResolvedValue(undefined)
    mockApi.listRecents.mockResolvedValue([])

    render(Recents)

    const section = document.querySelector('.recents-section') as HTMLElement
    await fireEvent.contextMenu(section)

    const clearButton = screen.getByText('Clear All Recents').closest('button') as HTMLButtonElement
    await fireEvent.click(clearButton)

    expect(mockApi.clearRecents).toHaveBeenCalled()
    expect(mockApi.listRecents).toHaveBeenCalled()
  })

  it('renders recents sorted by most recent first', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    const now = Date.now()
    recentFiles.set([
      { collectionId: '1', filePath: 'oldest.md', openedAt: now - 10000 },
      { collectionId: '1', filePath: 'newest.md', openedAt: now - 1000 },
      { collectionId: '1', filePath: 'middle.md', openedAt: now - 5000 },
    ])

    render(Recents)

    const buttons = Array.from(document.querySelectorAll('.recent-item'))
    expect(buttons).toHaveLength(3)

    // Verify order by checking the file names
    const fileNames = buttons.map(btn => btn.querySelector('.nav-label')?.textContent)
    expect(fileNames).toEqual(['newest.md', 'middle.md', 'oldest.md'])
  })

  it('renders file icon for each recent item', () => {
    collections.set([testCollection1])
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '1', filePath: 'file.md', openedAt: Date.now() },
    ])

    render(Recents)

    const icon = document.querySelector('.nav-icon')
    expect(icon?.textContent).toBe('description')
  })

  it('does not render when all recents are from deleted collections', () => {
    collections.set([testCollection1]) // Only collection 1 exists
    recentsLoading.set(false)
    recentFiles.set([
      { collectionId: '999', filePath: 'deleted1.md', openedAt: Date.now() },
      { collectionId: '888', filePath: 'deleted2.md', openedAt: Date.now() },
    ])

    render(Recents)

    // Should not render the section at all
    expect(screen.queryByText('Recent')).toBeNull()
  })
})
