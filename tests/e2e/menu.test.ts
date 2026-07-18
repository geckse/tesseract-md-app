import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
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

/**
 * Launch with an isolated user-data-dir so tests never touch the real
 * profile (and can run alongside a dev instance). The seeded config skips
 * onboarding; electron-store schema-validates the seed, so keep it minimal.
 */
function launchIsolated(): Promise<ElectronApplication> {
  const profileDir = mkdtempSync(join(tmpdir(), 'tesseract-menu-e2e-'))
  writeFileSync(join(profileDir, 'config.json'), JSON.stringify({ onboardingComplete: true }))
  return electron.launch({ args: [`--user-data-dir=${profileDir}`, appPath] })
}

/**
 * Native application menu (phase 43).
 * Menu items are driven from the MAIN process via Menu.getMenuItemById —
 * the same path a real click takes — and effects are asserted in the renderer.
 */
test.describe('Native App Menu', () => {
  test('builds the full menu bar with stable item ids', async () => {
    const electronApp = await launchIsolated()
    await electronApp.firstWindow()

    const menuInfo = await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()
      if (!menu) return null
      const labels = menu.items.map((item) => item.label || item.role || '')
      const ids = [
        'file.save',
        'file.save-copy',
        'file.export-html',
        'file.export-pdf',
        'file.export-docx',
        'file.export-odt',
        'file.export-epub',
        'file.export-text',
        'file.export-rtf',
        'file.close-tab',
        'edit.search',
        'format.bold',
        'structure.toc',
        'structure.fix-hierarchy',
        'view.toggle-sidebar',
        'view.toggle-properties',
        'collection.sync',
        'collection.doctor',
        'collection.add',
        'help.shortcuts',
        'help.docs'
      ]
      return {
        labels,
        missing: ids.filter((id) => !menu.getMenuItemById(id))
      }
    })

    expect(menuInfo).not.toBeNull()
    expect(menuInfo!.missing).toEqual([])
    for (const label of ['File', 'Edit', 'Format', 'View', 'Collection', 'Help']) {
      expect(menuInfo!.labels).toContain(label)
    }

    await electronApp.close()
  })

  test('View > Toggle Properties Panel round-trips the panel', async () => {
    const electronApp = await launchIsolated()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.locator('.app-shell').waitFor({ timeout: 10000 })

    const clickToggle = () =>
      electronApp.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('view.toggle-properties')?.click()
      })

    const properties = window.locator('.properties-region')
    const initiallyVisible = await properties.isVisible().catch(() => false)

    await clickToggle()
    if (initiallyVisible) {
      await expect(properties).toBeHidden()
    } else {
      await expect(properties).toBeVisible()
    }

    await clickToggle()
    if (initiallyVisible) {
      await expect(properties).toBeVisible()
    } else {
      await expect(properties).toBeHidden()
    }

    await electronApp.close()
  })

  test('View > Toggle Sidebar hides and restores the sidebar', async () => {
    const electronApp = await launchIsolated()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.locator('.app-shell').waitFor({ timeout: 10000 })

    const sidebar = window.locator('.sidebar-region')
    await expect(sidebar).toBeVisible()

    const clickToggle = () =>
      electronApp.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('view.toggle-sidebar')?.click()
      })

    await clickToggle()
    await expect(sidebar).toBeHidden()

    await clickToggle()
    await expect(sidebar).toBeVisible()

    await electronApp.close()
  })

  test('Help > Keyboard Shortcuts opens the reference modal and Escape closes it', async () => {
    const electronApp = await launchIsolated()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.locator('.app-shell').waitFor({ timeout: 10000 })

    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('help.shortcuts')?.click()
    })

    const dialog = window.locator('[role="dialog"][aria-label="Keyboard Shortcuts"]')
    await expect(dialog).toBeVisible()

    await window.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await electronApp.close()
  })

  test('export commands no-op safely without a document and never open a dialog', async () => {
    const electronApp = await launchIsolated()
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Monkey-patch the save dialog so an unexpected dialog can't hang CI
    await electronApp.evaluate(({ dialog }) => {
      let calls = 0
      const globalWithCounter = globalThis as { __exportDialogCalls?: number }
      globalWithCounter.__exportDialogCalls = 0
      dialog.showSaveDialog = (async () => {
        calls++
        globalWithCounter.__exportDialogCalls = calls
        return { canceled: true, filePath: undefined }
      }) as typeof dialog.showSaveDialog
    })

    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('file.export-text')?.click()
      Menu.getApplicationMenu()?.getMenuItemById('file.save-copy')?.click()
    })

    // Give the renderer a beat to (not) react
    await window.waitForTimeout(500)

    const dialogCalls = await electronApp.evaluate(
      () => (globalThis as { __exportDialogCalls?: number }).__exportDialogCalls
    )
    // Fresh window has no focused document tab — export must no-op
    expect(dialogCalls).toBe(0)

    // App still healthy
    await expect(window.locator('body')).toBeVisible()

    await electronApp.close()
  })
})

