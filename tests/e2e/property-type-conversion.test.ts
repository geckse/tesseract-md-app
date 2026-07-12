/**
 * E2E: phase-41 property type conversion.
 *
 * Uses PROFILE ISOLATION (--user-data-dir + seeded config.json) because this
 * feature MUTATES vault files — it must never run against the real profile.
 * Skipped when the mdvdb binary is not on PATH.
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

const cliPath = findMdvdbSync()
const cliAvailable = cliPath.length > 0 && existsSync(appPath)

/**
 * Open a file in the seeded vault's file tree. The very first `tree` CLI call
 * can lose a startup race against the freshly-spawned `mdvdb watch` process
 * (index file appears mid-flight) — the sidebar then shows a Retry button, so
 * retry until the tree renders.
 */
async function openVaultFile(
  window: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>,
  dirName: string,
  fileStem: string
): Promise<void> {
  const dirRow = window.locator('.tree-row', { hasText: dirName }).first()
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await dirRow.isVisible().catch(() => false)) break
    const retry = window.getByRole('button', { name: 'Retry' })
    if (await retry.isVisible().catch(() => false)) await retry.click()
    await window.waitForTimeout(1_000)
  }
  await dirRow.click()
  const fileRow = window.locator('.tree-row', { hasText: fileStem }).first()
  await fileRow.waitFor({ state: 'visible', timeout: 10_000 })
  await fileRow.click()
  await window.waitForTimeout(1_500)
}

test.describe('Property type conversion (phase 41)', () => {
  test.skip(!cliAvailable, 'mdvdb binary or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-vault-'))
    mkdirSync(join(vaultDir, 'notes'), { recursive: true })
    writeFileSync(
      join(vaultDir, 'notes', 'alpha.md'),
      '---\ntitle: Alpha\npriority: "3"\n---\n\n# Alpha\nBody stays byte-identical.\n'
    )
    writeFileSync(
      join(vaultDir, 'notes', 'beta.md'),
      '---\ntitle: Beta\npriority: "12"\n---\n\n# Beta\n'
    )
    writeFileSync(
      join(vaultDir, 'notes', 'gamma.md'),
      '---\ntitle: Gamma\npriority: not-a-number\n---\n\n# Gamma\n'
    )

    const now = Date.now()
    const cliVersion = execFileSync(cliPath, ['--version'], { timeout: 10_000 })
      .toString()
      .trim()
      .split(/\s+/)
      .pop()
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

  test('converts a property to Number across the folder, skips bad values, pins the overlay', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    // Open notes/alpha.md from the file tree.
    await openVaultFile(window, 'notes', 'alpha')

    // The property panel shows the priority row with a clickable type icon.
    const typeBtn = window.getByRole('button', { name: 'Change type of priority' })
    await expect(typeBtn).toBeVisible({ timeout: 10_000 })
    await typeBtn.click()

    // Pick Number from the type picker (complex/JSON must be absent).
    const picker = window.getByRole('listbox', { name: 'Select property type' })
    await expect(picker).toBeVisible()
    await expect(picker.getByText('JSON')).toHaveCount(0)
    await picker.getByRole('option', { name: 'Number' }).dispatchEvent('mousedown')

    // The conversion modal previews the folder database.
    const dialog = window.getByRole('dialog', { name: 'Change type of priority' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText(/2 files convert/)).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText(/1 skipped/)).toBeVisible()
    await expect(dialog.getByText('notes/gamma.md')).toBeVisible()

    // Convert and wait for the report.
    await dialog.getByRole('button', { name: 'Convert 2 files' }).click()
    await expect(dialog.locator('p.totals')).toContainText(
      /2 converted\s*·\s*1 skipped\s*·\s*0 failed/,
      { timeout: 30_000 }
    )
    await dialog.getByRole('button', { name: 'Close' }).click()

    // On disk: converted files hold unquoted numbers, bodies intact; the
    // unconvertible file is untouched; the overlay pins the scope's type.
    const alpha = readFileSync(join(vaultDir, 'notes', 'alpha.md'), 'utf-8')
    expect(alpha).toMatch(/priority: 3(\n|$)/)
    expect(alpha).toContain('# Alpha\nBody stays byte-identical.\n')
    const beta = readFileSync(join(vaultDir, 'notes', 'beta.md'), 'utf-8')
    expect(beta).toMatch(/priority: 12(\n|$)/)
    const gamma = readFileSync(join(vaultDir, 'notes', 'gamma.md'), 'utf-8')
    expect(gamma).toContain('priority: not-a-number')

    const overlay = readFileSync(join(vaultDir, '.markdownvdb.schema.yml'), 'utf-8')
    expect(overlay).toContain('notes')
    expect(overlay).toContain('field_type: number')

    await electronApp.close()
  })

  test('renames a property across the folder from the modal', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    await openVaultFile(window, 'notes', 'alpha')

    // Row overflow menu → Rename property… (the button is opacity-0 until
    // row hover but still actionable; the key label is an <input>, so
    // hasText can't target the row).
    await window.getByRole('button', { name: 'Property options for priority' }).click()
    await window
      .getByRole('menuitem', { name: 'Rename property…' })
      .dispatchEvent('mousedown')

    const dialog = window.getByRole('dialog', { name: 'Rename property priority' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'New property name' }).fill('rank')
    await dialog.getByRole('button', { name: 'Preview' }).click()
    await expect(dialog.getByText(/3 files convert/)).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Rename 3 files' }).click()
    await expect(dialog.locator('p.totals')).toContainText(
      /3 converted\s*·\s*0 skipped\s*·\s*0 failed/,
      { timeout: 30_000 }
    )
    await dialog.getByRole('button', { name: 'Close' }).click()

    const alpha = readFileSync(join(vaultDir, 'notes', 'alpha.md'), 'utf-8')
    expect(alpha).toContain('rank:')
    expect(alpha).not.toContain('priority:')

    await electronApp.close()
  })
})
