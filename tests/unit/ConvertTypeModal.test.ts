import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/svelte'

// Mock the store's leaf deps so the real property-ops store loads cleanly.
vi.mock('../../src/renderer/stores/collections', async () => {
  const { writable } = await import('svelte/store')
  return { activeCollection: writable({ id: 'c1', path: '/vault', name: 'Vault' }) }
})
vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: { tabs: {}, focusedDocumentTab: null }
}))
vi.mock('../../src/renderer/stores/table.svelte', () => ({
  tableStore: { reload: vi.fn() }
}))
vi.mock('../../src/renderer/stores/schema', () => ({ fetchSchema: vi.fn() }))
vi.mock('../../src/renderer/stores/file-sync', () => ({ handleVaultFileEvent: vi.fn() }))
vi.mock('../../src/renderer/stores/editor', () => ({ requestSave: vi.fn() }))

import {
  propertyOps,
  type PropertyOpModalState
} from '../../src/renderer/stores/property-ops.svelte'
import ConvertTypeModal from '../../src/renderer/components/ConvertTypeModal.svelte'
import type { PropertyOpPlan } from '../../src/preload/api'

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis.window ?? {}, { api: {} }),
    writable: true,
    configurable: true
  })
  propertyOps.modal = null
})

function modalState(over: Partial<PropertyOpModalState> = {}): PropertyOpModalState {
  return {
    phase: 'preview',
    origin: { kind: 'table', tabId: 't1', folderPath: 'knowledge-graph' },
    collection: { id: 'c1', path: '/vault' },
    req: {
      collectionId: 'c1',
      scope: 'knowledge-graph',
      filePath: null,
      key: 'status',
      op: { kind: 'convert', target: 'number' }
    },
    currentType: 'text',
    plan: null,
    progress: null,
    result: null,
    error: null,
    dirtyAffected: [],
    ...over
  }
}

const plan: PropertyOpPlan = {
  scope: 'knowledge-graph',
  files: [
    { path: 'knowledge-graph/a.md', action: 'convert', before: '"3"', after: '3' },
    {
      path: 'knowledge-graph/b.md',
      action: 'skip',
      before: 'drafted',
      reason: 'not a number',
      after: null
    },
    { path: 'knowledge-graph/c.md', action: 'no-value', before: null, after: null }
  ],
  totals: { add: 0, drop: 0, convert: 1, unchanged: 0, noValue: 1, skip: 1 },
  schemaPin: { scopeKey: 'knowledge-graph', fieldType: 'number' }
}

