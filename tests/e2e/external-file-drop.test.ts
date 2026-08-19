import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page, _electron as electron } from '@playwright/test'
import { closeElectronApp } from './support/electron-lifecycle'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * Populate a native file input, then reuse that OS-backed File in the same
 * drag payload the workspace receives from Finder/Explorer.
 */
async function stageExternalFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('#e2e-external-drop-input')?.remove()
    const input = document.createElement('input')
    input.id = 'e2e-external-drop-input'
    input.type = 'file'
    input.hidden = true
    document.body.append(input)
  })
  await page.locator('#e2e-external-drop-input').setInputFiles(filePath)
}

async function dragExternalFileOverTab(page: Page, filePath: string): Promise<void> {
  await stageExternalFile(page, filePath)

  await page
    .locator('.split-pane-container .tab-item')
    .first()
    .evaluate((target) => {
      const input = document.querySelector<HTMLInputElement>('#e2e-external-drop-input')
      const file = input?.files?.[0]
      if (!file) throw new Error('Playwright did not populate the external drop fixture')

      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      )
    })
}

async function dropExternalFile(page: Page, filePath: string): Promise<void> {
  await stageExternalFile(page, filePath)

  await page.locator('.split-pane-container').evaluate((workspace) => {
    const input = document.querySelector<HTMLInputElement>('#e2e-external-drop-input')
    const file = input?.files?.[0]
    if (!file) throw new Error('Playwright did not populate the external drop fixture')

    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    const target = workspace.querySelector<HTMLElement>('[data-external-drop-pane]') ?? workspace
    const bounds = target.getBoundingClientRect()
    const eventInit: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
      dataTransfer
    }

    target.dispatchEvent(new DragEvent('dragover', eventInit))
    target.dispatchEvent(new DragEvent('drop', eventInit))
  })
}

test('drops and saves external Markdown, then previews external media', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'tesseract external drop '))
  const markdownPath = join(tempRoot, 'outside drop.md')
  const imagePath = join(tempRoot, 'outside pixel.png')
  await writeFile(markdownPath, '# External drop\n\nOpened outside every collection.\n', 'utf-8')
  await writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )

  const electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
  })
  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('.app-shell')).toBeVisible()
    await expect(window.locator('.split-pane-container')).toBeVisible()

    await dragExternalFileOverTab(window, markdownPath)
    const tabBar = window.locator('.split-pane-container .tab-bar').first()
    await expect(tabBar).toHaveClass(/external-file-drag/)

    await dropExternalFile(window, markdownPath)
    await expect(tabBar).not.toHaveClass(/external-file-drag/)

    await expect(window.getByRole('tab', { name: /^outside drop\.md/ })).toBeVisible({
      timeout: 10_000
    })
    await expect(window.getByRole('heading', { name: 'External drop' })).toBeVisible()

    await window.getByRole('tab', { name: 'Raw', exact: true }).click()
    const source = window.locator('.cm-content')
    await expect(source).toBeVisible()
    await source.click()
    await window.keyboard.press(`${modifier}+End`)
    await window.keyboard.type('\nSaved from an external drop.\n')
    await expect(window.locator('.dirty-indicator')).toBeVisible()

    await window.keyboard.press(`${modifier}+s`)
    await expect(window.locator('.dirty-indicator')).not.toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => readFile(markdownPath, 'utf-8'))
      .toContain('Saved from an external drop.')

    await dropExternalFile(window, imagePath)
    await expect(window.getByRole('tab', { name: /^outside pixel\.png/ })).toBeVisible()
    await expect(window.getByLabel('External image preview')).toBeVisible()
    await expect(window.locator('.mode-toggle-bar')).toHaveCount(0)
  } finally {
    await closeElectronApp(electronApp)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
