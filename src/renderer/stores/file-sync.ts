import { writable, get } from 'svelte/store'
import type { VaultFileEvent } from '../../preload/api'
import { workspace, type DocumentTab } from './workspace.svelte'
import { activeCollection } from './collections'
import { onExternalFileEvent, vaultWatcherStatus } from './vault-events'
import { syncFileStoresFromTab } from './files'
import { propertiesFileContent } from './properties'
import { countWords, countTokens } from './editor'
import { conflicts, showConflict, dismissConflict, getConflict, diffView } from './conflict'
import { threeWayMerge } from '../lib/three-way-merge'

/** Labels used on both sides of a merge/diff. */
const MERGE_LABELS = { ours: 'Editor (unsaved)', theirs: 'On disk' }

/**
 * Shared router for external file changes → open editor tabs.
 *
 * Replaces the per-editor 2s polling: Tier-1 vault events push changes here;
 * the router reads fresh disk content once per path and routes per tab —
 * clean tabs get the content applied live (the "agent edits appear as they
 * happen" effect), dirty tabs get a conflict with a disk snapshot + diff.
 */

/** Per-path event coalescing: trailing debounce + max-wait. */
const CHANGE_DEBOUNCE_MS = 200
const CHANGE_MAX_WAIT_MS = 1_000

/** Conflict snapshots above this size are not retained (re-read on demand). */
const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024

/** Poll cadence for the degraded mode (vault watcher unavailable). */
const FALLBACK_POLL_MS = 5_000

/**
 * Transient "updated from disk" notice for the clean-tab live-apply case.
 * `previous` holds the pre-update content so a diff can still be shown.
 */
export const externalUpdateNotice = writable<{
  filePath: string
  previous: string
  at: number
} | null>(null)

interface PendingChange {
  timer: ReturnType<typeof setTimeout>
  firstAt: number
}

const pendingByPath = new Map<string, PendingChange>()

/** Per-path read generation — a newer event during a read triggers one re-run. */
const readGeneration = new Map<string, number>()

let getCollectionPath: () => string | null = () => get(activeCollection)?.path ?? null

let unsubExternalEvents: (() => void) | null = null
let unsubWatcherStatus: (() => void) | null = null
let fallbackPollTimer: ReturnType<typeof setInterval> | null = null
let focusListener: (() => void) | null = null

// ─── Event intake ───────────────────────────────────────────────────────

/** Handle one external-origin vault file event. Exported for tests. */
export function handleVaultFileEvent(event: VaultFileEvent): void {
  if (event.isDirectory) return
  if (event.fileKind !== 'markdown') return

  switch (event.kind) {
    case 'created':
    case 'modified':
      scheduleChange(event.path)
      break
    case 'deleted':
      cancelPending(event.path)
      routeFileDeleted(event.path)
      break
    case 'renamed':
      if (event.oldPath) {
        cancelPending(event.oldPath)
        routeFileRenamed(event.oldPath, event.path)
      }
      scheduleChange(event.path)
      break
  }
}

function scheduleChange(relPath: string): void {
  const now = Date.now()
  const pending = pendingByPath.get(relPath)
  const firstAt = pending?.firstAt ?? now
  if (pending) clearTimeout(pending.timer)

  const untilCap = firstAt + CHANGE_MAX_WAIT_MS - now
  const delay = Math.max(0, Math.min(CHANGE_DEBOUNCE_MS, untilCap))

  pendingByPath.set(relPath, {
    firstAt,
    timer: setTimeout(() => {
      pendingByPath.delete(relPath)
      routeFileChange(relPath).catch(() => {})
    }, delay)
  })
}

function cancelPending(relPath: string): void {
  const pending = pendingByPath.get(relPath)
  if (pending) {
    clearTimeout(pending.timer)
    pendingByPath.delete(relPath)
  }
}

// ─── Routing ────────────────────────────────────────────────────────────

/** All open (non-untitled) document tabs for a relative path. */
function tabsForPath(relPath: string): DocumentTab[] {
  const tabs: DocumentTab[] = []
  for (const tab of Object.values(workspace.tabs)) {
    if (tab.kind === 'document' && !tab.isUntitled && tab.filePath === relPath) {
      tabs.push(tab)
    }
  }
  return tabs
}

