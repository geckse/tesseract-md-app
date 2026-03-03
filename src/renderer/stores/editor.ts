import { writable, derived } from 'svelte/store'

/** Whether the editor content has unsaved changes. */
export const isDirty = writable<boolean>(false)

/** Current word count of the editor content. */
export const wordCount = writable<number>(0)

/** Estimated reading time in minutes (assumes 250 words per minute). */
export const readingTime = derived(wordCount, ($wordCount) =>
  Math.ceil($wordCount / 250)
)

/** Target line number to scroll to in the editor, or null when idle. */
export const scrollToLine = writable<number | null>(null)

/** Monotonic counter — increment to request a save from the Editor. */
export const saveRequested = writable<number>(0)

/** Request the Editor to save the current file. */
export function requestSave(): void {
  saveRequested.update((n) => n + 1)
}

/** Count words in a text string. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}
