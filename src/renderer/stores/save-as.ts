import { writable } from 'svelte/store'

/**
 * Holds the tab ID that needs a "Save As" dialog.
 * Set by editors when saving an untitled file; consumed by TabPane to show SaveAsModal.
 * Set to null to dismiss the dialog.
 */
export const saveAsTabId = writable<string | null>(null)

/** Request a "Save As" dialog for the given tab. */
export function requestSaveAs(tabId: string): void {
  saveAsTabId.set(tabId)
}

/** Dismiss the "Save As" dialog. */
export function dismissSaveAs(): void {
  saveAsTabId.set(null)
}
