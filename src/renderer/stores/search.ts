import { writable, get } from 'svelte/store'
import type { SearchOutput, SearchMode } from '../types/cli'
import { activeCollection } from './collections'

/** Whether the search panel is open. */
export const searchOpen = writable<boolean>(false)

/** Current search query text. */
export const searchQuery = writable<string>('')

/** Search results from the last successful query. */
export const searchResults = writable<SearchOutput | null>(null)

/** Whether a search is currently in progress. */
export const searchLoading = writable<boolean>(false)

/** Current search mode (hybrid, semantic, lexical). */
export const searchMode = writable<SearchMode>('hybrid')

/** Index of the currently highlighted result. */
export const highlightedIndex = writable<number>(-1)

/** Error message if search failed. */
export const searchError = writable<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let searchGeneration = 0

/** Restore persisted search mode for a collection. */
export function restoreSearchMode(collectionId: string): void {
  try {
    const stored = localStorage.getItem(`mdvdb-search-mode-${collectionId}`)
    if (stored === 'hybrid' || stored === 'semantic' || stored === 'lexical') {
      searchMode.set(stored)
    }
  } catch {
    // localStorage unavailable
  }
}

/** Set search mode and persist per collection. */
export function setSearchMode(mode: SearchMode): void {
  searchMode.set(mode)
  const collection = get(activeCollection)
  if (collection) {
    try {
      localStorage.setItem(`mdvdb-search-mode-${collection.id}`, mode)
    } catch {
      // localStorage unavailable
    }
  }
}

/** Execute search with debouncing (300ms delay, 2-char minimum). */
export function executeSearch(query: string): void {
  searchQuery.set(query)
  highlightedIndex.set(-1)

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  if (query.length < 2) {
    searchResults.set(null)
    searchLoading.set(false)
    searchError.set(null)
    return
  }

  searchLoading.set(true)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    performSearch(query)
  }, 300)
}

async function performSearch(query: string): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) {
    searchLoading.set(false)
    return
  }

  const generation = ++searchGeneration

  try {
    const mode = get(searchMode)
    const result = await window.api.search(collection.path, query, { mode })

    // Ignore stale results
    if (generation !== searchGeneration) return

    searchResults.set(result)
    searchError.set(null)
  } catch (err) {
    if (generation !== searchGeneration) return
    searchError.set(err instanceof Error ? err.message : String(err))
    searchResults.set(null)
  } finally {
    if (generation === searchGeneration) {
      searchLoading.set(false)
    }
  }
}

/** Clear search state and close panel. */
export function clearSearch(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  searchGeneration++
  searchQuery.set('')
  searchResults.set(null)
  searchLoading.set(false)
  searchError.set(null)
  highlightedIndex.set(-1)
  searchOpen.set(false)
}
