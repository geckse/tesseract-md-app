import { writable, get } from 'svelte/store'
import type { WatcherStatus, WatcherEvent } from '../../preload/api'
import { activeCollection, collectionStatus } from './collections'
import { applyWatchReportToTree, scheduleTreeResync, selectedFilePath } from './files'
import { refreshGraphData } from './graph'
import { linksInfo, backlinksInfo, loadProperties } from './properties'

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

/**
 * Start the watcher for the active collection.
 * @param remember - persist the enabled state so it restarts on next launch
 *                   (true for user toggles; false for automatic restore).
 */
export async function startWatcher(remember = true): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(watcherToggling)) return

  watcherToggling.set(true)
  watcherError.set(null)

  try {
    await window.api.startWatcher(collection.path)
    watcherState.set('starting')
    if (remember) window.api.setWatcherEnabled(collection.id, true).catch(() => {})
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

  const collection = get(activeCollection)
  watcherToggling.set(true)
  watcherError.set(null)

  try {
    await window.api.stopWatcher()
    watcherState.set('stopped')
    if (collection) window.api.setWatcherEnabled(collection.id, false).catch(() => {})
  } catch (err) {
    watcherError.set(err instanceof Error ? err.message : String(err))
  } finally {
    watcherToggling.set(false)
  }
}

/**
 * Restore the watcher for the active collection if it was last left running.
 * Call on app mount and after a collection switch. Does not re-persist the
 * flag (it's already true) and no-ops when the watcher is already running.
 */
export async function restoreWatcherForCollection(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (get(watcherState) === 'running' || get(watcherState) === 'starting') return
  try {
    const enabled = await window.api.getWatcherEnabled(collection.id)
    if (enabled) await startWatcher(false)
  } catch {
    // Non-critical
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

/** Debounce timer for the authoritative cli:status refresh. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const REFRESH_DEBOUNCE_MS = 500

/** Graph refresh debounce: trailing settle + max-wait cap so a continuous
 *  agent write stream cannot starve the graph forever. */
const GRAPH_REFRESH_DEBOUNCE_MS = 800
const GRAPH_REFRESH_MAX_WAIT_MS = 5_000
let graphRefreshTimer: ReturnType<typeof setTimeout> | null = null
let graphRefreshFirstAt: number | null = null

/** Properties/LocalGraph refresh: debounced, only when the change intersects
 *  the selected file or its 1-hop neighborhood. */
const PROPS_REFRESH_DEBOUNCE_MS = 800
let propsRefreshTimer: ReturnType<typeof setTimeout> | null = null
let propsChangedPaths = new Set<string>()

/** Whether this session has seen the watcher running before (restart detection). */
let watcherHadRun = false

/** Handle an incoming watcher event from the main process. */
export function handleWatcherEvent(event: WatcherEvent): void {
  pushEvent(event)

  if (event.type === 'state-change') {
    const state = event.data
    watcherState.set(state)
    if (state === 'error') {
      watcherError.set('Watcher encountered an error')
    }
    if (state === 'running') {
      if (watcherHadRun) {
        // The watcher was down (crash restart, ingest pause) — events were
        // missed, so resync the tree and patch the graph from fresh data.
        scheduleTreeResync()
        refreshGraphData().catch(() => {})
      }
      watcherHadRun = true
    }
  }

  if (event.type === 'error') {
    watcherError.set(event.data?.message ?? 'Unknown watcher error')
    watcherState.set('error')
  }

  if (event.type === 'watch-event') {
    const report = event.data

    // Patch the file tree per path (state flip to 'indexed' / row removal)
    applyWatchReportToTree(report)

    if (report.success) {
      // Optimistic document count; chunk/vector deltas are unknowable
      // client-side (chunks_processed is a total, not a delta) — the
      // debounced cli:status fetch below reconciles them.
      if (report.event_type === 'Created' || report.event_type === 'Deleted') {
        const delta = report.event_type === 'Created' ? 1 : -1
        collectionStatus.update(
          (s) => s && { ...s, document_count: Math.max(0, s.document_count + delta) }
        )
      }

      scheduleGraphRefresh()
      schedulePropertiesRefresh(report.path)
    }

    // Debounced authoritative status refresh (numbers only — not a view reload)
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refreshCollectionStatus()
    }, REFRESH_DEBOUNCE_MS)
  }
}

/** Schedule a debounced background graph re-fetch (diffed + patched in view). */
function scheduleGraphRefresh(): void {
  const now = Date.now()
  if (graphRefreshFirstAt === null) {
    graphRefreshFirstAt = now
  }

  if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
  const untilCap = graphRefreshFirstAt + GRAPH_REFRESH_MAX_WAIT_MS - now
  const delay = Math.max(0, Math.min(GRAPH_REFRESH_DEBOUNCE_MS, untilCap))

  graphRefreshTimer = setTimeout(() => {
    graphRefreshTimer = null
    graphRefreshFirstAt = null
    refreshGraphData().catch(() => {})
  }, delay)
}

/** Refresh the properties panel when a reindexed file touches the selection. */
function schedulePropertiesRefresh(changedPath: string): void {
  propsChangedPaths.add(changedPath)
  if (propsRefreshTimer) clearTimeout(propsRefreshTimer)
  propsRefreshTimer = setTimeout(() => {
    propsRefreshTimer = null
    const changed = propsChangedPaths
    propsChangedPaths = new Set()

    const selected = get(selectedFilePath)
    if (!selected) return

    let relevant = changed.has(selected)
    if (!relevant) {
      const links = get(linksInfo)
      const backlinks = get(backlinksInfo)
      relevant =
        (links?.links.outgoing.some((l) => changed.has(l.entry.target)) ?? false) ||
        (backlinks?.backlinks.some((b) => changed.has(b.entry.source)) ?? false)
    }
    if (relevant) {
      loadProperties(selected)
    }
  }, PROPS_REFRESH_DEBOUNCE_MS)
}

/** Refresh collection status counters from the CLI (non-critical helper). */
export async function refreshCollectionStatus(): Promise<void> {
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
