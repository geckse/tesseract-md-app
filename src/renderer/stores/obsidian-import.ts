/**
 * Obsidian topic sync notifications (phase 44).
 *
 * The main process keeps Obsidian-vault collections' topics in sync with the
 * vault's tags and graph color groups (import on first scan, add/update/remove
 * on later changes — user-edited topics are never touched) and broadcasts
 * `topics:obsidian-synced` whenever a sync changed something. This store
 * surfaces that event as a dismissible notice and keeps topic UI state fresh.
 */

import { writable, get } from 'svelte/store'
import type { ObsidianTopicsSyncedEvent } from '../../preload/api'
import { activeCollectionId } from './collections'
import { activeTopicScope, loadTopics, markTopicsNeedIngest, selectTopicScope } from './topics'

/** Last unacknowledged sync event, or null. */
export const obsidianImportNotice = writable<ObsidianTopicsSyncedEvent | null>(null)

/**
 * Handle a `topics:obsidian-synced` broadcast: surface the notice and, when
 * it concerns the active collection, refresh topic state and flag the pending
 * re-ingest (topic assignments are only computed by the next ingest).
 */
export function handleObsidianTopicsSynced(event: ObsidianTopicsSyncedEvent): void {
  obsidianImportNotice.set(event)
  if (get(activeCollectionId) === event.collectionId) {
    if (!get(activeTopicScope)) {
      selectTopicScope(event.root, null)
    }
    // Obsidian imports are collection-owned even while Settings is presenting
    // a Shard-local topic scope. Refresh and flag the root without stealing
    // the user's selected Settings scope.
    const refresh = loadTopics(event.root, null, { activate: false })
    markTopicsNeedIngest(event.root, null)
    refresh.catch(() => {})
  }
}

/** Register the preload listener. Called once from App.svelte onMount. */
export function setupObsidianImportListener(): void {
  window.api.onObsidianTopicsSynced(handleObsidianTopicsSynced)
}

/** Dismiss the current notice. */
export function dismissObsidianImportNotice(): void {
  obsidianImportNotice.set(null)
}
