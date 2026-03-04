import { writable } from 'svelte/store'

/** Whether the sidebar is collapsed. */
export const sidebarCollapsed = writable<boolean>(
  localStorage.getItem('mdvdb-sidebar-collapsed') === 'true'
)

/** Toggle the sidebar collapsed state. */
export function toggleSidebar(): void {
  sidebarCollapsed.update((collapsed) => {
    const next = !collapsed
    localStorage.setItem('mdvdb-sidebar-collapsed', String(next))
    return next
  })
}
