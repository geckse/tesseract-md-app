import { writable, get } from 'svelte/store'
import type { IngestResult } from '../types/cli'
import { activeCollection, collectionStatus } from './collections'
import { loadFileTree } from './files'

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

/** Run ingest on the active collection.
 *  @param reindex — if true, forces a full reindex; otherwise incremental (default).
 */
export async function runIngest(reindex = false): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(ingestRunning)) return

  ingestRunning.set(true)
  ingestIsReindex.set(reindex)
  ingestResult.set(null)
  ingestError.set(null)
  ingestModalOpen.set(true)
  startTimer()

  try {
    const result = await window.api.ingest(collection.path, { reindex })
    ingestResult.set(result)
  } catch (err) {
    ingestError.set(err instanceof Error ? err.message : String(err))
  } finally {
    stopTimer()
    ingestRunning.set(false)
    // Refresh file tree and collection status after ingest
    await loadFileTree()
    try {
      const status = await window.api.status(collection.path)
      collectionStatus.set(status)
    } catch {
      // Non-critical
    }
  }
}

/** Close the modal (only when not running). */
export function closeIngestModal(): void {
  if (get(ingestRunning)) return
  ingestModalOpen.set(false)
}
