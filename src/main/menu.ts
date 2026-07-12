/**
 * Native application menu orchestrator (phase 43).
 *
 * Owns the Menu lifecycle and the main→renderer command transport:
 *  - buildAppMenu(windowManager): build + set the menu once at startup
 *  - refreshAppMenu(): microtask-coalesced full rebuild (recents change,
 *    collection switch/add/remove, watcher toggle)
 *  - menu item clicks → sendMenuCommand → `menu:command` {id, payload} to
 *    the focused non-popup window (primary-window fallback; never
 *    broadcast — a broadcast `file.save` would save every window's tab)
 *
 * The template itself is a pure function in menu-template.ts, fed by a
 * store snapshot from menu-state.ts.
 */

import { Menu, BrowserWindow, app, shell } from 'electron'
import { initStore } from './store'
import { getMenuState } from './menu-state'
import { buildTemplate, type MenuActions } from './menu-template'
import { getAppUpdater } from './updater'
import type { WindowManager } from './window-manager'

/** Reference to the WindowManager for sending IPC events to windows. */
let windowManagerRef: WindowManager | null = null

/** Coalesce bursts of refresh calls (e.g. collection switch + recents) into one rebuild. */
let refreshQueued = false

/**
 * Send a menu command to the focused window, skipping popup windows
 * (they render PopupShell and never register the command dispatcher).
 * Falls back to the primary window when nothing suitable has focus.
 */
function sendMenuCommand(id: string, payload?: unknown): void {
  if (!windowManagerRef) return

  const focused = BrowserWindow.getFocusedWindow()
  let target: BrowserWindow | undefined
  if (focused && !focused.isDestroyed() && !windowManagerRef.isPopup(focused.webContents.id)) {
    target = focused
  } else {
    const primaryId = windowManagerRef.getPrimaryWindowId()
    if (primaryId !== null) {
      target = windowManagerRef.getWindow(primaryId)
    }
  }

  target?.webContents.send('menu:command', { id, payload })
}

/** Show the native about panel (macOS app menu + win/linux Help). */
function showAbout(): void {
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} ${app.name}`
  })
  app.showAboutPanel()
}

const menuActions: MenuActions = {
  sendCommand: sendMenuCommand,
  openRecent: (payload) => {
    // Send to the focused window, or broadcast to all if none focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && !focusedWindow.isDestroyed()) {
      focusedWindow.webContents.send('menu:open-recent', payload)
    } else if (windowManagerRef) {
      windowManagerRef.broadcastToAll('menu:open-recent', payload)
    }
  },
  clearRecents: () => {
    initStore().set('recentFiles', [])
    refreshAppMenu()
  },
  newWindow: () => {
    windowManagerRef?.createWindow()
  },
  checkForUpdates: () => {
    void getAppUpdater().checkForUpdates()
  },
  showAbout,
  openExternal: (url) => {
    void shell.openExternal(url)
  }
}

/**
 * Build and set the application menu.
 * Call once after the first window is created; later changes go through
 * refreshAppMenu().
 */
export function buildAppMenu(windowManager: WindowManager): void {
  windowManagerRef = windowManager
  const menu = Menu.buildFromTemplate(buildTemplate(getMenuState(), menuActions))
  Menu.setApplicationMenu(menu)
}

/**
 * Rebuild the application menu to reflect updated state (recents, active
 * collection, watcher flag). Safe to call in bursts — rebuilds once per
 * microtask tick.
 */
export function refreshAppMenu(): void {
  if (!windowManagerRef || windowManagerRef.getAllWindows().length === 0) return
  if (refreshQueued) return
  refreshQueued = true
  queueMicrotask(() => {
    refreshQueued = false
    if (!windowManagerRef || windowManagerRef.getAllWindows().length === 0) return
    const menu = Menu.buildFromTemplate(buildTemplate(getMenuState(), menuActions))
    Menu.setApplicationMenu(menu)
  })
}
