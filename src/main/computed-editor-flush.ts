import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import type { WindowManager } from './window-manager'
import {
  COMPUTED_EDITOR_FLUSH_REQUEST_CHANNEL,
  COMPUTED_EDITOR_FLUSH_RESPONSE_CHANNEL,
  COMPUTED_SCHEMA_APPLIED_CHANNEL,
  type ComputedEditorFlushBlocker,
  type ComputedEditorFlushPhase,
  type ComputedEditorFlushRequest,
  type ComputedEditorFlushResponse,
  type ComputedSchemaAppliedEvent
} from '../shared/computed-editor-flush'

const FLUSH_RESPONSE_TIMEOUT_MS = 60_000

interface WindowResponse {
  windowId: number
  response: ComputedEditorFlushResponse
}

interface PendingRequest {
  expectedWindowIds: Set<number>
  responses: Map<number, ComputedEditorFlushResponse>
  timer: NodeJS.Timeout
  resolve: (responses: WindowResponse[]) => void
  reject: (error: Error) => void
}

const pendingRequests = new Map<string, PendingRequest>()

/** Tell every renderer that materialized Markdown and schema may have changed. */
export function broadcastComputedSchemaApplied(
  windowManager: WindowManager,
  root: string,
  rename?: ComputedSchemaAppliedEvent['rename']
): void {
  windowManager.broadcastToAll(COMPUTED_SCHEMA_APPLIED_CHANNEL, { root, ...(rename && { rename }) })
}

function isFlushResponse(value: unknown): value is ComputedEditorFlushResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Partial<ComputedEditorFlushResponse>
  return (
    typeof response.requestId === 'string' &&
    (response.phase === 'inspect' || response.phase === 'flush' || response.phase === 'verify') &&
    typeof response.collectionId === 'string' &&
    typeof response.applies === 'boolean' &&
    typeof response.ok === 'boolean' &&
    Array.isArray(response.dirtyDocuments) &&
    response.dirtyDocuments.every(
      (document) =>
        document &&
        typeof document === 'object' &&
        typeof (document as { tabId?: unknown }).tabId === 'string' &&
        typeof (document as { path?: unknown }).path === 'string'
    ) &&
    Array.isArray(response.blockers) &&
    response.blockers.every(
      (blocker) =>
        blocker &&
        typeof blocker === 'object' &&
        typeof (blocker as { reason?: unknown }).reason === 'string'
    )
  )
}

/** Register the single response channel consumed by all computed-field mutations. */
export function registerComputedEditorFlushResponseHandler(): void {
  ipcMain.on(COMPUTED_EDITOR_FLUSH_RESPONSE_CHANNEL, (event: IpcMainEvent, value: unknown) => {
    if (!isFlushResponse(value)) return
    const pending = pendingRequests.get(value.requestId)
    if (!pending || !pending.expectedWindowIds.has(event.sender.id)) return
    if (pending.responses.has(event.sender.id)) return

    pending.responses.set(event.sender.id, value)
    if (pending.responses.size !== pending.expectedWindowIds.size) return

    clearTimeout(pending.timer)
    pendingRequests.delete(value.requestId)
    pending.resolve([...pending.responses].map(([windowId, response]) => ({ windowId, response })))
  })
}

function requestPhase(
  windows: BrowserWindow[],
  collectionId: string,
  collectionPath: string,
  phase: ComputedEditorFlushPhase
): Promise<WindowResponse[]> {
  if (windows.length === 0) return Promise.resolve([])

  const request: ComputedEditorFlushRequest = {
    requestId: randomUUID(),
    phase,
    collectionId,
    collectionPath
  }

  return new Promise<WindowResponse[]>((resolve, reject) => {
    const expectedWindowIds = new Set(windows.map((win) => win.webContents.id))
    const timer = setTimeout(() => {
      const pending = pendingRequests.get(request.requestId)
      if (!pending) return
      pendingRequests.delete(request.requestId)
      const missing = [...pending.expectedWindowIds].filter(
        (windowId) => !pending.responses.has(windowId)
      )
      reject(
        new Error(
          `Could not verify unsaved documents in window${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Retry after the window is ready.`
        )
      )
    }, FLUSH_RESPONSE_TIMEOUT_MS)

    pendingRequests.set(request.requestId, {
      expectedWindowIds,
      responses: new Map(),
      timer,
      resolve,
      reject
    })

    try {
      for (const win of windows) {
        win.webContents.send(COMPUTED_EDITOR_FLUSH_REQUEST_CHANNEL, request)
      }
    } catch (cause) {
      clearTimeout(timer)
      pendingRequests.delete(request.requestId)
      reject(new Error('Could not ask every open window to save its documents.', { cause }))
    }
  })
}

function phaseFailure(
  phase: ComputedEditorFlushPhase,
  collectionId: string,
  responses: WindowResponse[],
  allowNotApplicable = false,
  includeReportedBlockers = true
): Error | null {
  const blockers: Array<ComputedEditorFlushBlocker & { windowId: number }> = []
  for (const { windowId, response } of responses) {
    if (response.phase !== phase || response.collectionId !== collectionId) {
      blockers.push({ windowId, reason: `returned an invalid ${response.phase} response` })
      continue
    }
    if (!response.applies) {
      if (!allowNotApplicable) {
        blockers.push({ windowId, reason: 'switched to another collection during the save' })
      }
      continue
    }
    if (!response.ok && response.blockers.length === 0) {
      blockers.push({ windowId, reason: 'could not safely save its open documents' })
    }
    if (includeReportedBlockers) {
      blockers.push(...response.blockers.map((blocker) => ({ ...blocker, windowId })))
    }
  }
  if (blockers.length === 0) return null

  const details = blockers
    .slice(0, 4)
    .map((blocker) => {
      const target = blocker.path ? `“${blocker.path}”` : `window ${blocker.windowId}`
      return `${target}: ${blocker.reason}`
    })
    .join('; ')
  const remainder = blockers.length > 4 ? `; plus ${blockers.length - 4} more` : ''
  return new Error(
    `Save all open documents before changing computed fields. ${details}${remainder}`
  )
}

function normalizedDocumentPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function duplicateDirtyDocumentError(responses: WindowResponse[]): Error | null {
  const owners = new Map<string, Array<{ tabId: string; windowId: number }>>()
  for (const { windowId, response } of responses) {
    for (const document of response.dirtyDocuments) {
      const path = normalizedDocumentPath(document.path)
      const existing = owners.get(path) ?? []
      existing.push({ tabId: document.tabId, windowId })
      owners.set(path, existing)
    }
  }

  const duplicates = [...owners].filter(([, entries]) => entries.length > 1)
  if (duplicates.length === 0) return null
  const paths = duplicates
    .slice(0, 4)
    .map(([path]) => `“${path}”`)
    .join(', ')
  const remainder = duplicates.length > 4 ? ` and ${duplicates.length - 4} more` : ''
  return new Error(
    `Cannot save computed-field inputs because ${paths}${remainder} has unsaved edits in multiple tabs or windows. Save or close all but one dirty copy first.`
  )
}

function candidateWindows(windowManager: WindowManager): BrowserWindow[] {
  // Renderer state is authoritative for this barrier. Main-process collection
  // mappings can lag a just-switched window, so ask every managed window and
  // let unrelated renderers respond with applies:false.
  return windowManager.getAllWindows()
}

/**
 * Flush every safely saveable dirty Markdown tab in every window that has the
 * collection open. Any ambiguity, unavailable editor, failed write, or editor
 * change during the write blocks the subsequent overlay transaction.
 */
export async function flushDirtyDocumentsAcrossWindows(
  windowManager: WindowManager,
  collectionId: string,
  collectionPath: string
): Promise<void> {
  const windows = candidateWindows(windowManager)
  if (windows.length === 0) return

  const inspected = await requestPhase(windows, collectionId, collectionPath, 'inspect')
  // Inspection blockers describe individual documents that cannot be saved.
  // Defer them to the flush response so other safe dirty documents are still
  // persisted before the definition change is rejected.
  const inspectFailure = phaseFailure('inspect', collectionId, inspected, true, false)
  if (inspectFailure) throw inspectFailure
  const applicable = inspected.filter(({ response }) => response.applies)
  const applicableWindowIds = new Set(applicable.map(({ windowId }) => windowId))
  const applicableWindows = windows.filter((win) => applicableWindowIds.has(win.webContents.id))
  const duplicateFailure = duplicateDirtyDocumentError(applicable)
  if (duplicateFailure) throw duplicateFailure

  if (applicable.every(({ response }) => response.dirtyDocuments.length === 0)) return

  const flushed = await requestPhase(applicableWindows, collectionId, collectionPath, 'flush')
  const flushFailure = phaseFailure('flush', collectionId, flushed)
  if (flushFailure) throw flushFailure

  await verifyCleanDocumentsAcrossWindows(
    windowManager,
    collectionId,
    collectionPath,
    applicableWindows
  )
}

/**
 * Recheck that no renderer became dirty after the save barrier. Definition
 * transactions call this again after acquiring the cross-process module lock;
 * this phase never writes while the watcher is paused.
 */
export async function verifyCleanDocumentsAcrossWindows(
  windowManager: WindowManager,
  collectionId: string,
  collectionPath: string,
  windows: BrowserWindow[] = candidateWindows(windowManager)
): Promise<void> {
  if (windows.length === 0) return
  const verified = await requestPhase(windows, collectionId, collectionPath, 'verify')
  const verifyFailure = phaseFailure('verify', collectionId, verified, true)
  if (verifyFailure) throw verifyFailure
  const stillDirty = verified.flatMap(({ response }) => response.dirtyDocuments)
  if (stillDirty.length > 0) {
    const paths = stillDirty
      .slice(0, 4)
      .map((document) => `“${document.path}”`)
      .join(', ')
    throw new Error(
      `Computed fields were not changed because ${paths} still has unsaved edits. Save it and retry.`
    )
  }
}

/**
 * Read-only dirty-document barrier for destructive operations such as the
 * vault-wide Drop property flow. Nothing is auto-saved: any dirty document in
 * the collection blocks before an overlay or Markdown write begins.
 */
export async function assertNoDirtyDocumentsAcrossWindows(
  windowManager: WindowManager,
  collectionId: string,
  collectionPath: string
): Promise<void> {
  const windows = candidateWindows(windowManager)
  if (windows.length === 0) return
  const inspected = await requestPhase(windows, collectionId, collectionPath, 'inspect')
  const inspectFailure = phaseFailure('inspect', collectionId, inspected, true)
  if (inspectFailure) throw inspectFailure
  const dirty = inspected
    .filter(({ response }) => response.applies)
    .flatMap(({ response }) => response.dirtyDocuments)
  if (dirty.length === 0) return
  const paths = dirty
    .slice(0, 4)
    .map((document) => `“${document.path}”`)
    .join(', ')
  const remainder = dirty.length > 4 ? ` and ${dirty.length - 4} more` : ''
  throw new Error(
    `Drop property was not started because ${paths}${remainder} has unsaved edits. Save it and retry.`
  )
}
