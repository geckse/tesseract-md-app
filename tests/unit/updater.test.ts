import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must use vi.hoisted so mocks can reference these in the hoisted factory
const { mockAutoUpdater, mockIs, mockStoreGet, mockStoreSet } = vi.hoisted(() => {
  const { EventEmitter } = require('node:events')
  return {
    mockAutoUpdater: Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn()
    }),
    mockIs: { dev: false },
    mockStoreGet: vi.fn(),
    mockStoreSet: vi.fn()
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: mockIs
}))

vi.mock('../../src/main/store', () => ({
  initStore: () => ({
    get: (...args: unknown[]) => mockStoreGet(...args),
    set: (...args: unknown[]) => mockStoreSet(...args)
  })
}))

import { AppUpdater } from '../../src/main/updater'

beforeEach(() => {
  vi.useFakeTimers()
  mockAutoUpdater.removeAllListeners()
  mockAutoUpdater.checkForUpdates.mockReset()
  mockAutoUpdater.downloadUpdate.mockReset()
  mockAutoUpdater.quitAndInstall.mockReset()
  mockAutoUpdater.autoDownload = true
  mockAutoUpdater.autoInstallOnAppQuit = false
  mockStoreGet.mockReset()
  mockStoreSet.mockReset()
  mockIs.dev = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AppUpdater', () => {
  describe('constructor', () => {
    it('sets autoDownload=false and autoInstallOnAppQuit=true', () => {
      new AppUpdater()
      expect(mockAutoUpdater.autoDownload).toBe(false)
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
    })

    it('starts in idle state', () => {
      const updater = new AppUpdater()
      expect(updater.getState()).toBe('idle')
    })
  })

  describe('start', () => {
    it('schedules first check after 5s delay', () => {
      const updater = new AppUpdater()
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)

      updater.start()

      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5_000)
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('schedules 6h interval after initial delay', async () => {
      const updater = new AppUpdater()
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)

      updater.start()
      vi.advanceTimersByTime(5_000)
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

      // Resolve the pending check so state returns from 'checking'
      await vi.advanceTimersByTimeAsync(0)
      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })

      vi.advanceTimersByTime(6 * 60 * 60 * 1_000)
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(0)
      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })

      vi.advanceTimersByTime(6 * 60 * 60 * 1_000)
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
    })

    it('does nothing in dev mode', () => {
      mockIs.dev = true
      const updater = new AppUpdater()
      updater.start()

      vi.advanceTimersByTime(60_000)
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })
  })

  describe('checkForUpdates', () => {
    it('does nothing in dev mode', async () => {
      mockIs.dev = true
      const updater = new AppUpdater()
      await updater.checkForUpdates()
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })

    it('sets state to checking', async () => {
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)
      const updater = new AppUpdater()
      const promise = updater.checkForUpdates()
      expect(updater.getState()).toBe('checking')
      await promise
    })

    it('does not check if already checking', async () => {
      mockAutoUpdater.checkForUpdates.mockImplementation(() => new Promise(() => {}))
      const updater = new AppUpdater()
      updater.checkForUpdates()
      await updater.checkForUpdates()
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('does not check if currently downloading', async () => {
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)
      const updater = new AppUpdater()

      // Simulate downloading state via download-progress event
      mockAutoUpdater.emit('download-progress', { percent: 50, bytesPerSecond: 1000, transferred: 500, total: 1000 })
      expect(updater.getState()).toBe('downloading')

      await updater.checkForUpdates()
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })

    it('handles network errors gracefully', async () => {
      mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('Network error'))
      const updater = new AppUpdater()
      // Should not throw
      await updater.checkForUpdates()
      expect(updater.getState()).toBe('checking')
    })
  })

  describe('event forwarding to renderer', () => {
    it('forwards update-available to webContents.send()', () => {
      const mockSend = vi.fn()
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)
      mockStoreGet.mockReturnValue(null)

      mockAutoUpdater.emit('update-available', { version: '2.0.0', releaseNotes: 'New stuff' })

      expect(updater.getState()).toBe('available')
      expect(mockSend).toHaveBeenCalledWith('updater:state-changed', { state: 'available' })
      expect(mockSend).toHaveBeenCalledWith('updater:update-available', { version: '2.0.0', releaseNotes: 'New stuff' })
    })

    it('forwards update-not-available', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)

      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })

      expect(updater.getState()).toBe('not-available')
      expect(mockSend).toHaveBeenCalledWith('updater:update-not-available', {})
    })

    it('forwards download-progress', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)

      mockAutoUpdater.emit('download-progress', { percent: 42, bytesPerSecond: 1024, transferred: 420, total: 1000 })

      expect(updater.getState()).toBe('downloading')
      expect(mockSend).toHaveBeenCalledWith('updater:download-progress', {
        percent: 42,
        bytesPerSecond: 1024,
        transferred: 420,
        total: 1000
      })
    })

    it('forwards update-downloaded', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)

      mockAutoUpdater.emit('update-downloaded', { version: '2.0.0' })

      expect(updater.getState()).toBe('downloaded')
      expect(mockSend).toHaveBeenCalledWith('updater:update-downloaded', { version: '2.0.0' })
    })

    it('forwards error events', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)

      mockAutoUpdater.emit('error', new Error('Update failed'))

      expect(updater.getState()).toBe('error')
      expect(mockSend).toHaveBeenCalledWith('updater:update-error', { message: 'Update failed' })
    })

    it('does not send when no mainWindow set', () => {
      const updater = new AppUpdater()
      // Should not throw
      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })
      expect(updater.getState()).toBe('not-available')
    })

    it('does not send when window is destroyed', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => true, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)

      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('skip version suppression', () => {
    it('suppresses update-available when version matches skipped', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)
      mockStoreGet.mockReturnValue('2.0.0')

      mockAutoUpdater.emit('update-available', { version: '2.0.0', releaseNotes: '' })

      expect(updater.getState()).toBe('not-available')
      // Should not have sent update-available
      const availableCalls = mockSend.mock.calls.filter((c: unknown[]) => c[0] === 'updater:update-available')
      expect(availableCalls).toHaveLength(0)
    })

    it('does not suppress when version differs from skipped', () => {
      const mockSend = vi.fn()
      const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }

      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)
      mockStoreGet.mockReturnValue('1.9.0')

      mockAutoUpdater.emit('update-available', { version: '2.0.0', releaseNotes: '' })

      expect(updater.getState()).toBe('available')
    })

    it('skipVersion stores version in store', () => {
      const updater = new AppUpdater()
      updater.skipVersion('3.0.0')
      expect(mockStoreSet).toHaveBeenCalledWith('skipVersion', '3.0.0')
    })

    it('clearSkippedVersion sets null in store', () => {
      const updater = new AppUpdater()
      updater.clearSkippedVersion()
      expect(mockStoreSet).toHaveBeenCalledWith('skipVersion', null)
    })
  })

  describe('downloadUpdate', () => {
    it('downloads when state is available', async () => {
      mockAutoUpdater.downloadUpdate.mockResolvedValue(null)
      const updater = new AppUpdater()
      mockStoreGet.mockReturnValue(null)

      mockAutoUpdater.emit('update-available', { version: '2.0.0', releaseNotes: '' })
      expect(updater.getState()).toBe('available')

      await updater.downloadUpdate()
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled()
    })

    it('does nothing when state is not available', async () => {
      const updater = new AppUpdater()
      await updater.downloadUpdate()
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    })
  })

  describe('quitAndInstall', () => {
    it('installs when state is downloaded', () => {
      const updater = new AppUpdater()
      mockAutoUpdater.emit('update-downloaded', { version: '2.0.0' })

      updater.quitAndInstall()
      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled()
    })

    it('does nothing when state is not downloaded', () => {
      const updater = new AppUpdater()
      updater.quitAndInstall()
      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
    })
  })

  describe('stop', () => {
    it('clears timers', () => {
      const updater = new AppUpdater()
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)
      updater.start()

      updater.stop()

      vi.advanceTimersByTime(60_000)
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('cleans up timers and listeners and nulls mainWindow', () => {
      const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      const updater = new AppUpdater()
      updater.setMainWindow(mockWindow as never)
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null)
      updater.start()

      updater.destroy()

      // Timers cleared — no check after delay
      vi.advanceTimersByTime(60_000)
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()

      // Listeners removed — events should not change state
      const stateBefore = updater.getState()
      mockAutoUpdater.emit('update-not-available', { version: '1.0.0' })
      expect(updater.getState()).toBe(stateBefore)
    })
  })
})
