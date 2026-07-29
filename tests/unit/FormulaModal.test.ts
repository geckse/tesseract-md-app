import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const api = {
  validateFormula: vi.fn(),
  saveFormula: vi.fn(),
  removeFormula: vi.fn(),
  showConfirmation: vi.fn()
}
Object.defineProperty(window, 'api', { value: api, writable: true })

import FormulaModal from '@renderer/components/table/FormulaModal.svelte'
import type { CollectionColumn } from '@renderer/types/cli'

const price: CollectionColumn = {
  name: 'Unit Price',
  field_type: 'Number',
  description: null,
  occurrence_count: 2,
  sample_values: [],
  allowed_values: null,
  required: false,
  in_schema: true,
  relation_target: null,
  formula: null,
  result_type: null
}

const total: CollectionColumn = {
  ...price,
  name: 'total',
  field_type: 'Formula',
  formula: 'fields["Unit Price"] * quantity',
  result_type: 'Number'
}

describe('FormulaModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.validateFormula.mockResolvedValue({ valid: true, diagnostics: [] })
    api.showConfirmation.mockResolvedValue(false)
    api.removeFormula.mockResolvedValue({
      module: 'formula',
      event: 'manual_run',
      files_evaluated: 2,
      fields_updated: 2,
      diagnostics: [],
      duration_ms: 1
    })
    api.saveFormula.mockResolvedValue({
      module: 'formula',
      event: 'manual_run',
      files_evaluated: 2,
      fields_updated: 2,
      diagnostics: [],
      duration_ms: 1
    })
  })

  it('inserts non-identifier fields through the read-only fields object', async () => {
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [price],
        onclose: vi.fn()
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Unit Price' }))
    expect((screen.getByLabelText('JavaScript expression') as HTMLTextAreaElement).value).toBe(
      'fields["Unit Price"]'
    )
  })

  it('explains that formula results are written to Markdown frontmatter', () => {
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [price],
        onclose: vi.fn()
      }
    })

    expect(
      screen.getByText('Calculated by the CLI and written to Markdown frontmatter.')
    ).toBeTruthy()
  })

  it('warns that removal deletes materialized values from Markdown', async () => {
    api.showConfirmation.mockResolvedValue(true)
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        field: total,
        fields: [price, total],
        onclose: vi.fn()
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Remove formula' }))
    await waitFor(() =>
      expect(api.showConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Its materialized values will be removed from Markdown files in this scope.'
        })
      )
    )
  })

  it('inserts runtime builtin names through the read-only fields object', async () => {
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [{ ...price, name: 'Math' }],
        onclose: vi.fn()
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Math' }))
    expect((screen.getByLabelText('JavaScript expression') as HTMLTextAreaElement).value).toBe(
      'fields["Math"]'
    )
  })

  it('validates and saves through the CLI-backed bridge for the supplied scope', async () => {
    const onclose = vi.fn()
    const onapplied = vi.fn()
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [price],
        onapplied,
        onclose
      }
    })

    await fireEvent.input(screen.getByLabelText('Column name'), {
      target: { value: 'total' }
    })
    await fireEvent.input(screen.getByLabelText('JavaScript expression'), {
      target: { value: 'fields["Unit Price"] * quantity' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(api.validateFormula).toHaveBeenCalledWith(
      '/vault',
      'fields["Unit Price"] * quantity',
      'Number'
    )
    expect(screen.getByText('Formula is valid')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Save formula' }))
    expect(api.saveFormula).toHaveBeenCalledWith(
      'c1',
      'invoices',
      'total',
      'fields["Unit Price"] * quantity',
      'Number'
    )
    expect(onapplied).toHaveBeenCalledOnce()
    await waitFor(() => expect(onclose).toHaveBeenCalled())
  })

  it('cannot close through the backdrop while a save is in progress', async () => {
    let finishSave!: () => void
    api.saveFormula.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              module: 'formula',
              event: 'manual_run',
              files_evaluated: 2,
              fields_updated: 2,
              diagnostics: [],
              duration_ms: 1
            })
        })
    )
    const onclose = vi.fn()
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [price],
        onclose
      }
    })

    await fireEvent.input(screen.getByLabelText('Column name'), { target: { value: 'total' } })
    await fireEvent.input(screen.getByLabelText('JavaScript expression'), {
      target: { value: '1 + 1' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save formula' }))
    const backdrop = screen.getByRole('button', { name: 'Close' })
    expect((backdrop as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(backdrop)
    expect(onclose).not.toHaveBeenCalled()

    finishSave()
    await waitFor(() => expect(onclose).toHaveBeenCalled())
  })

  it('rejects reserved and duplicate names before calling the CLI', async () => {
    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'invoices',
        fields: [price],
        onclose: vi.fn()
      }
    })

    await fireEvent.input(screen.getByLabelText('Column name'), { target: { value: 'path' } })
    await fireEvent.input(screen.getByLabelText('JavaScript expression'), {
      target: { value: '1 + 1' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save formula' }))
    expect(screen.getByRole('alert').textContent).toContain('"path" is reserved')
    expect(api.saveFormula).not.toHaveBeenCalled()
  })

  it('awaits the durable-save hook before mutating and refreshes after the module run', async () => {
    const order: string[] = []
    const onbeforemutate = vi.fn(async () => {
      order.push('flush')
    })
    const onapplied = vi.fn(async () => {
      order.push('refresh')
    })
    api.saveFormula.mockImplementation(async () => {
      order.push('formula')
      return {
        module: 'formula',
        event: 'manual_run',
        files_evaluated: 1,
        fields_updated: 1,
        diagnostics: [],
        duration_ms: 1
      }
    })

    render(FormulaModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: null,
        fields: [price],
        initialName: 'total',
        onbeforemutate,
        onapplied,
        onclose: vi.fn()
      }
    })
    await fireEvent.input(screen.getByLabelText('JavaScript expression'), {
      target: { value: '1 + 1' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save formula' }))

    await waitFor(() => expect(order).toEqual(['flush', 'formula', 'refresh']))
    expect(api.saveFormula).toHaveBeenCalledWith('c1', null, 'total', '1 + 1', 'Number')
  })
})
