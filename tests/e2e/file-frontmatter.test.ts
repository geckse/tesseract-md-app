import { closeElectronApp } from './support/electron-lifecycle'
/**
 * E2E: File frontmatter fields and attachment tiles.
 *
 * Uses an isolated profile and vault because the flow edits frontmatter. The
 * locally-built 0.2.0 CLI is preferred so this test exercises the matching
 * schema contract even when another mdvdb version is installed globally.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { resolve, join } from 'path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const appPath = resolve(__dirname, '../../out/main/index.js')
const localCliPath = resolve(
  __dirname,
  process.platform === 'win32' ? '../../../target/debug/mdvdb.exe' : '../../../target/debug/mdvdb'
)

function findMdvdbSync(): string {
  if (existsSync(localCliPath)) return localCliPath
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    return execFileSync(whichCmd, ['mdvdb'], { timeout: 5_000 }).toString().trim().split('\n')[0]
  } catch {
    return ''
  }
}

function cliVersionSync(path: string): string {
  try {
    const stdout = execFileSync(path, ['--version', '--json'], { timeout: 10_000 }).toString()
    return String(JSON.parse(stdout.trim()).version ?? '')
  } catch {
    return ''
  }
}

function supportsFileFields(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return false
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major > 0 || minor >= 2
}

const cliPath = findMdvdbSync()
const cliVersion = cliPath ? cliVersionSync(cliPath) : ''
const cliAvailable = cliPath.length > 0 && existsSync(appPath) && supportsFileFields(cliVersion)
const NOTE_BODY = '# Item\n\nBody stays byte-identical.\n'

test.describe('File frontmatter fields @files', () => {
  test.skip(!cliAvailable, 'mdvdb >= 0.2.0 or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-file-e2e-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-file-e2e-vault-'))

    mkdirSync(join(vaultDir, 'notes'), { recursive: true })
    mkdirSync(join(vaultDir, 'assets'), { recursive: true })
    mkdirSync(join(vaultDir, 'documents'), { recursive: true })
    writeFileSync(
      join(vaultDir, 'notes', 'item.md'),
      `---\ntitle: Item\nattachments: []\n---\n\n${NOTE_BODY}`
    )
    writeFileSync(
      join(vaultDir, 'assets', 'mockup.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    writeFileSync(
      join(vaultDir, 'documents', 'spec.pdf'),
      '%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
    )
    writeFileSync(
      join(vaultDir, '.markdownvdb.schema.yml'),
      'scopes:\n  notes:\n    fields:\n      attachments:\n        field_type: file\n'
    )
    writeFileSync(
      join(vaultDir, '.env'),
      'MDVDB_EMBEDDING_PROVIDER=mock\nMDVDB_EMBEDDING_DIMENSIONS=8\n'
    )
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )
    execFileSync(cliPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })

    const now = Date.now()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          {
            id: 'file-e2e-vault',
            name: 'File E2E Vault',
            path: vaultDir,
            addedAt: now,
            lastOpenedAt: now
          }
        ],
        activeCollectionId: 'file-e2e-vault',
        onboardingComplete: true,
        cliPath,
        cliVersion
      })
    )
  })

  test.afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true })
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('adds multiple files, opens a preview, copies paths, and unlinks without deleting', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1_500)

    const dirRow = window.locator('.tree-row', { hasText: 'notes' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await dirRow.isVisible().catch(() => false)) break
      const retry = window.getByRole('button', { name: 'Retry' })
      if (await retry.isVisible().catch(() => false)) await retry.click()
      await window.waitForTimeout(1_000)
    }
    await dirRow.hover()
    await window.getByRole('button', { name: 'Open notes as table' }).click()
    await expect(window.getByRole('columnheader', { name: /attachments/i })).toBeVisible({
      timeout: 15_000
    })

    const attachmentCell = window.locator('.data-cell').first()
    await attachmentCell.dblclick()
    const picker = window.getByRole('dialog', { name: 'Select files' })
    await expect(picker).toBeVisible({ timeout: 10_000 })
    await picker.getByRole('option', { name: 'assets/mockup.png' }).click()
    await picker.getByRole('option', { name: 'documents/spec.pdf' }).click()
    await picker.getByRole('button', { name: 'Add files' }).click()

    await expect
      .poll(() => readFileSync(join(vaultDir, 'notes', 'item.md'), 'utf-8'), {
        timeout: 15_000
      })
      .toContain('attachments:\n  - "[[assets/mockup.png]]"\n  - "[[documents/spec.pdf]]"')
    const edited = readFileSync(join(vaultDir, 'notes', 'item.md'), 'utf-8')
    expect(edited).toContain(NOTE_BODY)

    const mockup = window.locator('.file-tile[title="assets/mockup.png"]')
    const spec = window.locator('.file-tile[title="documents/spec.pdf"]')
    await expect(mockup).toBeVisible({ timeout: 15_000 })
    await expect(spec).toBeVisible()

    await mockup.click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Copy Relative Path' }).dispatchEvent('mousedown')
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toBe('assets/mockup.png')

    await spec.click()
    await expect(window.getByRole('main', { name: 'Asset preview' })).toBeVisible({
      timeout: 10_000
    })
    await expect(window.locator('.tab-item', { hasText: 'spec.pdf' }).first()).toBeVisible()

    await window.locator('.tab-item', { hasText: 'notes' }).first().click()
    await expect(mockup).toBeVisible({ timeout: 10_000 })
    await mockup.click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Unlink' }).dispatchEvent('mousedown')

    await expect
      .poll(() => readFileSync(join(vaultDir, 'notes', 'item.md'), 'utf-8'), {
        timeout: 15_000
      })
      .not.toContain('[[assets/mockup.png]]')
    expect(existsSync(join(vaultDir, 'assets', 'mockup.png'))).toBe(true)
    expect(existsSync(join(vaultDir, 'documents', 'spec.pdf'))).toBe(true)

    await closeElectronApp(electronApp)
  })
})
