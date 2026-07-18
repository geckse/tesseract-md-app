import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

async function setNativeDialogResponse(
  electronApp: ElectronApplication,
  response: 0 | 1
): Promise<void> {
  await electronApp.evaluate(({ dialog }, nextResponse) => {
    ;(globalThis as { __settingsDialogCalls?: number }).__settingsDialogCalls = 0
    dialog.showMessageBox = (async () => {
      const state = globalThis as { __settingsDialogCalls?: number }
      state.__settingsDialogCalls = (state.__settingsDialogCalls ?? 0) + 1
      return { response: nextResponse, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

async function expectNativeDialogCalled(electronApp: ElectronApplication): Promise<void> {
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as { __settingsDialogCalls?: number }).__settingsDialogCalls ?? 0
      )
    )
    .toBe(1)
}

test.describe('Settings Panel', () => {
  test('should open settings panel when clicking gear icon in sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

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

  test('should display Global Settings in navigation', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Verify Global Settings nav item exists
    const navText = await window.locator('.settings-nav').textContent()
    expect(navText).toContain('Global Settings')

    // Verify page title
    const pageTitle = window.locator('.page-title')
    await expect(pageTitle).toContainText('Global System-Wide Settings')

    // Verify section tabs exist
    const sectionTabs = window.locator('.section-tab')
    const count = await sectionTabs.count()
    expect(count).toBeGreaterThanOrEqual(4)

    await electronApp.close()
  })

  test('should navigate between sections using section tabs', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Click on Appearance section tab
    const appearanceTab = window.locator('.section-tab', { hasText: 'Appearance' })
    await appearanceTab.click()

    // Verify it becomes active
    await expect(appearanceTab).toHaveClass(/active/)

    // Click on CLI section tab
    const cliTab = window.locator('.section-tab', { hasText: 'CLI' })
    await cliTab.click()
    await expect(cliTab).toHaveClass(/active/)

    await electronApp.close()
  })

  test('should change editor font size and verify it applies', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')
    await settingsBtn.click()

    await expect(window.locator('.settings-panel')).toBeVisible()

    // Navigate to Appearance section tab
    const appearanceTab = window.locator('.section-tab', { hasText: 'Appearance' })
    await appearanceTab.click()

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

    const settingsBtn = window.locator('.sidebar-footer-btn[title="Settings"]')

    // Open settings and change font size
    await settingsBtn.click()
    await expect(window.locator('.settings-panel')).toBeVisible()

    const appearanceTab = window.locator('.section-tab', { hasText: 'Appearance' })
    await appearanceTab.click()

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
    await window.locator('.section-tab', { hasText: 'Appearance' }).click()

    // Verify font size persisted
    const persistedSize = await fontSizeValue.textContent()
    expect(persistedSize).toBe(changedSize)

    await electronApp.close()
  })

  test('uses a native dialog before discarding unsaved settings', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.locator('.sidebar-footer-btn[title="Settings"]').click()
    await window.locator('.section-tab', { hasText: 'Embedding Provider' }).click()

    const provider = window.locator('#setting-embedding-provider')
    const original = await provider.inputValue()
    const changed = original === 'ollama' ? 'openai' : 'ollama'
    await provider.selectOption(changed)
    await expect(window.getByRole('button', { name: 'Save' })).toBeVisible()

    await setNativeDialogResponse(electronApp, 0)
    await window.getByTitle('Close settings').click()
    await expectNativeDialogCalled(electronApp)
    await expect(window.locator('.settings-panel')).toBeVisible()
    await expect(provider).toHaveValue(changed)

    await setNativeDialogResponse(electronApp, 1)
    await window.getByTitle('Close settings').click()
    await expectNativeDialogCalled(electronApp)
    await expect(window.locator('.settings-panel')).not.toBeVisible()

    await window.locator('.sidebar-footer-btn[title="Settings"]').click()
    await window.locator('.section-tab', { hasText: 'Embedding Provider' }).click()
    await expect(window.locator('#setting-embedding-provider')).toHaveValue(original)

    await electronApp.close()
  })
})
