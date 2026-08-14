import { closeElectronApp } from './support/electron-lifecycle'
/**
 * E2E: Lookup authoring and propagation through the real desktop/CLI boundary.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appPath = resolve(__dirname, '../../out/main/index.js')

function findMdvdbSync(): string {
  const command = process.platform === 'win32' ? 'where' : 'which'
  try {
    return execFileSync(command, ['mdvdb'], { timeout: 5_000 }).toString().trim().split('\n')[0]
  } catch {
    return ''
  }
}

const cliPath = findMdvdbSync()
const cliAvailable = cliPath.length > 0 && existsSync(appPath)

test.describe('Lookup/Rollup computed fields', () => {
  test.skip(!cliAvailable, 'mdvdb binary or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-lookup-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-lookup-vault-'))
    mkdirSync(join(vaultDir, 'clients'), { recursive: true })
    mkdirSync(join(vaultDir, 'contacts'), { recursive: true })
    mkdirSync(join(vaultDir, '.markdownvdb'), { recursive: true })
    writeFileSync(
      join(vaultDir, 'clients', 'acme.md'),
      '---\ntitle: Acme\ndomain: acme.example\nindustry: manufacturing\n---\n\n# Acme\n'
    )
    writeFileSync(
      join(vaultDir, 'contacts', 'alice.md'),
      '---\ntitle: Alice\nclient: "[[clients/acme]]"\n---\n\n# Alice\nBody stays intact.\n'
    )
    writeFileSync(
      join(vaultDir, '.markdownvdb.schema.yml'),
      'scopes:\n  contacts:\n    fields:\n      client:\n        field_type: relation\n        target: clients\n'
    )
    writeFileSync(
      join(vaultDir, '.markdownvdb', 'config.yaml'),
      'embedding:\n  provider: mock\n  dimensions: 8\n'
    )

    execFileSync(cliPath, ['ingest', '--root', vaultDir], { timeout: 60_000 })
    const descriptors = JSON.parse(
      execFileSync(cliPath, ['modules', 'list', '--root', vaultDir, '--json'], {
        timeout: 10_000
      }).toString()
    ) as Array<{ id: string }>
    if (!descriptors.some((descriptor) => descriptor.id === 'lookup_rollup')) {
      throw new Error('test CLI does not advertise lookup_rollup')
    }

    const now = Date.now()
    const cliVersion = execFileSync(cliPath, ['--version', '--json'], { timeout: 10_000 })
      .toString()
      .trim()
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({
        collections: [
          {
            id: 'lookup-vault',
            name: 'Lookup Vault',
            path: vaultDir,
            addedAt: now,
            lastOpenedAt: now
          }
        ],
        activeCollectionId: 'lookup-vault',
        onboardingComplete: true,
        cliPath,
        cliVersion: String(JSON.parse(cliVersion).version ?? '')
      })
    )
  })

  test.afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true })
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('renames and retargets a spaced Lookup key without duplicating or rewriting the record', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const contacts = window.locator('.tree-row', { hasText: 'contacts' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await contacts.isVisible().catch(() => false)) break
      const retry = window.getByRole('button', { name: 'Retry' })
      if (await retry.isVisible().catch(() => false)) await retry.click()
      await window.waitForTimeout(1_000)
    }
    await contacts.hover()
    await window.getByRole('button', { name: 'Open contacts as table' }).click()
    await expect(window.getByRole('button', { name: 'Add column' })).toBeVisible({
      timeout: 15_000
    })

    await window.getByRole('button', { name: 'Add column' }).click()
    const addColumn = window.getByRole('dialog', { name: 'Add column' })
    await addColumn.getByLabel('Column name').fill('Client Detail')
    await expect(addColumn.getByRole('radio', { name: /^Lookup/ })).toBeVisible({
      timeout: 10_000
    })
    await addColumn.getByRole('radio', { name: /^Lookup/ }).click()
    await addColumn.getByRole('button', { name: 'Continue to lookup' }).click()

    const lookup = window.getByRole('dialog', { name: 'Add lookup' })
    await lookup.getByLabel('Relation field').selectOption('client')
    await expect(lookup.getByLabel('Field to retrieve')).toContainText('title', {
      timeout: 10_000
    })
    await lookup.getByLabel('Field to retrieve').selectOption('title')
    await lookup.getByRole('button', { name: 'Save Lookup' }).click()
    await expect(lookup).not.toBeVisible({ timeout: 30_000 })

    const contactPath = join(vaultDir, 'contacts', 'alice.md')
    const expectedOriginalContact = (value: string) =>
      `---\ntitle: Alice\nclient: "[[clients/acme]]"\n"Client Detail": "${value}"\n---\n\n# Alice\nBody stays intact.\n`
    await expect
      .poll(() => readFileSync(contactPath, 'utf-8'), { timeout: 20_000 })
      .toBe(expectedOriginalContact('Acme'))
    expect(readFileSync(contactPath, 'utf-8').match(/^"?Client Detail"?:/gm)).toHaveLength(1)

    const computedCell = window.locator('.formula-cell', { hasText: 'Acme' }).first()
    await expect(computedCell).toBeVisible({ timeout: 20_000 })
    await expect(computedCell.locator('.fx.material-symbols-outlined')).toHaveText('arrow_outward')
    await expect(computedCell.locator('xpath=..')).not.toHaveClass(/editable/)

    // Keep a live WYSIWYG copy mounted while the definition changes. A clean
    // editor must accept the module's disk replacement without later saving its
    // stale computed pair back over the new value.
    const aliceRow = window.getByRole('row').filter({ hasText: 'Alice' })
    await aliceRow.hover()
    await aliceRow.getByRole('button', { name: 'Open document' }).click()
    await expect(window.locator('.tab-item[aria-selected="true"] .tab-title')).toHaveText(
      'alice.md'
    )
    await window.locator('.tab-item', { hasText: 'contacts' }).first().click()

    await expect(
      window.getByRole('button', { name: 'Column options for Client Detail' })
    ).toBeVisible({ timeout: 20_000 })
    await window.getByRole('button', { name: 'Column options for Client Detail' }).click()
    await window.getByRole('menuitem', { name: /Edit lookup/ }).click()

    const editLookup = window.getByRole('dialog', { name: 'Edit lookup Client Detail' })
    await expect(editLookup.getByLabel('Column name')).toBeEnabled()
    await editLookup.getByLabel('Column name').fill('Client Industry')
    await expect(editLookup.getByLabel('Field to retrieve')).toHaveValue('title')
    await editLookup.getByLabel('Field to retrieve').selectOption('industry')
    await editLookup.getByRole('button', { name: 'Save Lookup' }).click()
    await expect(editLookup).not.toBeVisible({ timeout: 30_000 })

    const expectedRenamedContact = (value: string) =>
      `---\ntitle: Alice\nclient: "[[clients/acme]]"\n"Client Industry": "${value}"\n---\n\n# Alice\nBody stays intact.\n`
    await expect
      .poll(() => readFileSync(contactPath, 'utf-8'), { timeout: 20_000 })
      .toBe(expectedRenamedContact('manufacturing'))
    expect(readFileSync(contactPath, 'utf-8')).not.toContain('Client Detail')
    expect(readFileSync(contactPath, 'utf-8').match(/^"?Client Industry"?:/gm)).toHaveLength(1)
    await window.waitForTimeout(750)
    expect(readFileSync(contactPath, 'utf-8')).toBe(expectedRenamedContact('manufacturing'))

    const watcherToggle = window.locator('button.watcher-toggle')
    await expect(watcherToggle).toContainText('Watch')
    await watcherToggle.click()
    await expect(watcherToggle).toContainText('Watching', { timeout: 15_000 })

    const clientPath = join(vaultDir, 'clients', 'acme.md')
    writeFileSync(
      clientPath,
      readFileSync(clientPath, 'utf-8').replace('industry: manufacturing', 'industry: aerospace')
    )

    await expect
      .poll(() => readFileSync(contactPath, 'utf-8'), { timeout: 30_000 })
      .toBe(expectedRenamedContact('aerospace'))
    expect(readFileSync(contactPath, 'utf-8')).not.toContain('Client Detail')
    expect(readFileSync(contactPath, 'utf-8').match(/^"?Client Industry"?:/gm)).toHaveLength(1)
    await expect(window.locator('.formula-cell', { hasText: 'aerospace' }).first()).toBeVisible({
      timeout: 30_000
    })

    await closeElectronApp(electronApp)
  })
})
