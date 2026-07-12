import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// PropertyRow → PropertySettingsPopover → property-ops store; mock the store
// so the component graph stays free of window.api / collections.
vi.mock('../../src/renderer/stores/property-ops.svelte', () => ({
  propertyOps: {
    modal: null,
    openConvert: vi.fn(),
    openRename: vi.fn(),
    applyOverlayFieldPatch: vi.fn()
  },
  scopeForPanelFile: (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null),
  scopeForTableTab: (f: string) => f || '.',
  isVaultWideScope: (s: string | null) => s === '' || s === '.'
}))

import PropertyRow from '../../src/renderer/components/wysiwyg/PropertyRow.svelte'

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis.window ?? {}, { api: {} }),
    writable: true,
    configurable: true
  })
})

function renderRow(extra: Record<string, unknown> = {}) {
  const onTypeChange = vi.fn()
  const onRename = vi.fn()
  render(PropertyRow, {
    props: {
      rowKey: 'status',
      value: 'drafted',
      fieldType: 'text',
      schemaField: null,
      onKeyChange: vi.fn(),
      onValueChange: vi.fn(),
      onRemove: vi.fn(),
      onTypeChange,
      onRename,
      settingsScope: 'docs',
      ...extra
    }
  })
  return { onTypeChange, onRename }
}

describe('PropertyRow type-change affordances (phase 41)', () => {
  it('renders the type icon as a button that opens the type picker', async () => {
    renderRow()
    const btn = screen.getByRole('button', { name: 'Change type of status' })
    await fireEvent.click(btn)
    expect(screen.getByRole('listbox', { name: 'Select property type' })).toBeTruthy()
  })

  it('excludes complex/JSON as a conversion target and marks the current type', async () => {
    renderRow()
    await fireEvent.click(screen.getByRole('button', { name: 'Change type of status' }))
    expect(screen.queryByText('JSON')).toBeNull()
    const current = screen.getByRole('option', { name: /Text/ })
    expect(current).toBeTruthy()
  })

  it('requests a conversion when a different type is picked', async () => {
    const { onTypeChange } = renderRow()
    await fireEvent.click(screen.getByRole('button', { name: 'Change type of status' }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Number/ }))
    expect(onTypeChange).toHaveBeenCalledWith('number')
  })

  it('does nothing when the current type is picked again', async () => {
    const { onTypeChange } = renderRow()
    await fireEvent.click(screen.getByRole('button', { name: 'Change type of status' }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Text/ }))
    expect(onTypeChange).not.toHaveBeenCalled()
  })

  it('offers rename via the row overflow menu', async () => {
    const { onRename } = renderRow()
    await fireEvent.click(screen.getByRole('button', { name: 'Property options for status' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Rename property/ }))
    expect(onRename).toHaveBeenCalled()
  })

  it('keeps the icon passive when no onTypeChange handler is provided', () => {
    render(PropertyRow, {
      props: {
        rowKey: 'status',
        value: 'drafted',
        fieldType: 'text',
        schemaField: null,
        onKeyChange: vi.fn(),
        onValueChange: vi.fn(),
        onRemove: vi.fn()
      }
    })
    expect(screen.queryByRole('button', { name: 'Change type of status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Property options for status' })).toBeNull()
  })
})
