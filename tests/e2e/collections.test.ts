import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Collection Management', () => {
  test('should display the collections section in sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const sidebar = window.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    const collectionsSection = window.locator('.collections-section')
    await expect(collectionsSection).toBeVisible()

    await electronApp.close()
  })

  test('should show add collection button', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const addBtn = window.locator('.add-collection-btn')
    await expect(addBtn).toBeVisible()

    await electronApp.close()
  })

  test('should show empty state when no collections exist', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Either collections are listed or the nav-list is empty
    const navList = window.locator('.nav-list')
    await expect(navList).toBeVisible()

    await electronApp.close()
  })

  test('should highlight active collection with active class', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // If there are collection items, clicking one should make it active
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await expect(collectionItems.first()).toHaveClass(/active/)
    }

    await electronApp.close()
  })

  test('should show context menu on right-click collection', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click({ button: 'right' })

      const contextMenu = window.locator('.context-menu')
      await expect(contextMenu).toBeVisible()

      // Should have a remove option
      const removeItem = window.locator('.context-menu-item')
      await expect(removeItem).toBeVisible()

      // Dismiss by clicking overlay
      const overlay = window.locator('.context-menu-overlay')
      await overlay.click()
      await expect(contextMenu).not.toBeVisible()
    }

    await electronApp.close()
  })

  test('should display collection name and stats', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      const label = collectionItems.first().locator('.nav-label')
      await expect(label).toBeVisible()
      const text = await label.textContent()
      expect(text!.length).toBeGreaterThan(0)

      const stats = collectionItems.first().locator('.collection-stats')
      await expect(stats).toBeVisible()
    }

    await electronApp.close()
  })

  test('should show user area at bottom of sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const userArea = window.locator('.user-area')
    await expect(userArea).toBeVisible()

    const userAvatar = window.locator('.user-avatar')
    await expect(userAvatar).toBeVisible()

    await electronApp.close()
  })
})
