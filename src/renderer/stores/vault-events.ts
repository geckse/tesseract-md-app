import { writable, get } from 'svelte/store'
import type { VaultEventBatch, VaultFileEvent, VaultWatcherStatus } from '../../preload/api'
import { activeCollection } from './collections'
import { loadFileTree, loadAssetTree, routeVaultEventToTree } from './files'
import { refreshCollectionStatus } from './watcher'
import { refreshGraphData } from './graph'

/**
 * Renderer-side dispatcher for Tier-1 vault watcher batches.
 *
 * One listener per window (App.svelte / PopupShell.svelte). Batches are
 * filtered by collection root, then routed per event: every event feeds the
 * incremental file-tree patchers; external-origin file events additionally
 * fan out to registered handlers (the editor's file-sync router).
 */

/** Live status of the main-process vault watcher (gates editor poll fallback). */
export const vaultWatcherStatus = writable<VaultWatcherStatus>({ state: 'stopped', root: null })

type VaultFileEventHandler = (event: VaultFileEvent) => void

/** Handlers for external-origin (non-app) file events — e.g. editor file-sync. */
const externalFileEventHandlers = new Set<VaultFileEventHandler>()

/** Resolves the collection root this window cares about. */
let getCollectionPath: () => string | null = () => get(activeCollection)?.path ?? null

/**
 * Register a handler for external-origin file events (agent/other-program
 * writes). Directory events are included; app-origin events are not.
 * Returns an unsubscribe function.
 */
export function onExternalFileEvent(handler: VaultFileEventHandler): () => void {
  externalFileEventHandlers.add(handler)
  return () => externalFileEventHandlers.delete(handler)
}

/** Handle one batch from the main process. Exported for tests. */
export function handleVaultEventBatch(batch: VaultEventBatch): void {
  const root = getCollectionPath()
  // Batches for other roots (in-flight during a collection switch) are dropped —
  // this makes switch races self-healing without listener teardown.
  if (!root || batch.root !== root) return

  if (batch.overflow) {
    // Burst beyond the batch cap: events were truncated — resync instead of
    // patching from an incomplete list.
    Promise.all([loadFileTree(), loadAssetTree()]).catch(() => {})
    refreshCollectionStatus()
    refreshGraphData().catch(() => {})
    return
  }

  for (const event of batch.events) {
    // Tree mutators run for app-origin events too (idempotent; covers app
    // writes whose optimistic tree update was missed).
    routeVaultEventToTree(event)

    // Editor/file-sync consumers only care about changes the app didn't make
    // itself — its own saves already flow through the save handlers and the
    // cross-window 'file:saved-externally' push.
    if (event.origin === 'external') {
      for (const handler of externalFileEventHandlers) {
        handler(event)
      }
    }
  }
}

export interface VaultListenerOptions {
  /** Override for popup windows, which pin a collection via query param. */
  getCollectionPath?: () => string | null
}

/** Set up the vault event listener. Call once on window mount. */
export function setupVaultListener(options?: VaultListenerOptions): void {
  if (options?.getCollectionPath) {
    getCollectionPath = options.getCollectionPath
  }
  window.api.onVaultFileEvents(handleVaultEventBatch)
  window.api.onVaultWatcherStatus((status) => vaultWatcherStatus.set(status))
  // Late-mounting windows pull the current status once
  window.api
    .getVaultWatcherStatus()
    .then((status) => vaultWatcherStatus.set(status))
    .catch(() => {
      // Non-critical
    })
}

/** Remove the vault event listener. Call on window unmount. */
export function teardownVaultListener(): void {
  window.api.removeVaultFileEventsListener()
  window.api.removeVaultWatcherStatusListener()
  externalFileEventHandlers.clear()
}
