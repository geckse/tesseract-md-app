/**
 * Dirty-close guard tests (data safety, E3).
 *
 * The WindowManager intercepts native window closes: the first close is
 * prevented and 'app:close-request' is sent to the renderer, which answers
 * via the 'app:confirm-close' IPC (→ WindowManager.confirmClose). A ~3s
 * fallback timer force-closes hung/crashed renderers that never answer;
 * the renderer's receipt ack ('app:close-ack' → clearCloseTimer) cancels it.
 *
 * Unlike window-manager.test.ts, the mock BrowserWindow here emulates the
 * real close lifecycle: close() emits a preventable 'close' event and only
 * proceeds to 'closed' when no handler called preventDefault().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockWindowInstances: MockBrowserWindow[] = []
let nextWebContentsId = 1

class MockBrowserWindow {
  private _destroyed = false
  private eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  webContents: {
    id: number
    send: ReturnType<typeof vi.fn>
    setZoomFactor: ReturnType<typeof vi.fn>
    getZoomFactor: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
  }

  constructor() {
    this.webContents = {
      id: nextWebContentsId++,
      send: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomFactor: vi.fn().mockReturnValue(1.0),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      once: vi.fn()
    }
    mockWindowInstances.push(this)
  }

  isDestroyed(): boolean {
    return this._destroyed
  }

  getBounds() {
    return { x: 0, y: 0, width: 1200, height: 800 }
  }

  show = vi.fn()
  loadURL = vi.fn().mockResolvedValue(undefined)
  loadFile = vi.fn().mockResolvedValue(undefined)

  /** Real-lifecycle close: preventable 'close', then 'closed' if allowed. */
  close(): void {
    if (this._destroyed) return
    let prevented = false
    const event = {
      preventDefault: (): void => {
        prevented = true
      }
    }
    for (const handler of this.eventHandlers['close'] ?? []) {
      handler(event)
    }
    if (!prevented) {
      this._destroyed = true
      for (const handler of this.eventHandlers['closed'] ?? []) {
        handler()
      }
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = []
    }
    this.eventHandlers[event].push(handler)
    return this
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

describe('dirty-close guard', () => {
  let wm: WindowManager

  beforeEach(() => {
    vi.useFakeTimers()
    wm = new WindowManager()
    mockWindowInstances = []
    nextWebContentsId = 1
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prevents the first close and sends app:close-request', () => {
    const win = wm.createWindow()
    const id = win.webContents.id

    win.close()

    expect(win.webContents.send).toHaveBeenCalledWith('app:close-request')
    // The window survived — close was intercepted.
    expect(win.isDestroyed()).toBe(false)
    expect(wm.getWindow(id)).toBe(win)
  })

  it('guards popup windows too', () => {
    const popup = wm.createPopupWindow({ kind: 'document' })

    popup.close()

    expect(popup.webContents.send).toHaveBeenCalledWith('app:close-request')
    expect(popup.isDestroyed()).toBe(false)
  })

  it('confirmClose closes the window for real', () => {
    const win = wm.createWindow()
    const id = win.webContents.id
    win.close() // intercepted, renderer asked

    wm.confirmClose(id)

    expect(win.isDestroyed()).toBe(true)
    expect(wm.getWindow(id)).toBeUndefined()
    // The fallback timer was cleared — advancing time must not throw or re-close.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
  })

  it('confirmClose without a pending request closes immediately (pop-back path)', () => {
    const popup = wm.createPopupWindow({ kind: 'document' })
    const id = popup.webContents.id

    wm.confirmClose(id)

    expect(popup.isDestroyed()).toBe(true)
    expect(popup.webContents.send).not.toHaveBeenCalledWith('app:close-request')
  })

  it('force-closes after ~3s when the renderer never answers (hung/crashed)', () => {
    const win = wm.createWindow()
    const id = win.webContents.id

    win.close()
    expect(win.isDestroyed()).toBe(false)

    vi.advanceTimersByTime(2_999)
    expect(win.isDestroyed()).toBe(false)

    vi.advanceTimersByTime(1)
    expect(win.isDestroyed()).toBe(true)
    expect(wm.getWindow(id)).toBeUndefined()
  })

  it('the renderer ack (clearCloseTimer) cancels the fallback — window stays on cancel', () => {
    const win = wm.createWindow()
    const id = win.webContents.id

    win.close()
    wm.clearCloseTimer(id) // preload sends app:close-ack on receipt

    vi.advanceTimersByTime(60_000)
    // User cancelled the confirm dialog → no confirmClose → window stays open.
    expect(win.isDestroyed()).toBe(false)
    expect(wm.getWindow(id)).toBe(win)
  })

  it('repeated close attempts do not stack fallback timers', () => {
    const win = wm.createWindow()
    const id = win.webContents.id

    win.close()
    win.close()
    expect(win.webContents.send).toHaveBeenCalledTimes(2)

    wm.clearCloseTimer(id)
    vi.advanceTimersByTime(60_000)
    expect(win.isDestroyed()).toBe(false)
  })

  it('a second close after an answered request starts a fresh guard cycle', () => {
    const win = wm.createWindow()
    const id = win.webContents.id

    win.close()
    wm.clearCloseTimer(id)
    vi.advanceTimersByTime(60_000)
    expect(win.isDestroyed()).toBe(false)

    // Next close attempt asks again and re-arms the fallback.
    win.close()
    expect(win.webContents.send).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(3_000)
    expect(win.isDestroyed()).toBe(true)
  })

  it('resumes application quit only after every guarded window closes', () => {
    const first = wm.createWindow()
    const second = wm.createWindow()
    const resume = vi.fn()

    wm.requestAppQuit(resume)

    expect(first.webContents.send).toHaveBeenCalledWith('app:close-request')
    expect(second.webContents.send).toHaveBeenCalledWith('app:close-request')
    expect(resume).not.toHaveBeenCalled()

    wm.confirmClose(first.webContents.id)
    expect(resume).not.toHaveBeenCalled()

    wm.confirmClose(second.webContents.id)
    expect(resume).toHaveBeenCalledOnce()
  })

  it('does not resume application quit after a renderer cancels', () => {
    const win = wm.createWindow()
    const resume = vi.fn()

    wm.requestAppQuit(resume)
    wm.cancelAppQuit()
    wm.confirmClose(win.webContents.id)

    expect(resume).not.toHaveBeenCalled()
  })
})
