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
const FILE_COUNT = 1_200
const DIRECTORY_COUNT = 24

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

test.describe('Large file-tree performance', () => {
  test.skip(!cliAvailable, 'mdvdb binary or built app not available')
  test.setTimeout(60_000)

  let vaultDir: string
  let profileDir: string
  let electronApp: ElectronApplication | undefined
  let window: Page

  test.beforeAll(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-performance-vault-'))
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )

    for (let index = 0; index < FILE_COUNT; index += 1) {
      const directory = `folder-${String(index % DIRECTORY_COUNT).padStart(2, '0')}`
      const directoryPath = join(vaultDir, directory)
      mkdirSync(directoryPath, { recursive: true })
      writeFileSync(
        join(directoryPath, `note-${String(index).padStart(4, '0')}.md`),
        `# Performance fixture ${index}\n\nDeterministic large-tree content.\n`
      )
    }
  })

  test.beforeEach(async () => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-performance-profile-'))
    const now = Date.now()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          {
            id: 'performance-fixture',
            name: 'Performance Fixture',
            path: vaultDir,
            addedAt: now,
            lastOpenedAt: now
          }
        ],
        activeCollectionId: 'performance-fixture',
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
    await expect(window.locator('.file-tree-summary')).toContainText(`${FILE_COUNT} files`, {
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

  async function expandAll(): Promise<number> {
    const start = Date.now()
    await window.getByTitle('Expand All').click()
    await expect(window.locator('.tree-nodes-virtual')).toHaveAttribute(
      'style',
      new RegExp(`height: ${(FILE_COUNT + DIRECTORY_COUNT) * 28}px`)
    )
    return Date.now() - start
  }

  test('expands a 1,200-file tree within two seconds', async () => {
    expect(await expandAll()).toBeLessThan(2_000)
  })

  test('virtualizes the expanded tree instead of mounting every row', async () => {
    await expandAll()
    const renderedRows = await window.locator('.tree-row').count()

    expect(renderedRows).toBeGreaterThan(0)
    expect(renderedRows).toBeLessThan(300)
    expect(renderedRows).toBeLessThan(FILE_COUNT)
  })

  test('keeps repeated scrolling within a frame-scale budget', async () => {
    await expandAll()
    const scrollContainer = window.locator('.file-tree-content')

    const durations = await scrollContainer.evaluate(async (element) => {
      const samples: number[] = []
      for (let index = 0; index < 6; index += 1) {
        const start = performance.now()
        element.scrollTop = index * 4_000
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
        samples.push(performance.now() - start)
      }
      return samples
    })

    expect(Math.max(...durations)).toBeLessThan(200)
    await expect(window.locator('.tree-row').first()).toBeVisible()
  })

  test('survives a rapid scroll burst without mounting the full tree', async () => {
    await expandAll()
    const scrollContainer = window.locator('.file-tree-content')

    const duration = await scrollContainer.evaluate(async (element) => {
      const start = performance.now()
      for (let index = 0; index < 100; index += 1) {
        element.scrollTop = (index * 613) % element.scrollHeight
      }
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
      )
      return performance.now() - start
    })

    expect(duration).toBeLessThan(500)
    expect(await window.locator('.tree-row').count()).toBeLessThan(300)
  })

  test('expands and collapses directories without lag', async () => {
    const directories = window.locator('.tree-row.directory')
    await expect(directories).toHaveCount(DIRECTORY_COUNT)

    for (let index = 0; index < 3; index += 1) {
      const directory = directories.nth(index)
      const start = Date.now()
      await directory.click()
      await expect(directory.locator('.expand-icon')).toHaveClass(/expanded/)
      await directory.click()
      await expect(directory.locator('.expand-icon')).not.toHaveClass(/expanded/)
      expect(Date.now() - start).toBeLessThan(500)
    }
  })

  test('handles rapid keyboard navigation efficiently', async () => {
    await expandAll()
    const fileTree = window.getByRole('tree', { name: 'Collection file tree' })
    await fileTree.focus()

    const start = Date.now()
    for (let index = 0; index < 10; index += 1) await window.keyboard.press('ArrowDown')
    for (let index = 0; index < 10; index += 1) await window.keyboard.press('ArrowUp')

    expect(Date.now() - start).toBeLessThan(1_000)
    await expect(window.locator('.tree-row.focused')).toBeVisible()
  })
})
