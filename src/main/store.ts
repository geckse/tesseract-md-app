/**
 * Persistent application store using electron-store.
 *
 * Manages collections (markdown project folders) and window state.
 * All store operations are synchronous and run in the main process only.
 */

import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SavedTableView } from '../preload/api'

export type { SavedTableView } from '../preload/api'

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
  kind: 'document' | 'graph' | 'asset' | 'terminal' | 'table'
  filePath?: string // Document/asset tabs; for table tabs, the folder path
  graphLevel?: string // Only for graph tabs: 'document' | 'chunk'
  mimeCategory?: string // Only for asset tabs
  /** For terminal tabs: the saved shell path + cwd used to respawn */
  terminalShell?: string
  terminalCwd?: string
  /** Optional user-set title for terminal tabs */
  terminalTitle?: string
  /** For table tabs: include nested subfolders. */
  recursive?: boolean
  /** For table tabs: the saved view id applied on open. */
  tableViewId?: string
}

/** A persisted pane within a window session. */
export interface PersistedPane {
  tabs: PersistedTab[]
  activeTabIndex: number
}

/** A terminal slot persisted in the bottom panel — shell + cwd only, no PTY state. */
export interface PersistedTerminalSlot {
  shell: string
  cwd: string
  title?: string
}

/** Persisted bottom panel state per window. */
export interface PersistedBottomPanel {
  open: boolean
  height: number
  slots: PersistedTerminalSlot[]
  activeIndex: number
}

/** Persisted window state — restored on app restart. */
export interface PersistedWindowState {
  panes: PersistedPane[]
  splitEnabled: boolean
  splitRatio: number // 0-1 fraction for left pane width
  bottomPanel?: PersistedBottomPanel
}

/** Schema for the persistent store */
export interface AppStore {
  collections: Collection[]
  activeCollectionId: string | null
  windowBounds: { x: number; y: number; width: number; height: number }
  favorites: FavoriteEntry[]
  recentFiles: RecentEntry[]
  /** Saved table views, keyed by collectionId then folder path. */
  tableViews: Record<string, Record<string, SavedTableView[]>>
  sidebarWidth: number
  metadataPanelWidth: number
  cliPath: string | null
  cliVersion: string | null
  onboardingComplete: boolean
  editorFontSize: number
  autoShowDiffOnConflict: boolean
  zoomLevel: number
  updateChannel: UpdateChannel
  lastUpdateCheck: number | null
  skipVersion: string | null
  windowSessions: PersistedWindowState[]
  primaryColor: string | null
  collectionColors: Record<string, string>
  watcherEnabled: Record<string, boolean>
  /** Obsidian topic sync provenance per collection (phase 44). */
  obsidianTopicSync: Record<string, ObsidianSyncState>
  themeMode: string
  collectionThemes: Record<string, string>
  terminalShellPath: string
  terminalShellArgs: string
  terminalFontSize: number
}

