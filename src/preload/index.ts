import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { MdvdbApi } from './api'

const api: MdvdbApi = {
  findCli: () => ipcRenderer.invoke('cli:find'),
  getCliVersion: () => ipcRenderer.invoke('cli:version'),
  search: (root, query, options?) => ipcRenderer.invoke('cli:search', root, query, options),
  status: (root) => ipcRenderer.invoke('cli:status', root),
  ingest: (root, options?) => ipcRenderer.invoke('cli:ingest', root, options),
  ingestPreview: (root) => ipcRenderer.invoke('cli:ingest-preview', root),
  tree: (root, path?) => ipcRenderer.invoke('cli:tree', root, path),
  getFile: (root, filePath) => ipcRenderer.invoke('cli:get', root, filePath),
  links: (root, filePath) => ipcRenderer.invoke('cli:links', root, filePath),
  backlinks: (root, filePath) => ipcRenderer.invoke('cli:backlinks', root, filePath),
  orphans: (root) => ipcRenderer.invoke('cli:orphans', root),
  clusters: (root) => ipcRenderer.invoke('cli:clusters', root),
  schema: (root) => ipcRenderer.invoke('cli:schema', root),
  config: (root) => ipcRenderer.invoke('cli:config', root),
  doctor: (root) => ipcRenderer.invoke('cli:doctor', root),
  init: (root) => ipcRenderer.invoke('cli:init', root),

  // Collection management
  listCollections: () => ipcRenderer.invoke('collections:list'),
  addCollection: () => ipcRenderer.invoke('collections:add'),
  removeCollection: (id) => ipcRenderer.invoke('collections:remove', id),
  setActiveCollection: (id) => ipcRenderer.invoke('collections:set-active', id),
  getActiveCollection: () => ipcRenderer.invoke('collections:get-active'),

  // File operations
  readFile: (absolutePath) => ipcRenderer.invoke('fs:read-file', absolutePath)
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
