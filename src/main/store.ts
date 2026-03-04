/**
 * Persistent application store using electron-store.
 *
 * Manages collections (markdown project folders) and window state.
 * All store operations are synchronous and run in the main process only.
 */

import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

/** A markdown project folder tracked by the app */
export interface Collection {
  id: string
  name: string
  path: string
  addedAt: number
  lastOpenedAt: number
}

/** A favorited file entry */
export interface FavoriteEntry {
  collectionId: string // Which collection this file belongs to
  filePath: string // Relative path within the collection
  addedAt: number // Unix timestamp
}

/** A recently opened file entry */
export interface RecentEntry {
  collectionId: string
  filePath: string
  openedAt: number // Unix timestamp, updated on each open
}

/** Schema for the persistent store */
export interface AppStore {
  collections: Collection[]
  activeCollectionId: string | null
  windowBounds: { x: number; y: number; width: number; height: number }
  favorites: FavoriteEntry[]
  recentFiles: RecentEntry[]
}

/** electron-store schema definition for validation */
const schema = {
  collections: {
    type: 'array' as const,
    default: [] as Collection[],
    items: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
        path: { type: 'string' as const },
        addedAt: { type: 'number' as const },
        lastOpenedAt: { type: 'number' as const }
      },
      required: ['id', 'name', 'path', 'addedAt', 'lastOpenedAt'] as const
    }
  },
  activeCollectionId: {
    type: ['string', 'null'] as const,
    default: null
  },
  windowBounds: {
    type: 'object' as const,
    default: { x: 0, y: 0, width: 1200, height: 800 },
    properties: {
      x: { type: 'number' as const },
      y: { type: 'number' as const },
      width: { type: 'number' as const },
      height: { type: 'number' as const }
    }
  },
  favorites: {
    type: 'array' as const,
    default: [] as FavoriteEntry[],
    items: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string' as const },
        filePath: { type: 'string' as const },
        addedAt: { type: 'number' as const }
      },
      required: ['collectionId', 'filePath', 'addedAt'] as const
    }
  },
  recentFiles: {
    type: 'array' as const,
    default: [] as RecentEntry[],
    items: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string' as const },
        filePath: { type: 'string' as const },
        openedAt: { type: 'number' as const }
      },
      required: ['collectionId', 'filePath', 'openedAt'] as const
    }
  }
}

let store: Store<AppStore> | null = null

/** Initialize and return the store singleton */
export function initStore(): Store<AppStore> {
  if (!store) {
    store = new Store<AppStore>({ schema })
  }
  return store
}

/** Get all collections */
export function getCollections(): Collection[] {
  const s = initStore()
  return s.get('collections', [])
}

/**
 * Add a new collection from an absolute folder path.
 * Rejects duplicate paths. Returns the newly created collection.
 */
export function addCollection(path: string): Collection {
  const s = initStore()
  const collections = s.get('collections', [])

  const duplicate = collections.find((c) => c.path === path)
  if (duplicate) {
    throw new Error(`Collection already exists for path: ${path}`)
  }

  const now = Date.now()
  const collection: Collection = {
    id: randomUUID(),
    name: basename(path),
    path,
    addedAt: now,
    lastOpenedAt: now
  }

  s.set('collections', [...collections, collection])
  return collection
}

/**
 * Remove a collection by ID. If it was the active collection,
 * clears the activeCollectionId.
 */
export function removeCollection(id: string): void {
  const s = initStore()
  const collections = s.get('collections', [])
  s.set(
    'collections',
    collections.filter((c) => c.id !== id)
  )

  if (s.get('activeCollectionId') === id) {
    s.set('activeCollectionId', null)
  }
}

/** Set the active collection by ID and update its lastOpenedAt timestamp */
export function setActiveCollection(id: string): void {
  const s = initStore()
  const collections = s.get('collections', [])
  const index = collections.findIndex((c) => c.id === id)
  if (index === -1) {
    throw new Error(`Collection not found: ${id}`)
  }

  collections[index] = { ...collections[index], lastOpenedAt: Date.now() }
  s.set('collections', collections)
  s.set('activeCollectionId', id)
}

/** Get the currently active collection, or null if none */
export function getActiveCollection(): Collection | null {
  const s = initStore()
  const activeId = s.get('activeCollectionId')
  if (!activeId) return null

  const collections = s.get('collections', [])
  return collections.find((c) => c.id === activeId) ?? null
}
