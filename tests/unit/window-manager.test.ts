import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────

// Track created mock windows for assertions
let mockWindowInstances: MockBrowserWindow[] = []
let nextWebContentsId = 1
let nextLoadFailure: Error | null = null

/** Mock webContents with configurable behavior. */
function createMockWebContents(id: number) {
  return {
    id,
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    getZoomFactor: vi.fn().mockReturnValue(1.0),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn()
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
  focus = vi.fn()
  restore = vi.fn()
  isMinimized = vi.fn().mockReturnValue(false)
  setTitleBarOverlay = vi.fn()

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

  loadURL = vi.fn().mockResolvedValue(undefined)
  loadFile = vi.fn(() =>
    nextLoadFailure ? Promise.reject(nextLoadFailure) : Promise.resolve(undefined)
  )

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
const mockNativeTheme = vi.hoisted(() => ({ shouldUseDarkColors: true }))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => new MockBrowserWindow()),
  nativeTheme: mockNativeTheme,
  shell: {
    openExternal: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

// Mock ./store
const mockStoreGet = vi.fn()
const mockStoreSet = vi.fn()
const mockGetActiveCollection = vi.fn()
vi.mock('../../src/main/store', () => ({
  initStore: vi.fn(() => ({
    get: (...args: unknown[]) => mockStoreGet(...args),
    set: (...args: unknown[]) => mockStoreSet(...args)
  })),
  getActiveCollection: (...args: unknown[]) => mockGetActiveCollection(...args),
  setZoomLevel: vi.fn()
}))

import { BrowserWindow } from 'electron'
import { WindowManager } from '../../src/main/window-manager'

// ── Tests ────────────────────────────────────────────────────────────────

describe('WindowManager', () => {
  let wm: WindowManager

  beforeEach(() => {
    wm = new WindowManager()
    mockWindowInstances = []
    nextWebContentsId = 1
    nextLoadFailure = null
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockGetActiveCollection.mockReset().mockReturnValue(null)
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

    it('loads and tracks a requested collection for a new window', () => {
      const win = wm.createWindow({ collectionId: 'work notes' }) as unknown as MockBrowserWindow

      expect(win.loadFile).toHaveBeenCalledWith(expect.any(String), {
        search: 'collectionId=work+notes'
      })
      expect(wm.getWindowCollectionId(win.webContents.id)).toBe('work notes')

      wm.setWindowCollectionId(win.webContents.id, 'personal')
      expect(wm.getWindowCollectionId(win.webContents.id)).toBe('personal')
    })

    it('removes window from tracking when closed', () => {
      const win = wm.createWindow()
      const id = win.webContents.id

      // Simulate closing the window (triggers 'closed' event)
      win.close()

      expect(wm.getWindow(id)).toBeUndefined()
      expect(wm.getWindowCollectionId(id)).toBeUndefined()
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

    it('reports renderer load failures without creating an unhandled rejection', async () => {
      const loadError = new Error('renderer missing')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      nextLoadFailure = loadError

      expect(() => wm.createWindow()).not.toThrow()
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to load the Tesseract renderer:',
          loadError
        )
      })

      consoleError.mockRestore()
    })
  })

  describe('window background color', () => {
    function lastBrowserWindowOptions(): { backgroundColor: string } {
      const calls = vi.mocked(BrowserWindow).mock.calls
      return calls[calls.length - 1][0] as unknown as { backgroundColor: string }
    }

    function setThemeMode(mode: string | undefined) {
      mockStoreGet.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'windowBounds') return { x: 0, y: 0, width: 1200, height: 800 }
        if (key === 'zoomLevel') return 1.0
        if (key === 'themeMode') return mode ?? defaultValue
        return defaultValue
      })
    }

    it('paints dark for themeMode=dark', () => {
      setThemeMode('dark')
      wm.createWindow()
      expect(lastBrowserWindowOptions().backgroundColor).toBe('#0f0f10')
    })

    it('paints the light --color-bg for themeMode=light', () => {
      setThemeMode('light')
      wm.createWindow()
      expect(lastBrowserWindowOptions().backgroundColor).toBe('#e9e9e9')
    })

    it('follows the OS for themeMode=auto (dark OS)', () => {
      setThemeMode('auto')
      mockNativeTheme.shouldUseDarkColors = true
      wm.createWindow()
      expect(lastBrowserWindowOptions().backgroundColor).toBe('#0f0f10')
    })

    it('follows the OS for themeMode=auto (light OS)', () => {
      setThemeMode('auto')
      mockNativeTheme.shouldUseDarkColors = false
      wm.createWindow()
      expect(lastBrowserWindowOptions().backgroundColor).toBe('#e9e9e9')
    })

    it('popup windows use the same theme-aware background', () => {
      setThemeMode('light')
      wm.createPopupWindow({ kind: 'document' })
      expect(lastBrowserWindowOptions().backgroundColor).toBe('#e9e9e9')
    })

    it('passes graph Shard and descendant path context to popup renderers', () => {
      const popup = wm.createPopupWindow({
        kind: 'graph',
        collectionId: 'work',
        collectionPath: '/vault',
        graphLevel: 'chunk',
        graphColoringMode: 'folder',
        shardId: 'research',
        graphPathFilter: 'work/research/papers'
      }) as unknown as MockBrowserWindow

      expect(popup.loadFile).toHaveBeenCalledWith(expect.any(String), {
        search: expect.stringContaining('shardId=research')
      })
      const search = popup.loadFile.mock.calls[0][1]?.search as string
      expect(search).toContain('graphPathFilter=work%2Fresearch%2Fpapers')
      expect(search).toContain('graphLevel=chunk')
    })
  })

  describe('platform titlebar options', () => {
    /** Run `fn` with process.platform stubbed to `platform`. */
    function withPlatform(platform: string, fn: () => void): void {
      const original = process.platform
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      try {
        fn()
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true })
      }
    }

    function lastBrowserWindowOptions(): Record<string, unknown> {
      const calls = vi.mocked(BrowserWindow).mock.calls
      return calls[calls.length - 1][0] as unknown as Record<string, unknown>
    }

    it('darwin keeps inset traffic lights and no overlay', () => {
      withPlatform('darwin', () => {
        wm.createWindow()
        const opts = lastBrowserWindowOptions()
        expect(opts.titleBarStyle).toBe('hiddenInset')
        expect(opts.titleBarOverlay).toBeUndefined()
      })
    })

    it('win32 gets a hidden titlebar with a 35px Window Controls Overlay', () => {
      withPlatform('win32', () => {
        wm.createWindow()
        const opts = lastBrowserWindowOptions()
        expect(opts.titleBarStyle).toBe('hidden')
        expect(opts.titleBarOverlay).toEqual({
          color: '#0f0f10',
          symbolColor: '#e4e4e7',
          height: 35
        })
      })
    })

    it('linux gets the same overlay treatment as win32', () => {
      withPlatform('linux', () => {
        wm.createWindow()
        const opts = lastBrowserWindowOptions()
        expect(opts.titleBarStyle).toBe('hidden')
        expect(opts.titleBarOverlay).toMatchObject({ height: 35 })
      })
    })

    it('popup windows get a 28px overlay on win32', () => {
      withPlatform('win32', () => {
        wm.createPopupWindow({ kind: 'document' })
        const opts = lastBrowserWindowOptions()
        expect(opts.titleBarStyle).toBe('hidden')
        expect(opts.titleBarOverlay).toMatchObject({ height: 28 })
      })
    })

    it('popup windows keep hiddenInset on darwin', () => {
      withPlatform('darwin', () => {
        wm.createPopupWindow({ kind: 'document' })
        const opts = lastBrowserWindowOptions()
        expect(opts.titleBarStyle).toBe('hiddenInset')
        expect(opts.titleBarOverlay).toBeUndefined()
      })
    })

    it('overlay colors follow the light theme', () => {
      mockStoreGet.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'windowBounds') return { x: 0, y: 0, width: 1200, height: 800 }
        if (key === 'zoomLevel') return 1.0
        if (key === 'themeMode') return 'light'
        return defaultValue
      })
      withPlatform('win32', () => {
        wm.createWindow()
        expect(lastBrowserWindowOptions().titleBarOverlay).toEqual({
          color: '#e9e9e9',
          symbolColor: '#1a1a1a',
          height: 35
        })
      })
    })

    describe('updateTitleBarOverlay', () => {
      it('re-colors every live window on win32', () => {
        withPlatform('win32', () => {
          const a = wm.createWindow() as unknown as MockBrowserWindow
          const b = wm.createPopupWindow({ kind: 'document' }) as unknown as MockBrowserWindow

          wm.updateTitleBarOverlay()

          expect(a.setTitleBarOverlay).toHaveBeenCalledWith({
            color: '#0f0f10',
            symbolColor: '#e4e4e7'
          })
          expect(b.setTitleBarOverlay).toHaveBeenCalledWith({
            color: '#0f0f10',
            symbolColor: '#e4e4e7'
          })
        })
      })

      it('is a no-op on darwin', () => {
        withPlatform('darwin', () => {
          const win = wm.createWindow() as unknown as MockBrowserWindow
          wm.updateTitleBarOverlay()
          expect(win.setTitleBarOverlay).not.toHaveBeenCalled()
        })
      })

      it('skips windows lacking setTitleBarOverlay and errors from it', () => {
        withPlatform('linux', () => {
          const a = wm.createWindow() as unknown as MockBrowserWindow
          const b = wm.createWindow() as unknown as MockBrowserWindow
          delete (a as unknown as Record<string, unknown>).setTitleBarOverlay
          b.setTitleBarOverlay.mockImplementation(() => {
            throw new Error('no overlay on this window')
          })

          expect(() => wm.updateTitleBarOverlay()).not.toThrow()
          expect(b.setTitleBarOverlay).toHaveBeenCalled()
        })
      })
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

  describe('external dropped-file grants', () => {
    it('binds an opaque exact-file capability to its owning renderer', () => {
      const owner = wm.createWindow()
      const other = wm.createWindow()

      const grantId = wm.grantExternalFile(owner.webContents.id, '/outside/photo.png')

      expect(grantId).toMatch(/^[0-9a-f-]{36}$/)
      expect(wm.getExternalFilePath(owner.webContents.id, grantId)).toBe('/outside/photo.png')
      expect(wm.getExternalFilePath(other.webContents.id, grantId)).toBeUndefined()
    })

    it('deduplicates the same normalized path within one window', () => {
      const owner = wm.createWindow()

      const first = wm.grantExternalFile(owner.webContents.id, '/outside/notes/../report.md')
      const second = wm.grantExternalFile(owner.webContents.id, '/outside/report.md')

      expect(second).toBe(first)
    })

    it('allows an owner to release one grant without affecting another', () => {
      const owner = wm.createWindow()
      const first = wm.grantExternalFile(owner.webContents.id, '/outside/one.md')
      const second = wm.grantExternalFile(owner.webContents.id, '/outside/two.md')

      expect(wm.releaseExternalFile(owner.webContents.id, first)).toBe(true)
      expect(wm.getExternalFilePath(owner.webContents.id, first)).toBeUndefined()
      expect(wm.getExternalFilePath(owner.webContents.id, second)).toBe('/outside/two.md')
      expect(wm.releaseExternalFile(owner.webContents.id, first)).toBe(false)
    })

    it('cleans every grant when its window closes or becomes stale', () => {
      const closed = wm.createWindow() as unknown as MockBrowserWindow
      const closedGrant = wm.grantExternalFile(closed.webContents.id, '/outside/closed.md')
      closed.close()
      expect(wm.getExternalFilePath(closed.webContents.id, closedGrant)).toBeUndefined()

      const stale = wm.createWindow() as unknown as MockBrowserWindow
      const staleGrant = wm.grantExternalFile(stale.webContents.id, '/outside/stale.md')
      stale._simulateDestroy()
      wm.getAllWindows()
      expect(wm.getExternalFilePath(stale.webContents.id, staleGrant)).toBeUndefined()
    })

    it('refuses to grant a file to an unknown renderer', () => {
      expect(() => wm.grantExternalFile(9999, '/outside/secret.md')).toThrow(/requesting window/)
    })
  })

  describe('OS-opened Markdown documents', () => {
    function triggerDidFinishLoad(win: MockBrowserWindow): void {
      const registration = win.webContents.on.mock.calls.find(
        ([event]) => event === 'did-finish-load'
      )
      expect(registration).toBeDefined()
      ;(registration?.[1] as () => void)()
    }

    it('creates a standalone editor without exposing its absolute path in the URL', () => {
      const win = wm.createStandaloneWindow(
        '/outside/private-note.md'
      ) as unknown as MockBrowserWindow
      const options = vi.mocked(BrowserWindow).mock.calls.at(-1)?.[0] as unknown as {
        width: number
        height: number
        minWidth: number
        minHeight: number
      }
      const search = win.loadFile.mock.calls[0][1]?.search as string

      expect(options).toMatchObject({ width: 960, height: 720, minWidth: 640, minHeight: 480 })
      expect(search).toContain('mode=standalone')
      expect(search).toContain('kind=document')
      expect(search).not.toContain('private-note')
      expect(wm.getStandaloneFilePath(win.webContents.id)).toBe('/outside/private-note.md')
      expect(wm.isStandalone(win.webContents.id)).toBe(true)
      expect(wm.isPopup(win.webContents.id)).toBe(true)
      expect(wm.getPrimaryWindowId()).toBeNull()
    })

    it('blocks a standalone renderer from navigating away with its file capability', () => {
      const win = wm.createStandaloneWindow(
        '/outside/private-note.md'
      ) as unknown as MockBrowserWindow
      const registration = win.webContents.on.mock.calls.find(
        ([event]) => event === 'will-navigate'
      )
      const navigationEvent = { preventDefault: vi.fn() }

      expect(registration).toBeDefined()
      ;(registration?.[1] as (event: typeof navigationEvent) => void)(navigationEvent)

      expect(navigationEvent.preventDefault).toHaveBeenCalledOnce()
    })

    it('focuses the existing standalone window when the same file is reopened', () => {
      const first = wm.createStandaloneWindow('/outside/reused.md') as unknown as MockBrowserWindow
      first.isMinimized.mockReturnValue(true)

      const second = wm.createStandaloneWindow('/outside/reused.md')

      expect(second).toBe(first)
      expect(mockWindowInstances).toHaveLength(1)
      expect(first.restore).toHaveBeenCalled()
      expect(first.show).toHaveBeenCalled()
      expect(first.focus).toHaveBeenCalled()
    })

    it('drops the exact-file capability when its standalone window closes', () => {
      const win = wm.createStandaloneWindow('/outside/closed.md') as unknown as MockBrowserWindow
      const id = win.webContents.id

      win.close()

      expect(wm.getStandaloneFilePath(id)).toBeUndefined()
      expect(wm.isStandalone(id)).toBe(false)
    })

    it('queues collection documents until a new full renderer is loaded', () => {
      const first = wm.openCollectionDocument(
        'work',
        'notes/one.md'
      ) as unknown as MockBrowserWindow
      const second = wm.openCollectionDocument('work', 'notes/two.md')

      expect(second).toBe(first)
      expect(mockWindowInstances).toHaveLength(1)
      expect(wm.isPopup(first.webContents.id)).toBe(false)
      expect(first.webContents.send).not.toHaveBeenCalledWith('menu:open-recent', expect.anything())

      triggerDidFinishLoad(first)

      expect(first.webContents.send).toHaveBeenNthCalledWith(1, 'menu:open-recent', {
        collectionId: 'work',
        filePath: 'notes/one.md'
      })
      expect(first.webContents.send).toHaveBeenNthCalledWith(2, 'menu:open-recent', {
        collectionId: 'work',
        filePath: 'notes/two.md'
      })
    })

    it('immediately opens and focuses a document in an already-loaded collection window', () => {
      const win = wm.createWindow({ collectionId: 'work' }) as unknown as MockBrowserWindow
      triggerDidFinishLoad(win)
      win.webContents.send.mockClear()

      const reused = wm.openCollectionDocument('work', 'notes/ready.md')

      expect(reused).toBe(win)
      expect(win.webContents.send).toHaveBeenCalledWith('menu:open-recent', {
        collectionId: 'work',
        filePath: 'notes/ready.md'
      })
      expect(win.show).toHaveBeenCalled()
      expect(win.focus).toHaveBeenCalled()
    })

    it('reuses a normal window that started on the persisted active collection', () => {
      mockGetActiveCollection.mockReturnValue({ id: 'work' })
      const win = wm.createWindow() as unknown as MockBrowserWindow
      triggerDidFinishLoad(win)
      win.webContents.send.mockClear()

      const reused = wm.openCollectionDocument('work', 'notes/ready.md')

      expect(reused).toBe(win)
      expect(mockWindowInstances).toHaveLength(1)
      expect(win.webContents.send).toHaveBeenCalledWith('menu:open-recent', {
        collectionId: 'work',
        filePath: 'notes/ready.md'
      })
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

      expect(win.webContents.send).toHaveBeenCalledWith('complex:event', 'arg1', 42, {
        key: 'value'
      })
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
  describe('primary window (session-persistence owner)', () => {
    it('the first main window is primary', () => {
      const a = wm.createWindow()
      const b = wm.createWindow()
      expect(wm.isPrimary(a.webContents.id)).toBe(true)
      expect(wm.isPrimary(b.webContents.id)).toBe(false)
    })

    it('promotes the oldest remaining window when the primary closes', () => {
      const a = wm.createWindow()
      const b = wm.createWindow()
      const c = wm.createWindow()
      a.close()
      expect(wm.isPrimary(b.webContents.id)).toBe(true)
      expect(wm.isPrimary(c.webContents.id)).toBe(false)
    })

    it('popup windows are never primary', () => {
      const popup = wm.createPopupWindow({ kind: 'graph' })
      const main = wm.createWindow()
      expect(wm.isPrimary(popup.webContents.id)).toBe(false)
      expect(wm.isPrimary(main.webContents.id)).toBe(true)
    })

    it('has no primary when no main windows exist', () => {
      expect(wm.getPrimaryWindowId()).toBeNull()
      const popup = wm.createPopupWindow({ kind: 'graph' })
      void popup
      expect(wm.getPrimaryWindowId()).toBeNull()
    })
  })
})
