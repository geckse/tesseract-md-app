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

/** Update channel preference */
export type UpdateChannel = 'stable' | 'beta'

/** Schema for the persistent store */
export interface AppStore {
  collections: Collection[]
  activeCollectionId: string | null
  windowBounds: { x: number; y: number; width: number; height: number }
  favorites: FavoriteEntry[]
  recentFiles: RecentEntry[]
  sidebarWidth: number
  metadataPanelWidth: number
  cliPath: string | null
  cliVersion: string | null
  onboardingComplete: boolean
  editorFontSize: number
  updateChannel: UpdateChannel
  lastUpdateCheck: number | null
  skipVersion: string | null
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
  },
  sidebarWidth: {
    type: 'number' as const,
    default: 280
  },
  metadataPanelWidth: {
    type: 'number' as const,
    default: 320
  },
  cliPath: {
    type: ['string', 'null'] as const,
    default: null
  },
  cliVersion: {
    type: ['string', 'null'] as const,
    default: null
  },
  onboardingComplete: {
    type: 'boolean' as const,
    default: false
  },
  editorFontSize: {
    type: 'number' as const,
    default: 17
  },
  updateChannel: {
    type: 'string' as const,
    default: 'stable' as UpdateChannel,
    enum: ['stable', 'beta']
  },
  lastUpdateCheck: {
    type: ['number', 'null'] as const,
    default: null
  },
  skipVersion: {
    type: ['string', 'null'] as const,
    default: null
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

/** Get whether onboarding has been completed */
export function getOnboardingComplete(): boolean {
  const s = initStore()
  return s.get('onboardingComplete', false)
}

/** Set onboarding completion status */
export function setOnboardingComplete(value: boolean): void {
  const s = initStore()
  s.set('onboardingComplete', value)
}

/** Get the editor font size */
export function getEditorFontSize(): number {
  const s = initStore()
  return s.get('editorFontSize', 17)
}

/** Set the editor font size */
export function setEditorFontSize(value: number): void {
  const s = initStore()
  s.set('editorFontSize', value)
}

/** Get CLI path and version info */
export function getCliInfo(): { path: string | null; version: string | null } {
  const s = initStore()
  return {
    path: s.get('cliPath', null),
    version: s.get('cliVersion', null)
  }
}

/** Set CLI path and version info */
export function setCliInfo(path: string | null, version: string | null): void {
  const s = initStore()
  s.set('cliPath', path)
  s.set('cliVersion', version)
}

/** Get the current update channel */
export function getUpdateChannel(): UpdateChannel {
  const s = initStore()
  return s.get('updateChannel', 'stable')
}

/** Set the update channel */
export function setUpdateChannel(channel: UpdateChannel): void {
  const s = initStore()
  s.set('updateChannel', channel)
}

/** Get the timestamp of the last update check, or null if never checked */
export function getLastUpdateCheck(): number | null {
  const s = initStore()
  return s.get('lastUpdateCheck', null)
}

/** Record the current time as the last update check */
export function setLastUpdateCheck(timestamp: number): void {
  const s = initStore()
  s.set('lastUpdateCheck', timestamp)
}

/** Get the version string the user chose to skip, or null */
export function getSkipVersion(): string | null {
  const s = initStore()
  return s.get('skipVersion', null)
}

/** Set a version to skip (user dismissed the update) */
export function setSkipVersion(version: string | null): void {
  const s = initStore()
  s.set('skipVersion', version)
}
