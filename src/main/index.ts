import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  registerIpcHandlers,
  destroyWatcherManager,
  destroyAppUpdater,
  getAppUpdater
} from './ipc-handlers'
import { initStore, setZoomLevel } from './store'
import { buildAppMenu } from './menu'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1

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
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Restore persisted zoom level
    const savedZoom = store.get('zoomLevel', 1.0)
    if (savedZoom !== 1.0) {
      mainWindow.webContents.setZoomFactor(savedZoom)
    }
    mainWindow.show()
  })

  // Handle zoom shortcuts from the main process to avoid Chromium conflicts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isMeta = process.platform === 'darwin' ? input.meta : input.control
    if (!isMeta) return

    if (input.code === 'Equal' || input.code === 'Minus' || input.code === 'Digit0') {
      event.preventDefault()
      const current = mainWindow.webContents.getZoomFactor()

      let next: number
      if (input.code === 'Equal') {
        next = Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 10) / 10)
      } else if (input.code === 'Minus') {
        next = Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 10) / 10)
      } else {
        next = 1.0
      }

      mainWindow.webContents.setZoomFactor(next)
      setZoomLevel(next)
      // Notify renderer of zoom change
      mainWindow.webContents.send('zoom:changed', next)
    }
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
  electronApp.setAppUserModelId('md.tesseract.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: true })
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
