/**
 * Per-tab undo/redo history for the table view (cell edits, add row, delete row).
 *
 * Pure data store: stacks, staleness snapshots, transient notice and reveal
 * requests. Application semantics (staleness checks against live rows, the
 * actual writes) live in TableStore.undo/redo — table.svelte.ts imports this
 * file one-way, never the reverse.
 *
 * History is in-memory and per window; a table tab transferred to another
 * window (workspace.removeTabSilently) keeps no history there. Batch property
 * ops (rename / type conversion) are intentionally NOT recorded — they have
 * their own preview + confirm flow.
 *
 * Svelte 5 runes singleton (MUST remain a .svelte.ts file).
 */

import type { JsonValue } from '../types/cli'
import { workspace } from './workspace.svelte'

/**
 * Normalized snapshot of one frontmatter cell. `'' | null | undefined` all
 * record as absent — mirroring editCell's clearing rule exactly, so an undo
 * of "value → cleared" replays as an unset, not a write of ''.
 */
export type CellSnapshot = { present: true; value: JsonValue } | { present: false }

export interface CellEditEntry {
  kind: 'cell-edit'
  /** Collection-relative path — the stable row key (reconcileRows keys by path). */
  path: string
  column: string
  /** Undo applies this. */
  before: CellSnapshot
  /** Redo applies this; also the staleness reference for undo. */
  after: CellSnapshot
}

export interface AddRowEntry {
  kind: 'add-row'
  path: string
  /** File bytes needed to RE-create the row on redo. Refreshed at trash time
   *  (undo re-reads current bytes before trashing, so body edits made after
   *  the add survive an undo → redo round trip). */
  content: string
}

export interface DeleteRowEntry {
  kind: 'delete-row'
  path: string
  /** Full file content snapshot captured via readFile BEFORE the trash. */
  content: string
}

export type HistoryEntry = (CellEditEntry | AddRowEntry | DeleteRowEntry) & { at: number }

/** Normalize a cell value into a snapshot (editCell's clearing rule). */
export function snapshotOf(value: JsonValue | null | undefined): CellSnapshot {
  if (value === undefined || value === null || value === '') return { present: false }
  return { present: true, value }
}

/** Deep-equal on snapshots (JSON convention, same as reconcileRows). */
export function snapshotsEqual(a: CellSnapshot, b: CellSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Maximum history entries kept per tab (parity with navigation.ts). */
const MAX_ENTRIES = 100

/** How long a skip/failure notice stays before the store clears it. */
const NOTICE_TTL_MS = 4000

interface TabStacks {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

class TableHistoryStore {
  private stacks = $state<Record<string, TabStacks>>({})

  /** Transient per-tab notice ("Undo skipped — …"). Rendered by TableToolbar. */
  notice = $state<{ tabId: string; message: string; at: number } | null>(null)

  /** Scroll/flash request consumed by TableView. Token re-triggers repeats. */
  reveal = $state<{ tabId: string; path: string; column: string | null; token: number } | null>(
    null
  )

  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private revealToken = 0

  constructor() {
    // Drop history when its table tab closes. Registered unconditionally —
    // no window.api dependency, works in jsdom tests.
    workspace.onTabClosed((tab) => {
      if (tab.kind === 'table') this.drop(tab.id)
    })
  }

  canUndo(tabId: string): boolean {
    return (this.stacks[tabId]?.undo.length ?? 0) > 0
  }

  canRedo(tabId: string): boolean {
    return (this.stacks[tabId]?.redo.length ?? 0) > 0
  }

  /** Record a fresh user mutation: push onto undo (capped), clear redo. */
  record(tabId: string, entry: HistoryEntry): void {
    const cur = this.stacks[tabId] ?? { undo: [], redo: [] }
    const undo = [...cur.undo.slice(-(MAX_ENTRIES - 1)), entry]
    this.stacks = { ...this.stacks, [tabId]: { undo, redo: [] } }
  }

  /**
   * Invalidate redo after a mutation that could not be recorded (e.g. the
   * pre-trash snapshot read failed) — stale redo entries must not replay
   * on top of it.
   */
  clearRedo(tabId: string): void {
    const cur = this.stacks[tabId]
    if (!cur || cur.redo.length === 0) return
    this.stacks = { ...this.stacks, [tabId]: { ...cur, redo: [] } }
  }

  popUndo(tabId: string): HistoryEntry | null {
    const cur = this.stacks[tabId]
    if (!cur || cur.undo.length === 0) return null
    const entry = cur.undo[cur.undo.length - 1]
    this.stacks = { ...this.stacks, [tabId]: { ...cur, undo: cur.undo.slice(0, -1) } }
    return entry
  }

  popRedo(tabId: string): HistoryEntry | null {
    const cur = this.stacks[tabId]
    if (!cur || cur.redo.length === 0) return null
    const entry = cur.redo[cur.redo.length - 1]
    this.stacks = { ...this.stacks, [tabId]: { ...cur, redo: cur.redo.slice(0, -1) } }
    return entry
  }

  /** Raw push moving an entry across stacks during undo — does NOT clear redo. */
  pushUndoRaw(tabId: string, entry: HistoryEntry): void {
    const cur = this.stacks[tabId] ?? { undo: [], redo: [] }
    this.stacks = {
      ...this.stacks,
      [tabId]: { ...cur, undo: [...cur.undo.slice(-(MAX_ENTRIES - 1)), entry] }
    }
  }

  /** Raw push moving an entry across stacks during redo — does NOT clear undo. */
  pushRedoRaw(tabId: string, entry: HistoryEntry): void {
    const cur = this.stacks[tabId] ?? { undo: [], redo: [] }
    this.stacks = {
      ...this.stacks,
      [tabId]: { ...cur, redo: [...cur.redo.slice(-(MAX_ENTRIES - 1)), entry] }
    }
  }

  /** Drop both stacks for a tab (tab closed). */
  drop(tabId: string): void {
    if (!this.stacks[tabId]) return
    const next = { ...this.stacks }
    delete next[tabId]
    this.stacks = next
  }

  /** Show a transient notice for a tab; auto-cleared after NOTICE_TTL_MS. */
  setNotice(tabId: string, message: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.notice = { tabId, message, at: Date.now() }
    // State cleanup, not a visual transition (the entrance is CSS) — a stale
    // notice must not linger in the toolbar's aria-live region.
    this.noticeTimer = setTimeout(() => {
      this.notice = null
      this.noticeTimer = null
    }, NOTICE_TTL_MS)
  }

  noticeFor(tabId: string): { message: string; at: number } | null {
    return this.notice?.tabId === tabId ? this.notice : null
  }

  /** Ask the table view to scroll a row into view (and flash a cell). */
  requestReveal(tabId: string, path: string, column: string | null): void {
    this.reveal = { tabId, path, column, token: ++this.revealToken }
  }

  clearReveal(): void {
    this.reveal = null
  }
}

/** Singleton table history instance. */
export const tableHistory = new TableHistoryStore()
