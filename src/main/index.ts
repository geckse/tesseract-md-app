import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, destroyWatcherManager, destroyAppUpdater, getAppUpdater } from './ipc-handlers'
import { initStore } from './store'
import { buildAppMenu } from './menu'

function createWindow(): BrowserWindow {
  const store = initStore()
  const savedBounds = store.get('windowBounds', { x: 0, y: 0, width: 1200, height: 800 })

  const mainWindow = new BrowserWindow({
    x: savedBounds.x,
    y: savedBounds.y,
    width: savedBounds.width,
    height: savedBounds.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f0f10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Save window bounds on resize or move (debounced)
  let saveBoundsTimer: NodeJS.Timeout | null = null
  const saveWindowBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds()
        store.set('windowBounds', bounds)
      }
    }, 500)
  }

  mainWindow.on('resize', saveWindowBounds)
  mainWindow.on('move', saveWindowBounds)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mdvdb.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()

  registerIpcHandlers(mainWindow)
  buildAppMenu(mainWindow)

  // Initialize auto-updater via the singleton (same instance used by IPC handlers)
  const updater = getAppUpdater()
  updater.setMainWindow(mainWindow)
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  // Clean up auto-updater
  destroyAppUpdater()

  // Kill any spawned CLI child processes on quit
  destroyWatcherManager().catch(() => {
    // Best-effort cleanup during shutdown
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
