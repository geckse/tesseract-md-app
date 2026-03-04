import { writable } from 'svelte/store'

/** Whether the QuickOpen modal is currently open. */
export const quickOpenModalOpen = writable<boolean>(false)

/** Open the QuickOpen modal. */
export function openQuickOpen(): void {
  quickOpenModalOpen.set(true)
}

/** Close the QuickOpen modal. */
export function closeQuickOpen(): void {
  quickOpenModalOpen.set(false)
}
