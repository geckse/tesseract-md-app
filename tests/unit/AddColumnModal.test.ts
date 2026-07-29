import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const openAdd = vi.fn()

vi.mock('../../src/renderer/stores/property-ops.svelte', () => ({
  propertyOps: {
    modal: null,
    openAdd: (...args: unknown[]) => openAdd(...args)
  }
}))

import AddColumnModal from '@renderer/components/table/AddColumnModal.svelte'
import { cliFeatures } from '@renderer/lib/cli-features.svelte'
import { workspace } from '@renderer/stores/workspace.svelte'
import type { CollectionColumn } from '@renderer/types/cli'

function column(name: string): CollectionColumn {
  return {
    name,
    field_type: 'String',
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema: true,
    relation_target: null,
    formula: null,
    result_type: null
  }
}

function renderModal(folderPath = 'docs', columns: CollectionColumn[] = [column('status')]) {
  const tabId = workspace.openTableTab(folderPath)
  const onformula = vi.fn()
  const onclose = vi.fn()
  render(AddColumnModal, { props: { tabId, columns, onformula, onclose } })
  return { tabId, onformula, onclose }
}

async function setName(value: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Column name'), { target: { value } })
}

describe('AddColumnModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspace.reset()
    cliFeatures.reset()
    cliFeatures.version = '0.2.0'
  })

  it('offers the durable database field types', () => {
    renderModal()

    for (const name of [
      'Text',
      'Number',
      'Boolean',
      'Date',
      'Tags / list',
      'Select',
      'Relation',
      'File',
      'JSON',
      'Formula'
    ]) {
      expect(screen.getByRole('radio', { name: new RegExp(`^${name}`) })).toBeTruthy()
    }
  })

  it('opens the recursive Add property flow for an ordinary column', async () => {
    const { tabId, onclose } = renderModal('invoices/2026')
    await setName('amount')
    await fireEvent.click(screen.getByRole('radio', { name: /^Number/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(openAdd).toHaveBeenCalledWith(
      { kind: 'table', tabId, folderPath: 'invoices/2026' },
      'amount',
      'number'
    )
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('passes Select allowed values to the Add property flow', async () => {
    const { tabId } = renderModal()
    await setName('stage')
    await fireEvent.click(screen.getByRole('radio', { name: /^Select/ }))

    const input = screen.getByLabelText('Add allowed value')
    await fireEvent.input(input, { target: { value: 'draft' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.input(input, { target: { value: 'published' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(openAdd).toHaveBeenCalledWith(
      { kind: 'table', tabId, folderPath: 'docs' },
      'stage',
      'select',
      ['draft', 'published']
    )
  })

  it('requires at least one allowed value for a Select column', async () => {
    renderModal()
    await setName('stage')
    await fireEvent.click(screen.getByRole('radio', { name: /^Select/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('alert').textContent).toContain('at least one allowed value')
    expect(openAdd).not.toHaveBeenCalled()
  })

  it('hands a validated name to the Formula editor instead of opening a property batch', async () => {
    const { onformula, onclose } = renderModal()
    await setName('total')
    await fireEvent.click(screen.getByRole('radio', { name: /^Formula/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'Continue to formula' }))

    expect(openAdd).not.toHaveBeenCalled()
    expect(onclose).toHaveBeenCalledOnce()
    expect(onformula).toHaveBeenCalledWith('total')
  })

  it('rejects duplicate, blank, and reserved column names', async () => {
    renderModal()

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter a column name')

    await setName('status')
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert').textContent).toContain('already exists')

    await setName('path')
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert').textContent).toContain('"path" is reserved')
    expect(openAdd).not.toHaveBeenCalled()
  })

  it('hides File when the detected CLI does not support File fields', () => {
    cliFeatures.version = '0.1.9'
    renderModal()

    expect(screen.queryByRole('radio', { name: /^File/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /^Relation/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Formula/ })).toBeTruthy()
  })
})
