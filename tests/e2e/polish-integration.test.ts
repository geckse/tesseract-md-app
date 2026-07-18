import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { waitForExampleCollection } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Desktop polish', () => {
  test('actually disables animated sidebar transitions for reduced-motion users', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await window.waitForLoadState('domcontentloaded')
    await waitForExampleCollection(window)

    const switcher = window.locator('.switcher-trigger')
    await expect(switcher).toBeVisible()
    expect(
      await switcher.evaluate((element) => ({
        matchesPreference: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionDuration: getComputedStyle(element).transitionDuration
      }))
    ).toEqual({ matchesPreference: true, transitionDuration: '0s' })

    await electronApp.close()
  })
})
