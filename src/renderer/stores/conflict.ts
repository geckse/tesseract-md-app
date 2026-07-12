import { writable, derived, get } from 'svelte/store'

/**
 * Per-file conflict state for "changed on disk" situations.
 *
 * Keyed by relative file path (not tab id) — the same file open in two split
 * panes is one logical conflict. Raised by the file-sync router when a dirty
 * tab's file changes externally; resolved via Take Disk / Keep Mine / save.
 */
export interface ConflictInfo {
  /** Relative file path within the collection. */
  filePath: string
  /** 'modified' = disk diverged from the editor; 'deleted' = file gone on disk. */
  kind: 'modified' | 'deleted'
  /** Disk snapshot at detection (null for very large files — re-read on demand). */
  diskContent: string | null
  diskMtimeMs: number | null
  detectedAt: number
  /**
   * Whether the local and disk edits can be composed cleanly (they touch
   * different lines) — drives whether the Merge action is offered.
   */
  mergeClean?: boolean
  /**
   * Keep-Mine mute: after the user dismisses, identical disk content will not
   * re-raise the conflict; a further external change will.
   */
  dismissedDiskContent?: string
}

/** All active conflicts, keyed by relative file path. */
export const conflicts = writable<Record<string, ConflictInfo>>({})

/**
 * Back-compat single-path view: the first active (non-muted) conflict path.
 * Prefer reading `conflicts` keyed by the file you render.
 */
export const conflictFilePath = derived(conflicts, ($conflicts) => {
  const first = Object.values($conflicts).find((c) => c.dismissedDiskContent === undefined)
  return first?.filePath ?? null
})

/** Content shown by the DiffView modal, or null when closed. */
export interface DiffViewRequest {
  filePath: string
  /** "Before" side (disk snapshot for conflicts; previous content for toasts). */
  original: string
  /** "After" side (editor content for conflicts; new disk content for toasts). */
  modified: string
  originalLabel: string
  modifiedLabel: string
  /** Whether Take Disk / Keep Mine actions apply (false for info-only views). */
  showActions: boolean
  /** Cleanly composed document when a merge is possible, else null. */
  merged?: string | null
}

/** The currently open diff view, or null. */
export const diffView = writable<DiffViewRequest | null>(null)

/** Raise (or update) a conflict for a file. */
export function showConflict(
  filePath: string,
  info?: Partial<Omit<ConflictInfo, 'filePath'>>
): void {
  conflicts.update(($conflicts) => {
    const existing = $conflicts[filePath] as ConflictInfo | undefined
    const base: ConflictInfo = existing ?? {
      filePath,
      kind: 'modified',
      diskContent: null,
      diskMtimeMs: null,
      detectedAt: Date.now()
    }
    return { ...$conflicts, [filePath]: { ...base, ...info, filePath } }
  })
}

/**
 * Dismiss a file's conflict, or all conflicts when called without a path
 * (back-compat with the previous single-conflict API).
 */
export function dismissConflict(filePath?: string): void {
  if (filePath === undefined) {
    conflicts.set({})
    diffView.set(null)
    return
  }
  conflicts.update(($conflicts) => {
    if (!(filePath in $conflicts)) return $conflicts
    const next = { ...$conflicts }
    delete next[filePath]
    return next
  })
  const view = get(diffView)
  if (view?.filePath === filePath) diffView.set(null)
}

/** Get the active conflict for a file (undefined when none). */
export function getConflict(filePath: string): ConflictInfo | undefined {
  return get(conflicts)[filePath]
}

/** Close the diff view without resolving anything. */
export function closeDiffView(): void {
  diffView.set(null)
}
