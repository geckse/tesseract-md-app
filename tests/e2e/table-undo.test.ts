/**
 * E2E: table view undo/redo (phase: table history).
 *
 * Two flows against a seeded notes/ fixture vault:
 *  1. Cell flow — edit a frontmatter cell, Cmd+Z restores the previous value
 *     on disk and in the grid, Cmd+Shift+Z reapplies it.
 *  2. Row flow — delete a row (OS trash), Cmd+Z recreates the file verbatim.
 *
 * Uses PROFILE ISOLATION (--user-data-dir + seeded config.json) because the
 * flows MUTATE vault files. Skipped when the mdvdb binary is not on PATH.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { resolve, join } from 'path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const appPath = resolve(__dirname, '../../out/main/index.js')

function findMdvdbSync(): string {
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

const cliPath = findMdvdbSync()
const cliVersion = cliPath ? cliVersionSync(cliPath) : ''
const cliAvailable = cliPath.length > 0 && existsSync(appPath)

const UNDO_ME_CONTENT = '---\nstatus: keep\n---\n\n# undo-me\n\nRow body to restore verbatim.\n'

test.describe('Table undo/redo @table-undo', () => {
  test.skip(!cliAvailable, 'mdvdb binary or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-vault-'))

    mkdirSync(join(vaultDir, 'notes'), { recursive: true })
    writeFileSync(
      join(vaultDir, 'notes', 'a.md'),
      '---\nstatus: draft\n---\n\n# a\n\nFirst note.\n'
    )
    writeFileSync(join(vaultDir, 'notes', 'undo-me.md'), UNDO_ME_CONTENT)
    writeFileSync(
      join(vaultDir, '.env'),
      'MDVDB_EMBEDDING_PROVIDER=mock\nMDVDB_EMBEDDING_DIMENSIONS=8\n'
    )
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )

    // Deterministic index state: ingest before the app touches the vault.
    execFileSync(cliPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })

    const now = Date.now()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          { id: 'e2e-vault', name: 'E2E Vault', path: vaultDir, addedAt: now, lastOpenedAt: now }
        ],
        activeCollectionId: 'e2e-vault',
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

  /** Launch the app and open notes/ as a table. */
  async function openNotesTable() {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    const dirRow = window.locator('.tree-row', { hasText: 'notes' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await dirRow.isVisible().catch(() => false)) break
      const retry = window.getByRole('button', { name: 'Retry' })
      if (await retry.isVisible().catch(() => false)) await retry.click()
      await window.waitForTimeout(1_000)
    }
    await dirRow.hover()
    await window.getByRole('button', { name: 'Open notes as table' }).click()
    await window.waitForTimeout(1_500)
    return { electronApp, window }
  }

  test('cell flow: edit → Cmd+Z restores value on disk and in grid → Cmd+Shift+Z reapplies', async () => {
    const { electronApp, window } = await openNotesTable()
    const aPath = join(vaultDir, 'notes', 'a.md')

    // Both undo/redo start disabled — nothing recorded yet.
    await expect(window.locator('button[title^="Undo"]')).toBeDisabled()
    await expect(window.locator('button[title^="Redo"]')).toBeDisabled()

    // Edit the status cell of a.md: draft → published.
    const cell = window.locator('.data-cell', { hasText: 'draft' }).first()
    await expect(cell).toBeVisible({ timeout: 15_000 })
    await cell.dblclick()
    const input = window.locator('.cell-input')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('published')
    await input.press('Enter')

    await expect
      .poll(() => readFileSync(aPath, 'utf-8'), { timeout: 15_000 })
      .toContain('status: published')
    await expect(window.locator('button[title^="Undo"]')).toBeEnabled()

    // Cmd+Z restores the old value on disk and in the grid, and arms redo.
    await window.keyboard.press('Meta+z')
    await expect
      .poll(() => readFileSync(aPath, 'utf-8'), { timeout: 15_000 })
      .toContain('status: draft')
    await expect(window.locator('.data-cell', { hasText: 'draft' }).first()).toBeVisible({
      timeout: 10_000
    })
    await expect(window.locator('button[title^="Redo"]')).toBeEnabled()

    // Cmd+Shift+Z reapplies the edit.
    await window.keyboard.press('Meta+Shift+z')
    await expect
      .poll(() => readFileSync(aPath, 'utf-8'), { timeout: 15_000 })
      .toContain('status: published')

    await electronApp.close()
  })

  test('row flow: delete row → Cmd+Z recreates the file verbatim', async () => {
    // shell.trashItem is unreliable on headless Linux CI.
    test.skip(process.platform === 'linux', 'OS trash unavailable headless')

    const { electronApp, window } = await openNotesTable()
    const filePath = join(vaultDir, 'notes', 'undo-me.md')

    // Row delete confirms via window.confirm — auto-accept.
    window.on('dialog', (dialog) => void dialog.accept())

    const row = window.locator('.row', { hasText: 'undo-me' }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.hover()
    await row.getByRole('button', { name: 'Delete file' }).click()

    await expect.poll(() => existsSync(filePath), { timeout: 15_000 }).toBe(false)
    // The index keeps trashed files visible as read-only "gone" rows until a
    // re-index prunes them — assert the deleted state, not disappearance.
    await expect(window.locator('.row.deleted', { hasText: 'undo-me' }).first()).toBeVisible({
      timeout: 15_000
    })

    // Cmd+Z recreates the file from the pre-trash snapshot, byte-identical,
    // and the re-ingest returns the row to an editable (non-deleted) state.
    await window.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(filePath), { timeout: 15_000 }).toBe(true)
    expect(readFileSync(filePath, 'utf-8')).toBe(UNDO_ME_CONTENT)
    await expect(window.locator('.row:not(.deleted)', { hasText: 'undo-me' }).first()).toBeVisible({
      timeout: 15_000
    })

    await electronApp.close()
  })
})