describe('ConvertTypeModal', () => {
  it('renders nothing while the store has no modal state', () => {
    render(ConvertTypeModal)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the preview: totals, per-file rows, skip reasons, schema pin', () => {
    propertyOps.modal = modalState({ plan })
    render(ConvertTypeModal)
    expect(screen.getByRole('dialog', { name: /Change type:/ })).toBeTruthy()
    expect(screen.getByText(/1 file convert/)).toBeTruthy()
    expect(screen.getByText(/1 skipped/)).toBeTruthy()
    expect(screen.getByText('knowledge-graph/b.md')).toBeTruthy()
    expect(screen.getByText('not a number')).toBeTruthy()
    expect(screen.getByText(/will record/)).toBeTruthy()
    const applyBtn = screen.getByRole('button', { name: 'Convert 1 file' }) as HTMLButtonElement
    expect(applyBtn.disabled).toBe(false)
  })

  it('offers "Update schema only" when nothing converts but a pin exists', () => {
    propertyOps.modal = modalState({
      plan: {
        ...plan,
        files: [],
        totals: { add: 0, drop: 0, convert: 0, unchanged: 0, noValue: 0, skip: 0 }
      }
    })
    render(ConvertTypeModal)
    const btn = screen.getByRole('button', { name: 'Update schema only' }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('disables apply when there is nothing to do at all', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: null,
        filePath: 'root.md',
        key: 'status',
        op: { kind: 'convert', target: 'number' }
      },
      plan: {
        scope: null,
        files: [],
        totals: { add: 0, drop: 0, convert: 0, unchanged: 0, noValue: 0, skip: 0 },
        schemaPin: null
      }
    })
    render(ConvertTypeModal)
    const btn = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('warns about dirty affected tabs', () => {
    propertyOps.modal = modalState({ plan, dirtyAffected: ['knowledge-graph/a.md'] })
    render(ConvertTypeModal)
    expect(screen.getByText(/unsaved changes in open tabs/)).toBeTruthy()
  })

  it('uses add-column language and counts without presenting existing keys as writes', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: 'knowledge-graph',
        filePath: null,
        key: 'payload',
        op: { kind: 'add', target: 'complex' }
      },
      currentType: null,
      plan: {
        scope: 'knowledge-graph',
        files: [
          {
            path: 'knowledge-graph/a.md',
            action: 'add',
            before: null,
            after: '{}'
          },
          {
            path: 'knowledge-graph/b.md',
            action: 'unchanged',
            before: '{"kept":true}',
            after: '{"kept":true}',
            reason: 'property already exists'
          }
        ],
        totals: { add: 1, drop: 0, convert: 0, unchanged: 1, noValue: 0, skip: 0 },
        schemaPin: { scopeKey: 'knowledge-graph', fieldType: 'mixed' }
      }
    })

    render(ConvertTypeModal)
    expect(screen.getByRole('dialog', { name: /Add column:/ })).toBeTruthy()
    expect(screen.getByText(/1 file add/)).toBeTruthy()
    expect(screen.getByText(/1 already have this property/)).toBeTruthy()
    expect(screen.getByText(/never overwritten/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to 1 file' })).toBeTruthy()
  })

  it('shows the streamed progress during the run', () => {
    propertyOps.modal = modalState({
      phase: 'running',
      plan,
      progress: { opId: 'op1', done: 3, total: 14, path: 'knowledge-graph/c.md' }
    })
    render(ConvertTypeModal)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
    expect(screen.getByText(/3\/14/)).toBeTruthy()
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
  })

  it('labels streamed Drop progress as a column removal', () => {
    propertyOps.modal = modalState({
      phase: 'running',
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'drop' }
      },
      plan: {
        scope: '.',
        files: [{ path: 'invoices/a.md', action: 'drop', before: 'paid', after: null }],
        totals: { add: 0, drop: 1, convert: 0, unchanged: 0, noValue: 0, skip: 0 },
        schemaPin: null
      },
      progress: { opId: 'op1', done: 1, total: 3, path: 'invoices/a.md' }
    })

    render(ConvertTypeModal)

    expect(screen.getByText(/Dropping column…\s*1\/3/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
  })

  it('reports ok/skipped/failed with reasons', () => {
    propertyOps.modal = modalState({
      phase: 'report',
      plan,
      result: {
        entries: [
          { path: 'a.md', status: 'ok' },
          { path: 'b.md', status: 'skipped', reason: 'not a number' },
          { path: 'c.md', status: 'failed', reason: 'invalid YAML frontmatter' }
        ],
        totals: { ok: 1, skipped: 1, failed: 1 },
        overlayWritten: true
      }
    })
    render(ConvertTypeModal)
    expect(screen.getByText(/1 converted · 1 skipped · 1 failed/)).toBeTruthy()
    expect(screen.getByText(/Schema updated.*no frontmatter rewrite was needed/)).toBeTruthy()
    expect(screen.getByText(/invalid YAML frontmatter/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('rename mode collects the new key before previewing', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: 'knowledge-graph',
        filePath: null,
        key: 'status',
        op: { kind: 'rename', newKey: '' }
      }
    })
    render(ConvertTypeModal)
    expect(screen.getByRole('dialog', { name: /Rename property:/ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'New property name' })).toBeTruthy()
    const preview = screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement
    expect(preview.disabled).toBe(true)
  })

  it('states the vault-wide blast radius for root scopes', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'convert', target: 'number' }
      },
      plan
    })
    render(ConvertTypeModal)
    expect(screen.getByText(/entire vault/)).toBeTruthy()
  })

  it('warns irreversibly and lists exactly the documents affected by Drop', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'drop' }
      },
      plan: {
        scope: '.',
        files: [
          { path: 'invoices/a.md', action: 'drop', before: 'paid', after: null },
          { path: 'invoices/b.md', action: 'no-value', before: null, after: null },
          {
            path: 'broken.md',
            action: 'skip',
            before: null,
            after: null,
            reason: 'invalid YAML frontmatter'
          }
        ],
        totals: { add: 0, drop: 1, convert: 0, unchanged: 0, noValue: 1, skip: 1 },
        schemaPin: null
      }
    })

    render(ConvertTypeModal)

    expect(screen.getByRole('dialog', { name: 'Drop column: status' })).toBeTruthy()
    const warning = screen.getByRole('alert')
    const warningText = warning.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(warningText).toContain('This cannot be undone')
    expect(warningText).toContain("document's frontmatter")
    expect(warningText).toContain('field will be removed from the schema')
    expect(screen.getByText(/1 affected document/)).toBeTruthy()
    expect(screen.getByText(/1 without this field/)).toBeTruthy()
    expect(screen.getByText(/1 skipped/)).toBeTruthy()

    const affected = screen.getByRole('list', { name: 'Affected documents' })
    expect(within(affected).getByText('invoices/a.md')).toBeTruthy()
    expect(within(affected).getByText('paid')).toBeTruthy()
    expect(within(affected).queryByText('invoices/b.md')).toBeNull()
    expect(within(affected).queryByText('broken.md')).toBeNull()

    const drop = screen.getByRole('button', {
      name: 'Drop from 1 document'
    }) as HTMLButtonElement
    expect(drop.className).toContain('btn-danger')
    expect(drop.disabled).toBe(false)
  })

  it('blocks the Drop CTA while an open document has unsaved changes', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'drop' }
      },
      plan: {
        scope: '.',
        files: [{ path: 'a.md', action: 'drop', before: 'draft', after: null }],
        totals: { add: 0, drop: 1, convert: 0, unchanged: 0, noValue: 0, skip: 0 },
        schemaPin: null
      },
      dirtyAffected: ['other-open-document.md']
    })

    render(ConvertTypeModal)

    expect(screen.getByText(/Drop is blocked/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Drop from 1 document' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('allows a schema-only Drop when no document currently contains the field', () => {
    propertyOps.modal = modalState({
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'drop' }
      },
      plan: {
        scope: '.',
        files: [{ path: 'a.md', action: 'no-value', before: null, after: null }],
        totals: { add: 0, drop: 0, convert: 0, unchanged: 0, noValue: 1, skip: 0 },
        schemaPin: null
      }
    })

    render(ConvertTypeModal)

    expect(screen.getByText(/still remove its schema definition/)).toBeTruthy()
    const drop = screen.getByRole('button', { name: 'Drop column' }) as HTMLButtonElement
    expect(drop.className).toContain('btn-danger')
    expect(drop.disabled).toBe(false)
  })

  it('reports Drop removals without listing every already-absent document as skipped', () => {
    propertyOps.modal = modalState({
      phase: 'report',
      req: {
        collectionId: 'c1',
        scope: '.',
        filePath: null,
        key: 'status',
        op: { kind: 'drop' }
      },
      plan: {
        scope: '.',
        files: [],
        totals: { add: 0, drop: 1, convert: 0, unchanged: 0, noValue: 2, skip: 1 },
        schemaPin: null
      },
      result: {
        entries: [
          { path: 'changed.md', status: 'ok' },
          { path: 'absent-a.md', status: 'skipped', reason: 'no value' },
          { path: 'absent-b.md', status: 'skipped', reason: 'no value' },
          { path: 'malformed.md', status: 'skipped', reason: 'invalid YAML frontmatter' },
          { path: 'locked.md', status: 'failed', reason: 'permission denied' }
        ],
        totals: { ok: 1, skipped: 3, failed: 1 },
        overlayWritten: true
      }
    })

    render(ConvertTypeModal)

    const totals = document.querySelector('.totals')?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(totals).toContain('1 removed · 2 already absent · 1 skipped · 1 failed')
    expect(screen.getByText('malformed.md')).toBeTruthy()
    expect(screen.queryByText('absent-a.md')).toBeNull()
    expect(screen.queryByText('absent-b.md')).toBeNull()
    expect(screen.getByText(/Schema definition removed/)).toBeTruthy()
  })
})
