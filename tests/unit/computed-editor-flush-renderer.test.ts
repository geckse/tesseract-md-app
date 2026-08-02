import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MdvdbApi } from '../../src/preload/api'
import type { ComputedEditorFlushRequest } from '../../src/shared/computed-editor-flush'
import { activeCollectionId, collections } from '../../src/renderer/stores/collections'
import {
  handleComputedSchemaApplied,
  handleComputedEditorFlushRequest,
  registerComputedEditorAdapter
} from '../../src/renderer/stores/computed-editor-flush'
import { workspace, type DocumentTab } from '../../src/renderer/stores/workspace.svelte'
import { dismissConflict, getConflict } from '../../src/renderer/stores/conflict'
import { tableStore } from '../../src/renderer/stores/table.svelte'
import { tableViewsStore } from '../../src/renderer/stores/table-views.svelte'

const readFile = vi.fn()
const writeFile = vi.fn()
const writeFileIfUnchanged = vi.fn()
const readSchema = vi.fn()
const unregisterAdapters: Array<() => void> = []

function request(phase: ComputedEditorFlushRequest['phase']): ComputedEditorFlushRequest {
  return {
    requestId: `request-${phase}`,
    phase,
    collectionId: 'collection-1',
    collectionPath: '/vault'
  }
}

function dirtyTab(path = 'contacts/alice.md', baseline = 'old', content = 'edited'): DocumentTab {
  const id = workspace.openTab(path)
  const tab = workspace.tabs[id] as DocumentTab
  tab.content = content
  tab.savedContent = baseline
  tab.isDirty = true
  tab.contentLoading = false
  tab.contentError = null
  return tab
}

