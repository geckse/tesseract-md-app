import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { openExampleFile, waitForExampleCollection } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')

async function openProperties(page: Page) {
  const panel = page.locator('.properties-panel')
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTitle('Toggle Properties').click()
  }
  await expect(panel).toBeVisible()
  return panel
}

async function favoriteCurrentFile(page: Page) {
  const panel = await openProperties(page)
  const star = panel.getByTitle('Add to favorites')
  await expect(star).toBeVisible()
  await star.click()
  await expect(panel.getByTitle('Remove from favorites')).toBeVisible()
}

test.describe('Favorites and native recents', () => {
  test('keeps empty favorites and obsolete sidebar recents out of the way', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await waitForExampleCollection(window)

    await expect(window.locator('.favorites-section')).toHaveCount(0)
    await expect(window.locator('.recents-section')).toHaveCount(0)

    await electronApp.close()
  })

  test('favorites an open guide and renders its real collection details', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await favoriteCurrentFile(window)

    const section = window.locator('.favorites-section')
    const item = section.locator('.favorite-item')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Favorites' })).toBeVisible()
    await expect(item).toHaveCount(1)
    await expect(item.locator('.nav-label')).toHaveText('Start Here.md')
    await expect(item.locator('.favorite-collection')).toHaveText('Tesseract Example')
    await expect(item.locator('.nav-icon')).toHaveText('description')

    await electronApp.close()
  })

  test('opens a favorited guide from the sidebar', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await favoriteCurrentFile(window)
    await openExampleFile(window, 'Search by meaning.md')
    await expect(window.getByRole('heading', { name: 'Search by meaning' })).toBeVisible()

    await window.locator('.favorite-item', { hasText: 'Start Here.md' }).click()
    await expect(window.getByRole('heading', { name: 'Welcome to Tesseract' })).toBeVisible()

    await electronApp.close()
  })

  test('adds and removes a favorite from the file context menu', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await waitForExampleCollection(window)
    const row = window.locator('.tree-row:not(.directory)', { hasText: 'Start Here.md' }).first()
    await expect(row).toBeVisible()

    await row.click({ button: 'right' })
    await window.getByRole('button', { name: 'Add to Favorites' }).click()
    await expect(window.locator('.favorite-item', { hasText: 'Start Here.md' })).toBeVisible()

    await row.click({ button: 'right' })
    await window.getByRole('button', { name: 'Remove from Favorites' }).click()
    await expect(window.locator('.favorites-section')).toHaveCount(0)

    await electronApp.close()
  })

  test('tracks, opens, and clears files through the native recent menu', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await openExampleFile(window, 'Search by meaning.md')

    await expect
      .poll(() =>
        electronApp.evaluate(({ Menu }) => {
          const menu = Menu.getApplicationMenu()
          return [
            menu?.getMenuItemById('file.open-recent.0')?.label ?? '',
            menu?.getMenuItemById('file.open-recent.1')?.label ?? ''
          ]
        })
      )
      .toEqual(['Search by meaning.md — Tesseract Example', 'Start Here.md — Tesseract Example'])

    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('file.open-recent.1')?.click()
    })
    await expect(window.getByRole('heading', { name: 'Welcome to Tesseract' })).toBeVisible()

    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('file.clear-recents')?.click()
    })
    await expect
      .poll(() =>
        electronApp.evaluate(({ Menu }) => ({
          firstRecentExists: Boolean(
            Menu.getApplicationMenu()?.getMenuItemById('file.open-recent.0')
          ),
          clearEnabled:
            Menu.getApplicationMenu()?.getMenuItemById('file.clear-recents')?.enabled ?? true
        }))
      )
      .toEqual({ firstRecentExists: false, clearEnabled: false })

    await electronApp.close()
  })
})
