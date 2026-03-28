import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────

// Track created mock windows for assertions
let mockWindowInstances: MockBrowserWindow[] = []
let nextWebContentsId = 1

/** Mock webContents with configurable behavior. */
function createMockWebContents(id: number) {
  return {
    id,
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    getZoomFactor: vi.fn().mockReturnValue(1.0),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
}

/** Mock BrowserWindow instance. */
class MockBrowserWindow {
  private _destroyed = false
  private _closed = false
  private eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  webContents: ReturnType<typeof createMockWebContents>

  constructor() {
    this.webContents = createMockWebContents(nextWebContentsId++)
    mockWindowInstances.push(this)
  }

  isDestroyed(): boolean {
    return this._destroyed
  }

  getBounds() {
    return { x: 0, y: 0, width: 1200, height: 800 }
  }

  show = vi.fn()

  close(): void {
    this._closed = true
    // Emit 'closed' event
    const handlers = this.eventHandlers['closed'] || []
    for (const handler of handlers) {
      handler()
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = []
    }
    this.eventHandlers[event].push(handler)
    return this
  }

  loadURL = vi.fn()
  loadFile = vi.fn()

  /** Test helper: simulate window destruction. */
  _simulateDestroy(): void {
    this._destroyed = true
  }

  /** Test helper: trigger an event. */
  _triggerEvent(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers[event] || []
    for (const handler of handlers) {
      handler(...args)
    }
  }
}

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => new MockBrowserWindow()),
  shell: {
    openExternal: vi.fn(),
  },
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

// Mock ./store
const mockStoreGet = vi.fn()
const mockStoreSet = vi.fn()
vi.mock('../../src/main/store', () => ({
  initStore: vi.fn(() => ({
    get: (...args: unknown[]) => mockStoreGet(...args),
    set: (...args: unknown[]) => mockStoreSet(...args),
  })),
  setZoomLevel: vi.fn(),
}))

import { WindowManager } from '../../src/main/window-manager'

// ── Tests ────────────────────────────────────────────────────────────────

