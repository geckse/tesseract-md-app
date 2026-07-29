import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks (leaf deps of the store) ────────────────────────────────
const callOrder: string[] = []

vi.mock('../../src/renderer/stores/collections', async () => {
  const { writable } = await import('svelte/store')
  return { activeCollection: writable({ id: 'c1', path: '/vault', name: 'Vault' }) }
})

vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: {
    tabs: {} as Record<string, unknown>,
    focusedDocumentTab: null as unknown
  }
}))

vi.mock('../../src/renderer/stores/table.svelte', () => ({
  tableStore: {
    reload: vi.fn(async () => {
      callOrder.push('table-reload')
    })
  }
}))

vi.mock('../../src/renderer/stores/schema', () => ({
  fetchSchema: vi.fn(async () => {
    callOrder.push('fetch-schema')
  })
}))

vi.mock('../../src/renderer/stores/file-sync', () => ({
  handleVaultFileEvent: vi.fn(() => {
    callOrder.push('file-sync')
  })
}))

vi.mock('../../src/renderer/stores/editor', () => ({
  requestSave: vi.fn()
}))

import {
  propertyOps,
  scopeForPanelFile,
  scopeForTableTab,
  isVaultWideScope
} from '../../src/renderer/stores/property-ops.svelte'
import { activeCollection } from '../../src/renderer/stores/collections'
import { workspace } from '../../src/renderer/stores/workspace.svelte'
import { tableStore } from '../../src/renderer/stores/table.svelte'
import { fetchSchema } from '../../src/renderer/stores/schema'
import { handleVaultFileEvent } from '../../src/renderer/stores/file-sync'
import type { PropertyOpPlan, PropertyOpResult } from '../../src/preload/api'

const emptyPlan: PropertyOpPlan = {
  scope: 'docs',
  files: [],
  totals: { add: 0, drop: 0, convert: 0, unchanged: 0, noValue: 0, skip: 0 },
  schemaPin: { scopeKey: 'docs', fieldType: 'number' }
}

const okResult: PropertyOpResult = {
  entries: [
    { path: 'docs/a.md', status: 'ok' },
    { path: 'docs/b.md', status: 'skipped', reason: 'no value' }
  ],
  totals: { ok: 1, skipped: 1, failed: 0 },
  overlayWritten: true
}

interface MockApi {
  previewPropertyOp: ReturnType<typeof vi.fn>
  applyPropertyOp: ReturnType<typeof vi.fn>
  updateOverlayField: ReturnType<typeof vi.fn>
  onPropertyOpProgress: ReturnType<typeof vi.fn>
  ingest: ReturnType<typeof vi.fn>
}

let mockApi: MockApi
let progressCallback: ((p: unknown) => void) | null = null
let unsubscribed = false

function setActiveCollection(value: { id: string; path: string; name: string }): void {
  ;(
    activeCollection as unknown as {
      set(next: { id: string; path: string; name: string }): void
    }
  ).set(value)
}

beforeEach(() => {
  callOrder.length = 0
  progressCallback = null
  unsubscribed = false
  mockApi = {
    previewPropertyOp: vi.fn(async () => emptyPlan),
    applyPropertyOp: vi.fn(async () => {
      callOrder.push('apply')
      return okResult
    }),
    updateOverlayField: vi.fn(async () => {}),
    onPropertyOpProgress: vi.fn((cb: (p: unknown) => void) => {
      progressCallback = cb
      return () => {
        unsubscribed = true
      }
    }),
    ingest: vi.fn(async () => {
      callOrder.push('ingest')
      return {}
    })
  }
  Object.defineProperty(globalThis, 'window', {
    value: { api: mockApi },
    writable: true,
    configurable: true
  })
  ;(workspace as { tabs: Record<string, unknown> }).tabs = {}
  ;(workspace as { focusedDocumentTab: unknown }).focusedDocumentTab = null
  setActiveCollection({ id: 'c1', path: '/vault', name: 'Vault' })
  vi.mocked(tableStore.reload).mockClear()
  vi.mocked(fetchSchema).mockClear()
  vi.mocked(handleVaultFileEvent).mockClear()
  propertyOps.close()
})

