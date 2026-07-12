/**
 * WindowManager — tracks all BrowserWindow instances for multi-window support.
 *
 * Provides centralized window lifecycle management: creation, lookup,
 * broadcast messaging, and cleanup. Uses webContents.id as the unique
 * key for each window. Always checks win.isDestroyed() before sending
 * IPC messages to prevent crashes.
 */

import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initStore, setZoomLevel } from './store'

/**
 * Native window background matching the renderer's `--color-bg` token,
 * so no white (or wrong-theme) flash shows before first paint.
 * 'auto' follows the OS via nativeTheme.
 */
function windowBackgroundColor(store: ReturnType<typeof initStore>): string {
  const mode = store.get('themeMode', 'dark')
  const dark = mode === 'dark' || (mode === 'auto' && nativeTheme.shouldUseDarkColors)
  return dark ? '#0f0f10' : '#e9e9e9'
}

/**
 * Colors for the Windows/Linux Window Controls Overlay, matching the
 * renderer theme: overlay background follows `--color-bg` (same source as
 * windowBackgroundColor) and the control symbols follow `--color-text`.
 */
function titleBarOverlayColors(store: ReturnType<typeof initStore>): {
  color: string
  symbolColor: string
} {
  const mode = store.get('themeMode', 'dark')
  const dark = mode === 'dark' || (mode === 'auto' && nativeTheme.shouldUseDarkColors)
  return {
    color: windowBackgroundColor(store),
    symbolColor: dark ? '#e4e4e7' : '#1a1a1a'
  }
}

/**
 * Platform-conditional titlebar window options: macOS keeps the inset
 * traffic lights ('hiddenInset'); Windows and Linux get a hidden native
 * titlebar with the Window Controls Overlay so the app draws its own
 * titlebar while native minimize/maximize/close controls stay usable.
 */
function titleBarOptions(
  store: ReturnType<typeof initStore>,
  overlayHeight: number
): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarOverlayColors(store), height: overlayHeight }
  }
}

/** How long main waits for the renderer to answer a close request (ms). */
const CLOSE_CONFIRM_TIMEOUT_MS = 3000

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1

/** Options for creating a popup window. */
export interface PopupWindowOptions {
  kind: 'document' | 'asset' | 'graph' | 'table' | 'terminal'
  filePath?: string
  editorMode?: string
  isUntitled?: boolean
  collectionId?: string
  collectionPath?: string
  mimeCategory?: string
  graphLevel?: string
  graphColoringMode?: string
  isDirty?: boolean
  content?: string | null
  savedContent?: string | null
  recursive?: boolean
  tableViewId?: string
  terminalId?: string
  title?: string
  shell?: string
  cwd?: string
}

/** Data sent to popup renderer for dirty document transfer. */
export interface PopupInitData {
  content: string | null
  savedContent: string | null
  isDirty: boolean
}

export class WindowManager {
  /** Map of webContents.id -> BrowserWindow */
  private windows: Map<number, BrowserWindow> = new Map()

  /** Set of webContents.id values that are popup windows. */
  private popups: Set<number> = new Set()

  /** Callbacks invoked (with webContents.id) when a tracked window is closed. */
  private closeListeners: ((webContentsId: number) => void)[] = []

  /** webContents.id values allowed to close without the dirty-close guard. */
  private forceClose: Set<number> = new Set()

  /** Pending hung-renderer fallback timers keyed by webContents.id. */
  private closeTimers: Map<number, NodeJS.Timeout> = new Map()

  /** Register a callback fired when any tracked window closes. */
  onWindowClosed(cb: (webContentsId: number) => void): void {
    this.closeListeners.push(cb)
  }

  /**
   * The primary main window — the single owner of session persistence.
   * Defined as the oldest living non-popup window (Map preserves insertion
   * order), so closing the primary promotes the next-oldest automatically.
   */
  getPrimaryWindowId(): number | null {
    for (const id of this.windows.keys()) {
      if (!this.popups.has(id)) return id
    }
    return null
  }

  /** Whether the given webContents belongs to the primary main window. */
  isPrimary(webContentsId: number): boolean {
    return this.getPrimaryWindowId() === webContentsId
  }

  /**
   * Bring the primary main window to the foreground (restore if minimized,
   * show, focus). Falls back to any live window when no main window exists.
   * Used by the single-instance lock when a second launch is attempted.
   */
  focusPrimaryWindow(): void {
    const primaryId = this.getPrimaryWindowId()
    const target =
      (primaryId !== null ? this.getWindow(primaryId) : undefined) ?? this.getAllWindows()[0]
    if (!target) return

    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
  }

