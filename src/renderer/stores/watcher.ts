import { writable, get } from 'svelte/store'
import type { WatcherStatus, WatcherEvent } from '../../preload/api'
import { activeCollection, collectionStatus } from './collections'
import { loadFileTree } from './files'

/** Maximum number of events to retain in the ring buffer. */
const MAX_EVENTS = 50

/** Current watcher state. */
export const watcherState = writable<WatcherStatus['state']>('stopped')

/** Ring buffer of recent watcher events (newest first). */
export const watcherEvents = writable<WatcherEvent[]>([])

/** Error message if the watcher encountered an error. */
export const watcherError = writable<string | null>(null)

/** Whether a toggle operation is in progress. */
export const watcherToggling = writable<boolean>(false)

/** Push a new event into the ring buffer, capping at MAX_EVENTS. */
function pushEvent(event: WatcherEvent): void {
  watcherEvents.update((events) => {
    const updated = [event, ...events]
    if (updated.length > MAX_EVENTS) {
      updated.length = MAX_EVENTS
    }
    return updated
  })
}

/** Start the watcher for the active collection. */
export async function startWatcher(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(watcherToggling)) return

  watcherToggling.set(true)
  watcherError.set(null)

  try {
    await window.api.startWatcher(collection.path)
    watcherState.set('starting')
  } catch (err) {
    watcherError.set(err instanceof Error ? err.message : String(err))
    watcherState.set('error')
  } finally {
    watcherToggling.set(false)
  }
}

/** Stop the watcher. */
export async function stopWatcher(): Promise<void> {
  if (get(watcherToggling)) return

  watcherToggling.set(true)
  watcherError.set(null)

  try {
    await window.api.stopWatcher()
    watcherState.set('stopped')
  } catch (err) {
    watcherError.set(err instanceof Error ? err.message : String(err))
  } finally {
    watcherToggling.set(false)
  }
}

/** Toggle the watcher on or off. */
export async function toggleWatcher(): Promise<void> {
  const state = get(watcherState)
  if (state === 'running') {
    await stopWatcher()
  } else if (state === 'stopped' || state === 'error') {
    await startWatcher()
  }
}

/** Fetch the current watcher status from the main process. */
export async function fetchWatcherStatus(): Promise<void> {
  try {
    const status = await window.api.getWatcherStatus()
    watcherState.set(status.state)
  } catch {
    // Non-critical
  }
}

/** Debounce timer for watch-event triggered refreshes. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const REFRESH_DEBOUNCE_MS = 500

/** Handle an incoming watcher event from the main process. */
export function handleWatcherEvent(event: WatcherEvent): void {
  pushEvent(event)

  if (event.type === 'state-change') {
    const state = event.data as WatcherStatus['state']
    watcherState.set(state)
    if (state === 'error') {
      watcherError.set('Watcher encountered an error')
    }
  }

  if (event.type === 'error') {
    const errorData = event.data as { message?: string }
    watcherError.set(errorData?.message ?? 'Unknown watcher error')
    watcherState.set('error')
  }

  // Debounced auto-refresh on watch events to avoid reload storms
  if (event.type === 'watch-event') {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      loadFileTree().catch(() => {})
      refreshCollectionStatus()
    }, REFRESH_DEBOUNCE_MS)
  }
}

/** Refresh collection status (non-critical helper). */
async function refreshCollectionStatus(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  try {
    const status = await window.api.status(collection.path)
    collectionStatus.set(status)
  } catch {
    // Non-critical
  }
}

/** Set up the watcher event listener. Call on app mount. */
export function setupWatcherListener(): void {
  window.api.onWatcherEvent(handleWatcherEvent)
}

/** Remove the watcher event listener. Call on app unmount. */
export function teardownWatcherListener(): void {
  window.api.removeWatcherEventListener()
}

/** Clear all events from the ring buffer. */
export function clearWatcherEvents(): void {
  watcherEvents.set([])
}
