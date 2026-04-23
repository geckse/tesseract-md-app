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
import { PtyManager } from './pty'
import { registerTerminalHandlers } from './pty-handlers'

/** Singleton WindowManager for centralized multi-window lifecycle. */
export const windowManager = new WindowManager()

/** Singleton PtyManager for embedded terminal PTYs. */
export const ptyManager = new PtyManager()

// Set the app name explicitly so macOS menu and About dialog show "Tesseract"
// (in dev mode, Electron defaults to the package.json "name" field)
app.setName('Tesseract')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('md.tesseract.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: true })
  })

  // Kill a window's terminals when it closes to avoid leaked PTYs.
  windowManager.onWindowClosed((webContentsId) => {
    ptyManager.disposeByWindow(webContentsId)
  })

  windowManager.createWindow()

  registerIpcHandlers(windowManager)
  registerTerminalHandlers(ptyManager)
  buildAppMenu(windowManager)

  // Initialize auto-updater via the singleton (same instance used by IPC handlers)
  const updater = getAppUpdater()
  updater.setWindowManager(windowManager)
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

  // Kill all PTYs before quit so no zombie shell processes are left behind
  ptyManager.disposeAll()

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
