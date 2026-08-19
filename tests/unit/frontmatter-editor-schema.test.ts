import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'

const propertyOpsMock = vi.hoisted(() => ({
  applyOverlayFieldPatch: vi.fn()
}))

vi.mock('../../src/renderer/stores/property-ops.svelte', () => ({
  propertyOps: propertyOpsMock,
  scopeForPanelFile: (path: string): string | null => {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash > 0 ? path.substring(0, lastSlash) : null
  }
}))

// Mock window.api before importing anything
const mockApi = {
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  renameFile: vi.fn(),
  validateFormula: vi.fn(),
  saveFormula: vi.fn(),
  removeFormula: vi.fn(),
  showConfirmation: vi.fn(),
  listTableViews: vi.fn(),
  getDefaultTableColumns: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: Object.assign(globalThis.window ?? {}, { api: mockApi }),
  writable: true
})

import DocumentHeader from '@renderer/components/wysiwyg/DocumentHeader.svelte'
import { documentInfo } from '@renderer/stores/properties'
import type { Schema, SchemaField } from '../../src/renderer/types/cli'

function makeSchemaField(overrides: Partial<SchemaField> & { name: string }): SchemaField {
  return {
    field_type: 'String',
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    relation_target: null,
    formula: null,
    result_type: null,
    ...overrides
  }
}

function makeSchema(fields: SchemaField[]): Schema {
  return { fields, last_updated: Date.now() }
}

const defaultProps = {
  filePath: 'docs/test.md',
  collectionPath: '/collections/test',
  collectionId: 'collection-1',
  documentTabId: 'tab-1',
  onFileRenamed: vi.fn()
}