/**
 * Full menu flow against a seeded mock-provider vault: structure tools in
 * the raw editor, live-buffer HTML export, and the Doctor modal fed by the
 * real CLI. Skipped when the mdvdb binary is unavailable.
 */
test.describe('Native App Menu — seeded vault flows', () => {
  test.skip(!cliAvailable, 'mdvdb CLI or built app not available')
  test.setTimeout(120_000)

  let profileDir: string
  let vaultDir: string

  test.beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'tesseract-menu-profile-'))
    vaultDir = mkdtempSync(join(tmpdir(), 'tesseract-menu-vault-'))

    writeFileSync(
      join(vaultDir, 'note.md'),
      '# Title\n\nIntro paragraph.\n\n### Skipped\n\nBody text.\n'
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
          { id: 'menu-vault', name: 'Menu Vault', path: vaultDir, addedAt: now, lastOpenedAt: now }
        ],
        activeCollectionId: 'menu-vault',
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

  test('fix hierarchy in raw mode, export the live buffer as HTML, run doctor', async () => {
    const electronApp = await electron.launch({
      args: [`--user-data-dir=${profileDir}`, appPath]
    })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1500)

    const menuClick = (id: string) =>
      electronApp.evaluate(({ Menu }, itemId) => {
        Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click()
      }, id)

    // Open the note from the file tree
    const fileRow = window.locator('.tree-row', { hasText: 'note.md' }).first()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await fileRow.isVisible().catch(() => false)) break
      await window.waitForTimeout(1_000)
    }
    await fileRow.click()
    await window.waitForTimeout(1_000)

    // Switch to the raw editor via View > Toggle Editor/Raw Mode
    await menuClick('view.toggle-editor-mode')
    const cmContent = window.locator('.cm-content')
    await expect(cmContent).toBeVisible({ timeout: 10_000 })
    await expect(cmContent).toContainText('### Skipped')

    // Format > Fix Heading Hierarchy — H1 → H3 jump becomes H1 → H2
    await menuClick('structure.fix-hierarchy')
    await expect(cmContent).toContainText('## Skipped')
    await expect(cmContent).not.toContainText('### Skipped')

    // File > Export as HTML — patched save dialog, exports the LIVE buffer
    const exportPath = join(profileDir, 'export-out.html')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath
      })) as typeof dialog.showSaveDialog
    }, exportPath)

    await menuClick('file.export-html')
    await expect.poll(() => existsSync(exportPath), { timeout: 10_000 }).toBe(true)
    const html = readFileSync(exportPath, 'utf-8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<h1>Title</h1>')
    // The fixed (unsaved) buffer was exported — h2, not the on-disk h3
    expect(html).toContain('<h2>Skipped</h2>')

    // File > Export as EPUB — binary zip container over the same IPC path
    const epubPath = join(profileDir, 'export-out.epub')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath
      })) as typeof dialog.showSaveDialog
    }, epubPath)

    await menuClick('file.export-epub')
    await expect.poll(() => existsSync(epubPath), { timeout: 10_000 }).toBe(true)
    const epub = readFileSync(epubPath)
    // OCF layout: zip magic, then the STORED `mimetype` entry at fixed offsets
    expect(epub.subarray(0, 2).toString()).toBe('PK')
    expect(epub.subarray(30, 38).toString()).toBe('mimetype')
    expect(epub.subarray(38, 58).toString()).toBe('application/epub+zip')
    // STORED entries are greppable raw — the live buffer's fixed heading is inside
    expect(epub.includes('<h2 id="skipped">Skipped</h2>')).toBe(true)

    // Collection > Run Doctor… — modal shows the real CLI checks
    await menuClick('collection.doctor')
    const doctorDialog = window.locator('[role="dialog"][aria-label="Collection Doctor"]')
    await expect(doctorDialog).toBeVisible({ timeout: 10_000 })
    await expect(doctorDialog).toContainText('Config loaded', { timeout: 15_000 })
    await expect(doctorDialog).toContainText(/\d+\/\d+ checks passed/)

    // Fix hierarchy intentionally leaves the live buffer dirty. Exercise the
    // renderer close guard and its native confirmation during shutdown. Stub
    // the OS response so the automated run cannot wait behind a modal dialog.
    await window.keyboard.press('Escape')
    await expect(doctorDialog).not.toBeVisible()

    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    await electronApp.close()
  })
})