  /**
   * Dirty-close guard (data safety): intercept the first native close, ask
   * the renderer to flush + confirm via 'app:close-request', and only close
   * for real once the renderer answers with 'app:confirm-close'. A fallback
   * timer force-closes hung/crashed renderers that never answer — the timer
   * is cancelled by the renderer's receipt ack ('app:close-ack').
   */
  private installCloseGuard(win: BrowserWindow, id: number): void {
    win.on('close', (event) => {
      if (this.forceClose.has(id)) return

      event.preventDefault()
      win.webContents.send('app:close-request')

      if (!this.closeTimers.has(id)) {
        const timer = setTimeout(() => {
          this.closeTimers.delete(id)
          if (!win.isDestroyed()) {
            this.forceClose.add(id)
            win.close()
          }
        }, CLOSE_CONFIRM_TIMEOUT_MS)
        this.closeTimers.set(id, timer)
      }
    })
  }

  /** Cancel the hung-renderer fallback timer (renderer acked the request). */
  clearCloseTimer(webContentsId: number): void {
    const timer = this.closeTimers.get(webContentsId)
    if (timer) {
      clearTimeout(timer)
      this.closeTimers.delete(webContentsId)
    }
  }

  /**
   * Close a window for real, bypassing the dirty-close guard. Called when
   * the renderer confirmed the close (or main already handled its state,
   * e.g. popup pop-back after the tab was transferred).
   */
  confirmClose(webContentsId: number): void {
    this.clearCloseTimer(webContentsId)
    const win = this.getWindow(webContentsId)
    if (!win) return
    this.forceClose.add(webContentsId)
    win.close()
  }

  /**
   * Create a new BrowserWindow, register it for tracking, and set up
   * standard event handlers (zoom, bounds persistence, external links).
   *
   * @returns The newly created BrowserWindow
   */
  createWindow(): BrowserWindow {
    const store = initStore()
    const savedBounds = store.get('windowBounds', { x: 0, y: 0, width: 1200, height: 800 })

    const win = new BrowserWindow({
      x: savedBounds.x,
      y: savedBounds.y,
      width: savedBounds.width,
      height: savedBounds.height,
      minWidth: 800,
      minHeight: 600,
      show: false,
      backgroundColor: windowBackgroundColor(store),
      ...titleBarOptions(store, 35),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    const id = win.webContents.id
    this.windows.set(id, win)

    this.installCloseGuard(win, id)

    // Remove from tracking when the window is closed
    win.on('closed', () => {
      this.windows.delete(id)
      this.forceClose.delete(id)
      this.clearCloseTimer(id)
      for (const cb of this.closeListeners) {
        try {
          cb(id)
        } catch {
          // ignore listener errors
        }
      }
    })

    win.on('ready-to-show', () => {
      // Restore persisted zoom level
      const savedZoom = store.get('zoomLevel', 1.0)
      if (savedZoom !== 1.0) {
        win.webContents.setZoomFactor(savedZoom)
      }
      win.show()
    })

    // Handle zoom shortcuts from the main process to avoid Chromium conflicts
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const isMeta = process.platform === 'darwin' ? input.meta : input.control
      if (!isMeta) return

      if (input.code === 'Equal' || input.code === 'Minus' || input.code === 'Digit0') {
        event.preventDefault()
        const current = win.webContents.getZoomFactor()

        let next: number
        if (input.code === 'Equal') {
          next = Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 10) / 10)
        } else if (input.code === 'Minus') {
          next = Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 10) / 10)
        } else {
          next = 1.0
        }

