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

// Maps from user callback -> wrapped ipcRenderer handler so removeTerminal*Listener
// can remove the exact listener without touching others.
type TerminalListener = (event: Electron.IpcRendererEvent, payload: unknown) => void
const terminalDataMap = new WeakMap<(payload: never) => void, TerminalListener>()
const terminalExitMap = new WeakMap<(payload: never) => void, TerminalListener>()
const terminalTitleMap = new WeakMap<(payload: never) => void, TerminalListener>()

const api: MdvdbApi = {
  findCli: () => invoke('cli:find'),
  getCliVersion: () => invoke('cli:version'),
  search: (root, query, options?) => invoke('cli:search', root, query, options),
  status: (root) => invoke('cli:status', root),
  ingest: (root, options?) => invoke('cli:ingest', root, options),
  ingestPreview: (root) => invoke('cli:ingest-preview', root),
  tree: (root, path?) => invoke('cli:tree', root, path),
  getFile: (root, filePath, options?) => invoke('cli:get', root, filePath, options),
  links: (root, filePath) => invoke('cli:links', root, filePath),
  backlinks: (root, filePath) => invoke('cli:backlinks', root, filePath),
  neighborhood: (root, filePath, depth) => invoke('cli:neighborhood', root, filePath, depth),
  orphans: (root) => invoke('cli:orphans', root),
  clusters: (root) => invoke('cli:clusters', root),
  customClusters: (root) => invoke('cli:custom-clusters', root),
  clusterDefinitions: (root) => invoke('cli:clusters-list', root),
  addTopic: (root, def) => invoke('cli:clusters-add', root, def),
  updateTopic: (root, name, def) => invoke('cli:clusters-update', root, name, def),
  removeTopic: (root, name) => invoke('cli:clusters-remove', root, name),
  topicUnassigned: (root) => invoke('cli:clusters-unassigned', root),
  onObsidianTopicsSynced: (callback) => {
    ipcRenderer.on('topics:obsidian-synced', (_event, data) => callback(data))
  },
  removeObsidianTopicsSyncedListener: () => {
    ipcRenderer.removeAllListeners('topics:obsidian-synced')
  },
  setConfigValue: (root, key, value) => invoke('cli:config-set', root, key, value),
  graphData: (root, level?, path?) => invoke('cli:graph', root, level, path),
  schema: (root, path?) => invoke('cli:schema', root, path),
  collection: (root, folderPath, options?) => invoke('cli:collection', root, folderPath, options),
  config: (root) => invoke('cli:config', root),
  doctor: (root) => invoke('cli:doctor', root),
  info: (root, path?) => invoke('cli:info', root, path),
  init: (root) => invoke('cli:init', root),
  resetIndex: (root) => invoke('cli:reset-index', root),

  // Collection management
  listCollections: () => invoke('collections:list'),
  addCollection: () => invoke('collections:add'),
  createExampleCollection: () => invoke('collections:create-example'),
  removeCollection: (id) => invoke('collections:remove', id),
  setActiveCollection: (id) => invoke('collections:set-active', id),
  getActiveCollection: () => invoke('collections:get-active'),

  // File operations
  readFile: (absolutePath) => invoke('fs:read-file', absolutePath),
  writeFile: (absolutePath, content) => invoke('fs:write-file', absolutePath, content),
  updateFrontmatter: (collectionId, relativePath, patch) =>
    invoke('fs:update-frontmatter', collectionId, relativePath, patch),
  createFile: (absolutePath, content) => invoke('fs:create-file', absolutePath, content),
  createDirectory: (absolutePath) => invoke('fs:create-directory', absolutePath),
  readBinary: (absolutePath) => invoke('fs:read-binary', absolutePath),
  writeBinary: (absolutePath, base64Data) => invoke('fs:write-binary', absolutePath, base64Data),
  fileInfo: (absolutePath) => invoke('fs:file-info', absolutePath),
  copyFile: (sourcePath, destPath) => invoke('fs:copy-file', sourcePath, destPath),
  isWithinCollection: (absolutePath) => invoke('fs:is-within-collection', absolutePath),
  renameFile: (oldPath, newPath) => invoke('fs:rename-file', oldPath, newPath),
  deleteFile: (absolutePath) => invoke('fs:delete', absolutePath),

  // Asset scanning
  scanAssets: (collectionPath) => invoke('fs:scan-assets', collectionPath),

  // Get native file path from dropped File (Electron webUtils — runs in preload only)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Shell operations
  showItemInFolder: (absolutePath) => invoke('shell:show-item-in-folder', absolutePath),
  openPath: (absolutePath) => invoke('shell:open-path', absolutePath),

  // Clipboard operations
  writeToClipboard: (text) => invoke('clipboard:write-text', text),

  // Native simple dialogs
  showConfirmation: (options) => invoke('dialog:confirm', options),
  showMessage: (options) => invoke('dialog:message', options),

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

  // Saved table views
  listTableViews: (collectionId, folderPath) => invoke('tableviews:list', collectionId, folderPath),
  saveTableView: (collectionId, folderPath, view) =>
    invoke('tableviews:save', collectionId, folderPath, view),
  updateTableView: (collectionId, folderPath, view) =>
    invoke('tableviews:update', collectionId, folderPath, view),
  deleteTableView: (collectionId, folderPath, viewId) =>
    invoke('tableviews:delete', collectionId, folderPath, viewId),
  setDefaultTableView: (collectionId, folderPath, viewId) =>
    invoke('tableviews:set-default', collectionId, folderPath, viewId),

  // Property type conversion / schema editing (phase 41)
  previewPropertyOp: (req) => invoke('schema:preview-property-op', req),
  applyPropertyOp: (opId, req) => invoke('schema:apply-property-op', opId, req),
  updateOverlayField: (collectionId, scope, key, patch) =>
    invoke('schema:update-overlay-field', collectionId, scope, key, patch),
  onPropertyOpProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown): void => {
      callback(data as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('schema:property-op-progress', listener)
    return () => {
      ipcRenderer.removeListener('schema:property-op-progress', listener)
    }
  },

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

  // Vault watcher (Tier-1 raw fs events; lifecycle is main-owned)
  getVaultWatcherStatus: () => invoke('vault-watcher:status'),
  onVaultFileEvents: (callback) => {
    ipcRenderer.on('vault:file-events', (_event, batch) => callback(batch))
  },
  removeVaultFileEventsListener: () => {
    ipcRenderer.removeAllListeners('vault:file-events')
  },
  onVaultWatcherStatus: (callback) => {
    ipcRenderer.on('vault:watcher-status', (_event, status) => callback(status))
  },
  removeVaultWatcherStatusListener: () => {
    ipcRenderer.removeAllListeners('vault:watcher-status')
  },

  // Native menu events
  onMenuOpenRecent: (callback) => {
    ipcRenderer.on('menu:open-recent', (_event, data) => callback(data))
  },
  removeMenuOpenRecentListener: () => {
    ipcRenderer.removeAllListeners('menu:open-recent')
  },
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:command', (_event, data) => callback(data))
  },
  removeMenuCommandListener: () => {
    ipcRenderer.removeAllListeners('menu:command')
  },
  setMenuContext: (context) => invoke('menu:set-context', context),

  // Export (phase 43) — native save dialog, outside collection bounds
  exportSave: (request) => invoke('export:save', request),
  exportPdf: (request) => invoke('export:pdf', request),

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
  setCollectionConfig: (root, key, value) =>
    invoke('settings:set-collection-config', root, key, value),
  deleteCollectionConfig: (root, key) => invoke('settings:delete-collection-config', root, key),

  // Onboarding state
  getOnboardingComplete: () => invoke('store:get-onboarding-complete'),
  setOnboardingComplete: (value) => invoke('store:set-onboarding-complete', value),

  // Editor preferences
  getEditorFontSize: () => invoke('store:get-editor-font-size'),
  setEditorFontSize: (value) => invoke('store:set-editor-font-size', value),
  getAutoShowDiff: () => invoke('store:get-auto-show-diff'),
  setAutoShowDiff: (value) => invoke('store:set-auto-show-diff', value),
  getWatcherEnabled: (collectionId) => invoke('store:get-watcher-enabled', collectionId),
  setWatcherEnabled: (collectionId, enabled) =>
    invoke('store:set-watcher-enabled', collectionId, enabled),

  // Zoom
  getZoomLevel: () => invoke('store:get-zoom-level'),
  setZoomLevel: (value) => invoke('store:set-zoom-level', value),

  // Accent color
  getPrimaryColor: () => invoke('store:get-primary-color'),
  setPrimaryColor: (hex) => invoke('store:set-primary-color', hex),
  getCollectionColor: (collectionId) => invoke('store:get-collection-color', collectionId),
  setCollectionColor: (collectionId, hex) =>
    invoke('store:set-collection-color', collectionId, hex),

  // Theme
  getTheme: () => invoke('store:get-theme'),
  setTheme: (mode) => invoke('store:set-theme', mode),
  getCollectionTheme: (collectionId) => invoke('store:get-collection-theme', collectionId),
  setCollectionTheme: (collectionId, mode) =>
    invoke('store:set-collection-theme', collectionId, mode),

  // Window session persistence
  saveWindowSession: (session) => invoke('session:save', session),
  saveWindowSessionSync: (session) => {
    ipcRenderer.sendSync('session:save-sync', session)
  },
  getWindowSession: () => invoke('session:get'),

  // Multi-window management
  newWindow: () => invoke('window:new'),

  // Dirty-close guard: main asks before really closing the window.
  // The ack is sent BEFORE the callback runs so main cancels its
  // hung-renderer fallback timer even while a confirm dialog blocks.
  onCloseRequest: (callback) => {
    ipcRenderer.on('app:close-request', () => {
      ipcRenderer.send('app:close-ack')
      callback()
    })
  },
  removeCloseRequestListener: () => {
    ipcRenderer.removeAllListeners('app:close-request')
  },
  confirmClose: () => invoke('app:confirm-close'),
  cancelClose: () => invoke('app:cancel-close'),

  // Cross-window tab transfer
  detachTab: (tabData) => invoke('tab:detach', tabData),
  onTabAttach: (callback) => {
    ipcRenderer.on('tab:attach', (_event, data) => callback(data))
  },
  removeTabAttachListener: () => {
    ipcRenderer.removeAllListeners('tab:attach')
  },

  // Cross-window file sync
  onFileSavedExternally: (callback) => {
    ipcRenderer.on('file:saved-externally', (_event, data) => callback(data))
  },
  removeFileSavedExternallyListener: () => {
    ipcRenderer.removeAllListeners('file:saved-externally')
  },

  // Popup windows
  openPopup: (options) => invoke('popup:open', options),
  onPopupInit: (callback) => {
    ipcRenderer.on('popup:init', (_event, data) => callback(data))
  },
  removePopupInitListener: () => {
    ipcRenderer.removeAllListeners('popup:init')
  },
  updatePopupTitle: (title) => invoke('popup:title-update', title),
  setPopupAlwaysOnTop: (enabled) => invoke('popup:set-always-on-top', enabled),
  popBack: (tabData) => invoke('popup:pop-back', tabData),

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
  },

  // Terminal (embedded PTY)
  terminalCreate: (opts) => invoke('terminal:create', opts),
  terminalWrite: (id, data) => invoke('terminal:write', { id, data }),
  terminalResize: (id, cols, rows) => invoke('terminal:resize', { id, cols, rows }),
  terminalDispose: (id) => invoke('terminal:dispose', { id }),
  terminalList: () => invoke('terminal:list'),
  terminalRebind: (id) => invoke('terminal:rebind', { id }),
  onTerminalData: (callback) => {
    // Wrap so listeners can be removed individually by returning a handle
    // that maps 1:1 to the Electron listener we register.
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      callback(payload as Parameters<typeof callback>[0])
    }
    terminalDataMap.set(callback, wrapped)
    ipcRenderer.on('terminal:data', wrapped)
    return callback
  },
  onTerminalExit: (callback) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      callback(payload as Parameters<typeof callback>[0])
    }
    terminalExitMap.set(callback, wrapped)
    ipcRenderer.on('terminal:exit', wrapped)
    return callback
  },
  onTerminalTitle: (callback) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      callback(payload as Parameters<typeof callback>[0])
    }
    terminalTitleMap.set(callback, wrapped)
    ipcRenderer.on('terminal:title', wrapped)
    return callback
  },
  removeTerminalDataListener: (handler) => {
    const wrapped = terminalDataMap.get(handler)
    if (wrapped) {
      ipcRenderer.off('terminal:data', wrapped)
      terminalDataMap.delete(handler)
    }
  },
  removeTerminalExitListener: (handler) => {
    const wrapped = terminalExitMap.get(handler)
    if (wrapped) {
      ipcRenderer.off('terminal:exit', wrapped)
      terminalExitMap.delete(handler)
    }
  },
  removeTerminalTitleListener: (handler) => {
    const wrapped = terminalTitleMap.get(handler)
    if (wrapped) {
      ipcRenderer.off('terminal:title', wrapped)
      terminalTitleMap.delete(handler)
    }
  },

  // Terminal settings
  getTerminalShellPath: () => invoke('store:get-terminal-shell-path'),
  setTerminalShellPath: (value) => invoke('store:set-terminal-shell-path', value),
  getTerminalShellArgs: () => invoke('store:get-terminal-shell-args'),
  setTerminalShellArgs: (value) => invoke('store:set-terminal-shell-args', value),
  getTerminalFontSize: () => invoke('store:get-terminal-font-size'),
  setTerminalFontSize: (value) => invoke('store:set-terminal-font-size', value),

  // Home directory (fallback cwd)
  getHomeDir: () => invoke('os:homedir')
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
