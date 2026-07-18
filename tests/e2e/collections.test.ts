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

    await window.locator('.switcher-trigger').click()
    const addBtn = window.locator('.dropdown-menu').getByRole('button', { name: 'Add Collection' })
    await expect(addBtn).toBeVisible()

    await electronApp.close()
  })

  test('should show empty state when no collections exist', async () => {
    const electronApp = await electron.launch({
      args: [appPath],
      env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.getByRole('button', { name: 'Add Collection' })).toBeVisible()
    await expect(window.locator('.file-tree-section')).toHaveCount(0)

    await electronApp.close()
  })

  test('should highlight active collection with active class', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.locator('.switcher-trigger').click()
    const collectionItem = window.locator('.dropdown-item', { hasText: 'Tesseract Example' })
    await expect(collectionItem).toBeVisible()
    await expect(collectionItem).toHaveClass(/active/)

    await electronApp.close()
  })

  test('should show context menu on right-click collection', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.locator('.switcher-trigger').click({ button: 'right' })

    const contextMenu = window.locator('.context-menu')
    await expect(contextMenu).toBeVisible()
    await expect(contextMenu.getByRole('button', { name: 'Remove Collection' })).toBeVisible()

    // Dismiss by clicking overlay
    const overlay = window.locator('.context-menu-overlay')
    await overlay.click()
    await expect(contextMenu).not.toBeVisible()

    await electronApp.close()
  })

  test('truncates long submenu labels instead of wrapping them', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.locator('.switcher-trigger').click({ button: 'right' })
    const settings = window.locator('.submenu-wrapper', { hasText: 'Settings' })
    await settings.hover()

    const provider = window.getByRole('button', { name: 'Embedding Provider' })
    await expect(provider).toBeVisible()
    const label = provider.locator('.context-menu-label')
    await expect(label).toHaveCSS('white-space', 'nowrap')
    await expect(label).toHaveCSS('overflow', 'hidden')
    await expect(label).toHaveCSS('text-overflow', 'ellipsis')

    // It may fit at the normal menu width. Constrain the real item to exercise
    // the overflow branch and prove the label clips instead of wrapping.
    await label.evaluate((element) => {
      element.style.width = '40px'
      element.style.flex = '0 0 40px'
    })
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

    await electronApp.close()
  })

  test('loads collection information with the installed CLI', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.locator('.switcher-trigger').click({ button: 'right' })
    const contextMenu = window.locator('.context-menu')
    await contextMenu.getByRole('button', { name: 'Information' }).click()

    const dialog = window.getByRole('dialog', { name: 'Collection Information' })
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).not.toContainText('unrecognized subcommand')
    await expect(dialog.locator('.stat-row', { hasText: 'Markdown files' })).toContainText('8')
    await expect(dialog.locator('.stat-row', { hasText: 'Indexed' })).toContainText('8')

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).not.toBeVisible()
    await electronApp.close()
  })

  test('should display collection name and stats', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const switcher = window.locator('.switcher-trigger')
    await expect(switcher.locator('.switcher-label')).toHaveText('Tesseract Example')
    await expect(switcher.locator('.switcher-stats')).toContainText('8 docs', { timeout: 15_000 })

    await electronApp.close()
  })

  test('should expose settings at the bottom of the sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const settingsButton = window.getByRole('button', { name: 'Settings' })
    await expect(settingsButton).toBeVisible()

    await electronApp.close()
  })
})
