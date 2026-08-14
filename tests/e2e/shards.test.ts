import { closeElectronApp } from './support/electron-lifecycle'
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

function getCliVersion(cliPath: string): string {
  try {
    const output = execFileSync(cliPath, ['--version', '--json'], { timeout: 5_000 })
      .toString()
      .trim()
    return String(JSON.parse(output).version ?? '')
  } catch {
    return ''
  }
}

function supportsShards(cliPath: string): boolean {
  try {
    execFileSync(cliPath, ['shards', 'list', '--root', tmpdir(), '--json'], {
      timeout: 5_000
    })
    return true
  } catch {
    return false
  }
}

function supportsScopedTopics(cliPath: string): boolean {
  try {
    return execFileSync(cliPath, ['clusters', '--help'], { timeout: 5_000 })
      .toString()
      .includes('--shard')
  } catch {
    return false
  }
}

function shardCount(cliPath: string, root: string): number {
  const output = execFileSync(cliPath, ['shards', 'list', '--root', root, '--json'], {
    timeout: 5_000
  })
    .toString()
    .trim()
  return Number(JSON.parse(output).total_shards)
}

interface TopicDefinition {
  name: string
  description: string | null
}

function topicDefinitions(cliPath: string, root: string, shardId?: string): TopicDefinition[] {
  const args = ['clusters']
  if (shardId) args.push('--shard', shardId)
  args.push('list', '--root', root, '--json')
  return JSON.parse(execFileSync(cliPath, args, { timeout: 5_000 }).toString())
}

const cliPath = findCli()
const prerequisitesAvailable =
  cliPath.length > 0 &&
  existsSync(appPath) &&
  supportsShards(cliPath) &&
  supportsScopedTopics(cliPath)

