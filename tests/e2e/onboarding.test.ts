import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

/**
 * Reset onboarding state by clearing the electron-store value.
 * Uses electronApp.evaluate to run code in the main process.
 */
async function resetOnboarding(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ ipcMain }) => {
    // Access the store module from the main process
    const store = require('electron-store')
    const s = new store()
    s.set('onboardingComplete', false)
  })
}

/**
 * Launch app with a fresh onboarding state by using a custom userData path
 * so we get a clean electron-store.
 */
async function launchWithFreshStore(): Promise<ElectronApplication> {
  const tmpDir = resolve(__dirname, '../../out/.test-userdata-' + Date.now())
  return electron.launch({
    args: ['--user-data-dir=' + tmpDir, appPath]
  })
}

test.describe('Onboarding Flow', () => {
  test('should show onboarding wizard on first launch', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const overlay = window.locator('.onboarding-overlay')
    await expect(overlay).toBeVisible()

    const card = window.locator('.onboarding-card')
    await expect(card).toBeVisible()

    const stepDots = window.locator('.step-dots')
    await expect(stepDots).toBeVisible()

    await electronApp.close()
  })

  test('should navigate through welcome step with Get Started button', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const overlay = window.locator('.onboarding-overlay')
    await expect(overlay).toBeVisible()

    // Welcome step should have Get Started button
    const getStartedBtn = window.locator('.primary-btn', { hasText: /get started/i })
    await expect(getStartedBtn).toBeVisible()

    await getStartedBtn.click()

    // Should advance to CLI detection step
    const stepTitle = window.locator('.step-title')
    await expect(stepTitle).toContainText(/cli/i)

    await electronApp.close()
  })

  test('should allow skipping CLI install step', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Navigate past welcome
    const getStartedBtn = window.locator('.primary-btn', { hasText: /get started/i })
    await expect(getStartedBtn).toBeVisible()
    await getStartedBtn.click()

    // Should be on CLI step - find skip link
    const skipLink = window.locator('.skip-link')
    await expect(skipLink).toBeVisible()
    await skipLink.click()

    // Should advance to collection step
    const stepTitle = window.locator('.step-title')
    await expect(stepTitle).toContainText(/collection|folder/i)

    await electronApp.close()
  })

  test('should complete onboarding and show main app after skipping all steps', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Step 1: Welcome - click Get Started
    const getStartedBtn = window.locator('.primary-btn', { hasText: /get started/i })
    await expect(getStartedBtn).toBeVisible()
    await getStartedBtn.click()

    // Step 2: CLI - skip
    let skipLink = window.locator('.skip-link')
    await expect(skipLink).toBeVisible()
    await skipLink.click()

    // Step 3: Collection - skip
    skipLink = window.locator('.skip-link')
    await expect(skipLink).toBeVisible()
    await skipLink.click()

    // Onboarding overlay should be gone
    const overlay = window.locator('.onboarding-overlay')
    await expect(overlay).not.toBeVisible()

    // Main app should be visible (sidebar)
    const sidebar = window.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    await electronApp.close()
  })

  test('should not show onboarding wizard on subsequent launches', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Check if onboarding is showing - if so, complete it first
    const overlay = window.locator('.onboarding-overlay')
    const isVisible = await overlay.isVisible().catch(() => false)

    if (isVisible) {
      // Complete the wizard
      const getStartedBtn = window.locator('.primary-btn', { hasText: /get started/i })
      await getStartedBtn.click()
      const skipLink1 = window.locator('.skip-link')
      await skipLink1.click()
      const skipLink2 = window.locator('.skip-link')
      await skipLink2.click()
      await expect(overlay).not.toBeVisible()
    }

    await electronApp.close()

    // Second launch - onboarding should NOT show (persisted)
    const electronApp2 = await electron.launch({
      args: [appPath]
    })

    const window2 = await electronApp2.firstWindow()
    await window2.waitForLoadState('domcontentloaded')

    const overlay2 = window2.locator('.onboarding-overlay')
    await expect(overlay2).not.toBeVisible()

    // Main app should be visible immediately
    const sidebar = window2.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    await electronApp2.close()
  })

  test('should show step indicator dots reflecting current step', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // On welcome step, first dot should be active
    const dots = window.locator('.step-dots .dot')
    const count = await dots.count()
    expect(count).toBeGreaterThanOrEqual(3)

    const firstDot = dots.nth(0)
    await expect(firstDot).toHaveClass(/active/)

    await electronApp.close()
  })
})
