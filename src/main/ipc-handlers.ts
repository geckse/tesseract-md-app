/**
 * IPC handler registration for all CLI bridge channels.
 *
 * Each handler maps an IPC channel to a CLI command via execCommand().
 * Called once from the main process on app ready.
 */

import { ipcMain, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { findCli, getCliVersion, execCommand, execRaw } from './cli'
import { WatcherManager, type WatcherState } from './watcher'
import {
  getCollections,
  addCollection,
  removeCollection,
  setActiveCollection,
  getActiveCollection
} from './store'
import type { Collection, FavoriteEntry, RecentEntry } from './store'
import {
  pickCollectionFolder,
  validateCollectionPath,
  initCollection,
  confirmRemoveCollection,
  promptInitCollection
} from './collections'
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
  ClusterSummary,
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
 * @param mainWindow - The main BrowserWindow for forwarding watcher events
 */
export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
  // CLI detection
  ipcMain.handle('cli:find', () => wrapHandler(() => findCli()))

  ipcMain.handle('cli:version', () => wrapHandler(() => getCliVersion()))

  // Search
  ipcMain.handle(
    'cli:search',
    (_event, root: string, query: string, options?: { limit?: number; mode?: string; path?: string; filter?: string }) => {
      const args: string[] = [query]
      if (options?.limit != null) args.push('--limit', String(options.limit))
      if (options?.mode) args.push('--mode', options.mode)
      if (options?.path) args.push('--path', options.path)
      if (options?.filter) args.push('--filter', options.filter)
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

  // Orphans
  ipcMain.handle('cli:orphans', (_event, root: string) =>
    wrapHandler(() => execCommand<OrphansOutput>('orphans', [], root))
  )

  // Clusters
  ipcMain.handle('cli:clusters', (_event, root: string) =>
    wrapHandler(() => execCommand<ClusterSummary[]>('clusters', [], root))
  )

  // Schema
  ipcMain.handle('cli:schema', (_event, root: string) =>
    wrapHandler(() => execCommand<Schema>('schema', [], root))
  )

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
    })
  )

  ipcMain.handle('recents:clear', () =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      s.set('recentFiles', [])
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

  // Watcher management
  ipcMain.handle('watcher:start', (_event, root: string) =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()

      // Forward watcher events to the renderer via webContents
      if (mainWindow && !mainWindow.isDestroyed()) {
        watcher.removeAllListeners()

        watcher.onEvent((event) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('watcher:event', { type: 'watch-event', data: event })
          }
        })

        watcher.onError((error) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('watcher:event', { type: 'error', data: { message: error.message } })
          }
        })

        watcher.onStateChange((state: WatcherState) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('watcher:event', { type: 'state-change', data: state })
          }
        })
      }

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
}
