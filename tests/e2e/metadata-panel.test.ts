import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { openExampleFile } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function openPanel(window: import('@playwright/test').Page) {
  const toggle = window.getByTitle('Toggle Properties')
  const panel = window.locator('.properties-panel')
  if (!(await panel.isVisible().catch(() => false))) await toggle.click()
  await expect(panel).toBeVisible()
  return { panel, toggle }
}

test.describe('Metadata Panel', () => {
  test('toggles panel visibility from the title bar', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { panel, toggle } = await openPanel(window)
    await toggle.click()
    await expect(panel).not.toBeVisible()

    await electronApp.close()
  })

  test('shows real frontmatter, links, and outline data for the guide', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const { panel } = await openPanel(window)
    await expect(panel.getByText('Frontmatter', { exact: true })).toBeVisible()
    await expect(panel.getByText('Links', { exact: true })).toBeVisible()
    await expect(panel.getByText('Outline', { exact: true })).toBeVisible()
    await expect(panel).toContainText('ready')
    await expect(panel.locator('.outline-item').first()).toContainText('Welcome to Tesseract')

    await electronApp.close()
  })

  test('collapses and expands frontmatter without losing the panel', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const { panel } = await openPanel(window)
    const header = panel.getByRole('button', { name: 'Frontmatter' })
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(panel.getByText('ready', { exact: true })).not.toBeVisible()
    await header.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toContainText('ready')

    await electronApp.close()
  })

  test('keeps live metadata in sync with WYSIWYG property edits', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const { panel } = await openPanel(window)
    const editor = window.getByRole('main', { name: 'Editor' })
    const status = editor.getByRole('textbox', { name: 'status value' })
    await status.fill('reviewed')
    await status.press('Enter')
    await expect(panel).toContainText('reviewed', { timeout: 10_000 })

    await window.keyboard.press(`${modifier}+s`)
    await expect(window.locator('.dirty-dot')).not.toBeVisible({ timeout: 10_000 })
    await electronApp.close()
  })

  test('renders the real local graph and opens a linked note from it', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const { panel } = await openPanel(window)
    const localGraph = panel.locator('#properties-local-graph')
    const neighbor = localGraph.locator('.graph-node:not(.center-node)').first()
    const activeDocumentTab = window.locator('.tab-item[aria-selected="true"] .tab-title')

    await expect(activeDocumentTab).toHaveText('Start Here.md')
    await expect(neighbor).toBeVisible({ timeout: 10_000 })
    await neighbor.press('Enter')

    await expect(activeDocumentTab).not.toHaveText('Start Here.md', {
      timeout: 10_000
    })
    await expect(window.getByRole('main', { name: 'Editor' })).toBeVisible()

    await electronApp.close()
  })

  test('reloads indexed links when returning to an already-loaded tab', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await openExampleFile(window)
    const { panel } = await openPanel(window)
    await panel.getByRole('button', { name: /Outgoing/ }).click()
    await expect(panel).toContainText('Search by meaning.md', { timeout: 10_000 })

    await window.getByTitle('Expand All').click()
    const writing = window
      .locator('.tree-row:not(.directory)', { hasText: 'Writing and editing.md' })
      .first()
    await writing.click({ button: 'right' })
    await window.getByRole('button', { name: 'Open in New Tab' }).click()
    await expect(window.locator('.tab-item[aria-selected="true"] .tab-title')).toHaveText(
      'Writing and editing.md'
    )
    await expect(panel).not.toContainText('Search by meaning.md', { timeout: 10_000 })

    await window.locator('.tab-item', { hasText: 'Start Here.md' }).click()
    await expect(window.locator('.tab-item[aria-selected="true"] .tab-title')).toHaveText(
      'Start Here.md'
    )
    await expect(panel).toContainText('Search by meaning.md', { timeout: 10_000 })

    await electronApp.close()
  })
})
