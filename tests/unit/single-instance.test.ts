/**
 * Single-instance focus tests (data safety, E3).
 *
 * main/index.ts takes app.requestSingleInstanceLock() and quits second
 * launches; the running instance handles 'second-instance' by calling
 * WindowManager.focusPrimaryWindow() — restore if minimized, show, focus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextWebContentsId = 1

class MockBrowserWindow {
  private _destroyed = false
  private eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  webContents = {
    id: nextWebContentsId++,
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    getZoomFactor: vi.fn().mockReturnValue(1.0),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    once: vi.fn()
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
  loadURL = vi.fn().mockResolvedValue(undefined)
  loadFile = vi.fn().mockResolvedValue(undefined)

  close(): void {
    this._destroyed = true
    for (const handler of this.eventHandlers['closed'] ?? []) {
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

  /** Test helper: simulate window destruction without the 'closed' event. */
  _simulateDestroy(): void {
    this._destroyed = true
  }
}

const mockNativeTheme = vi.hoisted(() => ({ shouldUseDarkColors: true }))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => new MockBrowserWindow()),
  nativeTheme: mockNativeTheme,
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('../../src/main/store', () => ({
  initStore: vi.fn(() => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
    set: vi.fn()
  })),
  setZoomLevel: vi.fn()
}))

import { WindowManager } from '../../src/main/window-manager'

describe('focusPrimaryWindow (second-instance handler)', () => {
  let wm: WindowManager

  beforeEach(() => {
    wm = new WindowManager()
    nextWebContentsId = 1
  })

  it('shows and focuses the primary window', () => {
    const win = wm.createWindow() as unknown as MockBrowserWindow

    wm.focusPrimaryWindow()

    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.restore).not.toHaveBeenCalled()
  })

  it('restores a minimized primary window before focusing', () => {
    const win = wm.createWindow() as unknown as MockBrowserWindow
    win.isMinimized.mockReturnValue(true)

    wm.focusPrimaryWindow()

    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('targets the primary (oldest main window), not popups or newer windows', () => {
    const popup = wm.createPopupWindow({ kind: 'document' }) as unknown as MockBrowserWindow
    const primary = wm.createWindow() as unknown as MockBrowserWindow
    const newer = wm.createWindow() as unknown as MockBrowserWindow

    wm.focusPrimaryWindow()

    expect(primary.focus).toHaveBeenCalled()
    expect(popup.focus).not.toHaveBeenCalled()
    expect(newer.focus).not.toHaveBeenCalled()
  })

  it('falls back to the next live window when the primary is destroyed', () => {
    const a = wm.createWindow() as unknown as MockBrowserWindow
    const b = wm.createWindow() as unknown as MockBrowserWindow
    a._simulateDestroy()

    wm.focusPrimaryWindow()

    expect(a.focus).not.toHaveBeenCalled()
    expect(b.show).toHaveBeenCalled()
    expect(b.focus).toHaveBeenCalled()
  })

  it('falls back to a popup when no main window exists', () => {
    const popup = wm.createPopupWindow({ kind: 'document' }) as unknown as MockBrowserWindow

    wm.focusPrimaryWindow()

    expect(popup.show).toHaveBeenCalled()
    expect(popup.focus).toHaveBeenCalled()
  })

  it('is a no-op when no windows exist', () => {
    expect(() => wm.focusPrimaryWindow()).not.toThrow()
  })
})
