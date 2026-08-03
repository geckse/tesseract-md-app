import { get, writable } from 'svelte/store'

import type { ActivityLogDescriptor, ActivityLogChanged } from '../../preload/api'
import { workspace } from './workspace.svelte'
import { activeCollection } from './collections'
import { syncFileStoresFromTab } from './files'

export interface ActivitySummaryState {
  events: number
  estimatedInputTokens: number
  apiCalls: number
  errors: number
  watcherEvents: number
  watcherState: string
}

const EMPTY_SUMMARY: ActivitySummaryState = {
  events: 0,
  estimatedInputTokens: 0,
  apiCalls: 0,
  errors: 0,
  watcherEvents: 0,
  watcherState: 'stopped'
}

export const activitySummary = writable<ActivitySummaryState>({ ...EMPTY_SUMMARY })
export const activityUnreadErrors = writable(0)
export const activityLatestMessage = writable('No activity yet')

let removeChangedListener: (() => void) | null = null
let removeCollectionListener: (() => void) | null = null
let lastKnownErrors = 0

function applySummary(descriptor: ActivityLogDescriptor): void {
  const summary = descriptor.summary
  const next: ActivitySummaryState = {
    events: summary.events,
    estimatedInputTokens: summary.estimated_input_tokens,
    apiCalls: summary.api_calls,
    errors: summary.errors,
    watcherEvents: summary.watcher_events,
    watcherState: summary.watcher_state
  }
  if (summary.errors > lastKnownErrors) {
    activityUnreadErrors.update((count) => count + (summary.errors - lastKnownErrors))
  }
  lastKnownErrors = summary.errors
  activitySummary.set(next)
  activityLatestMessage.set(descriptor.latest_event)
}

function applyDescriptorToOpenTabs(descriptor: ActivityLogDescriptor): void {
  let focusedChanged = false
  for (const tab of Object.values(workspace.tabs)) {
    if (
      tab.kind !== 'document' ||
      tab.origin !== 'activity-log' ||
      tab.activityLog?.collectionId !== descriptor.collection_id ||
      tab.activityLog.date !== descriptor.date
    ) {
      continue
    }
    tab.content = descriptor.content
    tab.savedContent = descriptor.content
    tab.isDirty = false
    tab.activityLog.revision = descriptor.revision
    if (workspace.focusedTab?.id === tab.id) focusedChanged = true
  }
  if (focusedChanged) syncFileStoresFromTab()
}

async function refreshDescriptor(event: ActivityLogChanged): Promise<void> {
  const collection = get(activeCollection)
  if (!collection || collection.id !== event.collection_id) return
  try {
    const descriptor = await window.api.readActivityLog(event.collection_id, event.date)
    applyDescriptorToOpenTabs(descriptor)
    applySummary(descriptor)
  } catch {
    // Temporary logs can expire while a background window is suspended.
  }
}

export async function openTodayActivityLog(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  const descriptor = await window.api.openTodayActivityLog(collection.id)
  applySummary(descriptor)
  activityUnreadErrors.set(0)
  const tabId = workspace.openActivityLog(descriptor)
  if (tabId) syncFileStoresFromTab()
}

export function setupActivityLogListener(): void {
  removeChangedListener?.()
  removeCollectionListener?.()
  removeChangedListener = window.api.onActivityLogChanged((event) => {
    void refreshDescriptor(event)
  })
  removeCollectionListener = activeCollection.subscribe((collection) => {
    lastKnownErrors = 0
    activityUnreadErrors.set(0)
    activitySummary.set({ ...EMPTY_SUMMARY })
    if (!collection) return
    void window.api
      .openTodayActivityLog(collection.id)
      .then((descriptor) => {
        if (get(activeCollection)?.id === collection.id) applySummary(descriptor)
      })
      .catch(() => {})
  })
}

export function teardownActivityLogListener(): void {
  removeChangedListener?.()
  removeCollectionListener?.()
  removeChangedListener = null
  removeCollectionListener = null
}
