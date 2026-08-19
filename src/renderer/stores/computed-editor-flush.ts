import { get } from 'svelte/store'
import type {
  ComputedEditorFlushBlocker,
  ComputedEditorFlushDocument,
  ComputedEditorFlushRequest,
  ComputedEditorFlushResponse,
  ComputedSchemaAppliedEvent
} from '../../shared/computed-editor-flush'
import type { TableViewConfig } from '../../preload/api'
import { activeCollection } from './collections'
import { dismissConflict } from './conflict'
import { syncEditorStoresFromTab } from './editor'
import { refreshOpenDocumentsFromDisk } from './file-sync'
import { loadProperties } from './properties'
import { clearSchema, fetchSchema } from './schema'
import { tableStore } from './table.svelte'
import { tableViewsStore } from './table-views.svelte'
import { workspace, type DocumentTab } from './workspace.svelte'

export interface ComputedEditorSnapshot {
  content: string
  isDirty: boolean
}

/** Adapter supplied by each mounted editor pool in this renderer. */
export interface ComputedEditorAdapter {
  snapshot(tabId: string): ComputedEditorSnapshot | undefined
  markSaved(tabId: string, content: string, clean: boolean): void
}

const editorAdapters = new Set<ComputedEditorAdapter>()

/** Register one editor pool. Inactive/evicted tabs still fall back to workspace state. */
export function registerComputedEditorAdapter(adapter: ComputedEditorAdapter): () => void {
  editorAdapters.add(adapter)
  return () => editorAdapters.delete(adapter)
}

interface DirtyCandidate {
  tab: DocumentTab
  content: string | null
}

interface DirtyInspection {
  candidates: DirtyCandidate[]
  dirtyDocuments: ComputedEditorFlushDocument[]
  blockers: ComputedEditorFlushBlocker[]
}

/**
 * Read the live content snapshots held by every mounted editor pool for a tab.
 * Standalone-window save coordination uses the same adapters as computed-field
 * flushing so switching between Source and Editor mode keeps one baseline.
 */
export function getEditorSnapshots(tabId: string): ComputedEditorSnapshot[] {
  const snapshots: ComputedEditorSnapshot[] = []
  for (const adapter of editorAdapters) {
    const snapshot = adapter.snapshot(tabId)
    if (snapshot) snapshots.push(snapshot)
  }
  return snapshots
}

function inspectDirtyDocuments(): DirtyInspection {
  const candidates: DirtyCandidate[] = []
  const dirtyDocuments: ComputedEditorFlushDocument[] = []
  const blockers: ComputedEditorFlushBlocker[] = []

  for (const candidate of Object.values(workspace.tabs)) {
    if (candidate.kind !== 'document' || candidate.origin !== 'collection') continue
    const tab = candidate as DocumentTab
    const snapshots = getEditorSnapshots(tab.id)
    const liveDirty = snapshots.some((snapshot) => snapshot.isDirty)
    if (!tab.isDirty && !liveDirty) continue

    dirtyDocuments.push({ tabId: tab.id, path: tab.filePath })

    const distinctLiveContents = new Set(snapshots.map((snapshot) => snapshot.content))
    if (distinctLiveContents.size > 1) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: 'multiple live editor copies contain different unsaved content'
      })
      candidates.push({ tab, content: null })
      continue
    }

    const content = snapshots[0]?.content ?? tab.content
    candidates.push({ tab, content })
    if (tab.isUntitled) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: 'the untitled document needs a filename'
      })
    } else if (tab.diskMissing) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: 'the document no longer exists on disk'
      })
    } else if (content === null) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: tab.contentError ?? 'the editor content is unavailable'
      })
    } else if (tab.savedContent === null) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: 'the document has no verified on-disk baseline'
      })
    }
  }

  return { candidates, dirtyDocuments, blockers }
}

