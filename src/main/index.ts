import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  registerIpcHandlers,
  destroyWatcherManager,
  destroyAppUpdater,
  getAppUpdater
} from './ipc-handlers'
import { buildAppMenu } from './menu'
import { WindowManager } from './window-manager'

/** Singleton WindowManager for centralized multi-window lifecycle. */
export const windowManager = new WindowManager()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('md.tesseract.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: true })
  })

  const mainWindow = windowManager.createWindow()

  registerIpcHandlers(mainWindow)
  buildAppMenu(mainWindow)

  // Initialize auto-updater via the singleton (same instance used by IPC handlers)
  const updater = getAppUpdater()
  updater.setMainWindow(mainWindow)
  updater.start()

  app.on('activate', () => {
    if (windowManager.getAllWindows().length === 0) {
      windowManager.createWindow()
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