/** Whether a tab is the focused pane's active document tab. */
function isFocusedTab(tab: DocumentTab): boolean {
  return workspace.focusedDocumentTab?.id === tab.id
}

async function routeFileChange(relPath: string): Promise<void> {
  const tabs = tabsForPath(relPath)
  if (tabs.length === 0) return

  const root = getCollectionPath()
  if (!root) return

  const generation = (readGeneration.get(relPath) ?? 0) + 1
  readGeneration.set(relPath, generation)

  let disk: string
  try {
    disk = await window.api.readFile(`${root}/${relPath}`)
  } catch {
    // File vanished between the event and the read
    routeFileDeleted(relPath)
    return
  }

  // A newer event landed mid-read — that scheduled run will read fresher bytes.
  if (readGeneration.get(relPath) !== generation) return

  let focusedUpdated = false
  for (const tab of tabs) {
    // Initial load in flight — _autoLoadTabContent will read the fresh state.
    if (tab.contentLoading) continue

    if (tab.diskMissing) tab.diskMissing = false

    // Echo guard: the editor's save handlers set savedContent synchronously
    // before writing, so by the time the fs event fires this compares equal.
    if (disk === tab.savedContent) {
      dismissConflict(relPath)
      continue
    }

    if (!tab.isDirty) {
      applyDiskContentToTab(tab, disk)
      dismissConflict(relPath)
      if (isFocusedTab(tab)) focusedUpdated = true
      continue
    }

    if (disk === tab.content) {
      // The external writer produced exactly what the user has — silently clean
      tab.savedContent = disk
      tab.isDirty = false
      dismissConflict(relPath)
      if (isFocusedTab(tab)) focusedUpdated = true
      continue
    }

    raiseConflict(tab, disk)
  }

  if (focusedUpdated) {
    propertiesFileContent.set(disk)
    syncFileStoresFromTab()
  }
}

function routeFileDeleted(relPath: string): void {
  const tabs = tabsForPath(relPath)
  if (tabs.length === 0) return

  let anyFocused = false
  for (const tab of tabs) {
    tab.diskMissing = true
    if (isFocusedTab(tab)) anyFocused = true
  }

  showConflict(relPath, {
    kind: 'deleted',
    diskContent: null,
    diskMtimeMs: null,
    detectedAt: Date.now(),
    dismissedDiskContent: undefined
  })

  if (anyFocused) syncFileStoresFromTab()
}

function routeFileRenamed(oldPath: string, newPath: string): void {
  const tabs = tabsForPath(oldPath)

  for (const tab of tabs) {
    tab.filePath = newPath
    tab.title = newPath.split('/').pop() ?? newPath
    tab.navigation.current = newPath
    if (isFocusedTab(tab)) syncFileStoresFromTab()
  }

  // Carry any conflict state over to the new key
  const existing = getConflict(oldPath)
  if (existing) {
    const { filePath: _oldKey, ...rest } = existing
    dismissConflict(oldPath)
    showConflict(newPath, rest)
  }
}

// ─── Applying + conflicts ───────────────────────────────────────────────

/**
 * Silently apply fresh disk content to a tab (live-edit effect). The visible
 * editor reacts through the tabs' $state reactivity — both editors' same-tab
 * effect branches dispatch the new content as a minimal change.
 */
export function applyDiskContentToTab(tab: DocumentTab, content: string): void {
  const previous = tab.content
  tab.content = content
  tab.savedContent = content
  tab.isDirty = false
  tab.diskMissing = false
  tab.wordCount = countWords(content)
  tab.tokenCount = countTokens(content)
  externalUpdateNotice.set({ filePath: tab.filePath, previous: previous ?? '', at: Date.now() })
}

