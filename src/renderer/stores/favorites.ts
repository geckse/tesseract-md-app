import { writable, derived, get } from 'svelte/store'
import type { FavoriteEntry, RecentEntry } from '../../preload/api'
import { activeCollection, activeCollectionId } from './collections'
import { selectedFilePath } from './files'

/** All favorited files across all collections. */
export const favorites = writable<FavoriteEntry[]>([])

/** All recently opened files across all collections. */
export const recentFiles = writable<RecentEntry[]>([])

/** Whether favorites are currently loading. */
export const favoritesLoading = writable<boolean>(false)

/** Whether recents are currently loading. */
export const recentsLoading = writable<boolean>(false)

/** Derived store: check if current file is favorited. */
export const isFavorited = derived(
  [favorites, selectedFilePath, activeCollectionId],
  ([$favorites, $selectedFilePath, $activeCollectionId]) => {
    if (!$selectedFilePath || !$activeCollectionId) return false
    return $favorites.some(
      (f) => f.collectionId === $activeCollectionId && f.filePath === $selectedFilePath
    )
  }
)

/** Load favorites from the main process store. */
export async function loadFavorites(): Promise<void> {
  favoritesLoading.set(true)
  try {
    const list = await window.api.listFavorites()
    favorites.set(list)
  } finally {
    favoritesLoading.set(false)
  }
}

/** Load recents from the main process store. */
export async function loadRecents(): Promise<void> {
  recentsLoading.set(true)
  try {
    const list = await window.api.listRecents()
    recentFiles.set(list)
  } finally {
    recentsLoading.set(false)
  }
}

/** Toggle favorite state for the current file. */
export async function toggleFavorite(collectionId: string, filePath: string): Promise<void> {
  const current = get(favorites)
  const exists = current.some(
    (f) => f.collectionId === collectionId && f.filePath === filePath
  )

  if (exists) {
    await window.api.removeFavorite(collectionId, filePath)
  } else {
    await window.api.addFavorite(collectionId, filePath)
  }

  await loadFavorites()
}

/** Track a file as recently opened (main process updates native menu automatically). */
export async function trackRecent(collectionId: string, filePath: string): Promise<void> {
  await window.api.addRecent(collectionId, filePath)
}

/** Clear all recent files. */
export async function clearAllRecents(): Promise<void> {
  await window.api.clearRecents()
  await loadRecents()
}

/** Get favorites for a specific collection, sorted by most recently added. */
export const favoritesByCollection = derived(
  [favorites, activeCollectionId],
  ([$favorites, $activeCollectionId]) => {
    if (!$activeCollectionId) return []
    return $favorites
      .filter((f) => f.collectionId === $activeCollectionId)
      .sort((a, b) => b.addedAt - a.addedAt)
  }
)

/** Get recent files sorted by most recently opened. */
export const sortedRecents = derived(recentFiles, ($recentFiles) =>
  [...$recentFiles].sort((a, b) => b.openedAt - a.openedAt)
)
