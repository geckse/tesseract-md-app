import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

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
  search: vi.fn().mockResolvedValue({ results: [], query: '', total_results: 0 }),
  startWatcher: vi.fn().mockResolvedValue(undefined),
  stopWatcher: vi.fn().mockResolvedValue(undefined),
  getWatcherStatus: vi.fn().mockResolvedValue({ state: 'stopped' }),
  onWatcherEvent: vi.fn(),
  removeWatcherEventListener: vi.fn(),
  ingest: vi.fn(),
  ingestPreview: vi.fn(),
  cancelIngest: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  watcherState,
  watcherError,
  watcherToggling,
} from '../../src/renderer/stores/watcher'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import WatcherToggle from '@renderer/components/WatcherToggle.svelte'

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
  watcherState.set('stopped')
  watcherError.set(null)
  watcherToggling.set(false)
  setActiveCollection(null)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('WatcherToggle component', () => {
  it('renders with "Watch" label when stopped', () => {
    render(WatcherToggle)
    expect(screen.getByText('Watch')).toBeTruthy()
  })

  it('renders with "Watching" label when running', () => {
    watcherState.set('running')
    render(WatcherToggle)
    expect(screen.getByText('Watching')).toBeTruthy()
  })

  it('renders with "Starting..." label when starting', () => {
    watcherState.set('starting')
    render(WatcherToggle)
    expect(screen.getByText('Starting...')).toBeTruthy()
  })

  it('renders with "Watch Error" label when in error state', () => {
    watcherState.set('error')
    render(WatcherToggle)
    expect(screen.getByText('Watch Error')).toBeTruthy()
  })

  it('button is disabled when toggling', () => {
    watcherToggling.set(true)
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('button is disabled when starting', () => {
    watcherState.set('starting')
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('button is enabled when stopped and not toggling', () => {
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('shows error message in title when error exists', () => {
    watcherError.set('Connection failed')
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('title')).toBe('Connection failed')
  })

  it('shows state in title when no error', () => {
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('title')).toBe('Watcher: stopped')
  })

  it('calls toggleWatcher on click when not toggling', async () => {
    setActiveCollection({ id: 'test', name: 'test', path: '/test' })
    render(WatcherToggle)
    const btn = screen.getByRole('button')
    await fireEvent.click(btn)
    // startWatcher should be called since state is 'stopped'
    expect(mockApi.startWatcher).toHaveBeenCalledWith('/test')
  })

  it('has dot indicator element', () => {
    const { container } = render(WatcherToggle)
    const dot = container.querySelector('.watcher-dot')
    expect(dot).toBeTruthy()
  })
})
