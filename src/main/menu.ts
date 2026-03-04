/**
 * Native application menu builder for macOS / Windows / Linux.
 *
 * Provides a standard menu bar with File > Open Recent, Edit (undo/redo/clipboard),
 * View (dev tools), and Window menus.
 */

import { Menu, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { initStore, getCollections } from './store'
import type { RecentEntry, Collection } from './store'
import path from 'node:path'

/** Reference to the main window for sending IPC events. */
let mainWindowRef: BrowserWindow | null = null

/** Whether the app is in development mode. */
const isDev = !app.isPackaged

/**
 * Build and set the application menu.
 * Call once after the main window is created, and again via refreshRecentMenu().
 */
export function buildAppMenu(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  const menu = Menu.buildFromTemplate(buildTemplate())
  Menu.setApplicationMenu(menu)
}

/**
 * Rebuild the application menu to reflect updated recent files.
 * Call after recents:add, recents:clear, or collections:remove.
 */
export function refreshRecentMenu(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return
  const menu = Menu.buildFromTemplate(buildTemplate())
  Menu.setApplicationMenu(menu)
}

/**
 * Build the full menu template.
 */
function buildTemplate(): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []

  // macOS app menu
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  // File menu
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Open Recent',
        submenu: buildRecentSubmenu()
      },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
    ]
  })

  // Edit menu (free undo/redo/clipboard)
  template.push({ role: 'editMenu' })

  // View menu
  const viewSubmenu: MenuItemConstructorOptions[] = []
  if (isDev) {
    viewSubmenu.push(
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' }
    )
  }
  viewSubmenu.push({ role: 'togglefullscreen' })
  template.push({ label: 'View', submenu: viewSubmenu })

  // Window menu
  template.push({ role: 'windowMenu' })

  return template
}

/**
 * Build the "Open Recent" submenu from electron-store recents.
 */
function buildRecentSubmenu(): MenuItemConstructorOptions[] {
  const store = initStore()
  const recents: RecentEntry[] = store.get('recentFiles', [])
  const collections: Collection[] = getCollections()

  const collectionMap = new Map<string, Collection>()
  for (const c of collections) {
    collectionMap.set(c.id, c)
  }

  const items: MenuItemConstructorOptions[] = []

  for (const recent of recents.slice(0, 15)) {
    const collection = collectionMap.get(recent.collectionId)
    if (!collection) continue

    const fileName = path.basename(recent.filePath)
    const collectionName = collection.name

    items.push({
      label: `${fileName} — ${collectionName}`,
      click: () => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('menu:open-recent', {
            collectionId: recent.collectionId,
            filePath: recent.filePath
          })
        }
      }
    })
  }

  if (items.length > 0) {
    items.push({ type: 'separator' })
  }

  items.push({
    label: 'Clear Recent Files',
    enabled: items.length > 1, // > 1 because separator counts
    click: () => {
      store.set('recentFiles', [])
      refreshRecentMenu()
    }
  })

  return items
}