        win.webContents.setZoomFactor(next)
        setZoomLevel(next)
        // Notify renderer of zoom change
        win.webContents.send('zoom:changed', next)
      }
    })

    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Save window bounds on resize or move (debounced)
    let saveBoundsTimer: NodeJS.Timeout | null = null
    const saveWindowBounds = (): void => {
      if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
      saveBoundsTimer = setTimeout(() => {
        if (!win.isDestroyed()) {
          const bounds = win.getBounds()
          store.set('windowBounds', bounds)
        }
      }, 500)
    }

    win.on('resize', saveWindowBounds)
    win.on('move', saveWindowBounds)

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    return win
  }

  /**
   * Create a lightweight popup BrowserWindow for focused single-content editing.
   * Popup windows are smaller, have no session persistence, and pass their
   * configuration via URL query parameters so the renderer can branch to
   * PopupShell instead of the full chrome.
   *
   * @param options - What kind of content the popup should display
   * @returns The newly created popup BrowserWindow
   */
  createPopupWindow(options: PopupWindowOptions): BrowserWindow {
    const store = initStore()

    const win = new BrowserWindow({
      width: 700,
      height: 500,
      minWidth: 400,
      minHeight: 300,
      show: false,
      backgroundColor: windowBackgroundColor(store),
      ...titleBarOptions(store, 28),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    const id = win.webContents.id
    this.windows.set(id, win)
    this.popups.add(id)

    this.installCloseGuard(win, id)

    win.on('closed', () => {
      this.windows.delete(id)
      this.popups.delete(id)
      this.forceClose.delete(id)
      this.clearCloseTimer(id)
      for (const cb of this.closeListeners) {
        try {
          cb(id)
        } catch {
          // ignore listener errors
        }
      }
    })

    win.on('ready-to-show', () => {
      const savedZoom = store.get('zoomLevel', 1.0)
      if (savedZoom !== 1.0) {
        win.webContents.setZoomFactor(savedZoom)
      }
      win.show()
    })

    // Handle zoom shortcuts (same as full windows)
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const isMeta = process.platform === 'darwin' ? input.meta : input.control
      if (!isMeta) return

      if (input.code === 'Equal' || input.code === 'Minus' || input.code === 'Digit0') {
        event.preventDefault()
        const current = win.webContents.getZoomFactor()

        let next: number
        if (input.code === 'Equal') {
          next = Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 10) / 10)
        } else if (input.code === 'Minus') {
          next = Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 10) / 10)
        } else {
          next = 1.0
        }

        win.webContents.setZoomFactor(next)
        setZoomLevel(next)
        win.webContents.send('zoom:changed', next)
      }
    })

    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Build query string from popup options
    const params = new URLSearchParams()
    params.set('mode', 'popup')
    params.set('kind', options.kind)
    if (options.filePath) params.set('filePath', options.filePath)
    if (options.editorMode) params.set('editorMode', options.editorMode)
    if (options.isUntitled) params.set('isUntitled', 'true')
    if (options.collectionId) params.set('collectionId', options.collectionId)
    if (options.collectionPath) params.set('collectionPath', options.collectionPath)
    if (options.mimeCategory) params.set('mimeCategory', options.mimeCategory)
    if (options.graphLevel) params.set('graphLevel', options.graphLevel)
    if (options.graphColoringMode) params.set('graphColoringMode', options.graphColoringMode)
    if (options.recursive) params.set('recursive', 'true')
    if (options.tableViewId) params.set('tableViewId', options.tableViewId)
    if (options.terminalId) params.set('terminalId', options.terminalId)
    if (options.title) params.set('title', options.title)
    if (options.shell) params.set('shell', options.shell)
    if (options.cwd) params.set('cwd', options.cwd)

    const qs = '?' + params.toString()

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'] + qs)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: params.toString() })
    }

    // If dirty content was provided, send it to the popup after it finishes loading
    if (options.isDirty && options.content != null) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) {
          const initData: PopupInitData = {
            content: options.content ?? null,
            savedContent: options.savedContent ?? null,
            isDirty: true
          }
          win.webContents.send('popup:init', initData)
        }
      })
    }

    return win
  }

  /**
   * Check if a tracked window is a popup window.
   *
   * @param id - The webContents.id of the window
   * @returns True if the window is a popup
   */
  isPopup(id: number): boolean {
    return this.popups.has(id)
  }

  /**
   * Get a tracked window by its webContents.id.
   *
   * @param id - The webContents.id of the window
   * @returns The BrowserWindow, or undefined if not found or destroyed
   */
  getWindow(id: number): BrowserWindow | undefined {
    const win = this.windows.get(id)
    if (win && !win.isDestroyed()) {
      return win
    }
    // Clean up stale entry if the window was destroyed outside normal flow
    if (win) {
      this.windows.delete(id)
      this.popups.delete(id)
    }
    return undefined
  }

  /**
   * Get all currently tracked, non-destroyed windows.
   *
   * @returns Array of live BrowserWindow instances
   */
  getAllWindows(): BrowserWindow[] {
    const live: BrowserWindow[] = []
    const stale: number[] = []

    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) {
        stale.push(id)
      } else {
        live.push(win)
      }
    }

    // Clean up any stale entries
    for (const id of stale) {
      this.windows.delete(id)
      this.popups.delete(id)
    }

    return live
  }

  /**
   * Send an IPC message to all tracked, non-destroyed windows.
   * Silently skips destroyed windows to prevent crashes.
   *
   * @param channel - The IPC channel name
   * @param args - Arguments to send with the message
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    const stale: number[] = []

    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) {
        stale.push(id)
        continue
      }

      try {
        win.webContents.send(channel, ...args)
      } catch {
        // Window may have been destroyed between the check and the send
        stale.push(id)
      }
    }

    // Clean up any stale entries
    for (const id of stale) {
      this.windows.delete(id)
    }
  }

  /**
   * Re-color the Windows/Linux Window Controls Overlay on all windows after
   * a theme change so the native controls match the new renderer theme.
   * No-op on macOS (traffic lights are not overlay-styled) and on windows
   * whose Electron build lacks setTitleBarOverlay.
   */
  updateTitleBarOverlay(): void {
    if (process.platform !== 'win32' && process.platform !== 'linux') return

    const colors = titleBarOverlayColors(initStore())
    for (const win of this.getAllWindows()) {
      if (typeof win.setTitleBarOverlay !== 'function') continue
      try {
        win.setTitleBarOverlay(colors)
      } catch {
        // Window may lack an overlay (or was destroyed mid-iteration) — skip
      }
    }
  }

  /**
   * Close a tracked window by its webContents.id.
   * No-op if the window is not found or already destroyed.
   *
   * @param id - The webContents.id of the window to close
   */
  closeWindow(id: number): void {
    const win = this.windows.get(id)
    if (!win || win.isDestroyed()) {
      this.windows.delete(id)
      return
    }

    win.close()
    // The 'closed' event handler will remove it from tracking
  }
}
