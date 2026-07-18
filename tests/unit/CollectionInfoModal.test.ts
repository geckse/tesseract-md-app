import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

const mockApi = {
  info: vi.fn(),
  listCollections: vi.fn().mockResolvedValue([]),
  getActiveCollection: vi.fn().mockResolvedValue(null),
  status: vi.fn(),
  doctor: vi.fn()
}
Object.defineProperty(globalThis, 'window', {
  value: Object.assign(globalThis.window ?? {}, { api: mockApi }),
  writable: true
})

import CollectionInfoModal from '@renderer/components/CollectionInfoModal.svelte'
import {
  collections,
  activeCollectionId,
  collectionInfo,
  infoModalOpen,
  infoLoading,
  infoError,
  infoScope
} from '@renderer/stores/collections'
import type { VaultInfo } from '@renderer/types/cli'

const sampleInfo: VaultInfo = {
  scope: '.',
  is_whole_vault: true,
  file_count: 12,
  indexed_file_count: 10,
  chunk_count: 42,
  vector_count: 45,
  edge_count: 3,
  reindex_chunks: 48,
  reindex_estimated_tokens: 12345,
  reindex_estimated_api_calls: 2,
  index_file_size: 2048,
  embedding: { provider: 'Mock', model: 'mock-model', dimensions: 8 },
  sync: { new: 1, changed: 1, unchanged: 10, deleted: 0 },
  last_updated: 1_700_000_000
}

describe('CollectionInfoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collections.set([{ id: 'col-1', name: 'Notes', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
    activeCollectionId.set('col-1')
    collectionInfo.set(null)
    infoModalOpen.set(false)
    infoLoading.set(false)
    infoError.set(null)
    infoScope.set(null)
  })

  it('renders nothing while closed', () => {
    collectionInfo.set(sampleInfo)
    render(CollectionInfoModal)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a skeleton while loading', async () => {
    infoLoading.set(true)
    infoModalOpen.set(true)
    render(CollectionInfoModal)
    await tick()

    expect(screen.getByLabelText('Loading collection information')).toBeTruthy()
    expect(screen.getByText('Notes')).toBeTruthy()
  })

  it('renders statistics and the whole-collection label', async () => {
    collectionInfo.set(sampleInfo)
    infoModalOpen.set(true)
    render(CollectionInfoModal)
    await tick()

    expect(screen.getByRole('dialog', { name: 'Collection Information' })).toBeTruthy()
    expect(screen.getByText('Notes')).toBeTruthy()
    expect(screen.getByText('12,345')).toBeTruthy()
    expect(screen.getByText('(3 edge)')).toBeTruthy()
    expect(screen.getByText('2 KB')).toBeTruthy()
    expect(screen.getByText('Mock · mock-model · 8 dims')).toBeTruthy()
    expect(screen.getByText('1 new')).toBeTruthy()
  })

  it('uses the folder path as the scoped subtitle', async () => {
    collectionInfo.set({ ...sampleInfo, scope: 'notes/', is_whole_vault: false })
    infoScope.set('notes')
    infoModalOpen.set(true)
    render(CollectionInfoModal)
    await tick()

    expect(screen.getByText('notes')).toBeTruthy()
    expect(screen.queryByText('Notes')).toBeNull()
  })

  it('renders unavailable legacy scoped metrics without inventing values', async () => {
    collectionInfo.set({
      ...sampleInfo,
      scope: 'notes/',
      is_whole_vault: false,
      vector_count: null,
      edge_count: null,
      reindex_estimated_api_calls: null
    })
    infoScope.set('notes')
    infoModalOpen.set(true)
    render(CollectionInfoModal)
    await tick()

    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.queryByText('(3 edge)')).toBeNull()
  })

  it('shows an update hint and retries after an error', async () => {
    infoError.set('[CliExecutionError] unknown command info')
    infoModalOpen.set(true)
    mockApi.info.mockResolvedValue(sampleInfo)
    render(CollectionInfoModal)
    await tick()

    expect(screen.getByText('unknown command info', { exact: false })).toBeTruthy()
    expect(screen.getByText('update the mdvdb CLI', { exact: false })).toBeTruthy()
    await fireEvent.click(screen.getByText('Retry'))
    expect(mockApi.info).toHaveBeenCalledWith('/vault', undefined)
  })

  it('closes on Escape and the Close button', async () => {
    collectionInfo.set(sampleInfo)
    infoModalOpen.set(true)
    render(CollectionInfoModal)
    await tick()

    await fireEvent.keyDown(window, { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('dialog')).toBeNull()

    infoModalOpen.set(true)
    await tick()
    await fireEvent.click(screen.getByText('Close'))
    await tick()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
