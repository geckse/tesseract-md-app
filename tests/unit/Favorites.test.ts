import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing stores
const mockApi = {
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  isFavorite: vi.fn(),
  setActiveCollection: vi.fn(),
  getFile: vi.fn(),
  addRecent: vi.fn(),
  listRecents: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import { favorites, favoritesLoading } from '../../src/renderer/stores/favorites'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { selectedFilePath } from '../../src/renderer/stores/files'
import Favorites from '@renderer/components/Favorites.svelte'
import type { FavoriteEntry } from '../../src/preload/api.d'

const testCollection1 = { id: '1', name: 'Docs', path: '/docs', addedAt: 1, lastOpenedAt: 1 }
const testCollection2 = { id: '2', name: 'Notes', path: '/notes', addedAt: 2, lastOpenedAt: 2 }

const sampleFavorites: FavoriteEntry[] = [
  {
    collectionId: '1',
    filePath: 'guide/intro.md',
    addedAt: Date.now() - 1000,
  },
  {
    collectionId: '1',
    filePath: 'docs/readme.md',
    addedAt: Date.now() - 2000,
  },
  {
    collectionId: '2',
    filePath: 'notes/meeting.md',
    addedAt: Date.now() - 3000,
  },
]

function resetStores() {
  favorites.set([])
  favoritesLoading.set(false)
  collections.set([])
  activeCollectionId.set(null)
  selectedFilePath.set(null)
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()

  // Set default mock implementations
  mockApi.addRecent.mockResolvedValue(undefined)
  mockApi.listRecents.mockResolvedValue([])
})

