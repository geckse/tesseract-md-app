import { writable, get } from 'svelte/store'
import type {
  IngestActivityEvent,
  IngestProgress,
  IngestResult,
  IngestPreview,
  IngestError
} from '../types/cli'
import { classifyCliError, type ClassifiedError } from '../lib/cli-errors'
import { activeCollection, collectionStatus } from './collections'
import { loadFileTree, loadAssetTree } from './files'
import { refreshGraphData } from './graph'

/** Ingest state machine states. */
export type IngestState = 'idle' | 'previewing' | 'ingesting' | 'done' | 'error'

/** Current state of the ingest state machine. */
export const ingestState = writable<IngestState>('idle')

/** Whether an ingest operation is currently running. */
export const ingestRunning = writable<boolean>(false)

/** Whether the current/last run was a full reindex. */
export const ingestIsReindex = writable<boolean>(false)

/** Elapsed seconds since ingest started. */
export const ingestElapsed = writable<number>(0)

/** The result of the last completed ingest operation. */
export const ingestResult = writable<IngestResult | null>(null)

/** Classified error if ingest failed. */
export const ingestError = writable<ClassifiedError | null>(null)

/** Latest structured progress update from the streaming CLI process. */
export const ingestProgress = writable<IngestProgress | null>(null)

/** File errors observed before the final result arrives. */
export const ingestProgressErrors = writable<IngestError[]>([])

/** Root and run id of the process currently represented by the global UI. */
export const ingestRoot = writable<string | null>(null)
export const ingestRunId = writable<string | null>(null)

/** Whether the ingest modal is open. */
export const ingestModalOpen = writable<boolean>(false)

/** Result of a preview (dry-run) operation. */
export const ingestPreviewResult = writable<IngestPreview | null>(null)

/** Whether a preview operation is currently loading. */
export const ingestPreviewLoading = writable<boolean>(false)

let elapsedInterval: ReturnType<typeof setInterval> | null = null

function startTimer(): void {
  stopTimer()
  ingestElapsed.set(0)
  elapsedInterval = setInterval(() => {
    ingestElapsed.update((n) => n + 1)
  }, 1000)
}

function stopTimer(): void {
  if (elapsedInterval !== null) {
    clearInterval(elapsedInterval)
    elapsedInterval = null
  }
}

/** Run a preview (dry-run) on the active collection to see what would be ingested. */
export async function runPreview(reindex = false): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(ingestState) !== 'idle' && get(ingestState) !== 'done' && get(ingestState) !== 'error')
    return

  ingestState.set('previewing')
  ingestPreviewLoading.set(true)
  ingestPreviewResult.set(null)
  ingestError.set(null)
  ingestIsReindex.set(reindex)
  ingestModalOpen.set(true)

  try {
    const result = reindex
      ? await window.api.ingestPreview(collection.path, { reindex: true })
      : await window.api.ingestPreview(collection.path)
    ingestPreviewResult.set(result)
  } catch (err) {
    ingestError.set(classifyCliError(err))
    ingestState.set('error')
    return
  } finally {
    ingestPreviewLoading.set(false)
  }

  ingestState.set('idle')
}

/** Run ingest on the active collection.
 *  @param reindex — if true, forces a full reindex; otherwise incremental (default).
 */
export async function runIngest(reindex = false): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(ingestRunning)) return

  ingestRunning.set(true)
  ingestState.set('ingesting')
  ingestIsReindex.set(reindex)
  ingestResult.set(null)
  ingestError.set(null)
  ingestProgress.set(null)
  ingestProgressErrors.set([])
  ingestRoot.set(collection.path)
  ingestModalOpen.set(true)
  startTimer()

  try {
    const result = await window.api.ingest(collection.path, { reindex })
    ingestResult.set(result)
    ingestState.set('done')
  } catch (err) {
    // A force-killed cancellation rejects after the main process has already
    // published its authoritative cancelled event.
    if (get(ingestState) !== 'done') {
      ingestError.set(classifyCliError(err))
      ingestState.set('error')
    }
  } finally {
    stopTimer()
    ingestRunning.set(false)
    // Refresh file tree and collection status after ingest
    await Promise.all([loadFileTree(), loadAssetTree()])
    // Patch the graph from the freshly-reindexed data (diffed, camera-preserving)
    refreshGraphData().catch(() => {})
    try {
      const status = await window.api.status(collection.path)
      collectionStatus.set(status)
    } catch {
      // Non-critical
    }
  }
}

