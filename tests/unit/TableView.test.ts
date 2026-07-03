import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

// Mock window.api on the real jsdom window (floating-ui needs real DOM classes)
const mockApi = {
  collection: vi.fn(),
  readFile: vi.fn(),
  ingestFile: vi.fn(),
  updateFrontmatter: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import { workspace } from '@renderer/stores/workspace.svelte'
import { tableStore } from '@renderer/stores/table.svelte'
import TableView from '@renderer/components/table/TableView.svelte'
import type { CollectionOutput, CollectionRow } from '../../src/renderer/types/cli'

function row(path: string, frontmatter: Record<string, unknown> = {}): CollectionRow {
  return {
    path,
    title: path.split('/').pop()!.replace('.md', ''),
    title_source: 'filename',
    frontmatter: frontmatter as CollectionRow['frontmatter'],
    content_hash: 'h',
    file_size: 1,
    modified_at: 1,
    indexed_at: 1,
    state: 'indexed'
  }
}

const fixture: CollectionOutput = {
  scope: 'docs/',
  recursive: false,
  columns: [
    {
      name: 'status',
      field_type: 'String',
      description: null,
      occurrence_count: 3,
      sample_values: [],
      allowed_values: null,
      required: false,
      in_schema: true
    }
  ],
  rows: [row('docs/a.md', { status: 'x' }), row('docs/b.md'), row('docs/c.md')],
  total_rows: 3,
  offset: 0
}

describe('TableView', () => {
  beforeEach(() => {
    workspace.reset()
    tableStore.dispose?.('')
    mockApi.collection.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the loading skeleton before data arrives', () => {
    const tabId = workspace.openTableTab('docs')
    const { container } = render(TableView, { props: { tabId } })

    expect(screen.getByRole('status', { name: 'Loading table' })).toBeTruthy()
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(8)
  })

  it('shows an icon-driven empty state for folders without markdown files', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue({ ...fixture, columns: [], rows: [], total_rows: 0 })
    await tableStore.load(tabId, 'c1', '/root')

    render(TableView, { props: { tabId } })

    expect(screen.getByText('No markdown files in this folder')).toBeTruthy()
  })

  it('shows the error state and Retry reloads the collection', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockRejectedValueOnce(new Error('CLI exploded'))
    await tableStore.load(tabId, 'c1', '/root')

    render(TableView, { props: { tabId } })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('CLI exploded')).toBeTruthy()

    mockApi.collection.mockResolvedValue(fixture)
    await fireEvent.click(screen.getByText('Retry'))
    await tick()

    expect(mockApi.collection).toHaveBeenCalledTimes(2)
  })

  it('positions virtual rows with top offsets (not transforms) so fixed popovers work', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const { container } = render(TableView, { props: { tabId } })

    const rows = Array.from(container.querySelectorAll<HTMLElement>('.virtual-row'))
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.style.top)).toEqual(['0px', '36px', '72px'])
    for (const r of rows) {
      expect(r.style.transform).toBe('')
    }
  })

  it('navigates rows with ArrowDown and opens the selected doc on Enter', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const openFile = vi.spyOn(workspace, 'openFile').mockImplementation(() => {})

    const { container } = render(TableView, { props: { tabId } })
    const grid = container.querySelector('.table-view')!

    await fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(container.querySelector('[role="row"][aria-selected="true"]')).toBeTruthy()

    await fireEvent.keyDown(grid, { key: 'Enter' })
    expect(openFile).toHaveBeenCalledWith('docs/a.md')
  })
})
