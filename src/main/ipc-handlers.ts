/**
 * IPC handler registration for all CLI bridge channels.
 *
 * Each handler maps an IPC channel to a CLI command via execCommand().
 * Called once from the main process on app ready.
 */

import { app, ipcMain, shell, clipboard, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { findCli, getCliVersion, execCommand, execRaw } from './cli'
import { detectCli, installCli, checkLatestVersion } from './cli-install'
import { readConfig, writeConfigKey, deleteConfigKey } from './config-io'
import {
  getOnboardingComplete,
  setOnboardingComplete,
  getEditorFontSize,
  setEditorFontSize,
  getZoomLevel,
  setZoomLevel,
  setCliInfo,
  getWindowSessions,
  setWindowSessions,
  getPrimaryColor,
  setPrimaryColor,
  getCollectionColor,
  setCollectionColor,
  getThemeMode,
  setThemeMode,
  getCollectionTheme,
  setCollectionTheme
} from './store'
import type { PersistedWindowState } from './store'
import type { TabTransferData } from '../preload/api'
import { WatcherManager, type WatcherState } from './watcher'
import { AppUpdater } from './updater'
import type { WindowManager } from './window-manager'
import {
  getCollections,
  addCollection,
  removeCollection,
  setActiveCollection,
  getActiveCollection
} from './store'
import type { Collection, FavoriteEntry } from './store'
import {
  pickCollectionFolder,
  validateCollectionPath,
  initCollection,
  confirmRemoveCollection,
  promptInitCollection
} from './collections'
import { refreshRecentMenu } from './menu'
import type {
  SearchOutput,
  IndexStatus,
  IngestResult,
  IngestPreview,
  FileTree,
  DocumentInfo,
  LinksOutput,
  BacklinksOutput,
  OrphansOutput,
  NeighborhoodResult,
  ClusterSummary,
  GraphData,
  Schema,
  Config,
  DoctorResult
} from '../renderer/types/cli'
import type { SerializedError } from './errors'
import {
  CliNotFoundError,
  CliExecutionError,
  CliParseError,
  CliTimeoutError
} from './errors'

/** Ingest timeout: 5 minutes */
const INGEST_TIMEOUT_MS = 300_000

/**
 * Serialize any error into an IPC-safe object.
 * IPC strips Error prototypes, so we convert to plain objects.
 */
function serializeError(error: unknown): SerializedError {
  if (
    error instanceof CliNotFoundError ||
    error instanceof CliExecutionError ||
    error instanceof CliParseError ||
    error instanceof CliTimeoutError
  ) {
    return error.serialize()
  }

  if (error instanceof Error) {
    return { error: true as const, type: 'CliExecutionError' as const, message: error.message }
  }

  return { error: true as const, type: 'CliExecutionError' as const, message: String(error) }
}

/**
 * Wrap an async handler so errors are serialized for IPC transport.
 */
function wrapHandler<T>(fn: () => Promise<T>): Promise<T | SerializedError> {
  return fn().catch((error: unknown) => {
    return serializeError(error)
  })
}

/** Singleton watcher manager instance */
let watcherManager: WatcherManager | null = null

/**
 * Get or create the WatcherManager singleton.
 */
function getWatcherManager(): WatcherManager {
  if (!watcherManager) {
    watcherManager = new WatcherManager()
  }
  return watcherManager
}

/** Singleton AppUpdater instance */
let appUpdater: AppUpdater | null = null

/**
 * Get or create the AppUpdater singleton.
 */
export function getAppUpdater(): AppUpdater {
  if (!appUpdater) {
    appUpdater = new AppUpdater()
  }
  return appUpdater
}

/**
 * Destroy the app updater (call on app quit).
 */
export function destroyAppUpdater(): void {
  if (appUpdater) {
    appUpdater.destroy()
    appUpdater = null
  }
}

/**
 * Destroy the watcher manager (call on app quit).
 */
export async function destroyWatcherManager(): Promise<void> {
  if (watcherManager) {
    await watcherManager.destroy()
    watcherManager = null
  }
}

/**
 * Run a callback with the watcher temporarily paused.
 * Stops the watcher if running, executes the callback, then restarts it.
 * If the watcher was not running, just executes the callback directly.
 */
async function withWatcherPaused<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const watcher = watcherManager
  const wasRunning = watcher?.isRunning() ?? false

  if (wasRunning && watcher) {
    await watcher.stop()
  }

  try {
    return await fn()
  } finally {
    if (wasRunning && watcher) {
      await watcher.start(root)
    }
  }
}

