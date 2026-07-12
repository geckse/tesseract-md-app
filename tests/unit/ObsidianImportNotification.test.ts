/**
 * Component tests for the Obsidian topic sync banner (phase 44).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const mockApi = {
  onObsidianTopicsSynced: vi.fn(),
  clusterDefinitions: vi.fn().mockResolvedValue([]),
  customClusters: vi.fn().mockResolvedValue([]),
  topicUnassigned: vi.fn().mockResolvedValue(null)
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

// Mock the ingest store — runIngest drives the real CLI otherwise
const mockRunIngest = vi.fn().mockResolvedValue(undefined)
vi.mock('@renderer/stores/ingest', () => ({
  runIngest: (...args: unknown[]) => mockRunIngest(...args)
}))

import ObsidianImportNotification from '@renderer/components/ObsidianImportNotification.svelte'
import { obsidianImportNotice } from '@renderer/stores/obsidian-import'
import { activeCollectionId } from '@renderer/stores/collections'
import { topicsNeedIngest } from '@renderer/stores/topics'
import { get } from 'svelte/store'

const IMPORT_EVENT = {
  collectionId: 'col-1',
  root: '/vault',
  added: ['rag', 'ai', 'ops', 'notes', 'extra', 'more'],
  updated: [],
  removed: []
}

const SYNC_EVENT = {
  collectionId: 'col-1',
  root: '/vault',
  added: ['fresh'],
  updated: ['rag'],
  removed: ['stale']
}

beforeEach(() => {
  vi.clearAllMocks()
  obsidianImportNotice.set(null)
  activeCollectionId.set(null)
  topicsNeedIngest.set(false)
})

describe('ObsidianImportNotification', () => {
  it('renders nothing without a notice', () => {
    render(ObsidianImportNotification)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('phrases a first import with count and truncated topic list', () => {
    obsidianImportNotice.set(IMPORT_EVENT)
    render(ObsidianImportNotification)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Imported 6')
    expect(banner.textContent).toContain('topics from your Obsidian vault')
    expect(banner.textContent).toContain('rag, ai, ops, notes +2 more')
  })

  it('uses the singular form for one imported topic', () => {
    obsidianImportNotice.set({ ...IMPORT_EVENT, added: ['solo'] })
    render(ObsidianImportNotification)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Imported 1')
    expect(banner.textContent).toContain('topic from your Obsidian vault')
  })

  it('phrases a later sync as an added/updated/removed summary', () => {
    obsidianImportNotice.set(SYNC_EVENT)
    render(ObsidianImportNotification)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Obsidian topics synced')
    expect(banner.textContent).toContain('1 added · 1 updated · 1 removed')
    expect(banner.textContent).toContain('fresh, rag')
  })

  it('dismisses on the close button', async () => {
    obsidianImportNotice.set(IMPORT_EVENT)
    render(ObsidianImportNotification)
    await fireEvent.click(screen.getByLabelText('Dismiss Obsidian topic import notification'))
    expect(get(obsidianImportNotice)).toBeNull()
  })

  it('only offers Sync now for the active collection', () => {
    obsidianImportNotice.set(IMPORT_EVENT)
    activeCollectionId.set('other-collection')
    render(ObsidianImportNotification)
    expect(screen.queryByText('Sync now')).toBeNull()
  })

  it('runs an ingest, clears the re-ingest flag, and dismisses on Sync now', async () => {
    obsidianImportNotice.set(IMPORT_EVENT)
    activeCollectionId.set('col-1')
    topicsNeedIngest.set(true)
    render(ObsidianImportNotification)

    await fireEvent.click(screen.getByText('Sync now'))
    // allow the async click handler to settle
    await vi.waitFor(() => expect(get(obsidianImportNotice)).toBeNull())
    expect(mockRunIngest).toHaveBeenCalledTimes(1)
    expect(get(topicsNeedIngest)).toBe(false)
  })

  it('keeps the notice when the ingest fails', async () => {
    mockRunIngest.mockRejectedValueOnce(new Error('ingest failed'))
    obsidianImportNotice.set(IMPORT_EVENT)
    activeCollectionId.set('col-1')
    render(ObsidianImportNotification)

    await fireEvent.click(screen.getByText('Sync now'))
    await vi.waitFor(() => expect(mockRunIngest).toHaveBeenCalled())
    expect(get(obsidianImportNotice)).toEqual(IMPORT_EVENT)
  })
})
