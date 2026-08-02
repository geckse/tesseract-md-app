import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const api = {
  tree: vi.fn(),
  collection: vi.fn(),
  validateRollup: vi.fn(),
  saveLookupRollup: vi.fn(),
  removeLookupRollup: vi.fn(),
  showConfirmation: vi.fn()
}
Object.defineProperty(window, 'api', { value: api, writable: true })

import LookupRollupModal from '@renderer/components/table/LookupRollupModal.svelte'
import type { CollectionColumn, FieldType } from '@renderer/types/cli'

function column(
  name: string,
  fieldType: FieldType,
  relationTarget: string | null = null
): CollectionColumn {
  return {
    name,
    field_type: fieldType,
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema: true,
    relation_target: relationTarget,
    formula: null,
    result_type: null
  }
}

function targetColumn(
  name: string,
  fieldType: FieldType,
  relationTarget: string | null = null,
  inSchema = true
): CollectionColumn {
  return { ...column(name, fieldType, relationTarget), in_schema: inSchema }
}

const client = column('client', 'Relation', 'clients')
const status = column('status', 'String')

describe('LookupRollupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.collection.mockImplementation(async (_root: string, scope: string) => ({
      columns:
        scope === 'clients'
          ? [targetColumn('domain', 'String', null, false)]
          : [
              targetColumn('client', 'Relation', 'clients'),
              targetColumn('vendor', 'Relation', 'vendors'),
              targetColumn('unscoped', 'Relation'),
              targetColumn('total', 'Formula')
            ],
      rows: [],
      scope,
      recursive: true,
      total_rows: 0,
      offset: 0
    }))
    api.tree.mockResolvedValue({
      root: {
        name: '',
        path: '',
        is_dir: true,
        state: null,
        children: [
          { name: 'clients', path: 'clients', is_dir: true, state: null, children: [] },
          { name: 'invoices', path: 'invoices', is_dir: true, state: null, children: [] }
        ]
      },
      total_files: 0,
      indexed_count: 0,
      modified_count: 0,
      new_count: 0,
      deleted_count: 0
    })
    api.validateRollup.mockResolvedValue({ valid: true, diagnostics: [] })
    api.saveLookupRollup.mockResolvedValue({
      module: 'lookup_rollup',
      event: 'manual_run',
      files_evaluated: 1,
      fields_updated: 1,
      diagnostics: [],
      duration_ms: 1
    })
  })

  it('authors a shape-preserving outgoing Lookup through a targeted Relation', async () => {
    const onclose = vi.fn()
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'contacts',
        kind: 'lookup',
        fields: [status, client],
        initialName: 'client_domain',
        onclose
      }
    })

    const lookupIcon = screen.getByText('arrow_outward')
    expect(lookupIcon.classList.contains('computed-mark')).toBe(true)
    expect(lookupIcon.classList.contains('material-symbols-outlined')).toBe(true)

    const relationSelect = screen.getByLabelText('Relation field')
    expect(
      Array.from((relationSelect as HTMLSelectElement).options).map((option) => option.value)
    ).toEqual(['', 'client'])
    await fireEvent.change(relationSelect, { target: { value: 'client' } })
    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'clients', {
        recursive: true,
        limit: 0
      })
    )
    expect(screen.getByRole('option', { name: 'domain · String' })).toBeTruthy()
    await fireEvent.change(screen.getByLabelText('Field to retrieve'), {
      target: { value: 'domain' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Lookup' }))

    expect(api.saveLookupRollup).toHaveBeenCalledWith('c1', 'contacts', 'client_domain', {
      kind: 'lookup',
      relationField: 'client',
      targetField: 'domain',
      relationDirection: 'outgoing'
    })
    await waitFor(() => expect(onclose).toHaveBeenCalled())
  })

  it('loads the selected Relation target schema instead of the current folder schema', async () => {
    api.collection.mockImplementation(async (_root: string, requestedScope: string) => ({
      columns:
        requestedScope === 'clients'
          ? [targetColumn('client_domain', 'String', null, false)]
          : [targetColumn('project_budget', 'Number', null, false)],
      rows: [],
      scope: requestedScope,
      recursive: true,
      total_rows: 1,
      offset: 0
    }))
    const existingLookup = {
      ...column('Client Name', 'Lookup'),
      relation_field: 'client',
      target_field: 'client_domain',
      relation_direction: 'Outgoing' as const
    }

    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        // This is deliberately the sibling folder named in the bug report.
        // The target must still come from client.relation_target (`clients`).
        scope: 'projects',
        kind: 'lookup',
        field: existingLookup,
        fields: [client, column('project', 'Relation', 'projects')],
        onclose: vi.fn()
      }
    })

    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'clients', {
        recursive: true,
        limit: 0
      })
    )
    expect(api.collection).not.toHaveBeenCalledWith('/vault', 'projects', expect.anything())
    expect(screen.getByRole('option', { name: 'client_domain · String' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'project_budget · Number' })).toBeNull()
  })

  it('renames an existing Lookup and sends its original key for an atomic move', async () => {
    const existingLookup = {
      ...column('client_domain', 'Lookup'),
      relation_field: 'client',
      target_field: 'domain',
      relation_direction: 'Outgoing' as const
    }
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'contacts',
        kind: 'lookup',
        field: existingLookup,
        fields: [existingLookup, status, client],
        onclose: vi.fn()
      }
    })

    const nameInput = screen.getByLabelText('Column name') as HTMLInputElement
    expect(nameInput.disabled).toBe(false)
    await fireEvent.input(nameInput, { target: { value: 'client_industry' } })
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'domain · String' })).toBeTruthy()
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Save Lookup' }))

    expect(api.saveLookupRollup).toHaveBeenCalledWith(
      'c1',
      'contacts',
      'client_industry',
      {
        kind: 'lookup',
        relationField: 'client',
        targetField: 'domain',
        relationDirection: 'outgoing'
      },
      'client_domain'
    )
  })

  it('identifies an unchanged-name edit as an update of the existing definition', async () => {
    const existingLookup = {
      ...column('client_domain', 'Lookup'),
      relation_field: 'client',
      target_field: 'domain',
      relation_direction: 'Outgoing' as const
    }
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'contacts',
        kind: 'lookup',
        field: existingLookup,
        fields: [existingLookup, client],
        onclose: vi.fn()
      }
    })

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'domain · String' })).toBeTruthy()
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Save Lookup' }))

    expect(api.saveLookupRollup).toHaveBeenCalledWith(
      'c1',
      'contacts',
      'client_domain',
      expect.objectContaining({ kind: 'lookup' }),
      'client_domain'
    )
  })

  it('blocks renaming a Lookup over another column', async () => {
    const existingLookup = {
      ...column('client_domain', 'Lookup'),
      relation_field: 'client',
      target_field: 'domain',
      relation_direction: 'Outgoing' as const
    }
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'contacts',
        kind: 'lookup',
        field: existingLookup,
        fields: [existingLookup, status, client],
        onclose: vi.fn()
      }
    })

    await fireEvent.input(screen.getByLabelText('Column name'), {
      target: { value: 'status' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Lookup' }))

    expect(screen.getByRole('alert').textContent).toContain(
      'A column named "status" already exists'
    )
    expect(api.saveLookupRollup).not.toHaveBeenCalled()
  })

  it('authors an incoming Rollup with a stored formula preset', async () => {
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'clients',
        kind: 'rollup',
        fields: [status],
        initialName: 'invoice_total',
        onclose: vi.fn()
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Incoming' }))
    await waitFor(() => expect(api.tree).toHaveBeenCalledWith('/vault'))
    await fireEvent.change(screen.getByLabelText(/^Folder/), {
      target: { value: 'invoices' }
    })
    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'invoices', {
        recursive: true,
        limit: 0
      })
    )
    const relationSelect = screen.getByLabelText('Incoming Relation field')
    expect(
      Array.from((relationSelect as HTMLSelectElement).options).map((option) => option.value)
    ).toEqual(['', 'client'])
    await fireEvent.change(relationSelect, {
      target: { value: 'client' }
    })
    await fireEvent.change(screen.getByLabelText('Field to retrieve'), {
      target: { value: 'total' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Sum' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(api.validateRollup).toHaveBeenCalledWith(
      '/vault',
      'values.reduce((sum, value) => sum + value, 0)',
      'Number'
    )

    await fireEvent.click(screen.getByRole('button', { name: 'Save Rollup' }))
    expect(api.saveLookupRollup).toHaveBeenCalledWith('c1', 'clients', 'invoice_total', {
      kind: 'rollup',
      relationField: 'client',
      targetField: 'total',
      relationDirection: 'incoming',
      relationScope: 'invoices',
      formula: 'values.reduce((sum, value) => sum + value, 0)',
      resultType: 'Number'
    })
  })

  it('keeps a drifted incoming Relation inspectable but blocks saving it', async () => {
    const drifted = {
      ...column('invoice_total', 'Rollup'),
      relation_field: 'vendor',
      target_field: 'total',
      relation_direction: 'Incoming' as const,
      relation_scope: 'invoices',
      formula: 'values.length',
      result_type: 'Number' as const
    }
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'clients',
        kind: 'rollup',
        field: drifted,
        fields: [status],
        onclose: vi.fn()
      }
    })

    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'invoices', {
        recursive: true,
        limit: 0
      })
    )
    const relationSelect = screen.getByLabelText('Incoming Relation field') as HTMLSelectElement
    expect(relationSelect.value).toBe('vendor')
    expect(
      screen.getByRole('option', { name: /vendor \(does not target this folder\)/ })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove definition from this scope' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Save Rollup' }))
    expect(screen.getByRole('alert').textContent).toContain(
      'The selected Relation must target clients'
    )
    expect(api.saveLookupRollup).not.toHaveBeenCalled()
  })

  it('ignores a stale target-schema response after the Relation changes', async () => {
    let resolveClients!: (value: { columns: CollectionColumn[] }) => void
    let resolveVendors!: (value: { columns: CollectionColumn[] }) => void
    api.collection.mockImplementation(
      async (_root: string, requestedScope: string) =>
        new Promise((resolve) => {
          if (requestedScope === 'clients') resolveClients = resolve
          if (requestedScope === 'vendors') resolveVendors = resolve
        })
    )
    render(LookupRollupModal, {
      props: {
        collectionId: 'c1',
        root: '/vault',
        scope: 'contacts',
        kind: 'lookup',
        fields: [client, column('vendor', 'Relation', 'vendors')],
        initialName: 'related_name',
        onclose: vi.fn()
      }
    })

    const relation = screen.getByLabelText('Relation field')
    await fireEvent.change(relation, { target: { value: 'client' } })
    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'clients', {
        recursive: true,
        limit: 0
      })
    )
    await fireEvent.change(relation, { target: { value: 'vendor' } })
    await waitFor(() =>
      expect(api.collection).toHaveBeenCalledWith('/vault', 'vendors', {
        recursive: true,
        limit: 0
      })
    )
    resolveVendors({ columns: [targetColumn('vendor_domain', 'String')] })
    await waitFor(() => expect(screen.getByRole('option', { name: /vendor_domain/ })).toBeTruthy())
    resolveClients({ columns: [targetColumn('domain', 'String')] })
    await Promise.resolve()

    expect(screen.queryByRole('option', { name: /^domain/ })).toBeNull()
    expect(screen.getByRole('option', { name: /vendor_domain/ })).toBeTruthy()
  })
})