describe('scope helpers', () => {
  it('scopeForPanelFile: parent directory subtree, null for vault-root files', () => {
    expect(scopeForPanelFile('docs/a.md')).toBe('docs')
    expect(scopeForPanelFile('docs/guides/b.md')).toBe('docs/guides')
    expect(scopeForPanelFile('a.md')).toBeNull()
  })

  it('scopeForTableTab: folder path, "." for the root table', () => {
    expect(scopeForTableTab('')).toBe('.')
    expect(scopeForTableTab('docs')).toBe('docs')
  })

  it('isVaultWideScope', () => {
    expect(isVaultWideScope('.')).toBe(true)
    expect(isVaultWideScope('')).toBe(true)
    expect(isVaultWideScope('docs')).toBe(false)
    expect(isVaultWideScope(null)).toBe(false)
  })
})

describe('openConvert', () => {
  it('builds the request from a panel origin and previews', async () => {
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/a.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    const req = mockApi.previewPropertyOp.mock.calls[0][0]
    expect(req).toEqual({
      collectionId: 'c1',
      scope: 'docs',
      filePath: null,
      key: 'status',
      op: { kind: 'convert', target: 'number' }
    })
    expect(propertyOps.modal?.plan).toEqual(emptyPlan)
  })

  it('vault-root panel files become single-file requests', async () => {
    propertyOps.openConvert({ kind: 'panel', filePath: 'root.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    const req = mockApi.previewPropertyOp.mock.calls[0][0]
    expect(req.scope).toBeNull()
    expect(req.filePath).toBe('root.md')
  })

  it('is a no-op while another modal is open', async () => {
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/a.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal).not.toBeNull())
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/b.md' }, 'other', 'tags', 'text')
    expect(propertyOps.modal?.req.key).toBe('status')
  })

  it('prefills allowed values for select targets from distinct plan values', async () => {
    mockApi.previewPropertyOp.mockResolvedValueOnce({
      ...emptyPlan,
      files: [
        { path: 'a.md', action: 'unchanged', before: 'drafted', after: 'drafted' },
        { path: 'b.md', action: 'unchanged', before: 'published', after: 'published' },
        { path: 'c.md', action: 'no-value', before: null, after: null }
      ]
    })
    propertyOps.openConvert(
      { kind: 'table', tabId: 't1', folderPath: 'docs' },
      'status',
      'select',
      'text'
    )
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    const op = propertyOps.modal?.req.op
    expect(op?.kind === 'convert' && op.allowedValues).toEqual(['drafted', 'published'])
  })

  it('reports preview failures as the error phase', async () => {
    mockApi.previewPropertyOp.mockRejectedValueOnce(new Error('boom'))
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/a.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('error'))
    expect(propertyOps.modal?.error).toBe('boom')
  })
})

describe('openAdd', () => {
  it('builds a recursive table-scope add request and previews it', async () => {
    const addPlan: PropertyOpPlan = {
      ...emptyPlan,
      files: [{ path: 'docs/a.md', action: 'add', before: null, after: '0' }],
      totals: { add: 1, drop: 0, convert: 0, unchanged: 0, noValue: 0, skip: 0 }
    }
    mockApi.previewPropertyOp.mockResolvedValueOnce(addPlan)

    propertyOps.openAdd({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'priority', 'number')

    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(mockApi.previewPropertyOp).toHaveBeenCalledWith({
      collectionId: 'c1',
      scope: 'docs',
      filePath: null,
      key: 'priority',
      op: { kind: 'add', target: 'number' }
    })
    expect(propertyOps.modal?.plan).toEqual(addPlan)
    expect(propertyOps.modal?.currentType).toBeNull()
  })

  it('initializes Select allowed values without deriving values from existing properties', async () => {
    propertyOps.openAdd({ kind: 'table', tabId: 't1', folderPath: '' }, 'status', 'select')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))

    expect(propertyOps.modal?.req.scope).toBe('.')
    const op = propertyOps.modal?.req.op
    expect(op?.kind === 'add' && op.allowedValues).toEqual([])
  })
})