function responseFor(
  request: ComputedEditorFlushRequest,
  inspection: DirtyInspection
): ComputedEditorFlushResponse {
  return {
    requestId: request.requestId,
    phase: request.phase,
    collectionId: request.collectionId,
    applies: true,
    ok: inspection.blockers.length === 0,
    dirtyDocuments: inspection.dirtyDocuments,
    blockers: inspection.blockers
  }
}

function currentContentForTab(tab: DocumentTab): string | null {
  const snapshots = getEditorSnapshots(tab.id)
  const contents = new Set(snapshots.map((snapshot) => snapshot.content))
  if (contents.size > 1) return null
  return snapshots[0]?.content ?? tab.content
}

/** Update every mounted/serialized editor pool after an awaited disk write. */
export function markEditorSaved(tabId: string, content: string, clean: boolean): void {
  for (const adapter of editorAdapters) adapter.markSaved(tabId, content, clean)
}

async function flushCandidates(
  request: ComputedEditorFlushRequest,
  inspection: DirtyInspection
): Promise<ComputedEditorFlushResponse> {
  const blockers: ComputedEditorFlushBlocker[] = [...inspection.blockers]
  const blockedTabIds = new Set(
    inspection.blockers.flatMap((blocker) => (blocker.tabId ? [blocker.tabId] : []))
  )
  for (const { tab, content } of inspection.candidates) {
    if (blockedTabIds.has(tab.id) || content === null || tab.savedContent === null) continue
    const fullPath = `${request.collectionPath}/${tab.filePath}`

    try {
      await window.api.writeFileIfUnchanged(fullPath, tab.savedContent, content)

      const latestContent = currentContentForTab(tab)
      const clean = latestContent === content
      markEditorSaved(tab.id, content, clean)
      tab.savedContent = content
      if (clean) {
        tab.content = content
        tab.isDirty = false
        dismissConflict(tab.filePath)
      } else {
        if (latestContent !== null) tab.content = latestContent
        tab.isDirty = true
        blockers.push({
          tabId: tab.id,
          path: tab.filePath,
          reason: 'the document changed again while it was being saved'
        })
      }
    } catch (cause) {
      blockers.push({
        tabId: tab.id,
        path: tab.filePath,
        reason: cause instanceof Error ? cause.message : String(cause)
      })
    }
  }

  syncEditorStoresFromTab()
  const after = inspectDirtyDocuments()
  const combinedBlockers = [...blockers, ...after.blockers].filter(
    (blocker, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.tabId === blocker.tabId &&
          candidate.path === blocker.path &&
          candidate.reason === blocker.reason
      ) === index
  )
  return {
    requestId: request.requestId,
    phase: request.phase,
    collectionId: request.collectionId,
    applies: true,
    ok: combinedBlockers.length === 0,
    dirtyDocuments: after.dirtyDocuments,
    blockers: combinedBlockers
  }
}

/** Handle one phase. Exported to keep the safety behavior directly unit-testable. */
export async function handleComputedEditorFlushRequest(
  request: ComputedEditorFlushRequest
): Promise<ComputedEditorFlushResponse> {
  const collection = get(activeCollection)
  if (
    !collection ||
    collection.id !== request.collectionId ||
    collection.path !== request.collectionPath
  ) {
    return {
      requestId: request.requestId,
      phase: request.phase,
      collectionId: request.collectionId,
      applies: false,
      ok: true,
      dirtyDocuments: [],
      blockers: []
    }
  }

  const inspection = inspectDirtyDocuments()
  if (request.phase === 'flush') return flushCandidates(request, inspection)
  return responseFor(request, inspection)
}

/** Install exactly one aggregate request listener for this renderer window. */
export function setupComputedEditorFlushListener(): () => void {
  let queue: Promise<void> = Promise.resolve()
  return window.api.onComputedEditorFlushRequest((request) => {
    queue = queue
      .then(async () => {
        const response = await handleComputedEditorFlushRequest(request)
        window.api.respondComputedEditorFlush(response)
      })
      .catch((cause: unknown) => {
        window.api.respondComputedEditorFlush({
          requestId: request.requestId,
          phase: request.phase,
          collectionId: request.collectionId,
          applies: true,
          ok: false,
          dirtyDocuments: [],
          blockers: [{ reason: cause instanceof Error ? cause.message : String(cause) }]
        })
      })
  })
}

