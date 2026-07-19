/**
 * Menu state snapshot (phase 43).
 *
 * Everything the menu template needs: persisted application state read
 * synchronously from electron-store plus transient graph-view state reported
 * by the renderer. Kept separate so buildTemplate stays pure and unit-testable.
 */

import path from 'node:path'
import { app } from 'electron'
import { initStore, getCollections, getActiveCollection, getWatcherEnabled } from './store'
import type { RecentEntry } from './store'
import type { GraphMenuContext } from '../preload/api'

/** A recent file entry joined with its collection, ready for display. */
export interface MenuRecentEntry {
  collectionId: string
  filePath: string
  fileName: string
  collectionName: string
}

/** Safe initial state before a renderer reports the focused graph context. */
export const DEFAULT_GRAPH_MENU_CONTEXT: GraphMenuContext = {
  active: false,
  ready: false,
  labelsVisible: true,
  linesVisible: true,
  shapesVisible: true,
  shapesAvailable: false,
  unconnectedHighlighted: false,
  unconnectedCount: 0,
  hasSelection: false,
  presentationState: 'idle',
  exportingScreenshot: false,
  level: 'document',
  coloringMode: 'cluster',
  topicsAvailable: false
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
  /** Transient state reported by the focused graph view. */
  graph: GraphMenuContext
}

/** Max entries in the Open Recent submenu. */
export const MAX_RECENT_MENU_ITEMS = 15

/** Snapshot persisted menu state and combine it with the supplied graph context. */
export function getMenuState(
  graphContext: GraphMenuContext = DEFAULT_GRAPH_MENU_CONTEXT
): MenuState {
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
    recents,
    graph: { ...graphContext }
  }
}
