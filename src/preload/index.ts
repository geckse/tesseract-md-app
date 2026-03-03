import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { MdvdbApi } from './api'

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
  orphans: (root) => invoke('cli:orphans', root),
  clusters: (root) => invoke('cli:clusters', root),
  schema: (root) => invoke('cli:schema', root),
  config: (root) => invoke('cli:config', root),
  doctor: (root) => invoke('cli:doctor', root),
  init: (root) => invoke('cli:init', root),

  // Collection management
  listCollections: () => invoke('collections:list'),
  addCollection: () => invoke('collections:add'),
  removeCollection: (id) => invoke('collections:remove', id),
  setActiveCollection: (id) => invoke('collections:set-active', id),
  getActiveCollection: () => invoke('collections:get-active'),

  // File operations
  readFile: (absolutePath) => invoke('fs:read-file', absolutePath),
  writeFile: (absolutePath, content) => invoke('fs:write-file', absolutePath, content),

  // Shell operations
  showItemInFolder: (absolutePath) => invoke('shell:show-item-in-folder', absolutePath),

  // Single-file ingest
  ingestFile: (root, filePath, options?) => invoke('cli:ingest-file', root, filePath, options)
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
