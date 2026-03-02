"use strict";
const electron = require("electron");
const electronAPI = {
  ipcRenderer: {
    send(channel, ...args) {
      electron.ipcRenderer.send(channel, ...args);
    },
    sendTo(webContentsId, channel, ...args) {
      const electronVer = process.versions.electron;
      const electronMajorVer = electronVer ? parseInt(electronVer.split(".")[0]) : 0;
      if (electronMajorVer >= 28) {
        throw new Error('"sendTo" method has been removed since Electron 28.');
      } else {
        electron.ipcRenderer.sendTo(webContentsId, channel, ...args);
      }
    },
    sendSync(channel, ...args) {
      return electron.ipcRenderer.sendSync(channel, ...args);
    },
    sendToHost(channel, ...args) {
      electron.ipcRenderer.sendToHost(channel, ...args);
    },
    postMessage(channel, message, transfer) {
      electron.ipcRenderer.postMessage(channel, message, transfer);
    },
    invoke(channel, ...args) {
      return electron.ipcRenderer.invoke(channel, ...args);
    },
    on(channel, listener) {
      electron.ipcRenderer.on(channel, listener);
      return () => {
        electron.ipcRenderer.removeListener(channel, listener);
      };
    },
    once(channel, listener) {
      electron.ipcRenderer.once(channel, listener);
      return () => {
        electron.ipcRenderer.removeListener(channel, listener);
      };
    },
    removeListener(channel, listener) {
      electron.ipcRenderer.removeListener(channel, listener);
      return this;
    },
    removeAllListeners(channel) {
      electron.ipcRenderer.removeAllListeners(channel);
    }
  },
  webFrame: {
    insertCSS(css) {
      return electron.webFrame.insertCSS(css);
    },
    setZoomFactor(factor) {
      if (typeof factor === "number" && factor > 0) {
        electron.webFrame.setZoomFactor(factor);
      }
    },
    setZoomLevel(level) {
      if (typeof level === "number") {
        electron.webFrame.setZoomLevel(level);
      }
    }
  },
  webUtils: {
    getPathForFile(file) {
      return electron.webUtils.getPathForFile(file);
    }
  },
  process: {
    get platform() {
      return process.platform;
    },
    get versions() {
      return process.versions;
    },
    get env() {
      return { ...process.env };
    }
  }
};
const api = {
  findCli: () => electron.ipcRenderer.invoke("cli:find"),
  getCliVersion: () => electron.ipcRenderer.invoke("cli:version"),
  search: (root, query, options) => electron.ipcRenderer.invoke("cli:search", root, query, options),
  status: (root) => electron.ipcRenderer.invoke("cli:status", root),
  ingest: (root, options) => electron.ipcRenderer.invoke("cli:ingest", root, options),
  ingestPreview: (root) => electron.ipcRenderer.invoke("cli:ingest-preview", root),
  tree: (root, path) => electron.ipcRenderer.invoke("cli:tree", root, path),
  getFile: (root, filePath) => electron.ipcRenderer.invoke("cli:get", root, filePath),
  links: (root, filePath) => electron.ipcRenderer.invoke("cli:links", root, filePath),
  backlinks: (root, filePath) => electron.ipcRenderer.invoke("cli:backlinks", root, filePath),
  orphans: (root) => electron.ipcRenderer.invoke("cli:orphans", root),
  clusters: (root) => electron.ipcRenderer.invoke("cli:clusters", root),
  schema: (root) => electron.ipcRenderer.invoke("cli:schema", root),
  config: (root) => electron.ipcRenderer.invoke("cli:config", root),
  doctor: (root) => electron.ipcRenderer.invoke("cli:doctor", root),
  init: (root) => electron.ipcRenderer.invoke("cli:init", root),
  // Collection management
  listCollections: () => electron.ipcRenderer.invoke("collections:list"),
  addCollection: () => electron.ipcRenderer.invoke("collections:add"),
  removeCollection: (id) => electron.ipcRenderer.invoke("collections:remove", id),
  setActiveCollection: (id) => electron.ipcRenderer.invoke("collections:set-active", id),
  getActiveCollection: () => electron.ipcRenderer.invoke("collections:get-active"),
  // File operations
  readFile: (absolutePath) => electron.ipcRenderer.invoke("fs:read-file", absolutePath)
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error("Failed to expose APIs via contextBridge:", error);
  }
} else {
  window.electron = electronAPI;
  window.api = api;
}
