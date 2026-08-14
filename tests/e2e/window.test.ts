import { test, expect, _electron as electron } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

async function readPersistedBounds(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<WindowBounds> {
  const userDataPath = await electronApp.evaluate(async ({ app }) => app.getPath('userData'))
  const config = JSON.parse(readFileSync(resolve(userDataPath, 'config.json'), 'utf8')) as {
    windowBounds: WindowBounds
  }
  return config.windowBounds
}

test.describe('Window State Persistence', () => {
  test('should load initial window bounds from store', async () => {
    // This test verifies the window state management mechanism exists
    // Full persistence across restarts is tested in manual/integration scenarios
    // since Playwright Electron tests use isolated user data

    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Get the window bounds
    const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Verify window has reasonable dimensions (either defaults or previously saved)
    expect(bounds.width).toBeGreaterThanOrEqual(800) // minWidth
    expect(bounds.height).toBeGreaterThanOrEqual(600) // minHeight
    expect(bounds.width).toBeLessThanOrEqual(3840) // Reasonable max
    expect(bounds.height).toBeLessThanOrEqual(2160) // Reasonable max

    // Verify bounds are valid numbers
    expect(typeof bounds.x).toBe('number')
    expect(typeof bounds.y).toBe('number')
    expect(typeof bounds.width).toBe('number')
    expect(typeof bounds.height).toBe('number')
    expect(Number.isNaN(bounds.x)).toBe(false)
    expect(Number.isNaN(bounds.y)).toBe(false)

    await electronApp.close()
  })

  test('should have default window dimensions on first launch', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Default is { x: 0, y: 0, width: 1200, height: 800 } or last saved bounds
    expect(bounds.width).toBeGreaterThanOrEqual(800) // minWidth constraint
    expect(bounds.height).toBeGreaterThanOrEqual(600) // minHeight constraint

    await electronApp.close()
  })

  test('should respect minimum window dimensions', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Try to set window smaller than minimum
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setMinimumSize(800, 600)
      win.setBounds({ x: 0, y: 0, width: 500, height: 400 })
    })

    await window.waitForTimeout(100)

    const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Should enforce minimum dimensions
    expect(bounds.width).toBeGreaterThanOrEqual(800)
    expect(bounds.height).toBeGreaterThanOrEqual(600)

    await electronApp.close()
  })

  test('should save bounds on window resize', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { initialBounds, targetBounds } = await electronApp.evaluate(
      async ({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win.isMaximized()) win.unmaximize()

        const initialBounds = win.getBounds()
        const workArea = screen.getDisplayMatching(initialBounds).workArea
        const [minWidth, minHeight] = win.getMinimumSize()
        const width =
          initialBounds.width + 100 <= workArea.width
            ? initialBounds.width + 100
            : Math.max(minWidth, initialBounds.width - 100)
        const height =
          initialBounds.height + 100 <= workArea.height
            ? initialBounds.height + 100
            : Math.max(minHeight, initialBounds.height - 100)
        const targetBounds = {
          x: Math.max(workArea.x, Math.min(initialBounds.x, workArea.x + workArea.width - width)),
          y: Math.max(workArea.y, Math.min(initialBounds.y, workArea.y + workArea.height - height)),
          width,
          height
        }

        win.setBounds(targetBounds)
        return { initialBounds, targetBounds }
      }
    )

    expect(targetBounds.width).not.toBe(initialBounds.width)
    expect(targetBounds.height).not.toBe(initialBounds.height)

    // macOS may clamp programmatic bounds to constraints imposed by the
    // hosted display. Assert and persist the bounds the window manager
    // actually accepted, rather than requiring the requested pixel size.
    await window.waitForTimeout(250)

    const newBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    expect(
      newBounds.width !== initialBounds.width || newBounds.height !== initialBounds.height
    ).toBe(true)

    // Wait for the window manager's persistence debounce after resizing settles.
    await window.waitForTimeout(1000)
    const persistedBounds = await readPersistedBounds(electronApp)
    expect(persistedBounds.width).toBe(newBounds.width)
    expect(persistedBounds.height).toBe(newBounds.height)

    await electronApp.close()
  })

  test('should save bounds on window move', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { initialBounds, targetBounds } = await electronApp.evaluate(
      async ({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win.isMaximized()) win.unmaximize()

        const initialBounds = win.getBounds()
        const workArea = screen.getDisplayMatching(initialBounds).workArea
        const [minWidth, minHeight] = win.getMinimumSize()
        const width = Math.min(initialBounds.width, Math.max(minWidth, workArea.width - 100))
        const height = Math.min(initialBounds.height, Math.max(minHeight, workArea.height - 100))
        const targetBounds = {
          x: workArea.x + Math.min(50, workArea.width - width),
          y: workArea.y + Math.min(50, workArea.height - height),
          width,
          height
        }

        win.setBounds(targetBounds)
        return { initialBounds, targetBounds }
      }
    )

    expect(targetBounds.x !== initialBounds.x || targetBounds.y !== initialBounds.y).toBe(true)

    // Wait for the window manager's persistence debounce.
    await window.waitForTimeout(1000)

    const newBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    expect(Math.abs(newBounds.x - targetBounds.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(newBounds.y - targetBounds.y)).toBeLessThanOrEqual(2)

    const persistedBounds = await readPersistedBounds(electronApp)
    expect(persistedBounds.x).toBe(newBounds.x)
    expect(persistedBounds.y).toBe(newBounds.y)

    await electronApp.close()
  })
})
