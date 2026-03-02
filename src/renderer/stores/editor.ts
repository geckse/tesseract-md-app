import { writable, derived } from 'svelte/store'

/** Whether the editor content has unsaved changes. */
export const isDirty = writable<boolean>(false)

/** Current word count of the editor content. */
export const wordCount = writable<number>(0)

/** Estimated reading time in minutes (assumes 250 words per minute). */
export const readingTime = derived(wordCount, ($wordCount) =>
  Math.ceil($wordCount / 250)
)

/** Count words in a text string. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}
