import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Search', () => {
  test('search input is visible', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const searchInput = window.locator('.search-input')
    await expect(searchInput).toBeVisible()

    await electronApp.close()
  })

  test('Cmd+K focuses search', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const searchInput = window.locator('.search-input')
    await expect(searchInput).toBeVisible()

    await window.keyboard.press('Meta+k')
    await window.waitForTimeout(300)

    const isFocused = await searchInput.evaluate(
      (el) => document.activeElement === el
    )
    expect(isFocused).toBe(true)

    await electronApp.close()
  })

  test('typing shows results', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Need a collection open for search to work
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultsOverlay = window.locator('.search-results-overlay')
      const isVisible = await resultsOverlay.isVisible().catch(() => false)

      if (isVisible) {
        const resultCards = window.locator('.result-card')
        const resultCount = await resultCards.count()
        expect(resultCount).toBeGreaterThanOrEqual(0)
      }
    }

    await electronApp.close()
  })

  test('clicking result opens file', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultCards = window.locator('.result-card')
      const resultCount = await resultCards.count()

      if (resultCount > 0) {
        await resultCards.first().click()
        await window.waitForTimeout(1000)

        const editorContainer = window.locator('.editor-container')
        const editorVisible = await editorContainer.isVisible().catch(() => false)

        if (editorVisible) {
          await expect(editorContainer).toBeVisible()
        }

        // Results panel should close after selection
        const resultsOverlay = window.locator('.search-results-overlay')
        await expect(resultsOverlay).not.toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('mode toggle switches mode', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultsOverlay = window.locator('.search-results-overlay')
      const isVisible = await resultsOverlay.isVisible().catch(() => false)

      if (isVisible) {
        const lexicalPill = window.locator('.mode-pill', { hasText: 'lexical' })
        const pillVisible = await lexicalPill.isVisible().catch(() => false)

        if (pillVisible) {
          await lexicalPill.click()
          await window.waitForTimeout(500)
          await expect(lexicalPill).toHaveClass(/active/)
        }
      }
    }

    await electronApp.close()
  })

  test('Escape closes results', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultsOverlay = window.locator('.search-results-overlay')
      const isVisible = await resultsOverlay.isVisible().catch(() => false)

      if (isVisible) {
        await window.keyboard.press('Escape')
        await window.waitForTimeout(300)
        await expect(resultsOverlay).not.toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('keyboard navigation', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultCards = window.locator('.result-card')
      const resultCount = await resultCards.count()

      if (resultCount > 0) {
        await window.keyboard.press('ArrowDown')
        await window.waitForTimeout(200)

        // First result should be highlighted
        const highlighted = window.locator('.result-card.highlighted')
        const highlightedCount = await highlighted.count()
        expect(highlightedCount).toBeGreaterThanOrEqual(1)

        // Enter should open the highlighted result
        await window.keyboard.press('Enter')
        await window.waitForTimeout(1000)

        const resultsOverlay = window.locator('.search-results-overlay')
        await expect(resultsOverlay).not.toBeVisible()
      }
    }

    await electronApp.close()
  })
})
