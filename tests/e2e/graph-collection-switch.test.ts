import { expect, test, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appPath = resolve(__dirname, '../../out/main/index.js')
const whichCommand = process.platform === 'win32' ? 'where' : 'which'

function findCli(): string {
  try {
    return execFileSync(whichCommand, ['mdvdb'], { timeout: 5_000 })
      .toString()
      .trim()
      .split('\n')[0]
  } catch {
    return ''
  }
}

function cliVersion(cliPath: string): string {
  const output = execFileSync(cliPath, ['--version', '--json'], { timeout: 5_000 }).toString()
  return String(JSON.parse(output).version ?? '')
}

function createIndexedVault(root: string, filenames: string[], cliPath: string): void {
  mkdirSync(join(root, '.markdownvdb'), { recursive: true })
  writeFileSync(
    join(root, '.markdownvdb', 'config.yaml'),
    'embedding:\n  provider: mock\n  dimensions: 8\n'
  )
  for (const [index, filename] of filenames.entries()) {
    writeFileSync(join(root, filename), `# ${filename}\n\nIndexed document ${index + 1}.\n`)
  }
  execFileSync(cliPath, ['ingest', '--root', root], { timeout: 60_000 })
}

function createUnindexedVault(root: string, filenames: string[]): void {
  mkdirSync(join(root, '.markdownvdb'), { recursive: true })
  writeFileSync(
    join(root, '.markdownvdb', 'config.yaml'),
    'embedding:\n  provider: mock\n  dimensions: 8\n'
  )
  for (const [index, filename] of filenames.entries()) {
    writeFileSync(join(root, filename), `# ${filename}\n\nFresh document ${index + 1}.\n`)
  }
}

test.describe('Graph collection switching', () => {
  const cliPath = findCli()
  test.skip(!cliPath || !existsSync(appPath), 'mdvdb CLI or built app not available')
  test.setTimeout(60_000)

  test('keeps Graph active and reloads nodes from the newly selected collection', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'tesseract-graph-switch-profile-'))
    const firstVault = mkdtempSync(join(tmpdir(), 'tesseract-graph-switch-first-'))
    const secondVault = mkdtempSync(join(tmpdir(), 'tesseract-graph-switch-second-'))

    try {
      createIndexedVault(firstVault, ['alpha.md', 'beta.md'], cliPath)
      createIndexedVault(secondVault, ['one.md', 'two.md', 'three.md'], cliPath)

      const now = Date.now()
      writeFileSync(
        join(profile, 'config.json'),
        JSON.stringify({
          collections: [
            {
              id: 'first',
              name: 'First Vault',
              path: firstVault,
              addedAt: now,
              lastOpenedAt: now
            },
            {
              id: 'second',
              name: 'Second Vault',
              path: secondVault,
              addedAt: now,
              lastOpenedAt: now
            }
          ],
          activeCollectionId: 'first',
          onboardingComplete: true,
          cliPath,
          cliVersion: cliVersion(cliPath)
        })
      )

      const electronApp = await electron.launch({
        args: [`--user-data-dir=${profile}`, appPath],
        env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
      })
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.locator('.switcher-label')).toHaveText('First Vault', {
        timeout: 15_000
      })
      await window.getByRole('tab', { name: 'Graph' }).click()
      await expect(window.getByRole('img', { name: 'Knowledge graph with 2 nodes' })).toBeVisible({
        timeout: 15_000
      })

      await window.locator('.switcher-trigger').click()
      await window.locator('.dropdown-item', { hasText: 'Second Vault' }).click()

      await expect(window.locator('.switcher-label')).toHaveText('Second Vault')
      await expect(window.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await expect(window.getByRole('img', { name: 'Knowledge graph with 3 nodes' })).toBeVisible({
        timeout: 15_000
      })
      await expect(
        window.getByText('No files indexed. Run ingest to build the graph.')
      ).toHaveCount(0)

      await electronApp.close()
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(firstVault, { recursive: true, force: true })
      rmSync(secondVault, { recursive: true, force: true })
    }
  })

  test('reloads the sidebar when a favorite switches to another collection', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'tesseract-favorite-switch-profile-'))
    const firstVault = mkdtempSync(join(tmpdir(), 'tesseract-favorite-switch-first-'))
    const secondVault = mkdtempSync(join(tmpdir(), 'tesseract-favorite-switch-second-'))

    try {
      createIndexedVault(firstVault, ['favorite.md'], cliPath)
      createIndexedVault(secondVault, ['other-one.md', 'other-two.md'], cliPath)

      const now = Date.now()
      writeFileSync(
        join(profile, 'config.json'),
        JSON.stringify({
          collections: [
            {
              id: 'first',
              name: 'First Vault',
              path: firstVault,
              addedAt: now,
              lastOpenedAt: now
            },
            {
              id: 'second',
              name: 'Second Vault',
              path: secondVault,
              addedAt: now,
              lastOpenedAt: now
            }
          ],
          activeCollectionId: 'second',
          favorites: [{ collectionId: 'first', filePath: 'favorite.md', addedAt: now }],
          onboardingComplete: true,
          cliPath,
          cliVersion: cliVersion(cliPath)
        })
      )

      const electronApp = await electron.launch({
        args: [`--user-data-dir=${profile}`, appPath],
        env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
      })
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.locator('.switcher-label')).toHaveText('Second Vault', {
        timeout: 15_000
      })
      await expect(window.locator('.file-tree-summary')).toContainText('2 files', {
        timeout: 15_000
      })

      await window.locator('.favorite-item', { hasText: 'favorite.md' }).click()

      await expect(window.locator('.switcher-label')).toHaveText('First Vault')
      await expect(window.locator('.file-tree-summary')).toContainText('1 files', {
        timeout: 15_000
      })
      await expect(
        window.locator('.tree-row:not(.directory)', { hasText: 'favorite.md' }).first()
      ).toBeVisible()
      await expect(window.getByRole('heading', { name: 'favorite.md' })).toBeVisible({
        timeout: 15_000
      })

      await electronApp.close()
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(firstVault, { recursive: true, force: true })
      rmSync(secondVault, { recursive: true, force: true })
    }
  })

  test('loads Graph after the first full reindex of a fresh collection', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'tesseract-first-index-profile-'))
    const vault = mkdtempSync(join(tmpdir(), 'tesseract-first-index-vault-'))

    try {
      createUnindexedVault(vault, ['fresh-one.md', 'fresh-two.md'])
      const now = Date.now()
      writeFileSync(
        join(profile, 'config.json'),
        JSON.stringify({
          collections: [
            {
              id: 'fresh',
              name: 'Fresh Vault',
              path: vault,
              addedAt: now,
              lastOpenedAt: now
            }
          ],
          activeCollectionId: 'fresh',
          onboardingComplete: true,
          cliPath,
          cliVersion: cliVersion(cliPath)
        })
      )

      const electronApp = await electron.launch({
        args: [`--user-data-dir=${profile}`, appPath],
        env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
      })
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.locator('.switcher-label')).toHaveText('Fresh Vault', {
        timeout: 15_000
      })
      await window.getByRole('tab', { name: 'Graph' }).click()
      await expect(
        window.getByText('No files indexed. Run ingest to build the graph.')
      ).toBeVisible({ timeout: 15_000 })

      await electronApp.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('collection.reindex')?.click()
      })
      await expect(window.getByRole('heading', { name: 'Indexing Complete' })).toBeVisible({
        timeout: 60_000
      })
      await window.getByRole('button', { name: 'Done' }).click()

      await expect(window.getByRole('img', { name: 'Knowledge graph with 2 nodes' })).toBeVisible({
        timeout: 15_000
      })
      await expect(
        window.getByText('No files indexed. Run ingest to build the graph.')
      ).toHaveCount(0)

      await electronApp.close()
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(vault, { recursive: true, force: true })
    }
  })
})
