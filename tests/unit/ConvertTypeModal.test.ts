import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'

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
  totals: { convert: 1, unchanged: 0, noValue: 1, skip: 1 },
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
    expect(screen.getByRole('dialog', { name: 'Change type of status' })).toBeTruthy()
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
      plan: { ...plan, files: [], totals: { convert: 0, unchanged: 0, noValue: 0, skip: 0 } }
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
        totals: { convert: 0, unchanged: 0, noValue: 0, skip: 0 },
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
    expect(screen.getByRole('dialog', { name: 'Rename property status' })).toBeTruthy()
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
})
