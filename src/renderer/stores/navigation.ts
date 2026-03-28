import { writable, derived } from 'svelte/store'
import { workspace } from './workspace.svelte'

/** Maximum number of entries to keep in the history stack. */
const MAX_HISTORY = 100

// ─── Workspace-derived navigation stores ──────────────────────────────
//
// These stores derive their values from the workspace's focused pane's
// active document tab's navigation history. They use a notification
// trigger (_navigationSync) rather than Svelte 5 rune reactivity so
// they work in plain .ts.
//
// Call syncNavigationStoresFromTab() after any workspace mutation that
// changes the active tab (switchTab, closeTab, tab bar click, etc.).

/**
 * Internal notification trigger. Derived stores re-evaluate when this
 * writable is bumped, pulling fresh values from workspace state.
 */
const _navigationSync = writable(0)

/**
 * Notify backward-compat derived stores that the workspace focus has changed.
 * Call this after any workspace mutation that changes the active tab.
 */
export function syncNavigationStoresFromTab(): void {
  _navigationSync.update((n) => n + 1)
}

/** Whether navigation can go back — derived from focused tab's back stack. */
export const canGoBack = derived(_navigationSync, () => {
  const nav = workspace.focusedDocumentTab?.navigation
  return nav ? nav.backStack.length > 0 : false
})

/** Whether navigation can go forward — derived from focused tab's forward stack. */
export const canGoForward = derived(_navigationSync, () => {
  const nav = workspace.focusedDocumentTab?.navigation
  return nav ? nav.forwardStack.length > 0 : false
})

/** Flag to suppress recording when navigating via back/forward. */
let navigating = false

/**
 * Record a file navigation. Called whenever a file is selected
 * through normal means (sidebar click, search result, etc.).
 * Clears the forward stack. Operates on the focused tab's history.
 */
export function recordNavigation(path: string | null): void {
  if (navigating) return

  const tab = workspace.focusedDocumentTab
  if (!tab) return

  const nav = tab.navigation
  if (path === nav.current) return
  if (!path) {
    // Deselecting a file — don't push null onto the stack
    nav.current = null
    _navigationSync.update((n) => n + 1)
    return
  }

  if (nav.current) {
    nav.backStack.push(nav.current)
    if (nav.backStack.length > MAX_HISTORY) {
      nav.backStack = nav.backStack.slice(-MAX_HISTORY)
    }
  }

  nav.current = path
  nav.forwardStack = []
  _navigationSync.update((n) => n + 1)
}

/**
 * Navigate back. Returns the file path to navigate to, or null if can't go back.
 * Operates on the focused tab's history.
 */
export function goBack(): string | null {
  const tab = workspace.focusedDocumentTab
  if (!tab) return null

  const nav = tab.navigation
  if (nav.backStack.length === 0) return null

  if (nav.current) {
    nav.forwardStack.push(nav.current)
  }

  nav.current = nav.backStack.pop()!
  _navigationSync.update((n) => n + 1)
  return nav.current
}

/**
 * Navigate forward. Returns the file path to navigate to, or null if can't go forward.
 * Operates on the focused tab's history.
 */
export function goForward(): string | null {
  const tab = workspace.focusedDocumentTab
  if (!tab) return null

  const nav = tab.navigation
  if (nav.forwardStack.length === 0) return null

  if (nav.current) {
    nav.backStack.push(nav.current)
  }

  nav.current = nav.forwardStack.pop()!
  _navigationSync.update((n) => n + 1)
  return nav.current
}

/**
 * Set the navigating flag. Use this to wrap workspace.openTab() calls
 * triggered by back/forward so they don't get recorded in navigation history.
 */
export function setNavigating(value: boolean): void {
  navigating = value
}

/**
 * Clear all navigation history for the focused tab.
 * Called when switching collections.
 */
export function clearNavigation(): void {
  const tab = workspace.focusedDocumentTab
  if (tab) {
    tab.navigation.backStack = []
    tab.navigation.forwardStack = []
    tab.navigation.current = null
  }
  _navigationSync.update((n) => n + 1)
}
