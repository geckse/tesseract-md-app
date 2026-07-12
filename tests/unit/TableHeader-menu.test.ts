import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const setTableEphemeral = vi.fn()
const openConvert = vi.fn()
const openRename = vi.fn()

vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: {
    tabs: { t1: { id: 't1', kind: 'table', folderPath: 'docs' } },
    setTableEphemeral: (...args: unknown[]) => setTableEphemeral(...args)
  }
}))

vi.mock('../../src/renderer/stores/table.svelte', () => ({
  tableStore: {
    mergedConfig: () => ({
      sort: [],
      filters: [],
      columns: [],
      groupBy: null,
      collapsedGroups: []
    }),
    columnWidth: () => 140
  }
}))

vi.mock('../../src/renderer/stores/property-ops.svelte', () => ({
  propertyOps: {
    modal: null,
    openConvert: (...args: unknown[]) => openConvert(...args),
    openRename: (...args: unknown[]) => openRename(...args),
    applyOverlayFieldPatch: vi.fn()
  },
  scopeForTableTab: (f: string) => f || '.',
  isVaultWideScope: (s: string | null) => s === '' || s === '.'
}))

import TableHeader from '../../src/renderer/components/table/TableHeader.svelte'
import type { CollectionColumn } from '../../src/renderer/types/cli'

const statusColumn: CollectionColumn = {
  name: 'status',
  field_type: 'String',
  description: null,
  occurrence_count: 3,
  sample_values: ['drafted'],
  allowed_values: null,
  required: false,
  in_schema: true
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis.window ?? {}, { api: {} }),
    writable: true,
    configurable: true
  })
})

function renderHeader(columns: CollectionColumn[] = [statusColumn]) {
  render(TableHeader, { props: { tabId: 't1', columns, titleWidth: 220 } })
}

describe('TableHeader column menu (phase 41)', () => {
  it('renders a kebab per data column but none for the Title cell', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: 'Column options for status' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Column options for Title/i })).toBeNull()
  })

  it('opens the menu with sort + property actions', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    expect(screen.getByRole('menuitem', { name: /Change type/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Rename property/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Property settings/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Sort ascending/ })).toBeTruthy()
  })

  it('sorts via the menu', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Sort descending/ }))
    expect(setTableEphemeral).toHaveBeenCalledWith('t1', {
      sort: [{ columnName: 'status', direction: 'desc' }]
    })
  })

  it('routes Change type → picker → openConvert with the table origin', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Change type/ }))
    // Picker opens, current type (text for String) highlighted, complex hidden.
    const picker = screen.getByRole('listbox', { name: 'Select property type' })
    expect(picker).toBeTruthy()
    expect(screen.queryByText('JSON')).toBeNull()
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Tags/ }))
    expect(openConvert).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status',
      'tags',
      'text'
    )
  })

  it('picking the current type closes without converting', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Change type/ }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Text/ }))
    expect(openConvert).not.toHaveBeenCalled()
  })

  it('routes Rename property to openRename', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Rename property/ }))
    expect(openRename).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status'
    )
  })
})