let computedSchemaRefreshGeneration = 0

function normalizedTableScope(value: string | null): string {
  return (value ?? '').replace(/^\/+|\/+$/g, '')
}

function pathContains(ancestor: string, descendant: string): boolean {
  return ancestor === '' || descendant === ancestor || descendant.startsWith(`${ancestor}/`)
}

function tableCanContainRename(
  folderPath: string,
  recursive: boolean,
  scope: string | null
): boolean {
  const folder = normalizedTableScope(folderPath)
  const origin = normalizedTableScope(scope)
  return pathContains(origin, folder) || (recursive && pathContains(folder, origin))
}

function renameConfigProperty(
  config: TableViewConfig,
  oldKey: string,
  newKey: string
): TableViewConfig {
  const rename = (name: string): string => (name === oldKey ? newKey : name)
  return {
    ...config,
    sort: config.sort.map((item) => ({ ...item, columnName: rename(item.columnName) })),
    filters: config.filters.map((item) => ({ ...item, columnName: rename(item.columnName) })),
    columns: config.columns.map((item) => ({ ...item, name: rename(item.name) })),
    groupBy: config.groupBy === null ? null : rename(config.groupBy)
  }
}

function renameOpenTableEphemerals(
  rename: NonNullable<ComputedSchemaAppliedEvent['rename']>
): void {
  for (const tab of Object.values(workspace.tabs)) {
    if (
      tab.kind !== 'table' ||
      tab.ephemeral === null ||
      !tableCanContainRename(tab.folderPath, tab.recursive, rename.scope)
    ) {
      continue
    }
    workspace.setTableEphemeral(
      tab.id,
      renameConfigProperty(tab.ephemeral, rename.oldKey, rename.newKey)
    )
  }
}

async function reloadOpenTableViews(collectionId: string): Promise<void> {
  const folders = new Set<string>()
  for (const tab of Object.values(workspace.tabs)) {
    if (tab.kind === 'table') folders.add(tab.folderPath)
  }
  await Promise.all([...folders].map((folder) => tableViewsStore.reload(collectionId, folder)))
}

export async function handleComputedSchemaApplied(
  root: string,
  rename?: ComputedSchemaAppliedEvent['rename']
): Promise<void> {
  const collection = get(activeCollection)
  if (!collection || collection.path !== root) return
  const currentGeneration = ++computedSchemaRefreshGeneration

  if (rename) renameOpenTableEphemerals(rename)
  clearSchema()
  // Main may have renamed persisted view references. Refresh those before a
  // table request is built, and force the first schema-changing collection
  // load to be unsorted so neither saved nor ephemeral stale keys reach CLI.
  await Promise.allSettled([refreshOpenDocumentsFromDisk(), reloadOpenTableViews(collection.id)])
  await tableStore.reloadAll({ suppressServerSort: true })
  if (
    currentGeneration !== computedSchemaRefreshGeneration ||
    get(activeCollection)?.path !== root
  ) {
    return
  }

  const selected = workspace.focusedDocumentTab
  const pathPrefix = selected?.filePath.includes('/')
    ? selected.filePath.slice(0, selected.filePath.lastIndexOf('/'))
    : undefined
  await fetchSchema(root, pathPrefix)
  if (
    selected &&
    currentGeneration === computedSchemaRefreshGeneration &&
    get(activeCollection)?.path === root
  ) {
    await loadProperties(selected.filePath)
  }
}

/**
 * Apply a completed computed-schema transaction to every view in this window.
 * Open documents deliberately use the normal conflict router: clean tabs are
 * replaced from disk, while newly-dirty tabs retain their edits and show a
 * disk conflict instead of being overwritten.
 */
export function setupComputedSchemaAppliedListener(): () => void {
  return window.api.onComputedSchemaApplied(({ root, rename }) => {
    void handleComputedSchemaApplied(root, rename)
  })
}
