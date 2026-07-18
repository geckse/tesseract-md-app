import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve, join } from 'path'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const appPath = resolve(__dirname, '../../out/main/index.js')
const onboardingEnv = {
  ...process.env,
  TESSERACT_E2E_AUTO_COMPLETE_ONBOARDING: '0',
  TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0'
}

/**
 * Launch app with a fresh onboarding state by using a custom userData path
 * so we get a clean electron-store.
 */
const profileDirs: string[] = []

function freshProfile(): string {
  const profileDir = mkdtempSync(join(tmpdir(), 'tesseract-onboarding-e2e-'))
  profileDirs.push(profileDir)
  return profileDir
}

async function launchWithFreshStore(): Promise<ElectronApplication> {
  const tmpDir = freshProfile()
  return electron.launch({
    args: ['--user-data-dir=' + tmpDir, appPath],
    env: onboardingEnv
  })
}

async function advancePastCli(page: Page): Promise<void> {
  const actions = page.locator('.forward-actions')
  await expect(actions).toContainText(/Skip for now|Continue/, { timeout: 10_000 })

  const skip = actions.getByRole('button', { name: /^Skip for now$/ })
  if (await skip.isVisible().catch(() => false)) {
    await skip.click()
  } else {
    await actions.getByRole('button', { name: /^Continue$/ }).click()
  }
}

test.afterEach(() => {
  for (const profileDir of profileDirs.splice(0)) {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

test.describe('Onboarding Flow', () => {
  test('should show onboarding wizard on first launch', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const overlay = window.locator('.onboarding-overlay')
    await expect(overlay).toBeVisible()

    const card = window.locator('.onboarding-card')
    await expect(card).toBeVisible()

    await expect(window.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    await expect(window.locator('.step-nav [aria-current="step"]')).toContainText('Welcome')
    await expect(window.getByRole('heading', { name: /Your knowledge/i })).toBeFocused()

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

  test('loads the bundled Space Grotesk font instead of a serif fallback', async () => {
    const electronApp = await launchWithFreshStore()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const fontState = await window.locator('.onboarding-overlay').evaluate(async (overlay) => {
      await document.fonts.ready
      return {
        family: getComputedStyle(overlay).fontFamily,
        loaded: document.fonts.check('400 16px "Space Grotesk Variable"', 'Tesseract')
      }
    })

    expect(fontState.family).toContain('Space Grotesk Variable')
    expect(fontState.family).not.toMatch(/(^|,\s*)serif(?:,|$)/i)
    expect(fontState.loaded).toBe(true)

    await electronApp.close()
  })

  test('should advance through the detected CLI state', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Navigate past welcome
    const getStartedBtn = window.locator('.primary-btn', { hasText: /get started/i })
    await expect(getStartedBtn).toBeVisible()
    await getStartedBtn.click()

    await advancePastCli(window)

    // Should advance to provider step
    const stepTitle = window.locator('.step-title')
    await expect(stepTitle).toContainText(/embedding provider/i)

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

    // Step 2: CLI - continue when installed, otherwise skip installation
    await advancePastCli(window)

    // Step 3: Provider - skip
    await window.getByRole('button', { name: /skip for now/i }).click()

    // Step 4: Collection - skip
    await window.locator('.skip-link', { hasText: /^Skip$/ }).click()

    // Onboarding overlay should be gone
    const overlay = window.locator('.onboarding-overlay')
    await expect(overlay).not.toBeVisible()

    // Main app should be visible (sidebar)
    const sidebar = window.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    await electronApp.close()
  })

  test('should not show onboarding wizard on subsequent launches', async () => {
    const profileDir = freshProfile()
    const electronApp = await electron.launch({
      args: ['--user-data-dir=' + profileDir, appPath],
      env: onboardingEnv
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
      await advancePastCli(window)
      await window.getByRole('button', { name: /skip for now/i }).click()
      await window.locator('.skip-link', { hasText: /^Skip$/ }).click()
      await expect(overlay).not.toBeVisible()
    }

    await electronApp.close()

    // Second launch - onboarding should NOT show (persisted)
    const electronApp2 = await electron.launch({
      args: ['--user-data-dir=' + profileDir, appPath],
      env: onboardingEnv
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

  test('should expose the current step in the semantic progress rail', async () => {
    const electronApp = await launchWithFreshStore()

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const progress = window.locator('.step-nav')
    await expect(progress.locator('li')).toHaveCount(4)
    await expect(progress.locator('[aria-current="step"]')).toContainText('Welcome')

    await window.getByRole('button', { name: /get started/i }).click()
    await expect(progress.locator('[aria-current="step"]')).toContainText('CLI')
    await expect(progress.locator('li').first()).toHaveClass(/complete/)

    await electronApp.close()
  })

  test('should create and open the guided example collection', async () => {
    const electronApp = await launchWithFreshStore()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('button', { name: /get started/i }).click()
    await advancePastCli(window)
    await window.getByRole('button', { name: /^Skip for now$/ }).click()
    await window.getByRole('button', { name: /Explore Example Collection/i }).click()

    await expect(window.locator('.onboarding-overlay')).not.toBeVisible()
    await expect(window.locator('.sidebar')).toContainText('Tesseract Example')

    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const examplePath = join(userData, 'Tesseract Example')
    expect(existsSync(join(examplePath, '.tesseract-example.json'))).toBe(true)
    expect(readFileSync(join(examplePath, 'Start Here.md'), 'utf8')).toContain(
      '[[Guides/Search by meaning|Search by meaning]]'
    )
    expect(
      readFileSync(join(examplePath, 'Guides', 'Properties and table views.md'), 'utf8')
    ).toContain('published: true')

    await electronApp.close()
  })
})