test.describe('Named Shards', () => {
  test.skip(!prerequisitesAvailable, 'Shard-capable mdvdb CLI or built app not available')
  test.setTimeout(90_000)

  test('keeps nested Shard Topics independent and removes only scoped metadata', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-shard-vault-'))
    const profileDir = mkdtempSync(join(tmpdir(), 'tesseract-shard-profile-'))
    let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined

    try {
      mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
      mkdirSync(join(vaultDir, 'research', 'notes'), { recursive: true })
      writeFileSync(
        join(vaultDir, '.markdownvdb', 'config.yaml'),
        'embedding:\n  provider: mock\n  dimensions: 8\n'
      )
      writeFileSync(
        join(vaultDir, 'research', 'notes', 'inside-one.md'),
        '# Inside One\n\nA Shard fixture.\n'
      )
      writeFileSync(
        join(vaultDir, 'research', 'notes', 'inside-two.md'),
        '# Inside Two\n\nAnother Shard fixture.\n'
      )
      writeFileSync(join(vaultDir, 'outside.md'), '# Outside\n\nOutside the Shard.\n')
      execFileSync(cliPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })

      const now = Date.now()
      writeFileSync(
        join(profileDir, 'config.json'),
        JSON.stringify({
          collections: [
            {
              id: 'shard-fixture',
              name: 'Shard Fixture',
              path: vaultDir,
              addedAt: now,
              lastOpenedAt: now
            }
          ],
          activeCollectionId: 'shard-fixture',
          onboardingComplete: true,
          cliPath,
          cliVersion: getCliVersion(cliPath)
        })
      )

      electronApp = await electron.launch({
        args: [`--user-data-dir=${profileDir}`, appPath],
        env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
      })
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.locator('.switcher-label')).toHaveText('Shard Fixture', {
        timeout: 15_000
      })
      await expect(window.locator('.file-tree-summary')).toContainText('3 files', {
        timeout: 15_000
      })

      await window.locator('.switcher-trigger').click({ button: 'right' })
      await window.getByRole('button', { name: 'Create Shard…' }).click()

      const createDialog = window.getByRole('dialog', { name: 'Create Shard' })
      await expect(createDialog).toBeVisible()
      await createDialog.getByLabel('Name').fill('Research Lens')
      await createDialog.getByLabel('Folder').fill('research')
      await createDialog.getByRole('button', { name: 'Create Shard' }).click()
      await expect(createDialog).not.toBeVisible({ timeout: 15_000 })
      await expect.poll(() => shardCount(cliPath, vaultDir)).toBe(1)

      await window.locator('.switcher-trigger').click({ button: 'right' })
      await window.getByRole('button', { name: 'Create Shard…' }).click()
      const nestedDialog = window.getByRole('dialog', { name: 'Create Shard' })
      await nestedDialog.getByLabel('Name').fill('Research Notes')
      await nestedDialog.getByLabel('Folder').fill('research/notes')
      await nestedDialog.getByRole('button', { name: 'Create Shard' }).click()
      await expect(nestedDialog).not.toBeVisible({ timeout: 15_000 })
      await expect.poll(() => shardCount(cliPath, vaultDir)).toBe(2)

      await window.locator('.switcher-trigger').click()
      const parentShardRow = window.locator('.dropdown-item.shard-row', {
        hasText: 'Research Lens'
      })
      const shardRow = window.locator('.dropdown-item.shard-row', {
        hasText: 'Research Notes'
      })
      await expect(parentShardRow).toHaveAttribute('aria-level', '2')
      await expect(shardRow).toHaveAttribute('aria-level', '3')
      await shardRow.click()

      await expect(window.locator('.switcher-label')).toHaveText(
        /Shard Fixture\s*›\s*Research Notes/
      )
      await expect(window.locator('.file-tree-summary')).toContainText('2 files', {
        timeout: 15_000
      })
      await window.getByTitle('Expand All').click()
      await expect(
        window.locator('.tree-row:not(.directory)', { hasText: 'inside-one.md' })
      ).toBeVisible()
      await expect(
        window.locator('.tree-row:not(.directory)', { hasText: 'inside-two.md' })
      ).toBeVisible()
      await expect(
        window.locator('.tree-row:not(.directory)', { hasText: 'outside.md' })
      ).toHaveCount(0)

      await window.locator('.sidebar-footer-btn[title="Settings"]').click()
      const settings = window.getByRole('dialog', { name: 'Settings' })
      await settings.locator('.nav-item', { hasText: 'Shard Fixture' }).click()
      await settings.locator('.section-tab', { hasText: 'Topics' }).click()

      const topicScope = settings.getByRole('tree', { name: 'Topic scope' })
      const parentTopicScope = topicScope.getByRole('treeitem', {
        name: 'Research Lens'
      })
      const shardTopicScope = topicScope.getByRole('treeitem', {
        name: 'Research Notes'
      })
      await expect(parentTopicScope).toHaveAttribute('aria-level', '2')
      await expect(shardTopicScope).toHaveAttribute('aria-level', '3')
      await expect(shardTopicScope).toHaveAttribute('aria-selected', 'true')

      await settings.getByTitle('Add topic to Research Notes').click()
      let topicDialog = window.getByRole('dialog', { name: 'Add Topic' })
      await topicDialog.getByLabel('Name').fill('Shared Topic')
      await topicDialog.getByLabel('Description').fill('Nested Shard definition')
      await topicDialog.getByRole('button', { name: 'Add Topic' }).click()
      await expect(topicDialog).not.toBeVisible()
      await expect(settings.locator('.cluster-card')).toContainText('Nested Shard definition')

      const collectionTopicScope = topicScope.getByRole('treeitem', {
        name: 'Collection-wide Topics'
      })
      await collectionTopicScope.click()
      await expect(collectionTopicScope).toHaveAttribute('aria-selected', 'true')
      await settings.getByTitle('Add collection topic').click()
      topicDialog = window.getByRole('dialog', { name: 'Add Topic' })
      await topicDialog.getByLabel('Name').fill('Shared Topic')
      await topicDialog.getByLabel('Description').fill('Collection root definition')
      await topicDialog.getByRole('button', { name: 'Add Topic' }).click()
      await expect(topicDialog).not.toBeVisible()
      await expect(settings.locator('.cluster-card')).toContainText('Collection root definition')
      await expect(settings.locator('.cluster-card')).not.toContainText('Nested Shard definition')

      await shardTopicScope.click()
      await expect(settings.locator('.cluster-card')).toContainText('Nested Shard definition')
      await expect(settings.locator('.cluster-card')).not.toContainText(
        'Collection root definition'
      )

      expect(topicDefinitions(cliPath, vaultDir)).toEqual([
        expect.objectContaining({
          name: 'Shared Topic',
          description: 'Collection root definition'
        })
      ])
      expect(topicDefinitions(cliPath, vaultDir, 'research-notes')).toEqual([
        expect.objectContaining({
          name: 'Shared Topic',
          description: 'Nested Shard definition'
        })
      ])

      await settings.getByTitle('Close settings').click()
      await expect(settings).not.toBeVisible()

      await electronApp.evaluate(({ dialog }) => {
        ;(
          globalThis as {
            __shardRemovalConfirmation?: { title?: string; detail?: string }
          }
        ).__shardRemovalConfirmation = undefined
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const options = args[args.length - 1] as { title?: string; detail?: string }
          ;(
            globalThis as {
              __shardRemovalConfirmation?: { title?: string; detail?: string }
            }
          ).__shardRemovalConfirmation = {
            title: options.title,
            detail: options.detail
          }
          return {
            response: 1,
            checkboxChecked: false
          }
        }) as typeof dialog.showMessageBox
      })
      await window.locator('.switcher-trigger').click()
      const activeShardRow = window.locator('.dropdown-item.shard-row', {
        hasText: 'Research Notes'
      })
      await activeShardRow.click({ button: 'right' })
      await window.getByRole('button', { name: 'Remove Shard' }).click()

      await expect
        .poll(() =>
          electronApp!.evaluate(
            () =>
              (
                globalThis as {
                  __shardRemovalConfirmation?: { title?: string; detail?: string }
                }
              ).__shardRemovalConfirmation
          )
        )
        .toEqual(
          expect.objectContaining({
            title: 'Remove Shard “Research Notes”?',
            detail: expect.stringMatching(
              /local Topic definitions.*folder, files, and the shared collection index/i
            )
          })
        )
      await expect.poll(() => shardCount(cliPath, vaultDir), { timeout: 15_000 }).toBe(1)
      await expect(window.locator('.switcher-label')).toHaveText('Shard Fixture', {
        timeout: 15_000
      })
      await expect(window.locator('.file-tree-summary')).toContainText('3 files', {
        timeout: 15_000
      })
      expect(existsSync(join(vaultDir, 'research'))).toBe(true)
      expect(existsSync(join(vaultDir, 'research', 'notes'))).toBe(true)
      expect(existsSync(join(vaultDir, 'research', 'notes', 'inside-one.md'))).toBe(true)
      expect(existsSync(join(vaultDir, 'research', 'notes', 'inside-two.md'))).toBe(true)
      expect(topicDefinitions(cliPath, vaultDir)).toEqual([
        expect.objectContaining({
          name: 'Shared Topic',
          description: 'Collection root definition'
        })
      ])
    } finally {
      await closeElectronApp(electronApp).catch(() => {})
      rmSync(profileDir, { recursive: true, force: true })
      rmSync(vaultDir, { recursive: true, force: true })
    }
  })
})
