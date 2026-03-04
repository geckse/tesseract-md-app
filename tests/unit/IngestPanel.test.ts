import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const mockApi = {
  tree: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn().mockResolvedValue({}),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  search: vi.fn().mockResolvedValue({ results: [], query: '', total_results: 0 }),
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  getWatcherStatus: vi.fn().mockResolvedValue({ state: 'stopped' }),
  onWatcherEvent: vi.fn(),
  removeWatcherEventListener: vi.fn(),
  ingest: vi.fn().mockResolvedValue({ files_processed: 0, chunks_created: 0 }),
  ingestPreview: vi.fn().mockResolvedValue({ files: [], total_files: 0 }),
  cancelIngest: vi.fn(),
}

// Attach mockApi to existing window to preserve DOM methods (addEventListener etc.)
// needed because IngestPanel uses svelte:window
;(globalThis as any).window = Object.assign(globalThis.window ?? {}, { api: mockApi })

import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { ingestRunning, ingestState } from '../../src/renderer/stores/ingest'
import IngestPanel from '@renderer/components/IngestPanel.svelte'

function setActiveCollection(col: { id: string; name: string; path: string } | null) {
  if (col) {
    collections.set([col])
    activeCollectionId.set(col.id)
  } else {
    collections.set([])
    activeCollectionId.set(null)
  }
}

function resetStores() {
  setActiveCollection(null)
  ingestRunning.set(false)
  ingestState.set('idle')
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('IngestPanel component', () => {
  it('renders trigger button with "Ingest" label', () => {
    render(IngestPanel)
    expect(screen.getByText('Ingest', { selector: '.trigger-label' })).toBeTruthy()
  })

  it('renders bolt icon', () => {
    render(IngestPanel)
    expect(screen.getByText('bolt')).toBeTruthy()
  })

  it('trigger is visually disabled when no active collection', () => {
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')
    expect(trigger?.classList.contains('disabled')).toBe(true)
  })

  it('trigger is visually disabled when ingest is running', () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    ingestRunning.set(true)
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')
    expect(trigger?.classList.contains('disabled')).toBe(true)
  })

  it('trigger is not disabled when collection is active and not running', () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')
    expect(trigger?.classList.contains('disabled')).toBe(false)
  })

  it('dropdown is closed by default', () => {
    render(IngestPanel)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clicking trigger opens dropdown when enabled', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('dropdown does not open when disabled', async () => {
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('dropdown shows three menu items', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)

    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(3)
  })

  it('dropdown shows Ingest, Preview, and Full Reindex options', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)

    expect(screen.getByText('Index new & changed files')).toBeTruthy()
    expect(screen.getByText('Dry run — see what would change')).toBeTruthy()
    expect(screen.getByText('Re-embed all files from scratch')).toBeTruthy()
  })

  it('Escape key closes dropdown', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clicking Ingest menu item calls runIngest', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)

    const items = screen.getAllByRole('menuitem')
    await fireEvent.click(items[0]) // Ingest

    expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: false })
  })

  it('clicking Preview menu item calls ingestPreview', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)

    const items = screen.getAllByRole('menuitem')
    await fireEvent.click(items[1]) // Preview

    expect(mockApi.ingestPreview).toHaveBeenCalledWith('/test')
  })

  it('clicking Full Reindex calls runIngest with reindex=true', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    await fireEvent.click(trigger)

    const items = screen.getAllByRole('menuitem')
    await fireEvent.click(items[2]) // Full Reindex

    expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: true })
  })

  it('shows correct title when no collection', () => {
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    expect(trigger.getAttribute('title')).toBe('Select a collection first')
  })

  it('shows correct title when ingest is running', () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    ingestRunning.set(true)
    const { container } = render(IngestPanel)
    const trigger = container.querySelector('.ingest-trigger')!
    expect(trigger.getAttribute('title')).toBe('Ingest in progress...')
  })
})
