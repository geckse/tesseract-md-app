import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { waitForExampleCollection } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const query = 'Tesseract'

async function searchExample(window: import('@playwright/test').Page) {
  await waitForExampleCollection(window)
  const input = window.getByRole('textbox', { name: 'Search database' })
  await input.fill(query)
  const results = window.locator('.result-card')
  await expect(results.first()).toBeVisible({ timeout: 15_000 })
  return { input, results, overlay: window.locator('.search-results-overlay') }
}

test.describe('Search', () => {
  test('shows and focuses search with Cmd/Ctrl+K', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await waitForExampleCollection(window)

    const input = window.getByRole('textbox', { name: 'Search database' })
    await expect(input).toBeVisible()
    await window.keyboard.press(`${modifier}+k`)
    await expect(input).toBeFocused()

    await electronApp.close()
  })

  test('returns indexed guide results for a real query', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { results, overlay } = await searchExample(window)
    await expect(overlay).toBeVisible()
    expect(await results.count()).toBeGreaterThan(0)
    await expect(results.first()).toContainText(/Tesseract|Welcome|Feature/i)

    await electronApp.close()
  })

  test('opens a result and closes the results panel', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { results, overlay } = await searchExample(window)
    await results.first().click()
    await expect(overlay).not.toBeVisible()
    await expect(window.getByRole('main', { name: 'Editor' })).toBeVisible({ timeout: 10_000 })

    await electronApp.close()
  })

  test('switches to lexical mode and refreshes results', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { results } = await searchExample(window)
    const lexical = window.locator('.mode-pill', { hasText: 'lexical' })
    await lexical.click()
    await expect(lexical).toHaveClass(/active/)
    await expect(results.first()).toBeVisible({ timeout: 15_000 })

    await electronApp.close()
  })

  test('closes results with Escape', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { overlay } = await searchExample(window)
    await window.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    await electronApp.close()
  })

  test('supports keyboard result navigation and selection from the results list', async () => {
    const electronApp = await electron.launch({ args: [appPath] })
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const { overlay } = await searchExample(window)
    const resultsList = window.getByRole('listbox', { name: 'Search results' })
    await resultsList.focus()
    await expect(resultsList).toBeFocused()
    await window.keyboard.press('ArrowDown')
    await expect(window.locator('.result-card.highlighted')).toBeVisible()
    await window.keyboard.press('Enter')
    await expect(overlay).not.toBeVisible()
    await expect(window.getByRole('main', { name: 'Editor' })).toBeVisible({ timeout: 10_000 })

    await electronApp.close()
  })
})
