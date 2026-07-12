/**
 * E2E: phase-42 frontmatter relations (@relations).
 *
 * Two flows against a seeded invoices/ → clients/ fixture vault:
 *  1. Table flow — relation column shows server-resolved titles, edit via the
 *     scoped picker writes a quoted `[[path]]` into frontmatter on disk.
 *  2. Panel flow — Referenced-by lists the referencing invoices grouped by
 *     field; Property settings pins the target folder into the overlay.
 *
 * Uses PROFILE ISOLATION (--user-data-dir + seeded config.json) because the
 * flows MUTATE vault files. Skipped when the mdvdb binary is not on PATH or
 * predates phase 31 (< 0.2.0) — relations are version-gated in the app.
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
  // The same machine-readable form the app's getCliVersion() parses.
  try {
    const stdout = execFileSync(path, ['--version', '--json'], { timeout: 10_000 }).toString()
    return String(JSON.parse(stdout.trim()).version ?? '')
  } catch {
    return ''
  }
}

function supportsRelations(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!m) return false
  const [maj, min] = [Number(m[1]), Number(m[2])]
  return maj > 0 || min >= 2
}

const cliPath = findMdvdbSync()
const cliVersion = cliPath ? cliVersionSync(cliPath) : ''
const cliAvailable = cliPath.length > 0 && existsSync(appPath) && supportsRelations(cliVersion)

const INVOICE_BODY = '# Invoice i1\n\nBody stays byte-identical.\n'

test.describe('Frontmatter relations (phase 42) @relations', () => {
  test.skip(!cliAvailable, 'mdvdb >= 0.2.0 or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-vault-'))

    mkdirSync(join(vaultDir, 'clients'), { recursive: true })
    mkdirSync(join(vaultDir, 'invoices'), { recursive: true })
    writeFileSync(
      join(vaultDir, 'clients', 'acme.md'),
      '---\ntitle: Acme Corp\nindustry: tech\n---\n\n# Acme\nClient profile.\n'
    )
    writeFileSync(
      join(vaultDir, 'clients', 'globex.md'),
      '---\ntitle: Globex\n---\n\n# Globex\nClient profile.\n'
    )
    writeFileSync(
      join(vaultDir, 'invoices', 'i1.md'),
      `---\nclient: "[[clients/acme]]"\namount: 100\n---\n\n${INVOICE_BODY}`
    )
    writeFileSync(
      join(vaultDir, '.markdownvdb.schema.yml'),
      'scopes:\n  invoices:\n    fields:\n      client:\n        field_type: relation\n        target: clients\n'
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

  test('table flow: title chips render, picker edit writes quoted [[path]] to disk', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    // Open invoices as a table (hover the tree row to reveal the action).
    const dirRow = window.locator('.tree-row', { hasText: 'invoices' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await dirRow.isVisible().catch(() => false)) break
      const retry = window.getByRole('button', { name: 'Retry' })
      if (await retry.isVisible().catch(() => false)) await retry.click()
      await window.waitForTimeout(1_000)
    }
    await dirRow.hover()
    await window.getByRole('button', { name: 'Open invoices as table' }).click()
    await window.waitForTimeout(1_500)

    // The relation column shows the SERVER-RESOLVED title, not the raw link.
    const chip = window.locator('.rel-chip', { hasText: 'Acme Corp' }).first()
    await expect(chip).toBeVisible({ timeout: 15_000 })

    // Edit via the picker: dblclick the cell, pick Globex (scoped to clients/).
    const cell = window.locator('.data-cell', { has: chip })
    await cell.dblclick()
    const picker = window.getByRole('dialog', { name: 'Pick a document' })
    await expect(picker).toBeVisible({ timeout: 10_000 })
    // Scoped to the target folder: both clients offered.
    await expect(picker.locator('.rp-title', { hasText: 'Globex' })).toBeVisible({
      timeout: 10_000
    })
    await expect(picker.locator('.rp-title', { hasText: 'Acme Corp' })).toBeVisible()
    await picker.locator('.rp-item', { hasText: 'Globex' }).dispatchEvent('mousedown')

    // On disk: the RAW value is a QUOTED wiki link; the body is byte-identical.
    await expect
      .poll(() => readFileSync(join(vaultDir, 'invoices', 'i1.md'), 'utf-8'), {
        timeout: 15_000
      })
      .toContain('client: "[[clients/globex]]"')
    const i1 = readFileSync(join(vaultDir, 'invoices', 'i1.md'), 'utf-8')
    expect(i1).toContain(INVOICE_BODY)
    expect(i1).not.toContain('clients/acme')

    // After the debounced reindex + reload, the chip resolves to the new title
    // and navigates to the client document on click.
    const globexChip = window.locator('.rel-chip', { hasText: 'Globex' }).first()
    await expect(globexChip).toBeVisible({ timeout: 20_000 })
    await expect(window.locator('.rel-chip .rel-chip-link', { hasText: 'Globex' })).toBeVisible({
      timeout: 20_000
    })
    await window.locator('.rel-chip .rel-chip-link', { hasText: 'Globex' }).first().click()
    await expect(window.locator('.tab-item', { hasText: 'globex' }).first()).toBeVisible({
      timeout: 10_000
    })

    await electronApp.close()
  })

  test('panel flow: Referenced-by lists referencing invoices; Property settings pins the target folder', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    // Open clients/acme.md from the tree.
    const dirRow = window.locator('.tree-row', { hasText: 'clients' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await dirRow.isVisible().catch(() => false)) break
      const retry = window.getByRole('button', { name: 'Retry' })
      if (await retry.isVisible().catch(() => false)) await retry.click()
      await window.waitForTimeout(1_000)
    }
    await dirRow.click()
    const fileRow = window.locator('.tree-row', { hasText: 'acme' }).first()
    await fileRow.waitFor({ state: 'visible', timeout: 10_000 })
    await fileRow.click()
    await window.waitForTimeout(1_500)

    // The properties panel is hidden by default — toggle it open.
    const panel = window.locator('.properties-panel')
    if (!(await panel.isVisible().catch(() => false))) {
      await window.locator('.icon-button', { hasText: 'side_navigation' }).click()
      await expect(panel).toBeVisible({ timeout: 5_000 })
    }

    // Referenced-by section: grouped under the `client` field, entry navigates.
    await expect(window.getByText('Referenced by')).toBeVisible({ timeout: 15_000 })
    const refGroup = window.locator('.refby-group', { hasText: 'client' })
    await expect(refGroup).toBeVisible()
    await expect(refGroup.getByText('invoices/i1.md')).toBeVisible()
    await refGroup.locator('.link-item').first().click()
    await window.waitForTimeout(1_500)

    // Now on the invoice: the client property row exposes Property settings
    // with the Target folder input (relation type detected from the schema).
    await window.getByRole('button', { name: 'Property options for client' }).click()
    await window.getByRole('menuitem', { name: 'Property settings…' }).dispatchEvent('mousedown')
    const settings = window.getByRole('dialog', { name: 'Property settings for client' })
    await expect(settings).toBeVisible({ timeout: 10_000 })
    const targetInput = settings.getByPlaceholder('e.g. clients')
    await expect(targetInput).toBeVisible()
    // (Prefill comes from the schema the panel holds — the global schema does
    // not carry scope-level targets, so the input may start empty.)

    // Saving writes the annotation through the comment-preserving overlay
    // writer, slash-less (a trailing slash is normalized away).
    await targetInput.fill('clients/')
    await settings.getByRole('button', { name: 'Save' }).click()
    await expect
      .poll(() => readFileSync(join(vaultDir, '.markdownvdb.schema.yml'), 'utf-8'), {
        timeout: 15_000
      })
      .toContain('target: clients')
    const overlay = readFileSync(join(vaultDir, '.markdownvdb.schema.yml'), 'utf-8')
    expect(overlay).not.toContain('clients/')
    expect(overlay).toContain('field_type: relation')

    await electronApp.close()
  })
})
