import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const mockApi = {
  collection: vi.fn(),
  search: vi.fn(),
  tree: vi.fn(),
  listRecents: vi.fn()
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import RelationPicker from '@renderer/components/RelationPicker.svelte'
import type { CollectionRow } from '@renderer/types/cli'

function row(path: string, title: string, state: CollectionRow['state'] = 'indexed') {
  return {
    path,
    title,
    title_source: 'frontmatter',
    frontmatter: {},
    content_hash: 'h',
    file_size: 1,
    modified_at: 1,
    indexed_at: 1,
    state
  }
}

function pickerProps(overrides: Record<string, unknown> = {}) {
  const onpick = vi.fn()
  const ondismiss = vi.fn()
  return {
    props: {
      anchorEl: document.body,
      root: '/vault',
      collectionId: 'c1',
      onpick,
      ondismiss,
      ...overrides
    },
    onpick,
    ondismiss
  }
}

describe('RelationPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.collection.mockResolvedValue({ rows: [], columns: [], total_rows: 0, offset: 0 })
    mockApi.search.mockResolvedValue({ results: [] })
    mockApi.tree.mockResolvedValue({ root: { name: '.', path: '.', is_dir: true, children: [] } })
    mockApi.listRecents.mockResolvedValue([])
  })

  it('scoped mode calls collection(root, targetFolder, recursive) ONCE and filters client-side', async () => {
    mockApi.collection.mockResolvedValue({
      rows: [row('clients/acme.md', 'Acme Corp'), row('clients/globex.md', 'Globex')],
      columns: [],
      total_rows: 2,
      offset: 0
    })
    const p = pickerProps({ targetFolder: 'clients' })
    render(RelationPicker, p.props)

    await screen.findByText('Acme Corp')
    expect(mockApi.collection).toHaveBeenCalledTimes(1)
    expect(mockApi.collection).toHaveBeenCalledWith('/vault', 'clients', { recursive: true })

    // Typing filters the CACHED rows — no second CLI call.
    const input = screen.getByLabelText('Search documents')
    await fireEvent.input(input, { target: { value: 'glo' } })
    expect(await screen.findByText('Globex')).toBeTruthy()
    expect(screen.queryByText('Acme Corp')).toBeNull()
    expect(mockApi.collection).toHaveBeenCalledTimes(1)
    expect(mockApi.search).not.toHaveBeenCalled()
  })

  it('scoped mode shows an explicit empty state for a missing/empty target folder', async () => {
    const p = pickerProps({ targetFolder: 'ghostfolder' })
    render(RelationPicker, p.props)
    expect(await screen.findByText('No documents in `ghostfolder/`')).toBeTruthy()
  })

  it('excludePaths are never offered', async () => {
    mockApi.collection.mockResolvedValue({
      rows: [row('clients/acme.md', 'Acme Corp'), row('clients/globex.md', 'Globex')],
      columns: [],
      total_rows: 2,
      offset: 0
    })
    const p = pickerProps({ targetFolder: 'clients', excludePaths: ['clients/acme.md'] })
    render(RelationPicker, p.props)
    expect(await screen.findByText('Globex')).toBeTruthy()
    expect(screen.queryByText('Acme Corp')).toBeNull()
  })

  it('picking an item returns the path (with .md)', async () => {
    mockApi.collection.mockResolvedValue({
      rows: [row('clients/acme.md', 'Acme Corp')],
      columns: [],
      total_rows: 1,
      offset: 0
    })
    const p = pickerProps({ targetFolder: 'clients' })
    render(RelationPicker, p.props)
    await fireEvent.mouseDown(await screen.findByText('Acme Corp'))
    expect(p.onpick).toHaveBeenCalledWith('clients/acme.md')
  })

  it('unscoped mode shows recents first, then falls back to the tree', async () => {
    mockApi.listRecents.mockResolvedValue([
      { collectionId: 'c1', filePath: 'notes/hello.md', openedAt: 1 },
      { collectionId: 'other', filePath: 'ignored.md', openedAt: 2 }
    ])
    const p = pickerProps()
    render(RelationPicker, p.props)
    expect(await screen.findByText('notes/hello.md')).toBeTruthy()
    expect(screen.queryByText('ignored.md')).toBeNull()
    expect(mockApi.search).not.toHaveBeenCalled()
  })

  it('unscoped typing runs a debounced hybrid search', async () => {
    vi.useFakeTimers()
    try {
      mockApi.search.mockResolvedValue({
        results: [
          {
            score: 1,
            chunk: {},
            file: { path: 'clients/acme.md', frontmatter: { title: 'Acme Corp' } }
          }
        ]
      })
      const p = pickerProps()
      render(RelationPicker, p.props)
      const input = screen.getByLabelText('Search documents')
      await fireEvent.input(input, { target: { value: 'acme' } })
      expect(mockApi.search).not.toHaveBeenCalled() // debounced
      await vi.advanceTimersByTimeAsync(300)
      expect(mockApi.search).toHaveBeenCalledWith('/vault', 'acme', { mode: 'hybrid', limit: 10 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('Escape dismisses without picking', async () => {
    const p = pickerProps({ targetFolder: 'clients' })
    render(RelationPicker, p.props)
    const input = screen.getByLabelText('Search documents')
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(p.ondismiss).toHaveBeenCalled()
    expect(p.onpick).not.toHaveBeenCalled()
  })
})