describe('DocumentHeader schema integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    documentInfo.set(null)
    mockApi.validateFormula.mockResolvedValue({ valid: true, diagnostics: [] })
    mockApi.showConfirmation.mockResolvedValue(false)
    mockApi.listTableViews.mockResolvedValue([])
    mockApi.getDefaultTableColumns.mockResolvedValue(null)
    propertyOpsMock.applyOverlayFieldPatch.mockResolvedValue(undefined)
  })

  it('renders with null schema (no regression)', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: Hello',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render the document header with properties
    expect(container.querySelector('.dh')).toBeTruthy()
    const keyInput = screen.getByDisplayValue('Hello')
    expect(keyInput).toBeTruthy()
  })

  it('edits standalone frontmatter locally without filename or collection schema actions', async () => {
    const onFrontmatterUpdate = vi.fn()
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate,
        schema: null,
        collectionFeaturesEnabled: false,
        showFileName: false,
        ...defaultProps
      }
    })

    expect(container.querySelector('.fne')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'summary' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    expect(screen.queryByRole('option', { name: /^Select$/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /^Relation$/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /^File$/ })).toBeNull()
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Text/ }))

    expect(onFrontmatterUpdate).toHaveBeenCalledWith('summary: ')
    expect(propertyOpsMock.applyOverlayFieldPatch).not.toHaveBeenCalled()
    expect(mockApi.listTableViews).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /Change type of summary/ })).toBeNull()
  })

  it('treats collection-shaped link lists as locally editable values when disabled', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'entries:\n  - one.md\n  - two.md',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        collectionFeaturesEnabled: false,
        ...defaultProps
      }
    })

    expect(container.querySelectorAll('.rel-chip')).toHaveLength(0)
    expect(container.querySelectorAll('.pr-tag')).toHaveLength(2)
  })

  it('uses database column order for display without rewriting YAML key order', async () => {
    mockApi.getDefaultTableColumns.mockResolvedValue([
      { name: 'author', hidden: false, width: 180, order: 0 },
      { name: 'status', hidden: false, width: 180, order: 1 }
    ])
    const onFrontmatterUpdate = vi.fn()
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: draft\nauthor: Ada',
        onFrontmatterUpdate,
        schema: null,
        ...defaultProps
      }
    })

    await waitFor(() => {
      const names = Array.from(
        container.querySelectorAll<HTMLInputElement>('.dh-properties .pr-key')
      ).map((input) => input.value)
      expect(names).toEqual(['author', 'status'])
    })

    await fireEvent.input(screen.getByLabelText('author value'), {
      target: { value: 'Grace' }
    })
    const yaml = onFrontmatterUpdate.mock.calls.at(-1)?.[0] as string
    expect(yaml.indexOf('status:')).toBeLessThan(yaml.indexOf('author:'))
    expect(yaml).toContain('author: Grace')
  })

  it('renders <select> for fields with allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published', 'archived']
      })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: draft',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.tagName).toBe('SELECT')

    const options = Array.from(select.querySelectorAll('option'))
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('draft')
    expect(optionValues).toContain('published')
    expect(optionValues).toContain('archived')
  })

  it('renders required indicator for required fields', () => {
    const schema = makeSchema([makeSchemaField({ name: 'title', required: true })])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: My Doc',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const indicator = container.querySelector('.pr-required')
    expect(indicator).toBeTruthy()
    expect(indicator!.textContent).toBe('*')
  })

  it('renders schema-only Formula fields but excludes them from raw-property autocomplete', async () => {
    const onFrontmatterUpdate = vi.fn()
    const schema = makeSchema([
      makeSchemaField({
        name: 'total',
        field_type: 'Formula',
        formula: 'price * quantity',
        result_type: 'Number'
      }),
      makeSchemaField({ name: 'status' })
    ])

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'price: 5',
        onFrontmatterUpdate,
        schema,
        ...defaultProps
      }
    })

    expect(screen.getByLabelText('Formula value for total').textContent).toContain('—')
    expect(screen.getByRole('button', { name: 'Formula options for total' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const suggestions = screen.getByRole('listbox', { name: 'Autocomplete suggestions' })

    expect(within(suggestions).queryByRole('option', { name: /total/i })).toBeNull()
    expect(within(suggestions).getByRole('option', { name: /status/i })).toBeTruthy()
    expect(onFrontmatterUpdate).not.toHaveBeenCalled()
  })

  it('writes a newly added property to frontmatter and the scoped schema in order', async () => {
    const order: string[] = []
    const onFrontmatterUpdate = vi.fn()
    const onBeforeSchemaMutate = vi.fn(async () => {
      order.push('flush')
    })
    const onSchemaApplied = vi.fn(async () => {
      order.push('refresh')
    })
    propertyOpsMock.applyOverlayFieldPatch.mockImplementation(async () => {
      order.push('schema')
    })

    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate,
        schema: null,
        onBeforeSchemaMutate,
        onSchemaApplied,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'amount' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Number/ }))

    await waitFor(() => {
      expect(propertyOpsMock.applyOverlayFieldPatch).toHaveBeenCalledWith(
        'docs',
        'amount',
        { fieldType: 'number' },
        { id: 'collection-1', path: '/collections/test' }
      )
    })
    expect(onFrontmatterUpdate).toHaveBeenCalledWith('amount: 0')
    expect(order).toEqual(['flush', 'schema', 'refresh'])
  })

  it('does not rewrite the schema when adding a field already defined there', async () => {
    const onFrontmatterUpdate = vi.fn()
    const schema = makeSchema([makeSchemaField({ name: 'status', field_type: 'String' })])
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate,
        schema,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    await fireEvent.mouseDown(screen.getByRole('option', { name: /status/i }))

    expect(onFrontmatterUpdate).toHaveBeenCalledWith('status: ')
    expect(propertyOpsMock.applyOverlayFieldPatch).not.toHaveBeenCalled()
  })

  it('surfaces a failed automatic schema write and retries it', async () => {
    propertyOpsMock.applyOverlayFieldPatch
      .mockRejectedValueOnce(new Error('overlay is malformed'))
      .mockResolvedValueOnce(undefined)

    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'priority' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Text/ }))

    expect(await screen.findByText(/“priority” was not added to the schema/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(propertyOpsMock.applyOverlayFieldPatch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('collects Select values and persists them with the schema field', async () => {
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'stage' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Select/ }))

    const allowedValue = screen.getByRole('textbox', { name: 'Allowed value' })
    await fireEvent.input(allowedValue, { target: { value: 'draft' } })
    await fireEvent.keyDown(allowedValue, { key: 'Enter' })
    await fireEvent.input(allowedValue, { target: { value: 'published' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add Select property' }))

    await waitFor(() => {
      expect(propertyOpsMock.applyOverlayFieldPatch).toHaveBeenCalledWith(
        'docs',
        'stage',
        { fieldType: 'string', allowedValues: ['draft', 'published'] },
        { id: 'collection-1', path: '/collections/test' }
      )
    })
  })

  it('does not create a duplicate raw property or schema entry', async () => {
    const onFrontmatterUpdate = vi.fn()
    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: draft',
        onFrontmatterUpdate,
        schema: null,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'status' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(screen.getByRole('alert').textContent).toContain('already exists')
    expect(onFrontmatterUpdate).not.toHaveBeenCalled()
    expect(propertyOpsMock.applyOverlayFieldPatch).not.toHaveBeenCalled()
  })

  it('keeps a DateTime property rendered as DateTime after its Date schema pin arrives', () => {
    const schema = makeSchema([makeSchemaField({ name: 'starts_at', field_type: 'Date' })])
    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'starts_at: 2026-07-29T18:30',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    expect(screen.getByRole('button', { name: 'Open date time picker' })).toBeTruthy()
  })

  it('keeps a queued schema write bound to its originating document context', async () => {
    let releaseFlush!: () => void
    const flush = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    const onBeforeSchemaMutate = vi.fn(() => flush)
    let emittedYaml: string | null = null
    const onFrontmatterUpdate = vi.fn((yaml: string | null) => {
      emittedYaml = yaml
    })
    const { rerender } = render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate,
        schema: null,
        onBeforeSchemaMutate,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'amount' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Number/ }))
    await waitFor(() => expect(onBeforeSchemaMutate).toHaveBeenCalledOnce())

    await rerender({
      frontmatterYaml: emittedYaml,
      onFrontmatterUpdate,
      schema: null,
      filePath: 'other/switched.md',
      collectionPath: '/collections/other',
      collectionId: 'collection-2',
      documentTabId: 'tab-2',
      onFileRenamed: vi.fn()
    })
    releaseFlush()

    await waitFor(() => {
      expect(propertyOpsMock.applyOverlayFieldPatch).toHaveBeenCalledWith(
        'docs',
        'amount',
        { fieldType: 'number' },
        { id: 'collection-1', path: '/collections/test' }
      )
    })
  })

  it('automatically adds an untitled property to schema after Save As', async () => {
    let emittedYaml: string | null = null
    const onFrontmatterUpdate = vi.fn((yaml: string | null) => {
      emittedYaml = yaml
    })
    const { rerender } = render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate,
        schema: null,
        isUntitled: true,
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'priority' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Number/ }))

    expect(await screen.findByText(/retry automatically after the document is saved/)).toBeTruthy()
    expect(propertyOpsMock.applyOverlayFieldPatch).not.toHaveBeenCalled()

    await rerender({
      frontmatterYaml: emittedYaml,
      onFrontmatterUpdate,
      schema: null,
      filePath: 'saved/new-note.md',
      collectionPath: '/collections/test',
      collectionId: 'collection-1',
      documentTabId: 'tab-1',
      isUntitled: false,
      onFileRenamed: vi.fn()
    })

    await waitFor(() => {
      expect(propertyOpsMock.applyOverlayFieldPatch).toHaveBeenCalledWith(
        'saved',
        'priority',
        { fieldType: 'number' },
        { id: 'collection-1', path: '/collections/test' }
      )
    })
  })

  it('renders one materialized Formula row with a read-only key and value plus edit options', async () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'total',
        field_type: 'Formula',
        formula: 'price * quantity',
        result_type: 'Number'
      })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'price: 5\ntotal: 12.50',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const formulaValue = screen.getByLabelText('Formula value for total')
    expect(formulaValue.textContent).toContain('12.5')
    expect(screen.queryByRole('textbox', { name: 'total value' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Property options for total' })).toBeNull()
    expect(container.querySelectorAll('.pr-key-readonly')).toHaveLength(1)
    expect(formulaValue.closest('.pr')?.querySelector('[aria-label="Remove property"]')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Formula options for total' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Edit formula/ }))

    expect(screen.getByRole('dialog', { name: 'Edit formula total' })).toBeTruthy()
    expect((screen.getByLabelText('JavaScript expression') as HTMLTextAreaElement).value).toBe(
      'price * quantity'
    )
  })

  it('keeps a failed unmaterialized Formula visible and editable without serializing it', async () => {
    const onFrontmatterUpdate = vi.fn()
    const schema = makeSchema([
      makeSchemaField({
        name: 'total',
        field_type: 'Formula',
        formula: 'price / quantity',
        result_type: 'Number'
      })
    ])
    documentInfo.set({
      path: 'docs/test.md',
      content_hash: 'hash',
      frontmatter: { price: 5 },
      computed_fields: {},
      computed_field_errors: {
        total: {
          module: 'formula',
          field: 'total',
          code: 'division_by_zero',
          message: 'Division by zero',
          span_start: null,
          span_end: null
        }
      },
      chunk_count: 1,
      file_size: 20,
      indexed_at: 1,
      modified_at: 1
    })

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'price: 5',
        onFrontmatterUpdate,
        schema,
        ...defaultProps
      }
    })

    expect(screen.getByLabelText('Formula error for total: Division by zero')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Formula options for total' }))
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Edit formula/ }))

    expect(screen.getByRole('dialog', { name: 'Edit formula total' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'price' })).toBeTruthy()
    expect(onFrontmatterUpdate).not.toHaveBeenCalled()
  })

  it('opens Add Formula from the property type picker without inserting a raw key', async () => {
    const onFrontmatterUpdate = vi.fn()
    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'adHocAmount: 5',
        onFrontmatterUpdate,
        schema: makeSchema([makeSchemaField({ name: 'status' })]),
        ...defaultProps
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    const nameInput = screen.getByPlaceholderText('Property name...')
    await fireEvent.input(nameInput, { target: { value: 'total' } })
    await fireEvent.keyDown(nameInput, { key: 'Enter' })
    await fireEvent.mouseDown(screen.getByRole('option', { name: /Formula/ }))

    expect(screen.getByRole('dialog', { name: 'Add formula' })).toBeTruthy()
    expect(screen.getByDisplayValue('total')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'adHocAmount' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'status' })).toBeTruthy()
    expect(onFrontmatterUpdate).not.toHaveBeenCalled()
  })

  it('preserves exact Formula, Lookup, and Rollup YAML nodes when an ordinary sibling is edited', async () => {
    const onFrontmatterUpdate = vi.fn()
    const schema = makeSchema([
      makeSchemaField({ name: 'price', field_type: 'Number' }),
      makeSchemaField({
        name: 'total',
        field_type: 'Formula',
        formula: 'price / 3',
        result_type: 'Number'
      }),
      makeSchemaField({
        name: 'payload',
        field_type: 'Formula',
        formula: '({ nested: sequence })',
        result_type: 'Json'
      }),
      makeSchemaField({
        name: 'lookup_payload',
        field_type: 'Lookup',
        relation_field: 'client',
        target_field: 'payload',
        relation_direction: 'Outgoing'
      }),
      makeSchemaField({
        name: 'rollup_total',
        field_type: 'Rollup',
        relation_field: 'invoices',
        target_field: 'total',
        relation_direction: 'Outgoing',
        formula: 'values.reduce((sum, value) => sum + value, 0)',
        result_type: 'Number'
      })
    ])
    const frontmatterYaml = [
      'price: 1',
      'total: 0.1234567890123456789012345678 # exact',
      'payload:',
      '  nested: 9007199254740993',
      '  values:',
      '    - 0.10000000000000001',
      'lookup_payload:',
      '  - domain: example.com',
      '    exact: 9007199254740993',
      'rollup_total: 1234567890.123456789012345678 # aggregate'
    ].join('\n')

    render(DocumentHeader, {
      props: {
        frontmatterYaml,
        onFrontmatterUpdate,
        schema,
        ...defaultProps
      }
    })

    const lookupValue = screen.getByLabelText('Lookup value for lookup_payload')
    const lookupIcon = lookupValue.querySelector('.pr-formula-mark')
    expect(lookupIcon?.textContent).toContain('arrow_outward')
    expect(lookupIcon?.classList.contains('material-symbols-outlined')).toBe(true)

    await fireEvent.input(screen.getByRole('spinbutton', { name: 'price value' }), {
      target: { value: '2' }
    })

    const updated = onFrontmatterUpdate.mock.calls.at(-1)?.[0] as string
    expect(updated).toContain('price: 2')
    expect(updated).toContain('total: 0.1234567890123456789012345678 # exact')
    expect(updated).toContain(
      'payload:\n  nested: 9007199254740993\n  values:\n    - 0.10000000000000001'
    )
    expect(updated).toContain(
      'lookup_payload:\n  - domain: example.com\n    exact: 9007199254740993'
    )
    expect(updated).toContain('rollup_total: 1234567890.123456789012345678 # aggregate')
  })

  it('sets title attribute from schema field description', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'title',
        description: 'The document title'
      })
    ])

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: Test',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const keyInput = screen.getByLabelText('Property name')
    expect(keyInput.getAttribute('title')).toBe('The document title')
  })

  it('preserves current value in <select> when it matches allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published', 'archived']
      })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: published',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()

    const selectedOption = select.querySelector('option[selected]') as HTMLOptionElement
    expect(selectedOption).toBeTruthy()
    expect(selectedOption.value).toBe('published')
  })

  it('preserves current value in <select> even when not in allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published']
      })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: custom-value',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()

    const options = Array.from(select.querySelectorAll('option'))
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('custom-value')
  })

  it('does not render required indicator for non-required fields', () => {
    const schema = makeSchema([makeSchemaField({ name: 'tags', required: false })])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'tags: foo',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const indicator = container.querySelector('.pr-required')
    expect(indicator).toBeFalsy()
  })

  it('renders text input (not select) when no allowed_values', () => {
    const schema = makeSchema([makeSchemaField({ name: 'author', allowed_values: null })])

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'author: Alice',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    expect(screen.getByDisplayValue('Alice')).toBeTruthy()
  })

  it('renders file name editor with correct name', () => {
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should show filename without .md extension
    expect(screen.getByText('test')).toBeTruthy()
    // Should show .md extension
    expect(screen.getByText('.md')).toBeTruthy()
  })

  it('shows add property button', () => {
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    expect(screen.getByText('Add property')).toBeTruthy()
  })

  it('shows type icons for properties', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'count: 42',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Number type icon should be present
    const typeIcon = container.querySelector('.pr-type-icon')
    expect(typeIcon).toBeTruthy()
  })

  it('detects date type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'created: 2024-03-15',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render date picker button
    const calendarBtn = container.querySelector('[aria-label="Open date picker"]')
    expect(calendarBtn).toBeTruthy()
  })

  it('detects datetime type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'updated: 2024-03-15T14:30',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render datetime picker button
    const datetimeBtn = container.querySelector('[aria-label="Open date time picker"]')
    expect(datetimeBtn).toBeTruthy()
  })

  it('detects URL type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'website: https://example.com',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render open URL button
    const openBtn = container.querySelector('[aria-label="Open URL"]')
    expect(openBtn).toBeTruthy()
  })

  it('detects boolean type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'published: true',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render toggle switch
    const toggle = container.querySelector('.pr-toggle')
    expect(toggle).toBeTruthy()
  })

  it('detects tags type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'tags:\n  - rust\n  - ai',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    // Should render tag pills
    const tags = container.querySelectorAll('.pr-tag')
    expect(tags.length).toBe(2)
  })

  it('renders shape-preserving Lookup values by type instead of serializing them as text', () => {
    const schema = makeSchema([
      makeSchemaField({ name: 'domains', field_type: 'Lookup' }),
      makeSchemaField({ name: 'active', field_type: 'Lookup' }),
      makeSchemaField({ name: 'score', field_type: 'Lookup' }),
      makeSchemaField({ name: 'reviewed', field_type: 'Lookup' }),
      makeSchemaField({ name: 'details', field_type: 'Lookup' })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: [
          'domains:',
          '  - acme.example',
          '  - globex.example',
          'active: true',
          'score: 42',
          'reviewed: 2026-08-03',
          'details:',
          '  owner: platform',
          '  tier: 2'
        ].join('\n'),
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    expect(container.querySelectorAll('.pr-computed-chip')).toHaveLength(2)
    expect(screen.getByText('acme.example')).toBeTruthy()
    expect(screen.getByText('globex.example')).toBeTruthy()
    expect(screen.queryByText('["acme.example","globex.example"]')).toBeNull()
    expect(screen.getByLabelText('True')).toBeTruthy()
    expect(container.querySelector('.pr-computed-mono')?.textContent).toBe('42')
    expect(container.querySelector('.pr-computed-value-icon')?.textContent).toContain(
      'calendar_today'
    )
    expect(container.querySelector('.pr-formula-value .key')?.textContent).toBe('"owner"')
    expect(container.querySelector('.pr-formula-value .number')?.textContent).toBe('2')
  })

  it('keeps link-shaped Lookup output in computed list presentation', () => {
    const schema = makeSchema([makeSchemaField({ name: 'documents', field_type: 'Lookup' })])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'documents:\n  - guides/one.md\n  - guides/two.md',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    expect(container.querySelectorAll('.pr-computed-chip')).toHaveLength(2)
    expect(container.querySelector('.relation-chip')).toBeNull()
    expect(container.querySelector('.pr-file-tiles')).toBeNull()
  })

  it('renders unambiguous file links as files despite a stale Relation schema', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'assets',
        field_type: 'Relation'
      })
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'assets:\n  - "[[Branding/cover.jpg]]"\n  - "[[Branding/source.buzz]]"',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps
      }
    })

    const tiles = container.querySelectorAll('.file-tile')
    expect(tiles).toHaveLength(2)
    expect([...tiles].every((tile) => tile.classList.contains('compact'))).toBe(true)
    expect(container.querySelector('.relation-chip')).toBeNull()
  })

  it('detects a plain Markdown filename list as relations without a schema', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml:
          'entries:\n  - what-is-okf.md\n  - validation-rules.md\n  - another-markdown.md',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps
      }
    })

    expect(container.querySelectorAll('.rel-chip')).toHaveLength(3)
    expect(container.querySelectorAll('.pr-tag')).toHaveLength(0)
  })
})
