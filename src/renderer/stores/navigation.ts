import { writable, get } from 'svelte/store'

/** Maximum number of entries to keep in the history stack. */
const MAX_HISTORY = 100

/** Whether navigation can go back. */
export const canGoBack = writable(false)

/** Whether navigation can go forward. */
export const canGoForward = writable(false)

/** Internal back stack (most recent at end). */
let backStack: string[] = []

/** Internal forward stack (most recent at end). */
let forwardStack: string[] = []

/** The current path (what the user is looking at). */
let current: string | null = null

/** Flag to suppress recording when navigating via back/forward. */
let navigating = false

function updateStores() {
  canGoBack.set(backStack.length > 0)
  canGoForward.set(forwardStack.length > 0)
}

/**
 * Record a file navigation. Called whenever a file is selected
 * through normal means (sidebar click, search result, etc.).
 * Clears the forward stack.
 */
export function recordNavigation(path: string | null): void {
  if (navigating) return
  if (path === current) return
  if (!path) {
    // Deselecting a file — don't push null onto the stack
    current = null
    return
  }

  if (current) {
    backStack.push(current)
    if (backStack.length > MAX_HISTORY) {
      backStack = backStack.slice(-MAX_HISTORY)
    }
  }

  current = path
  forwardStack = []
  updateStores()
}

/**
 * Navigate back. Returns the file path to navigate to, or null if can't go back.
 */
export function goBack(): string | null {
  if (backStack.length === 0) return null

  if (current) {
    forwardStack.push(current)
  }

  current = backStack.pop()!
  updateStores()
  return current
}

/**
 * Navigate forward. Returns the file path to navigate to, or null if can't go forward.
 */
export function goForward(): string | null {
  if (forwardStack.length === 0) return null

  if (current) {
    backStack.push(current)
  }

  current = forwardStack.pop()!
  updateStores()
  return current
}

/**
 * Set the navigating flag. Use this to wrap selectFile calls
 * triggered by back/forward so they don't get recorded.
 */
export function setNavigating(value: boolean): void {
  navigating = value
}

/**
 * Clear all navigation history. Called when switching collections.
 */
export function clearNavigation(): void {
  backStack = []
  forwardStack = []
  current = null
  updateStores()
}
