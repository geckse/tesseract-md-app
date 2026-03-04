import { writable } from 'svelte/store'

/** Path of the file that has a conflict (changed on disk while being edited). */
export const conflictFilePath = writable<string | null>(null)

/** Show the conflict notification for the specified file path. */
export function showConflict(filePath: string): void {
  conflictFilePath.set(filePath)
}

/** Dismiss the conflict notification. */
export function dismissConflict(): void {
  conflictFilePath.set(null)
}
