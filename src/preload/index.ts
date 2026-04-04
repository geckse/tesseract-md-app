import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { MdvdbApi } from './api'

// Flash prevention: synchronously apply theme before any renderer CSS paints.
// ipcRenderer.sendSync blocks until main replies, so data-theme is set before DOM renders.
try {
  const theme = ipcRenderer.sendSync('store:get-theme-sync')
  if (theme && (theme === 'light' || theme === 'dark' || theme === 'auto')) {
    let resolved = theme
    if (theme === 'auto') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', resolved)
    document.documentElement.style.setProperty('color-scheme', resolved)
  }
} catch {
  // Ignore — default dark theme from CSS will apply
}

/**
 * Check if an IPC result is a serialized error from wrapHandler.
 * If so, throw it as a proper Error so renderer catch blocks work.
 */
function unwrapResult<T>(result: T): T {
  if (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as Record<string, unknown>).error === true &&
    'type' in result &&
    'message' in result
  ) {
    const err = result as { type: string; message: string }
    throw new Error(`[${err.type}] ${err.message}`)
  }
  return result
}

/** Invoke IPC channel and unwrap serialized errors. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  return unwrapResult(result) as T
}

const api: MdvdbApi = {
  findCli: () => invoke('cli:find'),
  getCliVersion: () => invoke('cli:version'),
  search: (root, query, options?) => invoke('cli:search', root, query, options),
  status: (root) => invoke('cli:status', root),
  ingest: (root, options?) => invoke('cli:ingest', root, options),
  ingestPreview: (root) => invoke('cli:ingest-preview', root),
  tree: (root, path?) => invoke('cli:tree', root, path),
  getFile: (root, filePath) => invoke('cli:get', root, filePath),
  links: (root, filePath) => invoke('cli:links', root, filePath),
  backlinks: (root, filePath) => invoke('cli:backlinks', root, filePath),
  neighborhood: (root, filePath, depth) => invoke('cli:neighborhood', root, filePath, depth),
  orphans: (root) => invoke('cli:orphans', root),
  clusters: (root) => invoke('cli:clusters', root),
  graphData: (root, level?, path?) => invoke('cli:graph', root, level, path),
  schema: (root, path?) => invoke('cli:schema', root, path),
  config: (root) => invoke('cli:config', root),
  doctor: (root) => invoke('cli:doctor', root),
  init: (root) => invoke('cli:init', root),
  resetIndex: (root) => invoke('cli:reset-index', root),

  // Collection management
  listCollections: () => invoke('collections:list'),
  addCollection: () => invoke('collections:add'),
  removeCollection: (id) => invoke('collections:remove', id),
  setActiveCollection: (id) => invoke('collections:set-active', id),
  getActiveCollection: () => invoke('collections:get-active'),

  // File operations
  readFile: (absolutePath) => invoke('fs:read-file', absolutePath),
  writeFile: (absolutePath, content) => invoke('fs:write-file', absolutePath, content),
  createFile: (absolutePath, content) => invoke('fs:create-file', absolutePath, content),
  createDirectory: (absolutePath) => invoke('fs:create-directory', absolutePath),
  readBinary: (absolutePath) => invoke('fs:read-binary', absolutePath),
  writeBinary: (absolutePath, base64Data) => invoke('fs:write-binary', absolutePath, base64Data),
  fileInfo: (absolutePath) => invoke('fs:file-info', absolutePath),
  copyFile: (sourcePath, destPath) => invoke('fs:copy-file', sourcePath, destPath),
  isWithinCollection: (absolutePath) => invoke('fs:is-within-collection', absolutePath),
  renameFile: (oldPath, newPath) => invoke('fs:rename-file', oldPath, newPath),

  // Asset scanning
  scanAssets: (collectionPath) => invoke('fs:scan-assets', collectionPath),

  // Get native file path from dropped File (Electron webUtils — runs in preload only)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Shell operations
  showItemInFolder: (absolutePath) => invoke('shell:show-item-in-folder', absolutePath),
  openPath: (absolutePath) => invoke('shell:open-path', absolutePath),

  // Clipboard operations
  writeToClipboard: (text) => invoke('clipboard:write-text', text),

  // Single-file ingest
  ingestFile: (root, filePath, options?) => invoke('cli:ingest-file', root, filePath, options),

  // Favorites management
  listFavorites: () => invoke('favorites:list'),
  addFavorite: (collectionId, filePath) => invoke('favorites:add', collectionId, filePath),
  removeFavorite: (collectionId, filePath) => invoke('favorites:remove', collectionId, filePath),
  isFavorite: (collectionId, filePath) => invoke('favorites:is-favorite', collectionId, filePath),

  // Recents management
  listRecents: () => invoke('recents:list'),
  addRecent: (collectionId, filePath) => invoke('recents:add', collectionId, filePath),
  clearRecents: () => invoke('recents:clear'),

  // Window state persistence
  setSidebarWidth: (width) => invoke('store:set-sidebar-width', width),
  setMetadataPanelWidth: (width) => invoke('store:set-metadata-panel-width', width),
  getSidebarWidth: () => invoke('store:get-sidebar-width'),
  getMetadataPanelWidth: () => invoke('store:get-metadata-panel-width'),

  // Ingest cancellation
  cancelIngest: () => invoke('cli:cancel-ingest'),

  // Watcher management
  startWatcher: (root) => invoke('watcher:start', root),
  stopWatcher: () => invoke('watcher:stop'),
  getWatcherStatus: () => invoke('watcher:status'),
  onWatcherEvent: (callback) => {
    ipcRenderer.on('watcher:event', (_event, data) => callback(data))
  },
  removeWatcherEventListener: () => {
    ipcRenderer.removeAllListeners('watcher:event')
  },

  // Native menu events
  onMenuOpenRecent: (callback) => {
    ipcRenderer.on('menu:open-recent', (_event, data) => callback(data))
  },
  removeMenuOpenRecentListener: () => {
    ipcRenderer.removeAllListeners('menu:open-recent')
  },

  // CLI detection & installation
  detectCli: () => invoke('cli:detect'),
  installCli: () => invoke('cli:install'),
  onInstallProgress: (callback) => {
    ipcRenderer.on('cli:install-progress', (_event, data) => callback(data))
  },
  removeInstallProgressListener: () => {
    ipcRenderer.removeAllListeners('cli:install-progress')
  },
  checkLatestCliVersion: () => invoke('cli:check-latest-version'),

  // User-level config (~/.mdvdb/config)
  getUserConfig: () => invoke('settings:get-user-config'),
  setUserConfig: (key, value) => invoke('settings:set-user-config', key, value),
  deleteUserConfig: (key) => invoke('settings:delete-user-config', key),

  // Collection-level config (.markdownvdb/.config)
  getCollectionConfig: (root) => invoke('settings:get-collection-config', root),
  setCollectionConfig: (root, key, value) => invoke('settings:set-collection-config', root, key, value),
  deleteCollectionConfig: (root, key) => invoke('settings:delete-collection-config', root, key),

  // Onboarding state
  getOnboardingComplete: () => invoke('store:get-onboarding-complete'),
  setOnboardingComplete: (value) => invoke('store:set-onboarding-complete', value),

  // Editor preferences
  getEditorFontSize: () => invoke('store:get-editor-font-size'),
  setEditorFontSize: (value) => invoke('store:set-editor-font-size', value),

  // Zoom
  getZoomLevel: () => invoke('store:get-zoom-level'),
  setZoomLevel: (value) => invoke('store:set-zoom-level', value),

  // Accent color
  getPrimaryColor: () => invoke('store:get-primary-color'),
  setPrimaryColor: (hex) => invoke('store:set-primary-color', hex),
  getCollectionColor: (collectionId) => invoke('store:get-collection-color', collectionId),
  setCollectionColor: (collectionId, hex) => invoke('store:set-collection-color', collectionId, hex),

  // Theme
  getTheme: () => invoke('store:get-theme'),
  setTheme: (mode) => invoke('store:set-theme', mode),
  getCollectionTheme: (collectionId) => invoke('store:get-collection-theme', collectionId),
  setCollectionTheme: (collectionId, mode) => invoke('store:set-collection-theme', collectionId, mode),

  // Window session persistence
  saveWindowSession: (session) => invoke('session:save', session),
  getWindowSession: () => invoke('session:get'),

  // Multi-window management
  newWindow: () => invoke('window:new'),

  // Cross-window tab transfer
  detachTab: (tabData) => invoke('tab:detach', tabData),
  onTabAttach: (callback) => {
    ipcRenderer.on('tab:attach', (_event, data) => callback(data))
  },
  removeTabAttachListener: () => {
    ipcRenderer.removeAllListeners('tab:attach')
  },

  // Auto-updater
  checkForUpdates: () => invoke('updater:check'),
  downloadUpdate: () => invoke('updater:download'),
  installUpdate: () => invoke('updater:install'),
  getUpdateStatus: () => invoke('updater:status'),
  getAppVersion: () => invoke('updater:app-version'),
  onUpdateEvent: (callback) => {
    ipcRenderer.on('updater:event', (_event, data) => callback(data))
  },
  removeUpdateEventListener: () => {
    ipcRenderer.removeAllListeners('updater:event')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose APIs via contextBridge:', error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