describe('renderer computed editor flush', () => {
  beforeEach(() => {
    workspace.reset()
    collections.set([
      { id: 'collection-1', name: 'Vault', path: '/vault', addedAt: 1, lastOpenedAt: 1 }
    ])
    activeCollectionId.set('collection-1')
    readFile.mockReset()
    writeFile.mockReset()
    writeFileIfUnchanged.mockReset()
    readSchema.mockReset().mockResolvedValue({ fields: [], last_updated: 1 })
    dismissConflict()
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        readFile,
        writeFile,
        writeFileIfUnchanged,
        schema: readSchema
      } as unknown as MdvdbApi
    })
  })

  afterEach(() => {
    while (unregisterAdapters.length > 0) unregisterAdapters.pop()?.()
    workspace.reset()
    collections.set([])
    activeCollectionId.set(null)
  })

  it('inspects dirty inactive workspace tabs without writing', async () => {
    const tab = dirtyTab()

    const result = await handleComputedEditorFlushRequest(request('inspect'))

    expect(result.ok).toBe(true)
    expect(result.dirtyDocuments).toEqual([{ tabId: tab.id, path: tab.filePath }])
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(writeFileIfUnchanged).not.toHaveBeenCalled()
  })

  it('writes a verified dirty tab and marks both workspace and editor baseline clean', async () => {
    const tab = dirtyTab()
    const liveContent = 'edited in live editor'
    let liveBaseline = 'old'
    const markSaved = vi.fn()
    unregisterAdapters.push(
      registerComputedEditorAdapter({
        snapshot: (tabId) =>
          tabId === tab.id
            ? { content: liveContent, isDirty: liveContent !== liveBaseline }
            : undefined,
        markSaved: (tabId, content) => {
          if (tabId === tab.id) liveBaseline = content
          markSaved(tabId, content)
        }
      })
    )
    writeFileIfUnchanged.mockResolvedValue(undefined)

    const result = await handleComputedEditorFlushRequest(request('flush'))

    expect(result).toMatchObject({ ok: true, dirtyDocuments: [], blockers: [] })
    expect(writeFileIfUnchanged).toHaveBeenCalledWith(
      '/vault/contacts/alice.md',
      'old',
      'edited in live editor'
    )
    expect(markSaved).toHaveBeenCalledWith(tab.id, 'edited in live editor')
    expect(tab).toMatchObject({
      content: 'edited in live editor',
      savedContent: 'edited in live editor',
      isDirty: false
    })
  })

  it('blocks instead of overwriting when the disk no longer matches the editor baseline', async () => {
    const tab = dirtyTab()
    writeFileIfUnchanged.mockRejectedValue(
      new Error('The file changed on disk after this editor opened it')
    )

    const result = await handleComputedEditorFlushRequest(request('flush'))

    expect(result.ok).toBe(false)
    expect(result.blockers[0]?.reason).toMatch(/changed on disk/)
    expect(writeFile).not.toHaveBeenCalled()
    expect(tab.isDirty).toBe(true)
    expect(tab.savedContent).toBe('old')
  })

  it('blocks untitled dirty documents before any filesystem operation', async () => {
    const id = workspace.createUntitledTab()
    const tab = workspace.tabs[id] as DocumentTab
    tab.content = 'draft'

    const result = await handleComputedEditorFlushRequest(request('flush'))

    expect(result.ok).toBe(false)
    expect(result.blockers[0]?.reason).toMatch(/needs a filename/)
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(writeFileIfUnchanged).not.toHaveBeenCalled()
  })

  it('leaves newer edits dirty when content changes during the awaited write', async () => {
    const tab = dirtyTab()
    let liveContent = 'first edit'
    let liveBaseline = 'old'
    unregisterAdapters.push(
      registerComputedEditorAdapter({
        snapshot: (tabId) =>
          tabId === tab.id
            ? { content: liveContent, isDirty: liveContent !== liveBaseline }
            : undefined,
        markSaved: (tabId, content) => {
          if (tabId === tab.id) liveBaseline = content
        }
      })
    )
    writeFileIfUnchanged.mockImplementation(async () => {
      liveContent = 'second edit'
    })

    const result = await handleComputedEditorFlushRequest(request('flush'))

    expect(result.ok).toBe(false)
    expect(result.blockers.some((blocker) => /changed again/.test(blocker.reason))).toBe(true)
    expect(tab.content).toBe('second edit')
    expect(tab.savedContent).toBe('first edit')
    expect(tab.isDirty).toBe(true)
  })

  it('saves safe dirty tabs before reporting an unrelated blocked draft', async () => {
    const safe = dirtyTab()
    const untitledId = workspace.createUntitledTab()
    const untitled = workspace.tabs[untitledId] as DocumentTab
    untitled.content = 'draft'
    writeFileIfUnchanged.mockResolvedValue(undefined)

    const result = await handleComputedEditorFlushRequest(request('flush'))

    expect(result.ok).toBe(false)
    expect(result.blockers.some((blocker) => /needs a filename/.test(blocker.reason))).toBe(true)
    expect(writeFileIfUnchanged).toHaveBeenCalledWith('/vault/contacts/alice.md', 'old', 'edited')
    expect(safe.isDirty).toBe(false)
    expect(untitled.isDirty).toBe(true)
  })

  it('refreshes clean open documents from disk after computed materialization', async () => {
    const tab = dirtyTab('contacts/alice.md', 'old', 'old')
    tab.isDirty = false
    const pane = workspace.focusedPane!
    pane.activeTabId = pane.graphTabId
    readFile.mockResolvedValue('with computed lookup')

    await handleComputedSchemaApplied('/vault')

    expect(tab).toMatchObject({
      content: 'with computed lookup',
      savedContent: 'with computed lookup',
      isDirty: false
    })
    expect(readSchema).toHaveBeenCalledWith('/vault', undefined)
  })

  it('keeps newly dirty content and raises the normal conflict after materialization', async () => {
    const tab = dirtyTab('contacts/alice.md', 'old', 'my unsaved edit')
    const pane = workspace.focusedPane!
    pane.activeTabId = pane.graphTabId
    readFile.mockResolvedValue('old\ncomputed: new')

    await handleComputedSchemaApplied('/vault')

    expect(tab).toMatchObject({
      content: 'my unsaved edit',
      savedContent: 'old',
      isDirty: true
    })
    expect(getConflict(tab.filePath)?.diskContent).toBe('old\ncomputed: new')
  })

  it('force-refreshes open saved views before reloading schema-changed table data unsorted', async () => {
    workspace.openTableTab('contacts')
    const order: string[] = []
    const reloadViews = vi.spyOn(tableViewsStore, 'reload').mockImplementation(async () => {
      order.push('views')
    })
    const reloadTables = vi.spyOn(tableStore, 'reloadAll').mockImplementation(async (options) => {
      order.push('tables')
      expect(options).toEqual({ suppressServerSort: true })
    })

    try {
      await handleComputedSchemaApplied('/vault')
      expect(reloadViews).toHaveBeenCalledWith('collection-1', 'contacts')
      expect(order).toEqual(['views', 'tables'])
    } finally {
      reloadViews.mockRestore()
      reloadTables.mockRestore()
    }
  })

  it('migrates scoped and recursive-ancestor ephemeral view references before reload', async () => {
    const config = {
      sort: [{ columnName: 'client_domain', direction: 'asc' as const }],
      filters: [{ columnName: 'client_domain', op: 'exists' as const }],
      columns: [{ name: 'client_domain', hidden: false, width: 140, order: 0 }],
      groupBy: 'client_domain',
      collapsedGroups: ['acme.example']
    }
    const scopedId = workspace.openTableTab('contacts')
    workspace.setTableEphemeral(scopedId, config)
    const ancestorId = workspace.openTableTab('', { recursive: true })
    workspace.setTableEphemeral(ancestorId, config)
    const siblingId = workspace.openTableTab('projects')
    workspace.setTableEphemeral(siblingId, config)

    const reloadViews = vi.spyOn(tableViewsStore, 'reload').mockResolvedValue(undefined)
    const reloadTables = vi.spyOn(tableStore, 'reloadAll').mockResolvedValue(undefined)
    try {
      await handleComputedSchemaApplied('/vault', {
        scope: 'contacts',
        oldKey: 'client_domain',
        newKey: 'client_industry'
      })
    } finally {
      reloadViews.mockRestore()
      reloadTables.mockRestore()
    }

    for (const id of [scopedId, ancestorId]) {
      const tab = workspace.tabs[id]
      expect(tab.kind).toBe('table')
      if (tab.kind !== 'table') continue
      expect(tab.ephemeral).toMatchObject({
        sort: [{ columnName: 'client_industry', direction: 'asc' }],
        filters: [{ columnName: 'client_industry', op: 'exists' }],
        columns: [{ name: 'client_industry', hidden: false, width: 140, order: 0 }],
        groupBy: 'client_industry',
        collapsedGroups: ['acme.example']
      })
    }
    const sibling = workspace.tabs[siblingId]
    expect(sibling.kind).toBe('table')
    if (sibling.kind === 'table') {
      expect(sibling.ephemeral?.sort[0]?.columnName).toBe('client_domain')
    }
  })
})