function raiseConflict(tab: DocumentTab, disk: string): void {
  const filePath = tab.filePath

  // Keep-Mine mute: identical disk content doesn't re-raise
  const existing = getConflict(filePath)
  if (existing?.dismissedDiskContent === disk) return

  // base = the version both sides diverged from (last saved/loaded content)
  const base = tab.savedContent ?? ''
  const mergeClean = threeWayMerge(base, tab.content ?? '', disk, MERGE_LABELS).clean

  showConflict(filePath, {
    kind: 'modified',
    diskContent: disk.length <= MAX_SNAPSHOT_SIZE ? disk : null,
    diskMtimeMs: null,
    detectedAt: Date.now(),
    mergeClean,
    dismissedDiskContent: undefined
  })

  if (isFocusedTab(tab)) {
    window.api
      .getAutoShowDiff()
      .then((autoShow) => {
        if (!autoShow) return
        // Still conflicted and still focused?
        if (!getConflict(filePath)) return
        if (workspace.focusedDocumentTab?.filePath !== filePath) return
        openConflictDiff(filePath).catch(() => {})
      })
      .catch(() => {})
  }
}

/** Open the diff view for an active conflict (disk vs editor). */
export async function openConflictDiff(filePath: string): Promise<void> {
  const conflict = getConflict(filePath)
  if (!conflict || conflict.kind !== 'modified') return

  const tab = tabsForPath(filePath)[0]
  if (!tab) return

  let disk = conflict.diskContent
  if (disk === null) {
    const root = getCollectionPath()
    if (!root) return
    try {
      disk = await window.api.readFile(`${root}/${filePath}`)
    } catch {
      return
    }
  }

  const merge = threeWayMerge(tab.savedContent ?? '', tab.content ?? '', disk, MERGE_LABELS)

  diffView.set({
    filePath,
    original: disk,
    modified: tab.content ?? '',
    originalLabel: 'On disk',
    modifiedLabel: 'Editor (unsaved)',
    showActions: true,
    merged: merge.clean ? merge.merged : null
  })
}

/** Open an info-only diff of the last live-applied external update. */
export function openExternalUpdateDiff(filePath: string): void {
  const notice = get(externalUpdateNotice)
  if (!notice || notice.filePath !== filePath) return
  const tab = tabsForPath(filePath)[0]
  if (!tab) return

  diffView.set({
    filePath,
    original: notice.previous,
    modified: tab.content ?? '',
    originalLabel: 'Before',
    modifiedLabel: 'Updated from disk',
    showActions: false
  })
}

/** Conflict resolution: replace the editor content with the disk state. */
export async function resolveConflictTakeDisk(filePath: string): Promise<void> {
  const root = getCollectionPath()
  if (!root) return

  let disk: string
  try {
    // Re-read — fresher than the snapshot if the agent kept writing
    disk = await window.api.readFile(`${root}/${filePath}`)
  } catch {
    return
  }

  let anyFocused = false
  for (const tab of tabsForPath(filePath)) {
    applyDiskContentToTab(tab, disk)
    if (isFocusedTab(tab)) anyFocused = true
  }
  dismissConflict(filePath)
  if (anyFocused) {
    propertiesFileContent.set(disk)
    syncFileStoresFromTab()
  }
}

/**
 * Conflict resolution: compose both sides into one document. Applies the
 * merged content to the editor as unsaved changes (the user reviews and
 * saves). Only succeeds when the edits don't overlap; on a race where the
 * user typed into the disk-changed lines since the conflict was raised, it
 * leaves the conflict open and notifies via the still-active banner.
 */
export async function resolveConflictMerge(filePath: string): Promise<boolean> {
  const conflict = getConflict(filePath)
  if (!conflict || conflict.kind !== 'modified') return false

  const root = getCollectionPath()
  if (!root) return false

  // Re-read disk (fresher than the snapshot) and merge against live content
  let disk: string
  try {
    disk = await window.api.readFile(`${root}/${filePath}`)
  } catch {
    return false
  }

  const tabs = tabsForPath(filePath)
  const source = tabs[0]
  if (!source) return false

  const merge = threeWayMerge(source.savedContent ?? '', source.content ?? '', disk, MERGE_LABELS)
  if (!merge.clean) {
    // Overlap appeared since the conflict was raised — keep the conflict up so
    // the user resolves with Keep Mine / Take Disk instead.
    showConflict(filePath, { mergeClean: false })
    return false
  }

  let anyFocused = false
  for (const tab of tabs) {
    applyMergedContentToTab(tab, merge.merged, disk)
    if (isFocusedTab(tab)) anyFocused = true
  }
  dismissConflict(filePath)
  if (anyFocused) {
    propertiesFileContent.set(merge.merged)
    syncFileStoresFromTab()
  }
  return true
}

