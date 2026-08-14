import { expect, test, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const appPath = resolve(__dirname, '../../out/main/index.js')
const whichCommand = process.platform === 'win32' ? 'where' : 'which'
// Chromium no longer falls back to software WebGL automatically. Opt this
// trusted, headless Linux test into SwiftShader without changing production
// launch behavior.
const softwareWebGlArgs =
  process.platform === 'linux'
    ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']
    : []

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
    mkdirSync(dirname(join(root, filename)), { recursive: true })
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
    mkdirSync(dirname(join(root, filename)), { recursive: true })
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
        args: [...softwareWebGlArgs, `--user-data-dir=${profile}`, appPath],
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
        args: [...softwareWebGlArgs, `--user-data-dir=${profile}`, appPath],
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
        args: [...softwareWebGlArgs, `--user-data-dir=${profile}`, appPath],
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

  test('shows and highlights a nested folder hierarchy without hiding document links', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'tesseract-folder-graph-profile-'))
    const vault = mkdtempSync(join(tmpdir(), 'tesseract-folder-graph-vault-'))

    try {
      createIndexedVault(
        vault,
        [
          'readme.md',
          'departments/marketing/campaign.md',
          'departments/marketing/strategy.md',
          'departments/sales/deals.md'
        ],
        cliPath
      )
      writeFileSync(
        join(vault, 'departments/marketing/campaign.md'),
        '# Campaign\n\nSee the [strategy](strategy.md).\n'
      )
      execFileSync(cliPath, ['ingest', '--root', vault], { timeout: 60_000 })

      const now = Date.now()
      writeFileSync(
        join(profile, 'config.json'),
        JSON.stringify({
          collections: [
            {
              id: 'hierarchy',
              name: 'Hierarchy Vault',
              path: vault,
              addedAt: now,
              lastOpenedAt: now
            }
          ],
          activeCollectionId: 'hierarchy',
          onboardingComplete: true,
          cliPath,
          cliVersion: cliVersion(cliPath)
        })
      )

      const electronApp = await electron.launch({
        args: [...softwareWebGlArgs, `--user-data-dir=${profile}`, appPath],
        env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
      })
      const window = await electronApp.firstWindow()
      const shaderErrors: string[] = []
      window.on('console', (message) => {
        const text = message.text()
        if (/Shader Error|VALIDATE_STATUS false|WebGLProgram/i.test(text)) {
          shaderErrors.push(text)
        }
      })
      await window.waitForLoadState('domcontentloaded')
      await window.getByRole('tab', { name: 'Graph' }).click()
      await expect(window.locator('.graph-view-mode-trigger')).toBeVisible({ timeout: 15_000 })

      await window.locator('.graph-view-mode-trigger').click()
      await window.getByRole('menuitemcheckbox', { name: /Folders/ }).click()

      const graph = window.getByRole('img', {
        name: 'Knowledge graph with 4 content nodes and 4 folder hubs'
      })
      await expect(graph).toBeVisible({ timeout: 15_000 })
      await expect(graph).toHaveAttribute('data-hierarchy-link-count', '7')
      await expect(graph).toHaveAttribute('data-content-link-count', /^[1-9]\d*$/)

      const nestedFolder = window.locator(
        '.folder-proximity-label[data-folder-path="departments/marketing"]'
      )
      await expect(nestedFolder).toContainText('marketing', { timeout: 15_000 })
      await expect(nestedFolder).toContainText('2')
      // Folder labels track the live force simulation and can move between
      // Playwright's actionability check and pointer dispatch on slower CI
      // runners. Invoke the real button activation without freezing layout.
      await nestedFolder.evaluate((element: HTMLButtonElement) => element.click())
      await expect(window.locator('.folder-badge-text')).toHaveText('departments/marketing')
      await nestedFolder.evaluate((element: HTMLButtonElement) => element.click())
      await expect(window.locator('.folder-badge-text')).toHaveCount(0)
      expect(shaderErrors).toEqual([])

      await electronApp.close()
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(vault, { recursive: true, force: true })
    }
  })
})
