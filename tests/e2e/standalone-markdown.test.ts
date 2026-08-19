import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, _electron as electron } from '@playwright/test'
import { closeElectronApp } from './support/electron-lifecycle'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('opens, edits, and saves a Markdown file outside every collection', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'tesseract standalone '))
  const markdownPath = join(tempRoot, 'outside note.md')
  const initialContent = '# Standalone launch\n\nOpened without a collection.\n'
  await writeFile(markdownPath, initialContent, 'utf-8')

  const electronApp = await electron.launch({
    args: [appPath, markdownPath],
    env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
  })
  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.locator('.standalone-shell')).toBeVisible()
    await expect(window.getByText('No Collection')).toBeVisible()
    await expect(window.locator('.app-shell')).toHaveCount(0)
    await expect(window.locator('.sidebar-region')).toHaveCount(0)
    await expect(window.getByRole('heading', { name: 'Standalone launch' })).toBeVisible()

    await window.getByRole('button', { name: 'Raw', exact: true }).click()
    const source = window.locator('.cm-content')
    await expect(source).toBeVisible()
    await source.click()
    await window.keyboard.press(`${modifier}+End`)
    await window.keyboard.type('\nSaved from the standalone editor.\n')
    await expect(window.locator('.dirty-dot')).toBeVisible()

    await window.keyboard.press(`${modifier}+s`)
    await expect(window.locator('.dirty-dot')).not.toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => readFile(markdownPath, 'utf-8'))
      .toContain('Saved from the standalone editor.')
  } finally {
    await closeElectronApp(electronApp)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('keeps normal collection context when the opened Markdown file is registered', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'tesseract collection open '))
  const profilePath = join(tempRoot, 'profile')
  const collectionPath = join(tempRoot, 'collection')
  const markdownPath = join(collectionPath, 'inside.md')
  await Promise.all([mkdir(profilePath), mkdir(collectionPath)])
  await writeFile(markdownPath, '# Collection launch\n\nOpened with its collection.\n', 'utf-8')
  await writeFile(
    join(profilePath, 'config.json'),
    JSON.stringify({
      collections: [
        {
          id: 'open-fixture',
          name: 'Open Fixture',
          path: collectionPath,
          addedAt: Date.now(),
          lastOpenedAt: Date.now()
        }
      ],
      activeCollectionId: 'open-fixture',
      onboardingComplete: true
    }),
    'utf-8'
  )

  const electronApp = await electron.launch({
    args: [`--user-data-dir=${profilePath}`, appPath, markdownPath],
    env: { ...process.env, TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '0' }
  })
  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.locator('.app-shell')).toBeVisible()
    await expect(window.locator('.standalone-shell')).toHaveCount(0)
    await expect(window.locator('.sidebar-region')).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Collection launch' })).toBeVisible({
      timeout: 10_000
    })
  } finally {
    await closeElectronApp(electronApp)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