describe('openDrop', () => {
  const dropPlan: PropertyOpPlan = {
    scope: '.',
    files: [
      { path: 'docs/a.md', action: 'drop', before: 'draft', after: null },
      { path: 'other.md', action: 'no-value', before: null, after: null }
    ],
    totals: { add: 0, drop: 1, convert: 0, unchanged: 0, noValue: 1, skip: 0 },
    schemaPin: null
  }

  it('always builds a vault-wide request and captures its collection context', async () => {
    mockApi.previewPropertyOp.mockResolvedValueOnce(dropPlan)

    propertyOps.openDrop(
      { kind: 'table', tabId: 't1', folderPath: 'deeply/nested/database' },
      'status'
    )

    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(mockApi.previewPropertyOp).toHaveBeenCalledWith({
      collectionId: 'c1',
      scope: '.',
      filePath: null,
      key: 'status',
      op: { kind: 'drop' }
    })
    expect(propertyOps.modal?.req.op).toEqual({
      kind: 'drop',
      confirmedPaths: ['docs/a.md']
    })
    expect(propertyOps.modal?.collection).toEqual({ id: 'c1', path: '/vault' })
  })

  it('replaces confirmations from a refreshed preview without sending the stale set', async () => {
    const refreshedPlan: PropertyOpPlan = {
      ...dropPlan,
      files: [
        { path: 'new.md', action: 'drop', before: 'new value', after: null },
        { path: 'docs/a.md', action: 'no-value', before: null, after: null }
      ]
    }
    mockApi.previewPropertyOp.mockResolvedValueOnce(dropPlan).mockResolvedValueOnce(refreshedPlan)

    propertyOps.openDrop({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(propertyOps.modal?.req.op).toEqual({
      kind: 'drop',
      confirmedPaths: ['docs/a.md']
    })

    await propertyOps.preview()

    expect(mockApi.previewPropertyOp).toHaveBeenNthCalledWith(2, {
      collectionId: 'c1',
      scope: '.',
      filePath: null,
      key: 'status',
      op: { kind: 'drop' }
    })
    expect(propertyOps.modal?.req.op).toEqual({
      kind: 'drop',
      confirmedPaths: ['new.md']
    })
  })

  it('clears stale confirmations when a refreshed preview fails', async () => {
    mockApi.previewPropertyOp
      .mockResolvedValueOnce(dropPlan)
      .mockRejectedValueOnce(new Error('preview failed'))

    propertyOps.openDrop({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))

    await propertyOps.preview()

    expect(propertyOps.modal?.phase).toBe('error')
    expect(propertyOps.modal?.req.op).toEqual({ kind: 'drop' })

    await propertyOps.apply()

    expect(mockApi.applyPropertyOp).not.toHaveBeenCalled()
    expect(propertyOps.modal?.phase).toBe('error')
  })

  it('blocks apply while an affected document tab has unsaved changes', async () => {
    ;(workspace as { tabs: Record<string, unknown> }).tabs = {
      doc: {
        id: 'doc',
        kind: 'document',
        filePath: 'docs/a.md',
        isUntitled: false,
        isDirty: true
      }
    }
    mockApi.previewPropertyOp.mockResolvedValue(dropPlan)

    propertyOps.openDrop({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(propertyOps.modal?.dirtyAffected).toEqual(['docs/a.md'])

    await propertyOps.apply()

    expect(mockApi.applyPropertyOp).not.toHaveBeenCalled()
    expect(propertyOps.modal?.phase).toBe('preview')
  })

  it('rechecks dirty documents at click time instead of trusting the preview snapshot', async () => {
    const tab = {
      id: 'doc',
      kind: 'document',
      filePath: 'newly-dirty.md',
      isUntitled: false,
      isDirty: false
    }
    ;(workspace as { tabs: Record<string, unknown> }).tabs = { doc: tab }
    mockApi.previewPropertyOp.mockResolvedValue(dropPlan)

    propertyOps.openDrop({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(propertyOps.modal?.dirtyAffected).toEqual([])

    tab.isDirty = true
    await propertyOps.apply()

    expect(mockApi.applyPropertyOp).not.toHaveBeenCalled()
    expect(propertyOps.modal?.dirtyAffected).toEqual(['newly-dirty.md'])
    expect(propertyOps.modal?.phase).toBe('preview')
  })

  it('finishes the captured vault refresh without touching a newly active collection', async () => {
    mockApi.previewPropertyOp.mockResolvedValueOnce(dropPlan)
    propertyOps.openDrop({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))

    setActiveCollection({ id: 'c2', path: '/other-vault', name: 'Other Vault' })
    await propertyOps.apply()

    expect(mockApi.applyPropertyOp).toHaveBeenCalledWith(expect.any(String), {
      collectionId: 'c1',
      scope: '.',
      filePath: null,
      key: 'status',
      op: { kind: 'drop', confirmedPaths: ['docs/a.md'] }
    })
    expect(mockApi.ingest).toHaveBeenCalledWith('/vault')
    expect(vi.mocked(fetchSchema)).not.toHaveBeenCalled()
    expect(vi.mocked(tableStore.reload)).not.toHaveBeenCalled()
    expect(vi.mocked(handleVaultFileEvent)).not.toHaveBeenCalled()
    expect(propertyOps.modal?.phase).toBe('report')
  })
})

describe('apply', () => {
  async function openAndPreview(): Promise<void> {
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/a.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
  }

  it('runs the follow-up sequence in order: ingest → schema → tables → file-sync', async () => {
    ;(workspace as { tabs: Record<string, unknown> }).tabs = {
      t1: { id: 't1', kind: 'table', folderPath: 'docs' },
      t2: { id: 't2', kind: 'table', folderPath: 'other' }
    }
    await openAndPreview()
    await propertyOps.apply()

    expect(propertyOps.modal?.phase).toBe('report')
    expect(callOrder[0]).toBe('apply')
    expect(callOrder.indexOf('ingest')).toBeLessThan(callOrder.indexOf('fetch-schema'))
    expect(callOrder.indexOf('fetch-schema')).toBeLessThan(callOrder.indexOf('table-reload'))
    expect(callOrder.indexOf('table-reload')).toBeLessThan(callOrder.indexOf('file-sync'))

    // Only the in-scope table reloads; only 'ok' entries route through file-sync.
    expect(vi.mocked(tableStore.reload)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(tableStore.reload)).toHaveBeenCalledWith('t1')
    expect(vi.mocked(handleVaultFileEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(handleVaultFileEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'modified', path: 'docs/a.md', fileKind: 'markdown' })
    )
    expect(vi.mocked(fetchSchema)).toHaveBeenCalledWith('/vault', 'docs')
  })

  it('streams progress only for its own opId and unsubscribes after', async () => {
    await openAndPreview()
    const applying = propertyOps.apply()
    await vi.waitFor(() => expect(progressCallback).not.toBeNull())
    const opId = (propertyOps.modal?.progress as { opId: string }).opId
    progressCallback!({ opId: 'other-op', done: 5, total: 10, path: 'x.md' })
    expect(propertyOps.modal?.progress?.done).toBe(0)
    progressCallback!({ opId, done: 3, total: 10, path: 'docs/c.md' })
    expect(propertyOps.modal?.progress?.done).toBe(3)
    await applying
    expect(unsubscribed).toBe(true)
  })

  it('close() is a no-op while running', async () => {
    let resolveApply: (r: PropertyOpResult) => void
    mockApi.applyPropertyOp.mockImplementationOnce(
      () => new Promise((resolve) => (resolveApply = resolve))
    )
    await openAndPreview()
    const applying = propertyOps.apply()
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('running'))
    propertyOps.close()
    expect(propertyOps.modal).not.toBeNull()
    resolveApply!(okResult)
    await applying
  })

  it('surfaces a failed post-write index refresh instead of reporting success', async () => {
    await openAndPreview()
    mockApi.ingest.mockRejectedValueOnce(new Error('index is locked'))

    await propertyOps.apply()

    expect(propertyOps.modal?.phase).toBe('error')
    expect(propertyOps.modal?.error).toContain(
      'Changes were saved, but refreshing the index failed: index is locked'
    )
    expect(vi.mocked(fetchSchema)).not.toHaveBeenCalled()
  })
})

describe('rename flow', () => {
  it('opens without a plan and previews once the key is set', async () => {
    propertyOps.openRename({ kind: 'table', tabId: 't1', folderPath: 'docs' }, 'status')
    expect(propertyOps.modal?.phase).toBe('preview')
    expect(propertyOps.modal?.plan).toBeNull()

    propertyOps.setRenameKey('state')
    await propertyOps.preview()
    const req = mockApi.previewPropertyOp.mock.calls[0][0]
    expect(req.op).toEqual({ kind: 'rename', newKey: 'state' })
  })
})

describe('auto-save of the triggering tab', () => {
  it('requests a save and waits for the dirty flag to clear', async () => {
    const { requestSave } = await import('../../src/renderer/stores/editor')
    const tab = { id: 'd1', kind: 'document', filePath: 'docs/a.md', isDirty: true }
    ;(workspace as { focusedDocumentTab: unknown }).focusedDocumentTab = tab
    vi.mocked(requestSave).mockImplementation(() => {
      setTimeout(() => (tab.isDirty = false), 10)
    })
    propertyOps.openConvert({ kind: 'panel', filePath: 'docs/a.md' }, 'status', 'number', 'text')
    await vi.waitFor(() => expect(propertyOps.modal?.phase).toBe('preview'))
    expect(requestSave).toHaveBeenCalled()
    expect(tab.isDirty).toBe(false)
  })
})

describe('applyOverlayFieldPatch', () => {
  it('writes the overlay then refreshes schema and tables', async () => {
    ;(workspace as { tabs: Record<string, unknown> }).tabs = {
      t1: { id: 't1', kind: 'table', folderPath: 'docs' }
    }
    await propertyOps.applyOverlayFieldPatch('docs', 'status', { description: 'Review status' })
    expect(mockApi.updateOverlayField).toHaveBeenCalledWith('c1', 'docs', 'status', {
      description: 'Review status'
    })
    expect(callOrder.indexOf('ingest')).toBeLessThan(callOrder.indexOf('fetch-schema'))
    expect(vi.mocked(tableStore.reload)).toHaveBeenCalledWith('t1')
  })

  it('rejects when the required schema-refresh ingest fails', async () => {
    mockApi.ingest.mockRejectedValueOnce(new Error('index is locked'))

    await expect(
      propertyOps.applyOverlayFieldPatch('docs', 'status', { allowedValues: ['draft', 'paid'] })
    ).rejects.toThrow('Changes were saved, but refreshing the index failed: index is locked')
    expect(vi.mocked(fetchSchema)).not.toHaveBeenCalled()
  })

  it('refreshes every table after writing a global schema field', async () => {
    ;(workspace as { tabs: Record<string, unknown> }).tabs = {
      root: { id: 'root', kind: 'table', folderPath: '' },
      docs: { id: 'docs', kind: 'table', folderPath: 'docs' }
    }

    await propertyOps.applyOverlayFieldPatch(null, 'priority', { fieldType: 'number' })

    expect(vi.mocked(tableStore.reload)).toHaveBeenCalledWith('root')
    expect(vi.mocked(tableStore.reload)).toHaveBeenCalledWith('docs')
  })
})
