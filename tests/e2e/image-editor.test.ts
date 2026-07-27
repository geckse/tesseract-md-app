import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const appPath = resolve(__dirname, '../../out/main/index.js')

function findMdvdb(): string {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which'
    return execFileSync(command, ['mdvdb'], { timeout: 5_000 }).toString().trim().split('\n')[0]
  } catch {
    return ''
  }
}

function cliVersion(cliPath: string): string {
  try {
    const output = execFileSync(cliPath, ['--version', '--json'], { timeout: 10_000 })
      .toString()
      .trim()
    return String(JSON.parse(output).version ?? '')
  } catch {
    return ''
  }
}

const mdvdbPath = findMdvdb()
const canRun = Boolean(mdvdbPath && existsSync(appPath))

test.describe('Image editor overwrite flow', () => {
  test.skip(!canRun, 'mdvdb binary or built app not available')
  test.setTimeout(90_000)

  let profileDir: string
  let vaultDir: string
  let imagePath: string
  let electronApp: ElectronApplication | undefined

  test.beforeEach(async () => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-image-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-image-vault-'))
    imagePath = join(vaultDir, 'assets', 'sample.png')
    mkdirSync(join(vaultDir, 'assets'), { recursive: true })
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )
    writeFileSync(join(vaultDir, 'readme.md'), '# Image editor fixture\n')
    await sharp({
      create: { width: 64, height: 48, channels: 4, background: '#00e5ff' }
    })
      .png()
      .toFile(imagePath)
    execFileSync(mdvdbPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })

    const now = Date.now()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          {
            id: 'image-fixture',
            name: 'Image Fixture',
            path: vaultDir,
            addedAt: now,
            lastOpenedAt: now
          }
        ],
        activeCollectionId: 'image-fixture',
        onboardingComplete: true,
        cliPath: mdvdbPath,
        cliVersion: cliVersion(mdvdbPath)
      })
    )
  })

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = (async () => ({
            response: 1,
            checkboxChecked: false
          })) as typeof dialog.showMessageBox
        })
        .catch(() => {})
      await electronApp.close().catch(() => {})
    }
    electronApp = undefined
    rmSync(profileDir, { recursive: true, force: true })
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('rotates, crops, resizes and confirms the original overwrite', async () => {
    const launchEnv = { ...process.env }
    delete launchEnv['ELECTRON_RUN_AS_NODE']
    electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath],
      env: launchEnv
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.getByRole('tree', { name: 'Collection file tree' })).toBeVisible({
      timeout: 15_000
    })
    const assetsFolder = window.locator('.tree-row.directory', { hasText: 'assets' })
    await expect(assetsFolder).toBeVisible({ timeout: 15_000 })
    await assetsFolder.click()
    const imageRow = window.locator('.tree-row:not(.directory)', { hasText: 'sample.png' })
    await expect(imageRow).toBeVisible({ timeout: 15_000 })
    await imageRow.click()

    await expect(window.getByText('64 × 48')).toBeVisible({ timeout: 15_000 })
    await window.getByTitle('Rotate right 90°').click()
    await window.getByRole('button', { name: /Crop/ }).click()
    await window.getByRole('button', { name: '1:1' }).click()
    await window.getByRole('button', { name: 'Apply Crop' }).click()

    await window.getByRole('button', { name: /Resize/ }).click()
    await window.getByRole('spinbutton', { name: 'Width' }).fill('32')
    await expect(window.getByRole('spinbutton', { name: 'Height' })).toHaveValue('32')
    await window.getByRole('button', { name: 'Apply Resize' }).click()
    await expect(window.getByText('32 × 32')).toBeVisible()

    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    await window.getByRole('button', { name: /Save/ }).click()

    await expect(window.getByText('Image saved')).toBeVisible({ timeout: 30_000 })
    await expect(window.locator('.dirty-indicator')).toHaveCount(0)
    await expect(window.getByRole('button', { name: /Save/ })).toBeDisabled()
    await expect
      .poll(async () => {
        const metadata = await sharp(imagePath).metadata()
        return [metadata.width, metadata.height]
      })
      .toEqual([32, 32])
  })
})
