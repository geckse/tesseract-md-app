/**
 * Menu state snapshot (phase 43).
 *
 * Everything the menu template needs, read synchronously from the
 * electron-store — no renderer round-trips. Kept separate from the
 * template so buildTemplate stays a pure, unit-testable function.
 */

import path from 'node:path'
import { app } from 'electron'
import { initStore, getCollections, getActiveCollection, getWatcherEnabled } from './store'
import type { RecentEntry } from './store'

/** A recent file entry joined with its collection, ready for display. */
export interface MenuRecentEntry {
  collectionId: string
  filePath: string
  fileName: string
  collectionName: string
}

/** All dynamic state the menu template renders from. */
export interface MenuState {
  platform: NodeJS.Platform
  isDev: boolean
  appName: string
  collections: { id: string; name: string }[]
  activeCollectionId: string | null
  activeCollectionName: string | null
  /** Persisted watcher intent for the active collection. */
  watcherEnabled: boolean
  recents: MenuRecentEntry[]
}

/** Max entries in the Open Recent submenu. */
export const MAX_RECENT_MENU_ITEMS = 15

/** Snapshot the current menu state from the electron-store. */
export function getMenuState(): MenuState {
  const store = initStore()
  const collections = getCollections()
  const active = getActiveCollection()

  const collectionMap = new Map(collections.map((c) => [c.id, c]))
  const recents: MenuRecentEntry[] = []
  const rawRecents: RecentEntry[] = store.get('recentFiles', [])
  for (const recent of rawRecents) {
    if (recents.length >= MAX_RECENT_MENU_ITEMS) break
    const collection = collectionMap.get(recent.collectionId)
    if (!collection) continue
    recents.push({
      collectionId: recent.collectionId,
      filePath: recent.filePath,
      fileName: path.basename(recent.filePath),
      collectionName: collection.name
    })
  }

  return {
    platform: process.platform,
    isDev: !app.isPackaged,
    appName: app.name,
    collections: collections.map((c) => ({ id: c.id, name: c.name })),
    activeCollectionId: active?.id ?? null,
    activeCollectionName: active?.name ?? null,
    watcherEnabled: active ? getWatcherEnabled(active.id) : false,
    recents
  }
}