/**
 * Apply a composed (merged) document to a tab: the merged text becomes the
 * editor's content, the disk version becomes the new saved baseline, and the
 * tab is left dirty so the user reviews and saves the combined result.
 */
function applyMergedContentToTab(tab: DocumentTab, merged: string, disk: string): void {
  tab.content = merged
  tab.savedContent = disk
  tab.isDirty = merged !== disk
  tab.diskMissing = false
  tab.wordCount = countWords(merged)
  tab.tokenCount = countTokens(merged)
}

/**
 * Conflict resolution: keep the editor content. The conflict entry stays,
 * muted against identical disk content; the user's next save overwrites disk
 * (and clears the entry via the save → dismissConflict path).
 */
export function resolveConflictKeepMine(filePath: string): void {
  const conflict = getConflict(filePath)
  if (!conflict) return
  showConflict(filePath, {
    dismissedDiskContent: conflict.diskContent ?? undefined
  })
  const view = get(diffView)
  if (view?.filePath === filePath) diffView.set(null)
}

/** Deleted-on-disk resolution: keep the buffer; next save recreates the file. */
export function keepDeletedFileInEditor(filePath: string): void {
  for (const tab of tabsForPath(filePath)) {
    tab.diskMissing = false
    tab.savedContent = null
    tab.isDirty = true
    if (isFocusedTab(tab)) syncFileStoresFromTab()
  }
  dismissConflict(filePath)
}

/** Deleted-on-disk resolution: close all tabs showing the file. */
export function closeDeletedFileTabs(filePath: string): void {
  for (const tab of tabsForPath(filePath)) {
    workspace.closeTab(tab.id)
  }
  dismissConflict(filePath)
  syncFileStoresFromTab()
}

// ─── Verification nets (focus + degraded mode) ─────────────────────────

/**
 * One-shot check of the focused tab against disk — catches changes missed
 * while the watcher was down or the window unfocused.
 */
export async function verifyOpenTabsAgainstDisk(): Promise<void> {
  const tab = workspace.focusedDocumentTab
  if (!tab || tab.isUntitled || tab.contentLoading || tab.content === null) return
  await routeFileChange(tab.filePath)
}

function startFallbackPoll(): void {
  if (fallbackPollTimer) return
  fallbackPollTimer = setInterval(() => {
    verifyOpenTabsAgainstDisk().catch(() => {})
  }, FALLBACK_POLL_MS)
}

function stopFallbackPoll(): void {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer)
    fallbackPollTimer = null
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────

export interface FileSyncOptions {
  /** Override for popup windows, which pin a collection via query param. */
  getCollectionPath?: () => string | null
}

/** Set up the file-sync router. Call once per window (App / PopupShell). */
export function setupFileSyncListener(options?: FileSyncOptions): void {
  if (options?.getCollectionPath) {
    getCollectionPath = options.getCollectionPath
  }

  unsubExternalEvents = onExternalFileEvent(handleVaultFileEvent)

  // Degraded mode: poll the focused tab only while Tier-1 is unavailable
  unsubWatcherStatus = vaultWatcherStatus.subscribe((status) => {
    if (status.state === 'running') stopFallbackPoll()
    else startFallbackPoll()
  })

  focusListener = () => {
    verifyOpenTabsAgainstDisk().catch(() => {})
  }
  window.addEventListener('focus', focusListener)
}

/** Tear down the file-sync router. */
export function teardownFileSyncListener(): void {
  unsubExternalEvents?.()
  unsubExternalEvents = null
  unsubWatcherStatus?.()
  unsubWatcherStatus = null
  if (focusListener) {
    window.removeEventListener('focus', focusListener)
    focusListener = null
  }
  stopFallbackPoll()
  resetFileSyncState()
}

/** Clear routing state (collection switch). */
export function resetFileSyncState(): void {
  for (const pending of pendingByPath.values()) {
    clearTimeout(pending.timer)
  }
  pendingByPath.clear()
  readGeneration.clear()
  conflicts.set({})
  diffView.set(null)
  externalUpdateNotice.set(null)
}
