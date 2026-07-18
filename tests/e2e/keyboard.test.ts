import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { openExampleFile, waitForExampleCollection } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function launch() {
  const electronApp = await electron.launch({ args: [appPath] })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await waitForExampleCollection(window)
  return { electronApp, window }
}

async function expectFocused(page: Page, selector: string) {
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluate((element) =>
          Boolean(element === document.activeElement || element.contains(document.activeElement))
        )
    )
    .toBe(true)
}

test.describe('Keyboard navigation', () => {
  test('Cmd/Ctrl+K focuses database search', async () => {
    const { electronApp, window } = await launch()
    const input = window.getByRole('textbox', { name: 'Search database' })

    await window.keyboard.press(`${modifier}+k`)
    await expect(input).toBeFocused()

    await electronApp.close()
  })

  test('Cmd/Ctrl+O opens Quick Open and keyboard-selects a real file', async () => {
    const { electronApp, window } = await launch()

    await window.keyboard.press(`${modifier}+o`)
    const dialog = window.getByRole('dialog', { name: 'Quick Open' })
    const input = dialog.getByPlaceholder('Search files...')
    await expect(dialog).toBeVisible()
    await expect(input).toBeFocused()

    await input.fill('Search by meaning')
    await expect(dialog.locator('.result-item').first()).toContainText('Search by meaning.md')
    await window.keyboard.press('Enter')

    await expect(dialog).not.toBeVisible()
    await expect(window.getByRole('heading', { name: 'Search by meaning' })).toBeVisible()

    await electronApp.close()
  })

  test('reserves Cmd/Ctrl+B for editing and uses the native sidebar accelerator', async () => {
    const { electronApp, window } = await launch()
    const sidebar = window.locator('.sidebar-region')
    await expect(sidebar).toBeVisible()

    const shortcut = await electronApp.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('view.toggle-sidebar')
      return {
        accelerator: item?.accelerator,
        registerAccelerator: item?.registerAccelerator
      }
    })
    expect(shortcut.accelerator).toContain('Alt')
    expect(shortcut.accelerator).toMatch(/B$/)
    expect(shortcut.registerAccelerator).toBe(true)

    await window.keyboard.press(`${modifier}+b`)
    await expect(sidebar).toBeVisible()

    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('view.toggle-sidebar')?.click()
    })
    await expect(sidebar).not.toBeVisible()
    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('view.toggle-sidebar')?.click()
    })
    await expect(sidebar).toBeVisible()

    await electronApp.close()
  })

  test('Cmd/Ctrl+Shift+B toggles the Properties panel both ways', async () => {
    const { electronApp, window } = await launch()
    await openExampleFile(window)

    const properties = window.locator('.properties-region')
    const initiallyVisible = await properties.isVisible().catch(() => false)
    await window.keyboard.press(`${modifier}+Shift+b`)

    if (initiallyVisible) {
      await expect(properties).not.toBeVisible()
    } else {
      await expect(properties).toBeVisible()
    }

    await window.keyboard.press(`${modifier}+Shift+b`)
    if (initiallyVisible) {
      await expect(properties).toBeVisible()
    } else {
      await expect(properties).not.toBeVisible()
    }

    await electronApp.close()
  })

  test('Tab and Shift+Tab cycle through the main regions', async () => {
    const { electronApp, window } = await launch()
    await openExampleFile(window)

    const properties = window.locator('.properties-region')
    if (!(await properties.isVisible().catch(() => false))) {
      await window.getByTitle('Toggle Properties').click()
    }
    await expect(properties).toBeVisible()

    await window.locator('.sidebar-region').focus()
    await window.keyboard.press('Tab')
    await expectFocused(window, '#main-content')
    await window.keyboard.press('Tab')
    await expectFocused(window, '.properties-region')
    await window.keyboard.press('Shift+Tab')
    await expectFocused(window, '#main-content')

    await electronApp.close()
  })

  test('Cmd/Ctrl+E changes editor mode without inventing unsaved changes', async () => {
    const { electronApp, window } = await launch()
    await openExampleFile(window)
    const dirty = window.locator('.dirty-dot')
    await expect(dirty).not.toBeVisible()

    await window.keyboard.press(`${modifier}+e`)
    await expect(window.getByRole('main', { name: 'Raw editor' })).toBeVisible()
    await expect(dirty).not.toBeVisible()

    await window.keyboard.press(`${modifier}+e`)
    await expect(window.getByRole('main', { name: 'Editor' })).toBeVisible()
    await expect(dirty).not.toBeVisible()

    await electronApp.close()
  })
})
