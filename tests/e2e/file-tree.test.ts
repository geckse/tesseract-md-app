import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appPath = resolve(__dirname, '../../out/main/index.js')

function findMdvdb(): string {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which'
    return execFileSync(command, ['mdvdb'], { timeout: 5_000 }).toString().trim().split('\n')[0]
  } catch {
    return ''
  }
}

function getCliVersion(cliPath: string): string {
  try {
    const output = execFileSync(cliPath, ['--version', '--json'], { timeout: 10_000 })
      .toString()
      .trim()
    return String(JSON.parse(output).version ?? '')
  } catch {
    return ''
  }
}

const cliPath = findMdvdb()
const cliVersion = cliPath ? getCliVersion(cliPath) : ''
const cliAvailable = cliPath.length > 0 && existsSync(appPath)

test.describe('File Tree Navigation — empty collection state', () => {
  test('shows the no-file editor state when no collection is selected', async () => {
    const electronApp = await electron.launch({
      args: [appPath],
      env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
    })
    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.getByRole('main', { name: 'No file open' })).toBeVisible()
      await expect(window.locator('.file-tree-section')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})

test.describe('File Tree Navigation — indexed collection', () => {
  test.skip(!cliAvailable, 'mdvdb binary or built app not available')
  test.setTimeout(60_000)

  let vaultDir: string
  let profileDir: string
  let electronApp: ElectronApplication | undefined
  let window: Page

  test.beforeAll(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-tree-vault-'))
    mkdirSync(join(vaultDir, 'notes'), { recursive: true })
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )
    writeFileSync(
      join(vaultDir, 'notes', 'first.md'),
      '---\nstatus: ready\n---\n\n# First fixture note\n\nA deterministic file-tree fixture.\n'
    )
    writeFileSync(
      join(vaultDir, 'notes', 'second.md'),
      '# Second fixture note\n\nUsed to verify multiple files.\n'
    )
    writeFileSync(join(vaultDir, 'root.md'), '# Root fixture note\n')
    execFileSync(cliPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })
  })

  test.beforeEach(async () => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-tree-profile-'))
    const now = Date.now()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          {
            id: 'tree-fixture',
            name: 'Tree Fixture',
            path: vaultDir,
            addedAt: now,
            lastOpenedAt: now
          }
        ],
        activeCollectionId: 'tree-fixture',
        onboardingComplete: true,
        cliPath,
        cliVersion
      })
    )

    electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.getByRole('tree', { name: 'Collection file tree' })).toBeVisible({
      timeout: 15_000
    })
  })

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
    electronApp = undefined
    rmSync(profileDir, { recursive: true, force: true })
  })

  test.afterAll(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('displays the file tree and its actions', async () => {
    await expect(window.getByRole('heading', { name: 'Files' })).toBeVisible()
    await expect(window.getByTitle('Collapse All')).toBeVisible()
    await expect(window.getByTitle('Expand All')).toBeVisible()
    await expect(window.getByTitle('Refresh')).toBeVisible()
  })

  test('expands and collapses a directory', async () => {
    const directory = window.locator('.tree-row.directory', { hasText: 'notes' })
    await expect(directory).toBeVisible({ timeout: 15_000 })

    await directory.click()
    await expect(directory.locator('.expand-icon')).toHaveClass(/expanded/)
    await expect(window.locator('.tree-row:not(.directory)', { hasText: 'first.md' })).toBeVisible()

    await directory.click()
    await expect(directory.locator('.expand-icon')).not.toHaveClass(/expanded/)
  })

  test('highlights the selected file', async () => {
    const rootFile = window.locator('.tree-row:not(.directory)', { hasText: 'root.md' })
    await expect(rootFile).toBeVisible({ timeout: 15_000 })
    await rootFile.click()
    await expect(rootFile).toHaveClass(/active/)
  })

  test('shows indexed file-state indicators and an exact summary', async () => {
    await expect(window.locator('.file-tree-summary')).toContainText('3 files')
    await window.getByTitle('Expand All').click()
    await expect(window.locator('.state-indicator')).toHaveCount(3)
  })

  test('updates the document breadcrumb after selecting a nested file', async () => {
    const directory = window.locator('.tree-row.directory', { hasText: 'notes' })
    await directory.click()
    await window.locator('.tree-row:not(.directory)', { hasText: 'first.md' }).click()

    const breadcrumb = window.getByRole('navigation', { name: 'Folder path' })
    await expect(breadcrumb).toBeVisible({ timeout: 15_000 })
    await expect(breadcrumb).toContainText('notes')
    await expect(window.locator('.fne-name')).toHaveText('first')
  })
})
