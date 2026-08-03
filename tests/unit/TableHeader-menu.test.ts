import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const setTableEphemeral = vi.fn()
const openConvert = vi.fn()
const openRename = vi.fn()
const openDrop = vi.fn()
const applyOverlayFieldPatch = vi.fn()
const editFormula = vi.fn()
const reorderColumn = vi.fn()
const moveColumn = vi.fn()
const tableHeaderSource = readFileSync(
  resolve(__dirname, '../../src/renderer/components/table/TableHeader.svelte'),
  'utf8'
)

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
    reorderColumn: (...args: unknown[]) => reorderColumn(...args),
    moveColumn: (...args: unknown[]) => moveColumn(...args),
    commitColumnLayout: vi.fn(),
    setColumnWidth: vi.fn(),
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
    openDrop: (...args: unknown[]) => openDrop(...args),
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

const formulaColumn: CollectionColumn = {
  ...statusColumn,
  name: 'total',
  field_type: 'Formula',
  formula: 'price * quantity',
  result_type: 'Number'
}

const lookupColumn: CollectionColumn = {
  ...statusColumn,
  name: 'client_domain',
  field_type: 'Lookup',
  relation_field: 'client',
  target_field: 'domain',
  relation_direction: 'Outgoing',
  relation_target: null,
  formula: null,
  result_type: null
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
  render(TableHeader, {
    props: {
      tabId: 't1',
      columns,
      titleWidth: 220,
      oneditformula: editFormula
    }
  })
}

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  values: { pointerId: number; button?: number; clientX: number }
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    button: { value: values.button ?? 0 },
    clientX: { value: values.clientX }
  })
  target.dispatchEvent(event)
}

describe('TableHeader column menu (phase 41)', () => {
  it('keeps the sticky Title header opaque above horizontally scrolled columns', () => {
    renderHeader()

    const titleHeader = screen.getByRole('columnheader', { name: 'Title' })
    expect(titleHeader.classList.contains('title-cell')).toBe(true)

    const pinnedRule = tableHeaderSource.match(/\.header-cell\.title-cell\s*\{([^}]*)\}/)?.[1]
    expect(pinnedRule).toContain('position: sticky')
    expect(pinnedRule).toContain('z-index: 2')
    expect(pinnedRule).toContain('background: var(--color-surface)')

    const hoverRule = tableHeaderSource.match(/\.header-cell\.title-cell:hover\s*\{([^}]*)\}/)?.[1]
    expect(hoverRule).toContain('background: var(--color-surface-elevated)')
  })

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

  it('reorders columns by pointer drag and exposes keyboard arrow movement', async () => {
    renderHeader([statusColumn, tagsColumn])
    const statusHandle = screen.getByRole('button', {
      name: 'Reorder status; use left and right arrow keys'
    })
    const tagsHandle = screen.getByRole('button', {
      name: 'Reorder tags; use left and right arrow keys'
    })

    const statusHeader = statusHandle.closest('.header-col') as HTMLElement
    const tagsHeader = tagsHandle.closest('.header-col') as HTMLElement
    vi.spyOn(statusHeader, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 140,
      top: 0,
      bottom: 32,
      width: 140,
      height: 32,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    vi.spyOn(tagsHeader, 'getBoundingClientRect').mockReturnValue({
      left: 140,
      right: 280,
      top: 0,
      bottom: 32,
      width: 140,
      height: 32,
      x: 140,
      y: 0,
      toJSON: () => ({})
    })

    dispatchPointer(statusHandle, 'pointerdown', { pointerId: 7, clientX: 20 })
    dispatchPointer(window, 'pointermove', { pointerId: 7, clientX: 270 })
    dispatchPointer(window, 'pointerup', { pointerId: 7, clientX: 270 })
    expect(reorderColumn).toHaveBeenCalledWith('t1', 'status', 'tags', 'after')

    await fireEvent.keyDown(tagsHandle, { key: 'ArrowLeft' })
    expect(moveColumn).toHaveBeenCalledWith('t1', 'tags', -1)
  })

  it('opens the menu with sort + property actions', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    expect(screen.getByRole('menuitem', { name: /Change type/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Rename property/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Property settings/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Sort ascending/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Drop column/ }).className).toContain('danger')
  })

  it('offers Formula editing and routes the shared Drop action without conversion', async () => {
    renderHeader([formulaColumn])
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for total' }))
    expect(screen.queryByRole('menuitem', { name: /Change type/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Rename property/ })).toBeNull()

    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Edit formula/ }))
    expect(editFormula).toHaveBeenCalledWith(formulaColumn)

    await fireEvent.click(screen.getByRole('button', { name: 'Column options for total' }))
    const drop = screen.getByRole('menuitem', { name: /Drop column/ })
    expect(drop.className).toContain('danger')
    await fireEvent.mouseDown(drop)
    expect(openDrop).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'total'
    )
  })

  it('does not let an older CLI edit or remove an existing Lookup definition', async () => {
    renderHeader([lookupColumn])
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for client_domain' }))

    const edit = screen.getByRole('menuitem', { name: /Edit lookup/ }) as HTMLButtonElement
    const drop = screen.getByRole('menuitem', { name: /Drop column/ }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect(drop.disabled).toBe(true)

    await fireEvent.mouseDown(drop)
    expect(openDrop).not.toHaveBeenCalled()
  })

  it('routes ordinary columns through the same vault-wide Drop preview', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Drop column/ }))

    expect(openDrop).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status'
    )
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
    // Picker opens with the current String type highlighted and JSON available.
    const picker = screen.getByRole('listbox', { name: 'Select property type' })
    expect(picker).toBeTruthy()
    expect(screen.getByRole('option', { name: /JSON/ })).toBeTruthy()
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Tags/ }))
    expect(openConvert).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status',
      'tags',
      'text'
    )
  })

  it('routes JSON conversion through the table property flow', async () => {
    renderHeader()
    await fireEvent.click(screen.getByRole('button', { name: 'Column options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Change type/ }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /JSON/ }))
    expect(openConvert).toHaveBeenCalledWith(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status',
      'complex',
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
