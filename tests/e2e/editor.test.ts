import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { openExampleFile, openRawEditor } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function setNativeDialogResponse(
  electronApp: ElectronApplication,
  response: 0 | 1
): Promise<void> {
  await electronApp.evaluate(({ dialog }, nextResponse) => {
    ;(globalThis as { __tesseractDialogCalls?: number }).__tesseractDialogCalls = 0
    dialog.showMessageBox = (async () => {
      const state = globalThis as { __tesseractDialogCalls?: number }
      state.__tesseractDialogCalls = (state.__tesseractDialogCalls ?? 0) + 1
      return { response: nextResponse, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

async function expectNativeDialogCalled(electronApp: ElectronApplication): Promise<void> {
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as { __tesseractDialogCalls?: number }).__tesseractDialogCalls ?? 0
      )
    )
    .toBe(1)
}

test.describe('Editor Workflow', () => {
  test('shows a useful empty state before a file is selected', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const emptyState = window.getByRole('main', { name: 'No file open' })
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText('Open a file from the sidebar')

    await electronApp.close()
  })

  test('opens the generated guide in the WYSIWYG editor', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await expect(window.locator('.ProseMirror')).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Welcome to Tesseract' })).toBeVisible()

    await electronApp.close()
  })

  test('reports non-zero word and token counts for an open guide', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await expect(window.locator('.status-item', { hasText: 'words' })).toHaveText(
      /[1-9][\d,]* words/
    )
    await expect(window.locator('.status-item', { hasText: 'tokens' })).toHaveText(
      /[1-9][\d,]* tokens/
    )

    await electronApp.close()
  })

  test('marks source edits dirty and clears the state after saving', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const content = await openRawEditor(window)
    const dirtyDot = window.locator('.dirty-dot')
    await expect(dirtyDot).not.toBeVisible()

    await content.click()
    await window.keyboard.press(`${modifier}+End`)
    await window.keyboard.type('\n\nRelease-gate edit.')
    await expect(dirtyDot).toBeVisible()

    await window.keyboard.press(`${modifier}+s`)
    await expect(dirtyDot).not.toBeVisible({ timeout: 10_000 })

    await electronApp.close()
  })

  test('uses the native dialog for destructive discard actions', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const content = await openRawEditor(window)
    await content.click()
    await window.keyboard.press(`${modifier}+End`)
    await window.keyboard.type('\n\nUnsaved dialog test.')
    await expect(window.locator('.dirty-dot')).toBeVisible()

    const discard = window.getByTitle('Discard changes')
    await setNativeDialogResponse(electronApp, 0)
    await discard.click()
    await expectNativeDialogCalled(electronApp)
    await expect(window.locator('.dirty-dot')).toBeVisible()

    await setNativeDialogResponse(electronApp, 1)
    await discard.click()
    await expectNativeDialogCalled(electronApp)
    await expect(window.locator('.dirty-dot')).not.toBeVisible()
    await expect(content).not.toContainText('Unsaved dialog test.')

    await electronApp.close()
  })

  test('guards a native window close with the native discard dialog', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const content = await openRawEditor(window)
    await content.click()
    await window.keyboard.press(`${modifier}+End`)
    await window.keyboard.type('\n\nClose guard test.')
    await expect(window.locator('.dirty-dot')).toBeVisible()

    await setNativeDialogResponse(electronApp, 0)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expectNativeDialogCalled(electronApp)
    await expect(window.locator('.dirty-dot')).toBeVisible()
    expect(electronApp.windows()).toHaveLength(1)

    await setNativeDialogResponse(electronApp, 1)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expectNativeDialogCalled(electronApp)
    await expect.poll(() => electronApp.windows().length).toBe(0)

    await electronApp.close()
  })

  test('loads different content when switching files', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    await expect(window.getByRole('heading', { name: 'Welcome to Tesseract' })).toBeVisible()

    await openExampleFile(window, 'Search by meaning.md')
    await expect(window.getByRole('heading', { name: 'Search by meaning' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Welcome to Tesseract' })).not.toBeVisible()
    await expect(window.locator('.dirty-dot')).not.toBeVisible()

    await electronApp.close()
  })
})
