import { writable, get } from 'svelte/store'
import type { IngestResult, IngestPreview } from '../types/cli'
import { activeCollection, collectionStatus } from './collections'
import { loadFileTree, loadAssetTree } from './files'

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

/** Error message if ingest failed. */
export const ingestError = writable<string | null>(null)

/** Whether the ingest modal is open. */
export const ingestModalOpen = writable<boolean>(false)

/** Result of a preview (dry-run) operation. */
export const ingestPreviewResult = writable<IngestPreview | null>(null)

/** Whether a preview operation is currently loading. */
export const ingestPreviewLoading = writable<boolean>(false)

let elapsedInterval: ReturnType<typeof setInterval> | null = null

function startTimer(): void {
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
export async function runPreview(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(ingestState) !== 'idle' && get(ingestState) !== 'done' && get(ingestState) !== 'error') return

  ingestState.set('previewing')
  ingestPreviewLoading.set(true)
  ingestPreviewResult.set(null)
  ingestError.set(null)
  ingestModalOpen.set(true)

  try {
    const result = await window.api.ingestPreview(collection.path)
    ingestPreviewResult.set(result)
  } catch (err) {
    ingestError.set(err instanceof Error ? err.message : String(err))
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
  ingestModalOpen.set(true)
  startTimer()

  try {
    const result = await window.api.ingest(collection.path, { reindex })
    ingestResult.set(result)
    ingestState.set('done')
  } catch (err) {
    ingestError.set(err instanceof Error ? err.message : String(err))
    ingestState.set('error')
  } finally {
    stopTimer()
    ingestRunning.set(false)
    // Refresh file tree and collection status after ingest
    await Promise.all([loadFileTree(), loadAssetTree()])
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

  try {
    await window.api.cancelIngest()
  } catch (err) {
    ingestError.set(err instanceof Error ? err.message : String(err))
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
    ingestError.set(err instanceof Error ? err.message : String(err))
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
  ingestModalOpen.set(false)
  ingestPreviewResult.set(null)
  ingestPreviewLoading.set(false)
}

/** Close the modal (only when not running). */
export function closeIngestModal(): void {
  if (get(ingestRunning)) return
  ingestModalOpen.set(false)
  ingestState.set('idle')
  ingestPreviewResult.set(null)
}