/** Cancel an in-progress ingest operation. */
export async function cancelIngest(): Promise<void> {
  if (!get(ingestRunning)) return

  const root = get(ingestRoot) ?? get(activeCollection)?.path
  if (!root) return

  try {
    await window.api.cancelIngest(root)
  } catch (err) {
    ingestError.set(classifyCliError(err))
  }
}

/** Reset the index (delete corrupt files) and re-ingest from scratch. */
export async function rebuildIndex(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(ingestRunning)) return

  // Reset the index files first
  try {
    await window.api.resetIndex(collection.path)
  } catch (err) {
    ingestError.set(classifyCliError(err))
    ingestState.set('error')
    return
  }

  // Now run a full ingest
  await runIngest(true)
}

/** Reset ingest state (e.g. on collection switch). Does not cancel a running ingest. */
export function resetIngestState(): void {
  if (get(ingestRunning)) return
  stopTimer()
  ingestState.set('idle')
  ingestRunning.set(false)
  ingestIsReindex.set(false)
  ingestElapsed.set(0)
  ingestResult.set(null)
  ingestError.set(null)
  ingestProgress.set(null)
  ingestProgressErrors.set([])
  ingestRoot.set(null)
  ingestRunId.set(null)
  ingestModalOpen.set(false)
  ingestPreviewResult.set(null)
  ingestPreviewLoading.set(false)
}

/** Close the modal (only when not running). */
export function closeIngestModal(): void {
  if (get(ingestRunning)) {
    ingestModalOpen.set(false)
    return
  }
  ingestModalOpen.set(false)
  ingestState.set('idle')
  ingestPreviewResult.set(null)
}

/** Reopen the live background progress/result surface from the footer chip. */
export function openIngestModal(): void {
  ingestModalOpen.set(true)
}

/** Apply one main-process activity event to the renderer's ingest state. */
export function handleIngestEvent(event: IngestActivityEvent): void {
  const activeRoot = get(ingestRoot)
  if (activeRoot && activeRoot !== event.root) return

  ingestRoot.set(event.root)
  ingestRunId.set(event.run_id)
  ingestIsReindex.set(event.reindex)

  if (event.type === 'started') {
    ingestRunning.set(true)
    ingestState.set('ingesting')
    ingestResult.set(null)
    ingestError.set(null)
    ingestProgress.set(null)
    ingestProgressErrors.set([])
    startTimer()
    return
  }

  if (event.type === 'progress') {
    ingestProgress.set(event.progress)
    ingestElapsed.set(Math.floor(event.progress.elapsed_ms / 1000))
    if (event.progress.phase === 'file_error') {
      ingestProgressErrors.update((errors) => [
        ...errors,
        { path: event.progress.path, message: event.progress.message }
      ])
    }
    return
  }

  stopTimer()
  ingestRunning.set(false)
  if (event.type === 'completed' || event.type === 'cancelled') {
    ingestResult.set(event.result)
    ingestState.set('done')
  } else {
    ingestError.set(classifyCliError(new Error(event.message)))
    ingestState.set('error')
  }
}

let removeIngestListener: (() => void) | null = null

export function setupIngestListener(): void {
  removeIngestListener?.()
  removeIngestListener = window.api.onIngestEvent(handleIngestEvent)
}

export function teardownIngestListener(): void {
  removeIngestListener?.()
  removeIngestListener = null
}
