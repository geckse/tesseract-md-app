import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

// Mock window.api on the real jsdom window before store imports
const mockApi = {
  collection: vi.fn(),
  listTableViews: vi.fn().mockResolvedValue([]),
  getDefaultTableColumns: vi.fn().mockResolvedValue(null),
  saveDefaultTableColumns: vi
    .fn()
    .mockImplementation((_collection, _folder, columns) => Promise.resolve(columns))
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import { workspace } from '@renderer/stores/workspace.svelte'
import { tableStore } from '@renderer/stores/table.svelte'
import { tableHistory, type HistoryEntry } from '@renderer/stores/table-history.svelte'
import TableToolbar from '@renderer/components/table/TableToolbar.svelte'

function entry(): HistoryEntry {
  return {
    kind: 'cell-edit',
    path: 'docs/a.md',
    column: 'status',
    before: { present: false },
    after: { present: true, value: 'x' },
    at: 1
  }
}

describe('TableToolbar undo/redo controls', () => {
  let tabId: string

  beforeEach(() => {
    vi.restoreAllMocks()
    workspace.reset()
    tabId = workspace.openTableTab('docs')
  })

  it('renders both buttons disabled while the stacks are empty', () => {
    render(TableToolbar, { props: { tabId, onsaveview: () => {} } })
    expect(screen.getByTitle<HTMLButtonElement>(/^Undo/).disabled).toBe(true)
    expect(screen.getByTitle<HTMLButtonElement>(/^Redo/).disabled).toBe(true)
  })

  it('offers Add column instead of the formula-only action', async () => {
    const onaddcolumn = vi.fn()
    render(TableToolbar, { props: { tabId, onsaveview: () => {}, onaddcolumn } })

    expect(screen.queryByRole('button', { name: 'Add formula' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(onaddcolumn).toHaveBeenCalledOnce()
  })

  it('enables undo after a recorded mutation; click calls tableStore.undo', async () => {
    const undoSpy = vi.spyOn(tableStore, 'undo').mockResolvedValue()
    render(TableToolbar, { props: { tabId, onsaveview: () => {} } })

    tableHistory.record(tabId, entry())
    await tick()

    const undoBtn = screen.getByTitle<HTMLButtonElement>(/^Undo/)
    expect(undoBtn.disabled).toBe(false)
    await fireEvent.click(undoBtn)
    expect(undoSpy).toHaveBeenCalledWith(tabId)
  })

  it('enables redo after an undo moved the entry over; click calls tableStore.redo', async () => {
    const redoSpy = vi.spyOn(tableStore, 'redo').mockResolvedValue()
    render(TableToolbar, { props: { tabId, onsaveview: () => {} } })

    tableHistory.pushRedoRaw(tabId, entry())
    await tick()

    const redoBtn = screen.getByTitle<HTMLButtonElement>(/^Redo/)
    expect(redoBtn.disabled).toBe(false)
    await fireEvent.click(redoBtn)
    expect(redoSpy).toHaveBeenCalledWith(tabId)
  })

  it('shows the transient history notice for this tab only', async () => {
    render(TableToolbar, { props: { tabId, onsaveview: () => {} } })

    tableHistory.setNotice('some-other-tab', 'not for us')
    await tick()
    expect(screen.queryByRole('status', { name: '' })?.textContent ?? '').not.toContain(
      'not for us'
    )

    tableHistory.setNotice(tabId, 'Undo skipped — "status" changed outside this table')
    await tick()
    expect(screen.getByText(/Undo skipped/)).toBeTruthy()
  })

  it('shows the hidden-field count and offers one action to reveal every field', async () => {
    mockApi.collection.mockResolvedValue({
      scope: 'docs/',
      recursive: false,
      columns: [
        {
          name: 'author',
          field_type: 'String',
          description: null,
          occurrence_count: 1,
          sample_values: [],
          allowed_values: null,
          required: false,
          in_schema: true
        },
        {
          name: 'status',
          field_type: 'String',
          description: null,
          occurrence_count: 1,
          sample_values: [],
          allowed_values: null,
          required: false,
          in_schema: true
        }
      ],
      rows: [],
      total_rows: 0,
      offset: 0
    })
    await tableStore.load(tabId, 'c-toolbar-layout', '/root')
    tableStore.toggleColumnHidden(tabId, 'status')
    render(TableToolbar, { props: { tabId, onsaveview: () => {} } })

    const columnsButton = screen.getByRole('button', { name: /Columns.*1 hidden/ })
    expect(columnsButton).toBeTruthy()

    const viewButton = screen.getByRole('button', { name: /^bookmark All fields arrow_drop_down$/ })
    await fireEvent.click(viewButton)
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Customize fields.*1 hidden/ }))
    expect(screen.getByRole('menu', { name: 'Columns' })).toBeTruthy()
    await fireEvent.mouseDown(
      screen.getByRole('menuitem', { name: /Show all fields \(1 hidden\)/ })
    )

    expect(tableStore.visibleColumns(tabId).map((column) => column.name)).toEqual([
      'author',
      'status'
    ])
  })
})
