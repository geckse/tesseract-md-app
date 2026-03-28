/**
 * AppUpdater — manages auto-update lifecycle using electron-updater.
 *
 * Handles checking for updates, downloading, and installing on quit.
 * Follows the WatcherManager pattern with event forwarding to all windows
 * via WindowManager.broadcastToAll().
 */

import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

import { initStore } from './store'
import type { WindowManager } from './window-manager'

/** Update lifecycle states */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** IPC channel prefix for update events sent to renderer */
const IPC_PREFIX = 'updater'

/** Initial delay before first check (ms) */
const INITIAL_DELAY_MS = 5_000

/** Interval between periodic checks (ms) — 6 hours */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export class AppUpdater {
  private state: UpdateState = 'idle'
  private windowManager: WindowManager | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private initialTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Configure electron-updater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    this.setupListeners()
  }

  /** Set the WindowManager for broadcasting update events to all windows. */
  setWindowManager(wm: WindowManager | null): void {
    this.windowManager = wm
  }

  /** Start periodic update checks. No-op in dev mode. */
  start(): void {
    if (is.dev) return

    this.initialTimer = setTimeout(() => {
      this.checkForUpdates()

      this.checkTimer = setInterval(() => {
        this.checkForUpdates()
      }, CHECK_INTERVAL_MS)
    }, INITIAL_DELAY_MS)
  }

  /** Stop periodic update checks and clean up timers. */
  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  /** Manually trigger an update check. */
  async checkForUpdates(): Promise<void> {
    if (is.dev) return
    if (this.state === 'checking' || this.state === 'downloading') return

    try {
      this.setState('checking')
      await autoUpdater.checkForUpdates()
    } catch {
      // Error handled via autoUpdater 'error' event
    }
  }

  /** Start downloading an available update. */
  async downloadUpdate(): Promise<void> {
    if (this.state !== 'available') return

    try {
      await autoUpdater.downloadUpdate()
    } catch {
      // Error handled via autoUpdater 'error' event
    }
  }

  /** Install a downloaded update and restart the app. */
  quitAndInstall(): void {
    if (this.state !== 'downloaded') return
    autoUpdater.quitAndInstall()
  }

  /** Skip a specific version so the user is not prompted again. */
  skipVersion(version: string): void {
    const store = initStore()
    store.set('skipVersion', version)
  }

  /** Clear the skipped version. */
  clearSkippedVersion(): void {
    const store = initStore()
    store.set('skipVersion', null)
  }

  /** Current update state. */
  getState(): UpdateState {
    return this.state
  }

  /** Clean up all timers and listeners. */
  destroy(): void {
    this.stop()
    autoUpdater.removeAllListeners()
    this.windowManager = null
  }

  // --- Private ---

  private setupListeners(): void {
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      // Skip if user chose to skip this version
      const store = initStore()
      const skipped = store.get('skipVersion', null)
      if (skipped && info.version === skipped) {
        this.setState('not-available')
        return
      }

      this.setState('available')
      store.set('lastUpdateCheck', Date.now())
      this.sendToRenderer('update-available', { version: info.version, releaseNotes: info.releaseNotes })
    })

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      this.setState('not-available')
      const store = initStore()
      store.set('lastUpdateCheck', Date.now())
      this.sendToRenderer('update-not-available', {})
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState('downloading')
      this.sendToRenderer('download-progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState('downloaded')
      this.sendToRenderer('update-downloaded', { version: info.version })
    })

    autoUpdater.on('error', (error: Error) => {
      this.setState('error')
      this.sendToRenderer('update-error', { error: error.message })
    })
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.sendToRenderer('state-changed', { state })
  }

  /**
   * Map internal electron-updater event names to UpdateEvent type values
   * expected by the renderer store.
   */
  private static readonly EVENT_TYPE_MAP: Record<string, string> = {
    'update-available': 'available',
    'update-not-available': 'not-available',
    'download-progress': 'downloading',
    'update-downloaded': 'downloaded',
    'update-error': 'error',
    'state-changed': 'checking' // state-changed is handled separately
  }

  private sendToRenderer(event: string, data: Record<string, unknown>): void {
    if (!this.windowManager) return

    // Map event name to the type expected by the renderer's UpdateEvent interface.
    // For 'state-changed', use the state value directly as the type.
    const type = event === 'state-changed'
      ? (data.state as string)
      : (AppUpdater.EVENT_TYPE_MAP[event] ?? event)

    this.windowManager.broadcastToAll(`${IPC_PREFIX}:event`, { type, data })
  }
}
