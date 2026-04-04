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

/** A persisted tab — only file paths and layout, never file content. */
export interface PersistedTab {
  kind: 'document' | 'graph'
  filePath?: string // Only for document tabs
  graphLevel?: string // Only for graph tabs: 'document' | 'chunk'
}

/** A persisted pane within a window session. */
export interface PersistedPane {
  tabs: PersistedTab[]
  activeTabIndex: number
}

/** Persisted window state — restored on app restart. */
export interface PersistedWindowState {
  panes: PersistedPane[]
  splitEnabled: boolean
  splitRatio: number // 0-1 fraction for left pane width
}

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
  zoomLevel: number
  updateChannel: UpdateChannel
  lastUpdateCheck: number | null
  skipVersion: string | null
  windowSessions: PersistedWindowState[]
  primaryColor: string | null
  collectionColors: Record<string, string>
  themeMode: string
  collectionThemes: Record<string, string>
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
  zoomLevel: {
    type: 'number' as const,
    default: 1.0
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
  },
  windowSessions: {
    type: 'array' as const,
    default: [] as PersistedWindowState[],
    items: {
      type: 'object' as const,
      properties: {
        panes: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              tabs: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  properties: {
                    kind: {
                      type: 'string' as const,
                      enum: ['document', 'graph']
                    },
                    filePath: { type: 'string' as const },
                    graphLevel: { type: 'string' as const }
                  },
                  required: ['kind'] as const
                }
              },
              activeTabIndex: { type: 'number' as const }
            },
            required: ['tabs', 'activeTabIndex'] as const
          }
        },
        splitEnabled: { type: 'boolean' as const },
        splitRatio: { type: 'number' as const }
      },
      required: ['panes', 'splitEnabled', 'splitRatio'] as const
    }
  },
  primaryColor: {
    type: ['string', 'null'] as const,
    default: null
  },
  collectionColors: {
    type: 'object' as const,
    default: {} as Record<string, string>
  },
  themeMode: {
    type: 'string' as const,
    default: 'dark',
    enum: ['light', 'dark', 'auto']
  },
  collectionThemes: {
    type: 'object' as const,
    default: {} as Record<string, string>
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

/** Get the UI zoom level */
export function getZoomLevel(): number {
  const s = initStore()
  return s.get('zoomLevel', 1.0)
}

/** Set the UI zoom level */
export function setZoomLevel(value: number): void {
  const s = initStore()
  s.set('zoomLevel', value)
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

/** Get all persisted window sessions */
export function getWindowSessions(): PersistedWindowState[] {
  const s = initStore()
  return s.get('windowSessions', [])
}

/** Save window sessions (replaces all stored sessions) */
export function setWindowSessions(sessions: PersistedWindowState[]): void {
  const s = initStore()
  s.set('windowSessions', sessions)
}

/** Get the global primary accent color, or null for default */
export function getPrimaryColor(): string | null {
  const s = initStore()
  return s.get('primaryColor', null)
}

/** Set the global primary accent color (null resets to default) */
export function setPrimaryColor(hex: string | null): void {
  const s = initStore()
  s.set('primaryColor', hex)
}

/** Get a per-collection accent color override, or null if none */
export function getCollectionColor(collectionId: string): string | null {
  const s = initStore()
  const colors = s.get('collectionColors', {})
  return colors[collectionId] ?? null
}

/** Set a per-collection accent color override (null removes the override) */
export function setCollectionColor(collectionId: string, hex: string | null): void {
  const s = initStore()
  const colors = s.get('collectionColors', {})
  if (hex === null) {
    delete colors[collectionId]
  } else {
    colors[collectionId] = hex
  }
  s.set('collectionColors', colors)
}

/** Get all collection color overrides */
export function getCollectionColors(): Record<string, string> {
  const s = initStore()
  return s.get('collectionColors', {})
}

/** Get the global theme mode */
export function getThemeMode(): string {
  const s = initStore()
  return s.get('themeMode', 'dark')
}

/** Set the global theme mode */
export function setThemeMode(mode: string): void {
  const s = initStore()
  s.set('themeMode', mode)
}

/** Get a per-collection theme override, or null if none */
export function getCollectionTheme(collectionId: string): string | null {
  const s = initStore()
  const themes = s.get('collectionThemes', {})
  return themes[collectionId] ?? null
}

/** Set a per-collection theme override (null removes the override) */
export function setCollectionTheme(collectionId: string, mode: string | null): void {
  const s = initStore()
  const themes = s.get('collectionThemes', {})
  if (mode === null) {
    delete themes[collectionId]
  } else {
    themes[collectionId] = mode
  }
  s.set('collectionThemes', themes)
}
