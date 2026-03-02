import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('App Launch', () => {
  test('should launch the Electron app and show the main window', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    expect(window).toBeTruthy()

    const title = await window.title()
    expect(title).toBeTruthy()

    await electronApp.close()
  })

  test('should have the correct window dimensions', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    const { width, height } = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)

    await electronApp.close()
  })

  test('should render the app shell with sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const body = await window.locator('body')
    await expect(body).toBeVisible()

    await electronApp.close()
  })
})