/**
 * Register all IPC handlers for CLI bridge channels.
 * Must be called once after app is ready.
 *
 * @param windowManager - The WindowManager for broadcasting events to all windows
 */
export function registerIpcHandlers(windowManager: WindowManager): void {
  // CLI detection
  ipcMain.handle('cli:find', () => wrapHandler(() => findCli()))

  ipcMain.handle('cli:version', () => wrapHandler(() => getCliVersion()))

  // Search
  ipcMain.handle(
    'cli:search',
    (_event, root: string, query: string, options?: { limit?: number; mode?: string; path?: string; filter?: string; expand?: number; hops?: number; boostLinks?: boolean }) => {
      const args: string[] = [query]
      if (options?.limit != null) args.push('--limit', String(options.limit))
      if (options?.mode) args.push('--mode', options.mode)
      if (options?.path) args.push('--path', options.path)
      if (options?.filter) args.push('--filter', options.filter)
      if (options?.boostLinks) {
        args.push('--boost-links')
        if (options?.hops != null) args.push('--hops', String(options.hops))
      }
      if (options?.expand != null && options.expand > 0) args.push('--expand', String(options.expand))
      return wrapHandler(() => execCommand<SearchOutput>('search', args, root))
    }
  )

  // Status
  ipcMain.handle('cli:status', (_event, root: string) =>
    wrapHandler(() => execCommand<IndexStatus>('status', [], root))
  )

  // Ingest
  ipcMain.handle(
    'cli:ingest',
    (_event, root: string, options?: { reindex?: boolean }) => {
      const args: string[] = []
      if (options?.reindex) args.push('--reindex')
      return wrapHandler(() =>
        withWatcherPaused(root, () =>
          execCommand<IngestResult>('ingest', args, root, { timeout: INGEST_TIMEOUT_MS })
        )
      )
    }
  )

  // Ingest preview
  ipcMain.handle('cli:ingest-preview', (_event, root: string) =>
    wrapHandler(() =>
      execCommand<IngestPreview>('ingest', ['--preview'], root)
    )
  )

  // File tree
  ipcMain.handle('cli:tree', (_event, root: string, path?: string) => {
    const args: string[] = []
    if (path) args.push('--path', path)
    return wrapHandler(() => execCommand<FileTree>('tree', args, root))
  })

  // Get document
  ipcMain.handle('cli:get', (_event, root: string, filePath: string) =>
    wrapHandler(() => execCommand<DocumentInfo>('get', [filePath], root))
  )

  // Links
  ipcMain.handle('cli:links', (_event, root: string, filePath: string) =>
    wrapHandler(() => execCommand<LinksOutput>('links', [filePath], root))
  )

  // Backlinks
  ipcMain.handle('cli:backlinks', (_event, root: string, filePath: string) =>
    wrapHandler(() => execCommand<BacklinksOutput>('backlinks', [filePath], root))
  )

  // Neighborhood (multi-hop link tree)
  ipcMain.handle('cli:neighborhood', (_event, root: string, filePath: string, depth: number) => {
    const d = Math.min(3, Math.max(1, depth))
    return wrapHandler(() => execCommand<NeighborhoodResult>('links', [filePath, '--depth', String(d)], root))
  })

  // Orphans
  ipcMain.handle('cli:orphans', (_event, root: string) =>
    wrapHandler(() => execCommand<OrphansOutput>('orphans', [], root))
  )

  // Clusters
  ipcMain.handle('cli:clusters', (_event, root: string) =>
    wrapHandler(() => execCommand<ClusterSummary[]>('clusters', [], root))
  )

  // Graph data
  ipcMain.handle('cli:graph', (_event, root: string, level?: string, path?: string) => {
    const args: string[] = []
    if (level) args.push('--level', level)
    if (path) args.push('--path', path)
    return wrapHandler(() => execCommand<GraphData>('graph', args, root))
  })

  // Schema
  ipcMain.handle('cli:schema', (_event, root: string, path?: string) => {
    const args: string[] = []
    if (path) args.push('--path', path)
    return wrapHandler(() => execCommand<Schema>('schema', args, root))
  })

  // Config
  ipcMain.handle('cli:config', (_event, root: string) =>
    wrapHandler(() => execCommand<Config>('config', [], root))
  )

  // Doctor
  ipcMain.handle('cli:doctor', (_event, root: string) =>
    wrapHandler(() => execCommand<DoctorResult>('doctor', [], root))
  )

  // Init
  ipcMain.handle('cli:init', (_event, root: string) =>
    wrapHandler(() => execRaw('init', [], root))
  )

  // Reset index (delete .markdownvdb/index and .markdownvdb/fts/ to recover from corruption)
  ipcMain.handle('cli:reset-index', (_event, root: string) =>
    wrapHandler(async () => {
      const path = await import('node:path')
      const indexFile = path.join(root, '.markdownvdb', 'index')
      const ftsDir = path.join(root, '.markdownvdb', 'fts')
      await fs.rm(indexFile, { force: true })
      await fs.rm(ftsDir, { recursive: true, force: true })
    })
  )

  // Collection management
  ipcMain.handle('collections:list', () =>
    wrapHandler(async () => getCollections())
  )

  ipcMain.handle('collections:add', () =>
    wrapHandler(async (): Promise<Collection | null> => {
      const path = await pickCollectionFolder()
      if (!path) return null

      const validation = await validateCollectionPath(path)
      if (!validation.valid) {
        throw new Error(validation.error ?? 'Invalid collection path')
      }

      if (!validation.hasConfig) {
        const shouldInit = await promptInitCollection(validation.name)
        if (!shouldInit) return null
        await initCollection(path)
      }

      return addCollection(path)
    })
  )

  ipcMain.handle('collections:remove', (_event, id: string) =>
    wrapHandler(async () => {
      const collections = getCollections()
      const collection = collections.find((c) => c.id === id)
      if (!collection) {
        throw new Error(`Collection not found: ${id}`)
      }

      const confirmed = await confirmRemoveCollection(collection.name)
      if (!confirmed) return

      removeCollection(id)

      // Clean up stale favorites and recents for this collection
      const s = await import('./store').then((m) => m.initStore())

      const favorites = s.get('favorites', [])
      s.set('favorites', favorites.filter((f) => f.collectionId !== id))

      const recents = s.get('recentFiles', [])
      s.set('recentFiles', recents.filter((r) => r.collectionId !== id))
      refreshRecentMenu()

      // Clean up accent color override for this collection
      const colors = s.get('collectionColors', {})
      if (id in colors) {
        delete colors[id]
        s.set('collectionColors', colors)
      }

      // Clean up theme override for this collection
      const themes = s.get('collectionThemes', {})
      if (id in themes) {
        delete themes[id]
        s.set('collectionThemes', themes)
      }
    })
  )

  ipcMain.handle('collections:set-active', (_event, id: string) =>
    wrapHandler(async () => {
      setActiveCollection(id)
    })
  )

  ipcMain.handle('collections:get-active', () =>
    wrapHandler(async () => getActiveCollection())
  )

  // Favorites management
  ipcMain.handle('favorites:list', () =>
    wrapHandler(async (): Promise<FavoriteEntry[]> => {
      const s = await import('./store').then((m) => m.initStore())
      return s.get('favorites', [])
    })
  )

  ipcMain.handle('favorites:add', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      const exists = favorites.some(
        (f) => f.collectionId === collectionId && f.filePath === filePath
      )
      if (!exists) {
        favorites.push({ collectionId, filePath, addedAt: Date.now() })
        s.set('favorites', favorites)
      }
    })
  )

  ipcMain.handle('favorites:remove', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      s.set(
        'favorites',
        favorites.filter((f) => !(f.collectionId === collectionId && f.filePath === filePath))
      )
    })
  )

  ipcMain.handle('favorites:is-favorite', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async (): Promise<boolean> => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      return favorites.some((f) => f.collectionId === collectionId && f.filePath === filePath)
    })
  )

  // Recents management
  ipcMain.handle('recents:list', () =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      return s.get('recentFiles', [])
    })
  )

  ipcMain.handle('recents:add', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      let recents = s.get('recentFiles', [])
      // Remove existing entry for same file (dedup)
      recents = recents.filter(
        (r) => !(r.collectionId === collectionId && r.filePath === filePath)
      )
      // Add to front (most recent first)
      recents.unshift({ collectionId, filePath, openedAt: Date.now() })
      // Cap at 50 entries
      recents = recents.slice(0, 50)
      s.set('recentFiles', recents)
      refreshRecentMenu()
    })
  )

  ipcMain.handle('recents:clear', () =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      s.set('recentFiles', [])
      refreshRecentMenu()
    })
  )

  // Reveal file in OS file manager (Finder on macOS, Explorer on Windows)
  ipcMain.handle('shell:show-item-in-folder', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      shell.showItemInFolder(normalizedPath)
    })
  )

  // Ingest a single file
  ipcMain.handle(
    'cli:ingest-file',
    (_event, root: string, filePath: string, options?: { reindex?: boolean }) => {
      const args: string[] = ['--file', filePath]
      if (options?.reindex) args.push('--reindex')
      return wrapHandler(() =>
        withWatcherPaused(root, () =>
          execCommand<IngestResult>('ingest', args, root, { timeout: INGEST_TIMEOUT_MS })
        )
      )
    }
  )

  // File reading (with security validation)
  ipcMain.handle('fs:read-file', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      return fs.readFile(normalizedPath, 'utf-8')
    })
  )

  // File writing (with security validation)
  ipcMain.handle('fs:write-file', (_event, absolutePath: string, content: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await fs.writeFile(normalizedPath, content, 'utf-8')
    })
  )

  // Create file (exclusive create — fails if exists)
  ipcMain.handle('fs:create-file', (_event, absolutePath: string, content: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Ensure parent directory exists
      await fs.mkdir(dirname(normalizedPath), { recursive: true })
      // Exclusive create: fails if file already exists
      await fs.writeFile(normalizedPath, content, { encoding: 'utf-8', flag: 'wx' })
    })
  )

  // Create directory
  ipcMain.handle('fs:create-directory', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await fs.mkdir(normalizedPath, { recursive: true })
    })
  )

  // Scan for non-markdown asset files in a collection
  ipcMain.handle('fs:scan-assets', (_event, collectionPath: string) =>
    wrapHandler(async () => {
      const { scanAssets } = await import('./asset-scanner')
      return scanAssets(collectionPath)
    })
  )

  // Read a file as base64 (for images, PDFs, etc.)
  ipcMain.handle('fs:read-binary', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Guard against overly large files (50MB)
      const stat = await fs.stat(normalizedPath)
      if (stat.size > 50 * 1024 * 1024) {
        throw new Error('File too large for binary IPC transfer (max 50MB)')
      }
      const buffer = await fs.readFile(normalizedPath)
      return buffer.toString('base64')
    })
  )

  // Write base64 data to a file (for clipboard-pasted images)
  ipcMain.handle('fs:write-binary', (_event, absolutePath: string, base64Data: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await fs.mkdir(dirname(normalizedPath), { recursive: true })
      const buffer = Buffer.from(base64Data, 'base64')
      await fs.writeFile(normalizedPath, buffer)
    })
  )

  // Get file metadata (size, mtime)
  ipcMain.handle('fs:file-info', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      const stat = await fs.stat(normalizedPath)
      return { size: stat.size, mtime: stat.mtime.toISOString() }
    })
  )

  // Copy a file into a collection (for external drag-and-drop import)
  ipcMain.handle('fs:copy-file', (_event, sourcePath: string, destPath: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedDest = resolve(destPath)
      const collections = getCollections()
      // Destination must be within a collection
      const isDestWithinCollection = collections.some(
        (c) => normalizedDest.startsWith(c.path + sep)
      )
      if (!isDestWithinCollection) {
        throw new Error('Access denied: destination is not within a known collection')
      }
      await fs.mkdir(dirname(normalizedDest), { recursive: true })
      await fs.copyFile(resolve(sourcePath), normalizedDest)
    })
  )

  // Check if a path is within any known collection
  ipcMain.handle('fs:is-within-collection', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const match = collections.find(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      return {
        within: !!match,
        collectionPath: match?.path ?? null,
      }
    })
  )

  // Rename/move a file within a collection
  ipcMain.handle('fs:rename-file', (_event, oldPath: string, newPath: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedOld = resolve(oldPath)
      const normalizedNew = resolve(newPath)
      const collections = getCollections()
      const oldCollection = collections.find(
        (c) => normalizedOld === c.path || normalizedOld.startsWith(c.path + sep)
      )
      if (!oldCollection) {
        throw new Error('Access denied: source path is not within a known collection')
      }
      const isNewWithinSame =
        normalizedNew === oldCollection.path || normalizedNew.startsWith(oldCollection.path + sep)
      if (!isNewWithinSame) {
        throw new Error('Access denied: destination must be within the same collection')
      }
      // Check target doesn't already exist
      try {
        await fs.access(normalizedNew)
        throw new Error('A file with that name already exists')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      // Ensure parent dir exists
      await fs.mkdir(dirname(normalizedNew), { recursive: true })
      await fs.rename(normalizedOld, normalizedNew)
    })
  )

  ipcMain.handle('fs:delete', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const collection = collections.find(
        (c) => normalizedPath.startsWith(c.path + sep)
      )
      if (!collection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Prevent deleting the collection root itself
      if (normalizedPath === collection.path) {
        throw new Error('Cannot delete the collection root directory')
      }
      await shell.trashItem(normalizedPath)
    })
  )

  // Window state persistence
  ipcMain.handle('store:set-sidebar-width', (_event, width: number) =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      store.set('sidebarWidth', width)
    })
  )

  ipcMain.handle('store:set-metadata-panel-width', (_event, width: number) =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      store.set('metadataPanelWidth', width)
    })
  )

  ipcMain.handle('store:get-sidebar-width', () =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      return store.get('sidebarWidth', 280)
    })
  )

  ipcMain.handle('store:get-metadata-panel-width', () =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      return store.get('metadataPanelWidth', 320)
    })
  )

  // Open file/folder in default app (e.g., open markdown in default editor)
  ipcMain.handle('shell:open-path', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await shell.openPath(normalizedPath)
    })
  )

  // Copy text to clipboard
  ipcMain.handle('clipboard:write-text', (_event, text: string) =>
    wrapHandler(async () => {
      clipboard.writeText(text)
    })
  )

  // CLI detection and installation
  ipcMain.handle('cli:detect', () =>
    wrapHandler(async () => {
      const result = await detectCli()
      if (result.found && result.path) {
        setCliInfo(result.path, result.version ?? null)
      }
      return result
    })
  )

  ipcMain.handle('cli:install', (event) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        throw new Error('No window available for install progress')
      }
      const result = await installCli(win)
      if (result.success) {
        setCliInfo(result.path, result.version ?? null)
      }
      return result
    })
  )

  ipcMain.handle('cli:check-update', () =>
    wrapHandler(() => checkLatestVersion())
  )

  // User-level config (~/.mdvdb/config)
  ipcMain.handle('settings:get-user-config', () =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')
      const configPath = join(homedir(), '.mdvdb', 'config')
      return readConfig(configPath)
    })
  )

  ipcMain.handle('settings:set-user-config', (_event, key: string, value: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')
      const configPath = join(homedir(), '.mdvdb', 'config')
      await writeConfigKey(configPath, key, value)
    })
  )

  ipcMain.handle('settings:delete-user-config', (_event, key: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')
      const configPath = join(homedir(), '.mdvdb', 'config')
      await deleteConfigKey(configPath, key)
    })
  )

  // Collection-level config (.markdownvdb/.config)
  ipcMain.handle('settings:get-collection-config', (_event, root: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const configPath = join(root, '.markdownvdb', '.config')
      return readConfig(configPath)
    })
  )

  ipcMain.handle('settings:set-collection-config', (_event, root: string, key: string, value: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const configPath = join(root, '.markdownvdb', '.config')
      await writeConfigKey(configPath, key, value)
    })
  )

  ipcMain.handle('settings:delete-collection-config', (_event, root: string, key: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const configPath = join(root, '.markdownvdb', '.config')
      await deleteConfigKey(configPath, key)
    })
  )

  // Onboarding and editor font size store
  ipcMain.handle('store:get-onboarding-complete', () =>
    wrapHandler(async () => getOnboardingComplete())
  )

  ipcMain.handle('store:set-onboarding-complete', (_event, value: boolean) =>
    wrapHandler(async () => {
      setOnboardingComplete(value)
    })
  )

  ipcMain.handle('store:get-editor-font-size', () =>
    wrapHandler(async () => getEditorFontSize())
  )

  ipcMain.handle('store:set-editor-font-size', (_event, value: number) =>
    wrapHandler(async () => {
      setEditorFontSize(value)
    })
  )

  ipcMain.handle('store:get-zoom-level', () =>
    wrapHandler(async () => getZoomLevel())
  )

  ipcMain.handle('store:set-zoom-level', (event, value: number) =>
    wrapHandler(async () => {
      setZoomLevel(value)
      // Apply zoom to the requesting window immediately
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.setZoomFactor(value)
      }
    })
  )

  // Accent color
  ipcMain.handle('store:get-primary-color', () =>
    wrapHandler(async () => getPrimaryColor())
  )

  ipcMain.handle('store:set-primary-color', (_event, hex: string | null) =>
    wrapHandler(async () => {
      setPrimaryColor(hex)
    })
  )

  ipcMain.handle('store:get-collection-color', (_event, collectionId: string) =>
    wrapHandler(async () => getCollectionColor(collectionId))
  )

  ipcMain.handle('store:set-collection-color', (_event, collectionId: string, hex: string | null) =>
    wrapHandler(async () => {
      setCollectionColor(collectionId, hex)
    })
  )

  // Theme
  ipcMain.handle('store:get-theme', () =>
    wrapHandler(async () => getThemeMode())
  )

  ipcMain.handle('store:set-theme', (_event, mode: string) =>
    wrapHandler(async () => {
      setThemeMode(mode)
    })
  )

  ipcMain.handle('store:get-collection-theme', (_event, collectionId: string) =>
    wrapHandler(async () => getCollectionTheme(collectionId))
  )

  ipcMain.handle('store:set-collection-theme', (_event, collectionId: string, mode: string | null) =>
    wrapHandler(async () => {
      setCollectionTheme(collectionId, mode)
    })
  )

  // Synchronous theme read for flash prevention (preload calls this before DOM paints)
  ipcMain.on('store:get-theme-sync', (event) => {
    event.returnValue = getThemeMode()
  })

  // Watcher management
  ipcMain.handle('watcher:start', (_event, root: string) =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()

      // Forward watcher events to all windows via broadcastToAll
      watcher.removeAllListeners()

      watcher.onEvent((watchEvent) => {
        windowManager.broadcastToAll('watcher:event', { type: 'watch-event', data: watchEvent })
      })

      watcher.onError((error) => {
        windowManager.broadcastToAll('watcher:event', { type: 'error', data: { message: error.message } })
      })

      watcher.onStateChange((state: WatcherState) => {
        windowManager.broadcastToAll('watcher:event', { type: 'state-change', data: state })
      })

      await watcher.start(root)
    })
  )

  ipcMain.handle('watcher:stop', () =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()
      await watcher.stop()
    })
  )

  ipcMain.handle('watcher:status', () =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()
      return {
        state: watcher.getState(),
        running: watcher.isRunning()
      }
    })
  )

  // Updater management
  const updater = getAppUpdater()

  // Wire event forwarding from AppUpdater to all windows
  updater.setWindowManager(windowManager)

  ipcMain.handle('updater:check', () =>
    wrapHandler(async () => {
      await updater.checkForUpdates()
    })
  )

  ipcMain.handle('updater:download', () =>
    wrapHandler(async () => {
      await updater.downloadUpdate()
    })
  )

  ipcMain.handle('updater:install', () =>
    wrapHandler(async () => {
      updater.quitAndInstall()
    })
  )

  ipcMain.handle('updater:status', () =>
    wrapHandler(async () => {
      return { state: updater.getState() }
    })
  )

  ipcMain.handle('updater:skip-version', (_event, version: string) =>
    wrapHandler(async () => {
      updater.skipVersion(version)
    })
  )

  ipcMain.handle('updater:app-version', () =>
    wrapHandler(async () => app.getVersion())
  )

  // Window session persistence
  ipcMain.handle('session:save', (_event, session: PersistedWindowState) =>
    wrapHandler(async () => {
      // For single-window mode, store as a single-element array
      setWindowSessions([session])
    })
  )

  ipcMain.handle('session:get', () =>
    wrapHandler(async (): Promise<PersistedWindowState | null> => {
      const sessions = getWindowSessions()
      return sessions.length > 0 ? sessions[0] : null
    })
  )

  // Multi-window management
  ipcMain.handle('window:new', () =>
    wrapHandler(async () => {
      windowManager.createWindow()
    })
  )

  // Cross-window tab transfer
  //
  // tab:detach: Serialized tab data from the source window.
  // Spawns a new BrowserWindow and sends the tab data to it
  // once the renderer has finished loading (did-finish-load).
  ipcMain.handle('tab:detach', (_event, tabData: TabTransferData) =>
    wrapHandler(async () => {
      const newWin = windowManager.createWindow()
      newWin.webContents.once('did-finish-load', () => {
        if (!newWin.isDestroyed()) {
          newWin.webContents.send('tab:attach', tabData)
        }
      })
    })
  )

  // tab:attach: Relay tab data to a specific target window.
  // Used for cross-window drag-drop where the target window
  // is already identified. The main process forwards the data
  // as a push event so the renderer can add it to the workspace.
  ipcMain.handle('tab:attach', (event, tabData: TabTransferData) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab:attach', tabData)
      }
    })
  )
}
