import { writable } from 'svelte/store'
import { encodingForModel } from 'js-tiktoken'

const encoder = encodingForModel('gpt-4o')

/** Whether the editor content has unsaved changes. */
export const isDirty = writable<boolean>(false)

/** Current word count of the editor content. */
export const wordCount = writable<number>(0)

/** Token count of the editor content (tiktoken cl100k_base). */
export const tokenCount = writable<number>(0)

/** Count tokens in a text string using tiktoken. */
export function countTokens(text: string): number {
  if (text.trim().length === 0) return 0
  return encoder.encode(text).length
}

/** Target line number to scroll to in the editor, or null when idle. */
export const scrollToLine = writable<number | null>(null)

/** Currently active heading index in the outline (based on editor scroll position). */
export const activeHeadingIndex = writable<number>(-1)

/** Current editor mode: 'wysiwyg' (Tiptap) or 'editor' (CodeMirror). */
export type EditorMode = 'wysiwyg' | 'editor'

/** Current editor mode. Defaults to wysiwyg. */
export const editorMode = writable<EditorMode>('wysiwyg')

/** Toggle between editor modes: wysiwyg ↔ editor. */
export function toggleEditorMode(): void {
  editorMode.update((m) => (m === 'wysiwyg' ? 'editor' : 'wysiwyg'))
}

/** Set editor mode explicitly. */
export function setEditorMode(mode: EditorMode): void {
  editorMode.set(mode)
}

/** Monotonic counter — increment to request a save from the Editor. */
export const saveRequested = writable<number>(0)

/** Request the Editor to save the current file. */
export function requestSave(): void {
  saveRequested.update((n) => n + 1)
}

/** Reset all editor state to defaults. */
export function resetEditorState(): void {
  isDirty.set(false)
  wordCount.set(0)
  tokenCount.set(0)
  scrollToLine.set(null)
  activeHeadingIndex.set(-1)
  editorMode.set('wysiwyg')
}

/** Count words in a text string. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}