describe('WindowManager', () => {
  let wm: WindowManager

  beforeEach(() => {
    wm = new WindowManager()
    mockWindowInstances = []
    nextWebContentsId = 1
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockStoreGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'windowBounds') return { x: 0, y: 0, width: 1200, height: 800 }
      if (key === 'zoomLevel') return 1.0
      return defaultValue
    })
  })

  describe('createWindow', () => {
    it('returns a BrowserWindow instance', () => {
      const win = wm.createWindow()
      expect(win).toBeDefined()
      expect(win.webContents).toBeDefined()
    })

    it('tracks the created window by webContents.id', () => {
      const win = wm.createWindow()
      const id = win.webContents.id
      const retrieved = wm.getWindow(id)
      expect(retrieved).toBe(win)
    })

    it('tracks multiple created windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()
      const win3 = wm.createWindow()

      const allWindows = wm.getAllWindows()
      expect(allWindows).toHaveLength(3)
      expect(allWindows).toContain(win1)
      expect(allWindows).toContain(win2)
      expect(allWindows).toContain(win3)
    })

    it('removes window from tracking when closed', () => {
      const win = wm.createWindow()
      const id = win.webContents.id

      // Simulate closing the window (triggers 'closed' event)
      win.close()

      expect(wm.getWindow(id)).toBeUndefined()
      expect(wm.getAllWindows()).toHaveLength(0)
    })

    it('reads saved window bounds from store', () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'windowBounds') return { x: 100, y: 200, width: 900, height: 700 }
        return 1.0
      })

      wm.createWindow()

      expect(mockStoreGet).toHaveBeenCalledWith('windowBounds', expect.any(Object))
    })
  })

  describe('getWindow', () => {
    it('returns the window for a valid webContents.id', () => {
      const win = wm.createWindow()
      const id = win.webContents.id
      expect(wm.getWindow(id)).toBe(win)
    })

    it('returns undefined for an unknown webContents.id', () => {
      expect(wm.getWindow(9999)).toBeUndefined()
    })

    it('returns undefined and cleans up destroyed window', () => {
      const win = wm.createWindow() as unknown as MockBrowserWindow
      const id = win.webContents.id

      // Simulate window destruction without 'closed' event
      win._simulateDestroy()

      expect(wm.getWindow(id)).toBeUndefined()
      // Subsequent call should also return undefined (stale entry cleaned up)
      expect(wm.getWindow(id)).toBeUndefined()
    })
  })

  describe('getAllWindows', () => {
    it('returns empty array when no windows exist', () => {
      expect(wm.getAllWindows()).toEqual([])
    })

    it('returns all live windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()

      const all = wm.getAllWindows()
      expect(all).toHaveLength(2)
      expect(all).toContain(win1)
      expect(all).toContain(win2)
    })

    it('filters out destroyed windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow() as unknown as MockBrowserWindow
      const win3 = wm.createWindow()

      // Destroy win2 without triggering 'closed' event
      win2._simulateDestroy()

      const all = wm.getAllWindows()
      expect(all).toHaveLength(2)
      expect(all).toContain(win1)
      expect(all).toContain(win3)
    })

    it('cleans up stale entries from tracking', () => {
      const win1 = wm.createWindow() as unknown as MockBrowserWindow
      wm.createWindow()

      // Destroy win1 silently
      win1._simulateDestroy()

      // First call cleans up
      wm.getAllWindows()

      // Second call should still work with just 1 window
      const all = wm.getAllWindows()
      expect(all).toHaveLength(1)
    })
  })

  describe('broadcastToAll', () => {
    it('sends to all non-destroyed windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()
      const win3 = wm.createWindow()

      wm.broadcastToAll('test:event', { data: 'hello' })

      expect(win1.webContents.send).toHaveBeenCalledWith('test:event', { data: 'hello' })
      expect(win2.webContents.send).toHaveBeenCalledWith('test:event', { data: 'hello' })
      expect(win3.webContents.send).toHaveBeenCalledWith('test:event', { data: 'hello' })
    })

    it('skips destroyed windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow() as unknown as MockBrowserWindow
      const win3 = wm.createWindow()

      // Destroy win2
      win2._simulateDestroy()

      wm.broadcastToAll('test:event', 'payload')

      expect(win1.webContents.send).toHaveBeenCalledWith('test:event', 'payload')
      expect(win2.webContents.send).not.toHaveBeenCalled()
      expect(win3.webContents.send).toHaveBeenCalledWith('test:event', 'payload')
    })

    it('handles send failures gracefully', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()

      // Make win1 throw on send
      ;(win1.webContents.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Window destroyed during send')
      })

      // Should not throw — errors are caught internally
      expect(() => wm.broadcastToAll('test:event', 'data')).not.toThrow()

      // win2 should still receive the message
      expect(win2.webContents.send).toHaveBeenCalledWith('test:event', 'data')
    })

    it('broadcasts with multiple arguments', () => {
      const win = wm.createWindow()

      wm.broadcastToAll('complex:event', 'arg1', 42, { key: 'value' })

      expect(win.webContents.send).toHaveBeenCalledWith('complex:event', 'arg1', 42, { key: 'value' })
    })

    it('does nothing when no windows exist', () => {
      // Should not throw when broadcasting to no windows
      expect(() => wm.broadcastToAll('test:event')).not.toThrow()
    })

    it('cleans up stale entries after broadcast', () => {
      wm.createWindow() as unknown as MockBrowserWindow
      const win2 = wm.createWindow()
      const win1 = wm.getAllWindows()[0] as unknown as MockBrowserWindow

      // Destroy win1
      win1._simulateDestroy()

      wm.broadcastToAll('test:event')

      // After broadcast, getAllWindows should only return live windows
      expect(wm.getAllWindows()).toHaveLength(1)
      expect(wm.getAllWindows()).toContain(win2)
    })
  })

  describe('closeWindow', () => {
    it('closes a tracked window by webContents.id', () => {
      const win = wm.createWindow()
      const id = win.webContents.id

      wm.closeWindow(id)

      // Window should be removed from tracking (via 'closed' event)
      expect(wm.getWindow(id)).toBeUndefined()
      expect(wm.getAllWindows()).toHaveLength(0)
    })

    it('does nothing for an unknown webContents.id', () => {
      wm.createWindow()

      // Should not throw
      expect(() => wm.closeWindow(9999)).not.toThrow()
      expect(wm.getAllWindows()).toHaveLength(1)
    })

    it('handles already-destroyed windows', () => {
      const win = wm.createWindow() as unknown as MockBrowserWindow
      const id = win.webContents.id

      // Destroy the window silently
      win._simulateDestroy()

      // Should not throw
      expect(() => wm.closeWindow(id)).not.toThrow()

      // Should be cleaned up from tracking
      expect(wm.getWindow(id)).toBeUndefined()
    })

    it('does not affect other tracked windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()
      const win3 = wm.createWindow()

      wm.closeWindow(win2.webContents.id)

      expect(wm.getAllWindows()).toHaveLength(2)
      expect(wm.getWindow(win1.webContents.id)).toBe(win1)
      expect(wm.getWindow(win3.webContents.id)).toBe(win3)
    })

    it('allows closing multiple windows sequentially', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()
      const win3 = wm.createWindow()

      wm.closeWindow(win1.webContents.id)
      expect(wm.getAllWindows()).toHaveLength(2)

      wm.closeWindow(win2.webContents.id)
      expect(wm.getAllWindows()).toHaveLength(1)

      wm.closeWindow(win3.webContents.id)
      expect(wm.getAllWindows()).toHaveLength(0)
    })
  })
})
