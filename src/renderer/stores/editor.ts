import { writable, derived } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { encodingForModel } from 'js-tiktoken'
import { workspace } from './workspace.svelte'

const encoder = encodingForModel('gpt-4o')

// ─── Types ──────────────────────────────────────────────────────────────

/** Current editor mode: 'wysiwyg' (Tiptap) or 'editor' (CodeMirror). */
export type EditorMode = 'wysiwyg' | 'editor'

// ─── Pure utility functions (unchanged) ─────────────────────────────────

/** Count tokens in a text string using tiktoken. */
export function countTokens(text: string): number {
  if (text.trim().length === 0) return 0
  return encoder.encode(text).length
}

/** Count words in a text string. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

// ─── Workspace-derived editor stores ────────────────────────────────────
//
// These stores derive their values from the workspace's focused pane's
// active document tab. They use a notification trigger (_editorSync)
// rather than Svelte 5 rune reactivity so they work in plain .ts.
//
// Call syncEditorStoresFromTab() after any workspace mutation that changes
// the active tab (switchTab, closeTab, tab bar click, etc.).

/**
 * Internal notification trigger. Derived stores re-evaluate when this
 * writable is bumped, pulling fresh values from workspace state.
 */
const _editorSync = writable(0)

/**
 * Notify backward-compat derived stores that the workspace focus has changed.
 * Call this after any workspace mutation that changes the active tab.
 */
export function syncEditorStoresFromTab(): void {
  _editorSync.update((n) => n + 1)
}

/**
 * Whether the editor content has unsaved changes — derived from focused tab.
 * Retains .set()/.update() for backward compat (editors call isDirty.set()).
 */
export const isDirty: Writable<boolean> = {
  subscribe: derived(_editorSync, () => {
    return workspace.focusedDocumentTab?.isDirty ?? false
  }).subscribe,
  set(value: boolean) {
    const tab = workspace.focusedDocumentTab
    if (tab) {
      tab.isDirty = value
    }
    _editorSync.update((n) => n + 1)
  },
  update(fn: (value: boolean) => boolean) {
    const tab = workspace.focusedDocumentTab
    const current = tab?.isDirty ?? false
    const newValue = fn(current)
    if (tab) {
      tab.isDirty = newValue
    }
    _editorSync.update((n) => n + 1)
  },
}

/**
 * Current word count of the editor content — derived from focused tab.
 * Retains .set()/.update() for backward compat (editors call wordCount.set()).
 */
export const wordCount: Writable<number> = {
  subscribe: derived(_editorSync, () => {
    return workspace.focusedDocumentTab?.wordCount ?? 0
  }).subscribe,
  set(value: number) {
    const tab = workspace.focusedDocumentTab
    if (tab) {
      tab.wordCount = value
    }
    _editorSync.update((n) => n + 1)
  },
  update(fn: (value: number) => number) {
    const tab = workspace.focusedDocumentTab
    const current = tab?.wordCount ?? 0
    const newValue = fn(current)
    if (tab) {
      tab.wordCount = newValue
    }
    _editorSync.update((n) => n + 1)
  },
}

/**
 * Token count of the editor content — derived from focused tab.
 * Retains .set()/.update() for backward compat (editors call tokenCount.set()).
 */
export const tokenCount: Writable<number> = {
  subscribe: derived(_editorSync, () => {
    return workspace.focusedDocumentTab?.tokenCount ?? 0
  }).subscribe,
  set(value: number) {
    const tab = workspace.focusedDocumentTab
    if (tab) {
      tab.tokenCount = value
    }
    _editorSync.update((n) => n + 1)
  },
  update(fn: (value: number) => number) {
    const tab = workspace.focusedDocumentTab
    const current = tab?.tokenCount ?? 0
    const newValue = fn(current)
    if (tab) {
      tab.tokenCount = newValue
    }
    _editorSync.update((n) => n + 1)
  },
}

/**
 * Current editor mode — derived from focused tab. Defaults to wysiwyg.
 * Retains .set()/.update() for backward compat (editors call editorMode.set()).
 */
export const editorMode: Writable<EditorMode> = {
  subscribe: derived(_editorSync, () => {
    return workspace.focusedDocumentTab?.editorMode ?? 'wysiwyg'
  }).subscribe,
  set(value: EditorMode) {
    const tab = workspace.focusedDocumentTab
    if (tab) {
      tab.editorMode = value
    }
    _editorSync.update((n) => n + 1)
  },
  update(fn: (value: EditorMode) => EditorMode) {
    const tab = workspace.focusedDocumentTab
    const current = tab?.editorMode ?? 'wysiwyg'
    const newValue = fn(current)
    if (tab) {
      tab.editorMode = newValue
    }
    _editorSync.update((n) => n + 1)
  },
}

// ─── Ephemeral stores (not per-tab — editor-instance signals) ───────────

/** Target line number to scroll to in the editor, or null when idle. */
export const scrollToLine = writable<number | null>(null)

/** Currently active heading index in the outline (based on editor scroll position). */
export const activeHeadingIndex = writable<number>(-1)

/** Monotonic counter — increment to request a save from the Editor. */
export const saveRequested = writable<number>(0)

// ─── Mutation functions ─────────────────────────────────────────────────

/** Toggle between editor modes: wysiwyg ↔ editor — targets focused tab. */
export function toggleEditorMode(): void {
  const tab = workspace.focusedDocumentTab
  if (tab) {
    tab.editorMode = tab.editorMode === 'wysiwyg' ? 'editor' : 'wysiwyg'
  }
  _editorSync.update((n) => n + 1)
}

/** Set editor mode explicitly — targets focused tab. */
export function setEditorMode(mode: EditorMode): void {
  const tab = workspace.focusedDocumentTab
  if (tab) {
    tab.editorMode = mode
  }
  _editorSync.update((n) => n + 1)
}

/** Request the Editor to save the current file. */
export function requestSave(): void {
  saveRequested.update((n) => n + 1)
}

/** Reset all editor state to defaults — resets focused tab's editor state. */
export function resetEditorState(): void {
  const tab = workspace.focusedDocumentTab
  if (tab) {
    tab.isDirty = false
    tab.wordCount = 0
    tab.tokenCount = 0
    tab.editorMode = 'wysiwyg'
  }
  scrollToLine.set(null)
  activeHeadingIndex.set(-1)
  _editorSync.update((n) => n + 1)
}
