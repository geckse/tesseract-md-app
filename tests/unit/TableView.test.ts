import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

// Mock window.api on the real jsdom window (floating-ui needs real DOM classes)
const mockApi = {
  collection: vi.fn(),
  readFile: vi.fn(),
  ingestFile: vi.fn(),
  updateFrontmatter: vi.fn(),
  listTableViews: vi.fn(),
  // Called by the content-load pipeline (syncFileStoresFromTab → _autoLoadTabContent)
  addRecent: vi.fn(),
  getFile: vi.fn(),
  backlinks: vi.fn(),
  links: vi.fn(),
  neighborhood: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import { workspace } from '@renderer/stores/workspace.svelte'
import { collections, activeCollectionId } from '@renderer/stores/collections'
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
    collections.set([])
    activeCollectionId.set(null)
    mockApi.collection.mockReset()
    mockApi.listTableViews.mockReset()
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
    expect(openFile).toHaveBeenCalledWith('docs/a.md', undefined)
  })

  it('opening a row loads the document content into the new tab', async () => {
    collections.set([{ id: 'c1', name: 'Root', path: '/root', addedAt: 1, lastOpenedAt: 1 }])
    activeCollectionId.set('c1')
    mockApi.collection.mockResolvedValue(fixture)
    mockApi.listTableViews.mockResolvedValue([])
    mockApi.readFile.mockResolvedValue('# Doc A')

    const tabId = workspace.openTableTab('docs')
    await tableStore.load(tabId, 'c1', '/root')

    const { container } = render(TableView, { props: { tabId } })
    const grid = container.querySelector('.table-view')!

    await fireEvent.keyDown(grid, { key: 'ArrowDown' })
    await fireEvent.keyDown(grid, { key: 'Enter' })

    // The regression: the tab opened but content never loaded because
    // syncFileStoresFromTab() wasn't called after workspace.openFile().
    await vi.waitFor(() => expect(mockApi.readFile).toHaveBeenCalledWith('/root/docs/a.md'))
    await vi.waitFor(() => {
      const docTab = Object.values(workspace.tabs).find(
        (t) => t.kind === 'document' && t.filePath === 'docs/a.md'
      )
      expect(docTab && docTab.kind === 'document' ? docTab.content : null).toBe('# Doc A')
    })
  })

  it('the load effect settles — data + views arriving must not re-trigger a refetch loop', async () => {
    collections.set([{ id: 'c-settle', name: 'Root', path: '/root', addedAt: 1, lastOpenedAt: 1 }])
    activeCollectionId.set('c-settle')
    mockApi.collection.mockResolvedValue(fixture)
    mockApi.listTableViews.mockResolvedValue([])

    const tabId = workspace.openTableTab('docs')
    render(TableView, { props: { tabId } })

    // Each loop cycle only needs a few microtasks; plenty of rounds to expose one.
    for (let i = 0; i < 25; i++) await tick()
    expect(mockApi.collection).toHaveBeenCalledTimes(1)
    expect(mockApi.listTableViews).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 25; i++) await tick()
    expect(mockApi.collection).toHaveBeenCalledTimes(1)
  })

  it('keys inside a cell editor never drive grid navigation (Enter must not open the doc)', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    mockApi.updateFrontmatter.mockResolvedValue({ status: 'x' })
    mockApi.ingestFile.mockResolvedValue({})
    await tableStore.load(tabId, 'c1', '/root')

    const openFile = vi.spyOn(workspace, 'openFile').mockImplementation(() => {})
    const { container } = render(TableView, { props: { tabId } })

    const cell = container.querySelector('.data-cell')!
    await fireEvent.click(cell) // selects the row
    await fireEvent.dblClick(cell) // enters edit mode
    const input = container.querySelector<HTMLInputElement>('.data-cell input')!
    await fireEvent.keyDown(input, { key: 'Enter' }) // commits the edit; bubbles to the grid

    expect(openFile).not.toHaveBeenCalled()
  })

  it('suppresses native text selection on double-click but not on single clicks or in edit mode', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const { container } = render(TableView, { props: { tabId } })
    const cell = container.querySelector('.data-cell')!

    // Single-click mousedown keeps its default → drag-selection still possible.
    expect(await fireEvent.mouseDown(cell, { detail: 1 })).toBe(true)
    // The double-click's second mousedown is prevented → no word-selection highlight.
    expect(await fireEvent.mouseDown(cell, { detail: 2 })).toBe(false)

    // In edit mode the guard steps aside: double-click word-selection inside the
    // editor input must keep working (its mousedown bubbles to the cell).
    await fireEvent.dblClick(cell)
    const input = container.querySelector<HTMLInputElement>('.data-cell input')!
    expect(await fireEvent.mouseDown(input, { detail: 2 })).toBe(true)
  })

  it('an open cell editor follows its row when a reload reorders the data', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const { container } = render(TableView, { props: { tabId } })

    // Open the editor on docs/a.md (first row).
    await fireEvent.dblClick(container.querySelector('.data-cell')!)
    expect(container.querySelector('.data-cell input')).toBeTruthy()

    // A background refetch delivers the same rows in reverse order.
    const reordered = { ...fixture, rows: [fixture.rows[2], fixture.rows[1], fixture.rows[0]] }
    mockApi.collection.mockResolvedValueOnce(JSON.parse(JSON.stringify(reordered)))
    await tableStore.reload(tabId)
    await tick()

    // The editor must still sit in docs/a.md's row — now rendered last.
    const editingRow = container.querySelector('.data-cell input')!.closest('.virtual-row')!
    expect(editingRow.querySelector('.title-cell')!.textContent).toContain('a')
    expect((editingRow as HTMLElement).style.top).toBe('72px')
  })

  it('renders the add-row affordance after the last row inside the scrolling grid', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const { container } = render(TableView, { props: { tabId } })

    const addRow = container.querySelector('.table-inner > .add-row.row')!
    expect(addRow).toBeTruthy()
    const rows = container.querySelector('.rows')!
    expect(rows.compareDocumentPosition(addRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the empty state offers an Add row CTA wired to tableStore.addRow', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue({ ...fixture, columns: [], rows: [], total_rows: 0 })
    await tableStore.load(tabId, 'c1', '/root')

    const addRow = vi.spyOn(tableStore, 'addRow').mockResolvedValue({ ok: true })
    const { container } = render(TableView, { props: { tabId } })

    const cta = container.querySelector('.table-state .add-row')!
    expect(cta).toBeTruthy()
    await fireEvent.click(cta)

    const input = container.querySelector<HTMLInputElement>('.table-state .add-input')!
    await fireEvent.input(input, { target: { value: 'first-doc' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(addRow).toHaveBeenCalledWith(tabId, 'first-doc')
  })

  it('Enter on the focused add-row button never opens the selected row (grid shortcut)', async () => {
    const tabId = workspace.openTableTab('docs')
    mockApi.collection.mockResolvedValue(fixture)
    await tableStore.load(tabId, 'c1', '/root')

    const openFile = vi.spyOn(workspace, 'openFile').mockImplementation(() => {})
    const { container } = render(TableView, { props: { tabId } })
    const grid = container.querySelector('.table-view')!

    await fireEvent.keyDown(grid, { key: 'ArrowDown' }) // selects row 0
    const button = container.querySelector<HTMLButtonElement>('.table-inner > .add-row.row')!
    button.focus()
    await fireEvent.keyDown(button, { key: 'Enter' }) // bubbles toward the grid handler

    expect(openFile).not.toHaveBeenCalled()
    // Plain activation still works.
    await fireEvent.click(button)
    expect(container.querySelector('.add-input')).toBeTruthy()
  })
})
