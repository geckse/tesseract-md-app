import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Settings Panel', () => {
  test('should open settings panel when clicking gear icon in sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Skip onboarding if present
    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    // Click gear icon in sidebar footer
    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    // Verify settings panel opens
    const settingsPanel = window.locator('.settings-panel')
    await expect(settingsPanel).toBeVisible()

    // Verify header is present
    const settingsHeader = window.locator('.settings-header')
    await expect(settingsHeader).toBeVisible()

    await electronApp.close()
  })

  test('should display all navigation sections', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Verify navigation items exist
    const navItems = window.locator('.nav-item')
    const count = await navItems.count()
    expect(count).toBeGreaterThanOrEqual(4)

    // Check expected section names
    const navText = await window.locator('.settings-nav').textContent()
    expect(navText).toContain('CLI')
    expect(navText).toContain('Appearance')

    await electronApp.close()
  })

  test('should navigate between sections', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Click on Appearance nav item
    const appearanceNav = window.locator('.nav-item', { hasText: 'Appearance' })
    await appearanceNav.click()

    // Verify it becomes active
    await expect(appearanceNav).toHaveClass(/active/)

    // Click on CLI nav item
    const cliNav = window.locator('.nav-item', { hasText: 'CLI' })
    await cliNav.click()
    await expect(cliNav).toHaveClass(/active/)

    await electronApp.close()
  })

  test('should change editor font size and verify it applies', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Navigate to Appearance section
    const appearanceNav = window.locator('.nav-item', { hasText: 'Appearance' })
    await appearanceNav.click()

    // Get initial font size
    const fontSizeValue = window.locator('.font-size-value')
    const initialSize = await fontSizeValue.textContent()

    // Click increase button (the + button)
    const increaseBtns = window.locator('.font-btn')
    // The increase button is typically the second one
    const increaseBtn = increaseBtns.last()
    await increaseBtn.click()

    // Verify font size changed
    const newSize = await fontSizeValue.textContent()
    expect(newSize).not.toBe(initialSize)

    await electronApp.close()
  })

  test('should close settings and return to editor', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    // Open settings
    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    const settingsPanel = window.locator('.settings-panel')
    await expect(settingsPanel).toBeVisible()

    // Close settings via the close button in header
    const closeBtn = window.locator('.settings-header button')
    await closeBtn.click()

    // Verify settings panel is gone
    await expect(settingsPanel).not.toBeVisible()

    await electronApp.close()
  })

  test('should persist changed values when reopening settings', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const skipLink = window.locator('.skip-link')
    if (await skipLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipLink.click()
    }

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')

    // Open settings and change font size
    await settingsBtn.click()
    await expect(window.locator('.settings-panel')).toBeVisible()

    const appearanceNav = window.locator('.nav-item', { hasText: 'Appearance' })
    await appearanceNav.click()

    const fontSizeValue = window.locator('.font-size-value')
    const initialSize = await fontSizeValue.textContent()

    // Increase font size
    const increaseBtn = window.locator('.font-btn').last()
    await increaseBtn.click()
    const changedSize = await fontSizeValue.textContent()
    expect(changedSize).not.toBe(initialSize)

    // Close settings
    const closeBtn = window.locator('.settings-header button')
    await closeBtn.click()
    await expect(window.locator('.settings-panel')).not.toBeVisible()

    // Reopen settings
    await settingsBtn.click()
    await expect(window.locator('.settings-panel')).toBeVisible()

    // Navigate back to Appearance
    await window.locator('.nav-item', { hasText: 'Appearance' }).click()

    // Verify font size persisted
    const persistedSize = await fontSizeValue.textContent()
    expect(persistedSize).toBe(changedSize)

    await electronApp.close()
  })
})
