import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const setTableEphemeral = vi.fn()
const openConvert = vi.fn()
const openRename = vi.fn()
const applyOverlayFieldPatch = vi.fn()

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
    columnWidth: () => 140,
    collectionIdFor: () => 'collection-1',
    state: () => ({
      data: {
        rows: [
          {
            frontmatter: {
              tags: ['urgent', 'finance']
            }
          }
        ]
      }
    })
  }
}))

vi.mock('../../src/renderer/stores/property-ops.svelte', () => ({
  propertyOps: {
    modal: null,
    openConvert: (...args: unknown[]) => openConvert(...args),
    openRename: (...args: unknown[]) => openRename(...args),
    applyOverlayFieldPatch: (...args: unknown[]) => applyOverlayFieldPatch(...args)
  },
  scopeForTableTab: (f: string) => f || '.',
  isVaultWideScope: (s: string | null) => s === '' || s === '.'
}))

import TableHeader from '../../src/renderer/components/table/TableHeader.svelte'
import { cliFeatures } from '../../src/renderer/lib/cli-features.svelte'
import { TITLE_COLUMN } from '../../src/renderer/stores/table-views.svelte'
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

const relationColumn: CollectionColumn = {
  ...statusColumn,
  name: 'groups',
  field_type: 'Relation',
  relation_target: 'clients'
}

const selectColumn: CollectionColumn = {
  ...statusColumn,
  allowed_values: ['drafted', 'published']
}

const tagsColumn: CollectionColumn = {
  ...statusColumn,
  name: 'tags',
  field_type: 'List'
}

beforeEach(() => {
  vi.clearAllMocks()
  cliFeatures.reset()
  cliFeatures.version = '0.2.0'
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis.window ?? {}, {
      api: {
        getPropertyValueColors: vi.fn().mockResolvedValue({}),
        setPropertyValueColor: vi
          .fn()
          .mockImplementation(
            (
              _collectionId: string,
              _scope: string | null,
              field: string,
              value: string,
              selection: { palette: 'accent' | 'neutral'; slot: number }
            ) => Promise.resolve({ [field]: { [value]: selection } })
          )
      }
    }),
    writable: true,
    configurable: true
  })
})

function renderHeader(columns: CollectionColumn[] = [statusColumn]) {
  render(TableHeader, { props: { tabId: 't1', columns, titleWidth: 220 } })
}

describe('TableHeader column menu (phase 41)', () => {
  it('sorts the Title column when its header is clicked', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('columnheader', { name: 'Title' }))
    expect(setTableEphemeral).toHaveBeenCalledWith('t1', {
      sort: [{ columnName: TITLE_COLUMN, direction: 'asc' }]
    })
  })

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

  it('only offers File conversion when the CLI supports File fields', async () => {
    cliFeatures.version = '0.1.9'
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Change type/ }))
    expect(screen.queryByRole('option', { name: /File$/ })).toBeNull()

    await fireEvent.keyDown(document, { key: 'Escape' })
    cliFeatures.version = '0.2.0'
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Change type/ }))
    expect(screen.getByRole('option', { name: /File$/ })).toBeTruthy()
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

  it('configures a relation target folder from table property settings', async () => {
    renderHeader([relationColumn])
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for groups' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Property settings/ }))

    const target = screen.getByRole('textbox', { name: 'Target folder' })
    expect((target as HTMLInputElement).value).toBe('clients')
    await fireEvent.input(target, { target: { value: 'groups/' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(applyOverlayFieldPatch).toHaveBeenCalledWith('docs', 'groups', {
      description: null,
      required: null,
      allowedValues: null,
      target: 'groups'
    })
  })

  it('offers accent and neutral synced palette colors in Property settings', async () => {
    renderHeader([selectColumn])
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Property settings/ }))

    await fireEvent.click(screen.getByRole('button', { name: 'Choose color for drafted' }))
    expect(screen.getAllByRole('button', { name: /Accent color/ })).toHaveLength(24)
    expect(screen.getAllByRole('button', { name: /Neutral color/ })).toHaveLength(12)

    await fireEvent.click(screen.getByRole('button', { name: 'Neutral color 12' }))
    expect(window.api.setPropertyValueColor).toHaveBeenCalledWith(
      'collection-1',
      'docs',
      'status',
      'drafted',
      { palette: 'neutral', slot: 11 }
    )
  })

  it('discovers current Tags values for Property settings color controls', async () => {
    renderHeader([tagsColumn])
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for tags' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Property settings/ }))

    expect(screen.getByRole('button', { name: 'Choose color for urgent' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose color for finance' })).toBeTruthy()
  })
})