/** Schema of one persisted pane (tabs + active index) — shared by editor panes and the bottom pane. */
const persistedPaneSchema = {
  type: 'object' as const,
  properties: {
    tabs: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          kind: {
            type: 'string' as const,
            enum: ['document', 'graph', 'asset', 'terminal', 'table']
          },
          filePath: { type: 'string' as const },
          graphLevel: { type: 'string' as const },
          mimeCategory: { type: 'string' as const },
          terminalShell: { type: 'string' as const },
          terminalCwd: { type: 'string' as const },
          terminalTitle: { type: 'string' as const },
          recursive: { type: 'boolean' as const },
          tableViewId: { type: 'string' as const }
        },
        required: ['kind'] as const
      }
    },
    activeTabIndex: { type: 'number' as const }
  },
  required: ['tabs', 'activeTabIndex'] as const
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
  // Saved table views: Record<collectionId, Record<folderPath, SavedTableView[]>>.
  // Nested config shapes vary by view version; validated/migrated in code, so the
  // schema here is intentionally permissive (object of objects of arrays).
  tableViews: {
    type: 'object' as const,
    default: {} as Record<string, Record<string, SavedTableView[]>>
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
  autoShowDiffOnConflict: {
    type: 'boolean' as const,
    default: true
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
          items: persistedPaneSchema
        },
        splitEnabled: { type: 'boolean' as const },
        splitRatio: { type: 'number' as const },
        // The bottom pane hosts any tab kind — same shape as editor panes
        bottomPane: persistedPaneSchema,
        bottomPaneOpen: { type: 'boolean' as const },
        bottomPaneHeight: { type: 'number' as const },
        // Legacy terminal-only bottom panel — kept so old data validates on
        // read (migrated in the renderer); never written anymore.
        bottomPanel: {
          type: 'object' as const,
          properties: {
            open: { type: 'boolean' as const },
            height: { type: 'number' as const },
            activeIndex: { type: 'number' as const },
            slots: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  shell: { type: 'string' as const },
                  cwd: { type: 'string' as const },
                  title: { type: 'string' as const }
                },
                required: ['shell', 'cwd'] as const
              }
            }
          }
        }
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
  watcherEnabled: {
    type: 'object' as const,
    default: {} as Record<string, boolean>
  },
  obsidianTopicSync: {
    type: 'object' as const,
    default: {} as Record<string, ObsidianSyncState>
  },
  themeMode: {
    type: 'string' as const,
    default: 'dark',
    enum: ['light', 'dark', 'auto']
  },
  collectionThemes: {
    type: 'object' as const,
    default: {} as Record<string, string>
  },
  terminalShellPath: {
    type: 'string' as const,
    default: ''
  },
  terminalShellArgs: {
    type: 'string' as const,
    default: ''
  },
  terminalFontSize: {
    type: 'number' as const,
    default: 14
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

/** Whether the diff view auto-opens when a dirty file changes on disk */
export function getAutoShowDiff(): boolean {
  const s = initStore()
  return s.get('autoShowDiffOnConflict', true)
}

/** Set whether the diff view auto-opens on conflicts */
export function setAutoShowDiff(value: boolean): void {
  const s = initStore()
  s.set('autoShowDiffOnConflict', value)
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

/** Whether the mdvdb watcher was last left running for a collection. */
export function getWatcherEnabled(collectionId: string): boolean {
  const s = initStore()
  const flags = s.get('watcherEnabled', {})
  return flags[collectionId] ?? false
}

/** Remember whether the mdvdb watcher is enabled for a collection. */
export function setWatcherEnabled(collectionId: string, enabled: boolean): void {
  const s = initStore()
  const flags = s.get('watcherEnabled', {})
  if (enabled) {
    flags[collectionId] = true
  } else {
    delete flags[collectionId]
  }
  s.set('watcherEnabled', flags)
}

/**
 * Obsidian topic sync state for a collection (phase 44).
 * `managed: false` = the vault already had user topics at first scan — never
 * sync it. `topics` maps managed topic names to the name+seeds hash last
 * written, or the literal 'deleted' tombstone for user-deleted topics.
 */
export interface ObsidianSyncState {
  managed: boolean
  topics: Record<string, string>
}

/** Get the Obsidian topic sync state for a collection (null = never scanned). */
export function getObsidianSyncState(collectionId: string): ObsidianSyncState | null {
  const s = initStore()
  const states = s.get('obsidianTopicSync', {})
  return states[collectionId] ?? null
}

/** Persist (or clear, with null) the Obsidian topic sync state for a collection. */
export function setObsidianSyncState(collectionId: string, state: ObsidianSyncState | null): void {
  const s = initStore()
  const states = s.get('obsidianTopicSync', {})
  if (state) {
    states[collectionId] = state
  } else {
    delete states[collectionId]
  }
  s.set('obsidianTopicSync', states)
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

/** Get the user-configured shell path override (empty string = use default) */
export function getTerminalShellPath(): string {
  const s = initStore()
  return s.get('terminalShellPath', '')
}

/** Set the user-configured shell path override */
export function setTerminalShellPath(value: string): void {
  const s = initStore()
  s.set('terminalShellPath', value)
}

/** Get the user-configured shell arguments as a space-separated string */
export function getTerminalShellArgs(): string {
  const s = initStore()
  return s.get('terminalShellArgs', '')
}

/** Set the user-configured shell arguments string */
export function setTerminalShellArgs(value: string): void {
  const s = initStore()
  s.set('terminalShellArgs', value)
}

/** Get the terminal font size */
export function getTerminalFontSize(): number {
  const s = initStore()
  return s.get('terminalFontSize', 14)
}

/** Set the terminal font size */
export function setTerminalFontSize(value: number): void {
  const s = initStore()
  s.set('terminalFontSize', value)
}
