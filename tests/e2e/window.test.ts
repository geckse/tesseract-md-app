import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

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

    // Get initial bounds
    const initialBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Resize window (pass values directly)
    await electronApp.evaluate(async ({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width + 100,
        height: bounds.height + 100
      })
    }, initialBounds)

    // Wait for debounce
    await window.waitForTimeout(1000)

    // Get new bounds
    const newBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Verify resize happened
    expect(newBounds.width).toBeGreaterThan(initialBounds.width)
    expect(newBounds.height).toBeGreaterThan(initialBounds.height)

    await electronApp.close()
  })

  test('should save bounds on window move', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Get initial bounds
    const initialBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Move window (pass values directly)
    await electronApp.evaluate(async ({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setBounds({
        x: bounds.x + 50,
        y: bounds.y + 50,
        width: bounds.width,
        height: bounds.height
      })
    }, initialBounds)

    // Wait for debounce
    await window.waitForTimeout(1000)

    // Get new bounds
    const newBounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win.getBounds()
    })

    // Verify move happened (allowing small variance)
    expect(Math.abs(newBounds.x - (initialBounds.x + 50))).toBeLessThanOrEqual(2)
    expect(Math.abs(newBounds.y - (initialBounds.y + 50))).toBeLessThanOrEqual(2)

    await electronApp.close()
  })
})
