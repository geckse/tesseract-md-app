/**
 * Native application menu orchestrator (phase 43).
 *
 * Owns the Menu lifecycle and the main→renderer command transport:
 *  - buildAppMenu(windowManager): build + set the menu once at startup
 *  - refreshAppMenu(): microtask-coalesced full rebuild (recents change,
 *    collection switch/add/remove, watcher toggle)
 *  - menu item clicks → sendMenuCommand → `menu:command` {id, payload} to
 *    the focused application window. Graph-local commands may target a focused
 *    graph popup; all other commands fall back to the primary window. Commands
 *    are never broadcast because, for example, that would save every tab.
 *
 * The template itself is a pure function in menu-template.ts, fed by a
 * store snapshot from menu-state.ts.
 */

import { Menu, BrowserWindow, app, shell } from 'electron'
import { initStore } from './store'
import { DEFAULT_GRAPH_MENU_CONTEXT, getMenuState } from './menu-state'
import { buildTemplate, type MenuActions } from './menu-template'
import { getAppUpdater } from './updater'
import type { WindowManager } from './window-manager'
import type { GraphMenuContext } from '../preload/api'

/** Reference to the WindowManager for sending IPC events to windows. */
let windowManagerRef: WindowManager | null = null

/** Coalesce bursts of refresh calls (e.g. collection switch + recents) into one rebuild. */
let refreshQueued = false

/** Transient native Graph-menu state, isolated per renderer window. */
const windowMenuContexts = new Map<number, GraphMenuContext>()

/** Graph commands that are safe and meaningful inside a focused graph popup. */
const popupGraphCommandIds = new Set([
  'graph.search',
  'graph.recenter',
  'graph.presentation-toggle',
  'graph.presentation-reset',
  'graph.set-coloring',
  'graph.set-level',
  'graph.toggle-labels',
  'graph.toggle-lines',
  'graph.toggle-shapes',
  'graph.toggle-unconnected',
  'graph.screenshot',
  'graph.screenshot-transparent'
])

/** Resolve a command target, permitting only graph-local actions in graph popups. */
function resolveMenuTarget(commandId?: string): BrowserWindow | undefined {
  if (!windowManagerRef) return undefined

  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && !windowManagerRef.isPopup(focused.webContents.id)) {
    return focused
  }
  if (
    focused &&
    !focused.isDestroyed() &&
    commandId &&
    popupGraphCommandIds.has(commandId) &&
    windowMenuContexts.get(focused.webContents.id)?.active
  ) {
    return focused
  }

  const primaryId = windowManagerRef.getPrimaryWindowId()
  return primaryId === null ? undefined : windowManagerRef.getWindow(primaryId)
}

/** Build menu state for the focused graph popup or application window. */
function getFocusedMenuState() {
  const focused = BrowserWindow.getFocusedWindow()
  const focusedPopupContext =
    focused && windowManagerRef?.isPopup(focused.webContents.id)
      ? windowMenuContexts.get(focused.webContents.id)
      : undefined
  const target = focusedPopupContext?.active ? focused : resolveMenuTarget()
  const context = target
    ? (windowMenuContexts.get(target.webContents.id) ?? DEFAULT_GRAPH_MENU_CONTEXT)
    : DEFAULT_GRAPH_MENU_CONTEXT
  return getMenuState(context)
}

/** Merge a renderer's transient focused-view state and refresh the native menu. */
export function updateWindowMenuContext(
  webContentsId: number,
  update: Partial<GraphMenuContext>
): void {
  const previous = windowMenuContexts.get(webContentsId) ?? DEFAULT_GRAPH_MENU_CONTEXT
  const next =
    update.active === false ? { ...DEFAULT_GRAPH_MENU_CONTEXT } : { ...previous, ...update }
  windowMenuContexts.set(webContentsId, next)
  refreshAppMenu()
}

/** Forget transient state when its renderer is destroyed. */
export function clearWindowMenuContext(webContentsId: number): void {
  if (windowMenuContexts.delete(webContentsId)) refreshAppMenu()
}

/**
 * Send a menu command to its appropriate focused target. Graph-local commands
 * can reach a focused graph popup; all other popup commands fall back to the
 * primary window.
 */
function sendMenuCommand(id: string, payload?: unknown): void {
  resolveMenuTarget(id)?.webContents.send('menu:command', { id, payload })
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
  const menu = Menu.buildFromTemplate(buildTemplate(getFocusedMenuState(), menuActions))
  Menu.setApplicationMenu(menu)
}

/**
 * Rebuild the application menu to reflect persisted and focused-view state.
 * Safe to call in bursts — rebuilds once per microtask tick.
 */
export function refreshAppMenu(): void {
  if (!windowManagerRef || windowManagerRef.getAllWindows().length === 0) return
  if (refreshQueued) return
  refreshQueued = true
  queueMicrotask(() => {
    refreshQueued = false
    if (!windowManagerRef || windowManagerRef.getAllWindows().length === 0) return
    const menu = Menu.buildFromTemplate(buildTemplate(getFocusedMenuState(), menuActions))
    Menu.setApplicationMenu(menu)
  })
}