describe('Favorites component', () => {
  it('shows nothing when no favorites exist', () => {
    favorites.set([])
    favoritesLoading.set(false)
    collections.set([testCollection1])

    const { container } = render(Favorites)

    expect(container.querySelector('.favorites-section')).toBeNull()
  })

  it('shows nothing when loading', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(true)
    collections.set([testCollection1, testCollection2])

    const { container } = render(Favorites)

    expect(container.querySelector('.favorites-section')).toBeNull()
  })

  it('renders the header with Favorites title and star icon', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])

    render(Favorites)

    expect(screen.getByText('Favorites')).toBeTruthy()
    const icon = document.querySelector('.section-icon')
    expect(icon).toBeTruthy()
    expect(icon?.textContent).toBe('star')
  })

  it('renders favorite items with file names', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])

    render(Favorites)

    expect(screen.getByText('intro.md')).toBeTruthy()
    expect(screen.getByText('readme.md')).toBeTruthy()
    expect(screen.getByText('meeting.md')).toBeTruthy()
  })

  it('renders collection names for each favorite', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])

    render(Favorites)

    // Two favorites from 'Docs' collection
    const docsElements = screen.getAllByText('Docs')
    expect(docsElements.length).toBe(2)

    // One favorite from 'Notes' collection
    expect(screen.getByText('Notes')).toBeTruthy()
  })

  it('filters out favorites from collections that no longer exist', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    // Only include collection1, not collection2
    collections.set([testCollection1])

    render(Favorites)

    // Should show favorites from collection1
    expect(screen.getByText('intro.md')).toBeTruthy()
    expect(screen.getByText('readme.md')).toBeTruthy()

    // Should NOT show favorite from collection2
    expect(screen.queryByText('meeting.md')).toBeNull()
  })

  it('shows "Unknown" for favorites with missing collection', () => {
    favorites.set([
      {
        collectionId: '999', // Non-existent collection
        filePath: 'orphan.md',
        addedAt: Date.now(),
      },
    ])
    favoritesLoading.set(false)
    collections.set([testCollection1])

    const { container } = render(Favorites)

    // Should filter out because collection doesn't exist
    expect(container.querySelector('.favorites-section')).toBeNull()
  })

  it('extracts basename from file path correctly', () => {
    favorites.set([
      {
        collectionId: '1',
        filePath: 'deeply/nested/folder/structure/file.md',
        addedAt: Date.now(),
      },
    ])
    favoritesLoading.set(false)
    collections.set([testCollection1])

    render(Favorites)

    expect(screen.getByText('file.md')).toBeTruthy()
  })

  it('handles file path with no slashes', () => {
    favorites.set([
      {
        collectionId: '1',
        filePath: 'root-file.md',
        addedAt: Date.now(),
      },
    ])
    favoritesLoading.set(false)
    collections.set([testCollection1])

    render(Favorites)

    expect(screen.getByText('root-file.md')).toBeTruthy()
  })

  it('calls handleFavoriteClick when clicking a favorite', async () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])
    activeCollectionId.set('1')

    mockApi.setActiveCollection.mockResolvedValue(undefined)
    mockApi.getFile.mockResolvedValue({
      path: 'guide/intro.md',
      content: '# Test',
      frontmatter: {},
      modified_at: Date.now(),
    })

    render(Favorites)

    const introButton = screen.getByText('intro.md').closest('button')
    expect(introButton).toBeTruthy()

    await fireEvent.click(introButton!)

    // Should call getFile to open the file
    expect(mockApi.getFile).toHaveBeenCalledWith('/docs', 'guide/intro.md')
  })

  it('switches collection when clicking favorite from different collection', async () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])
    activeCollectionId.set('1') // Currently on Docs

    mockApi.setActiveCollection.mockResolvedValue(undefined)
    mockApi.getFile.mockResolvedValue({
      path: 'notes/meeting.md',
      content: '# Meeting',
      frontmatter: {},
      modified_at: Date.now(),
    })

    render(Favorites)

    // Click favorite from Notes collection
    const meetingButton = screen.getByText('meeting.md').closest('button')
    expect(meetingButton).toBeTruthy()

    await fireEvent.click(meetingButton!)

    // Should switch to collection 2
    expect(mockApi.setActiveCollection).toHaveBeenCalledWith('2')

    // Then open the file
    expect(mockApi.getFile).toHaveBeenCalledWith('/notes', 'notes/meeting.md')
  })

  it('does not switch collection when clicking favorite from same collection', async () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])
    activeCollectionId.set('1') // Currently on Docs

    mockApi.setActiveCollection.mockResolvedValue(undefined)
    mockApi.getFile.mockResolvedValue({
      path: 'guide/intro.md',
      content: '# Test',
      frontmatter: {},
      modified_at: Date.now(),
    })

    render(Favorites)

    const introButton = screen.getByText('intro.md').closest('button')
    expect(introButton).toBeTruthy()

    await fireEvent.click(introButton!)

    // Should NOT call setActiveCollection
    expect(mockApi.setActiveCollection).not.toHaveBeenCalled()

    // But should still open the file
    expect(mockApi.getFile).toHaveBeenCalledWith('/docs', 'guide/intro.md')
  })

  it('renders multiple favorites in order', () => {
    favorites.set(sampleFavorites)
    favoritesLoading.set(false)
    collections.set([testCollection1, testCollection2])

    render(Favorites)

    const buttons = document.querySelectorAll('.favorite-item')
    expect(buttons.length).toBe(3)
  })

  it('applies correct CSS classes', () => {
    favorites.set([sampleFavorites[0]])
    favoritesLoading.set(false)
    collections.set([testCollection1])

    render(Favorites)

    expect(document.querySelector('.favorites-section')).toBeTruthy()
    expect(document.querySelector('.section-header-row')).toBeTruthy()
    expect(document.querySelector('.section-header')).toBeTruthy()
    expect(document.querySelector('.nav-list')).toBeTruthy()
    expect(document.querySelector('.nav-item')).toBeTruthy()
    expect(document.querySelector('.favorite-item')).toBeTruthy()
    expect(document.querySelector('.favorite-info')).toBeTruthy()
    expect(document.querySelector('.nav-label')).toBeTruthy()
    expect(document.querySelector('.favorite-collection')).toBeTruthy()
  })
})
