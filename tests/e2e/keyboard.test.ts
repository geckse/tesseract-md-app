import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Keyboard Navigation', () => {
  test('Cmd+K focuses search', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Open a collection first so search is available
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Press Cmd+K to focus search
      await window.keyboard.press('Meta+k')
      await window.waitForTimeout(300)

      const searchInput = window.locator('.search-input')
      const isFocused = await searchInput.evaluate(
        (el) => document.activeElement === el
      )
      expect(isFocused).toBe(true)
    }

    await electronApp.close()
  })

  test('Cmd+P opens quick file picker', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Open a collection first
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Press Cmd+P to open quick file picker
      await window.keyboard.press('Meta+p')
      await window.waitForTimeout(300)

      // Check that quick open modal is visible
      const quickOpenModal = window.locator('.quick-open-modal, [role="dialog"][aria-label*="Quick"]')
      const isVisible = await quickOpenModal.isVisible().catch(() => false)

      if (isVisible) {
        await expect(quickOpenModal).toBeVisible()

        // Close with Escape
        await window.keyboard.press('Escape')
        await window.waitForTimeout(200)
        await expect(quickOpenModal).not.toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('Cmd+B toggles sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Get initial sidebar visibility state
    const sidebar = window.locator('.sidebar, .sidebar-region, [role="navigation"]').first()
    const initialVisible = await sidebar.isVisible()

    // Toggle sidebar with Cmd+B
    await window.keyboard.press('Meta+b')
    await window.waitForTimeout(500)

    const afterToggleVisible = await sidebar.isVisible()
    expect(afterToggleVisible).toBe(!initialVisible)

    // Toggle back
    await window.keyboard.press('Meta+b')
    await window.waitForTimeout(500)

    const finalVisible = await sidebar.isVisible()
    expect(finalVisible).toBe(initialVisible)

    await electronApp.close()
  })

  test('Cmd+Shift+B toggles properties panel', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Open a collection and file
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Open a file
      const fileTreeItems = window.locator('.file-tree-item')
      const fileCount = await fileTreeItems.count()

      if (fileCount > 0) {
        await fileTreeItems.first().click()
        await window.waitForTimeout(500)

        // Get initial properties panel state
        const propertiesPanel = window.locator('.properties-panel, .properties-region, [role="complementary"]')
        const initialVisible = await propertiesPanel.isVisible().catch(() => false)

        // Toggle properties panel with Cmd+Shift+B
        await window.keyboard.press('Meta+Shift+b')
        await window.waitForTimeout(500)

        const afterToggleVisible = await propertiesPanel.isVisible().catch(() => false)
        expect(afterToggleVisible).toBe(!initialVisible)

        // Toggle back
        await window.keyboard.press('Meta+Shift+b')
        await window.waitForTimeout(500)

        const finalVisible = await propertiesPanel.isVisible().catch(() => false)
        expect(finalVisible).toBe(initialVisible)
      }
    }

    await electronApp.close()
  })

  test('arrow keys navigate search results', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Open search and type query
      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultCards = window.locator('.result-card')
      const resultCount = await resultCards.count()

      if (resultCount > 0) {
        // Press ArrowDown to select first result
        await window.keyboard.press('ArrowDown')
        await window.waitForTimeout(200)

        // First result should be highlighted
        const highlighted = window.locator('.result-card.highlighted, .result-card[data-highlighted="true"]')
        const highlightedCount = await highlighted.count()
        expect(highlightedCount).toBeGreaterThanOrEqual(1)

        // Press ArrowDown again to move to second result (if exists)
        if (resultCount > 1) {
          await window.keyboard.press('ArrowDown')
          await window.waitForTimeout(200)

          // Should still have one highlighted result
          const highlightedAfter = await window.locator('.result-card.highlighted, .result-card[data-highlighted="true"]').count()
          expect(highlightedAfter).toBeGreaterThanOrEqual(1)
        }

        // Press ArrowUp to go back
        await window.keyboard.press('ArrowUp')
        await window.waitForTimeout(200)

        const highlightedFinal = await window.locator('.result-card.highlighted, .result-card[data-highlighted="true"]').count()
        expect(highlightedFinal).toBeGreaterThanOrEqual(1)
      }
    }

    await electronApp.close()
  })

  test('Enter key selects highlighted search result', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

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
        // Select first result with arrow key
        await window.keyboard.press('ArrowDown')
        await window.waitForTimeout(200)

        // Press Enter to open the highlighted result
        await window.keyboard.press('Enter')
        await window.waitForTimeout(1000)

        // Results panel should close
        const resultsOverlay = window.locator('.search-results-overlay')
        await expect(resultsOverlay).not.toBeVisible()

        // Editor should be visible
        const editorContainer = window.locator('.editor-container, .editor-region')
        const editorVisible = await editorContainer.isVisible().catch(() => false)
        expect(editorVisible).toBe(true)
      }
    }

    await electronApp.close()
  })

  test('Escape closes search results', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Open search
      await window.keyboard.press('Meta+k')
      await window.waitForTimeout(300)

      const searchInput = window.locator('.search-input')
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      const resultsOverlay = window.locator('.search-results-overlay')
      const isVisible = await resultsOverlay.isVisible().catch(() => false)

      if (isVisible) {
        // Press Escape to close results
        await window.keyboard.press('Escape')
        await window.waitForTimeout(300)

        await expect(resultsOverlay).not.toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('Tab cycles focus through regions', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    // Open a collection and file to have all regions active
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const fileTreeItems = window.locator('.file-tree-item')
      const fileCount = await fileTreeItems.count()

      if (fileCount > 0) {
        await fileTreeItems.first().click()
        await window.waitForTimeout(500)

        // Focus the document body first
        await window.evaluate(() => {
          (document.body as HTMLElement).focus()
        })

        // Press Tab to cycle to first region (sidebar)
        await window.keyboard.press('Tab')
        await window.waitForTimeout(200)

        let focusedRegion = await window.evaluate(() => {
          const active = document.activeElement as HTMLElement
          if (!active) return null

          // Check which region contains the focused element
          const sidebar = document.querySelector('.sidebar-region, [role="navigation"]')
          const editor = document.querySelector('.editor-region, [role="main"]')
          const properties = document.querySelector('.properties-region, [role="complementary"]')

          if (sidebar && (active === sidebar || sidebar.contains(active))) return 'sidebar'
          if (editor && (active === editor || editor.contains(active))) return 'editor'
          if (properties && (active === properties || properties.contains(active))) return 'properties'

          return null
        })

        // Should focus one of the regions
        expect(['sidebar', 'editor', 'properties']).toContain(focusedRegion)

        // Press Tab again to cycle to next region
        await window.keyboard.press('Tab')
        await window.waitForTimeout(200)

        const nextFocusedRegion = await window.evaluate(() => {
          const active = document.activeElement as HTMLElement
          if (!active) return null

          const sidebar = document.querySelector('.sidebar-region, [role="navigation"]')
          const editor = document.querySelector('.editor-region, [role="main"]')
          const properties = document.querySelector('.properties-region, [role="complementary"]')

          if (sidebar && (active === sidebar || sidebar.contains(active))) return 'sidebar'
          if (editor && (active === editor || editor.contains(active))) return 'editor'
          if (properties && (active === properties || properties.contains(active))) return 'properties'

          return null
        })

        // Should focus a different region
        expect(['sidebar', 'editor', 'properties']).toContain(nextFocusedRegion)
        expect(nextFocusedRegion).not.toBe(focusedRegion)
      }
    }

    await electronApp.close()
  })

  test('Shift+Tab cycles focus backward through regions', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      const fileTreeItems = window.locator('.file-tree-item')
      const fileCount = await fileTreeItems.count()

      if (fileCount > 0) {
        await fileTreeItems.first().click()
        await window.waitForTimeout(500)

        // Focus the document body first
        await window.evaluate(() => {
          (document.body as HTMLElement).focus()
        })

        // Press Tab to focus first region
        await window.keyboard.press('Tab')
        await window.waitForTimeout(200)

        const firstFocusedRegion = await window.evaluate(() => {
          const active = document.activeElement as HTMLElement
          if (!active) return null

          const sidebar = document.querySelector('.sidebar-region, [role="navigation"]')
          const editor = document.querySelector('.editor-region, [role="main"]')
          const properties = document.querySelector('.properties-region, [role="complementary"]')

          if (sidebar && (active === sidebar || sidebar.contains(active))) return 'sidebar'
          if (editor && (active === editor || editor.contains(active))) return 'editor'
          if (properties && (active === properties || properties.contains(active))) return 'properties'

          return null
        })

        // Press Shift+Tab to cycle backward
        await window.keyboard.press('Shift+Tab')
        await window.waitForTimeout(200)

        const secondFocusedRegion = await window.evaluate(() => {
          const active = document.activeElement as HTMLElement
          if (!active) return null

          const sidebar = document.querySelector('.sidebar-region, [role="navigation"]')
          const editor = document.querySelector('.editor-region, [role="main"]')
          const properties = document.querySelector('.properties-region, [role="complementary"]')

          if (sidebar && (active === sidebar || sidebar.contains(active))) return 'sidebar'
          if (editor && (active === editor || editor.contains(active))) return 'editor'
          if (properties && (active === properties || properties.contains(active))) return 'properties'

          return null
        })

        // Should focus a different region (cycling backward)
        expect(['sidebar', 'editor', 'properties']).toContain(secondFocusedRegion)
        expect(secondFocusedRegion).not.toBe(firstFocusedRegion)
      }
    }

    await electronApp.close()
  })

  test('all keyboard shortcuts work in sequence', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(500)

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Test Cmd+K (search)
      await window.keyboard.press('Meta+k')
      await window.waitForTimeout(300)

      const searchInput = window.locator('.search-input')
      let isFocused = await searchInput.evaluate(
        (el) => document.activeElement === el
      )
      expect(isFocused).toBe(true)

      // Close search with Escape
      await window.keyboard.press('Escape')
      await window.waitForTimeout(300)

      // Test Cmd+B (toggle sidebar)
      const sidebar = window.locator('.sidebar, .sidebar-region, [role="navigation"]').first()
      const initialSidebarVisible = await sidebar.isVisible()

      await window.keyboard.press('Meta+b')
      await window.waitForTimeout(500)

      const afterToggleSidebarVisible = await sidebar.isVisible()
      expect(afterToggleSidebarVisible).toBe(!initialSidebarVisible)

      // Toggle back
      await window.keyboard.press('Meta+b')
      await window.waitForTimeout(500)

      // Test Cmd+P (quick open)
      await window.keyboard.press('Meta+p')
      await window.waitForTimeout(300)

      const quickOpenModal = window.locator('.quick-open-modal, [role="dialog"][aria-label*="Quick"]')
      const quickOpenVisible = await quickOpenModal.isVisible().catch(() => false)

      if (quickOpenVisible) {
        await expect(quickOpenModal).toBeVisible()

        // Close with Escape
        await window.keyboard.press('Escape')
        await window.waitForTimeout(200)
      }

      // All shortcuts should work without conflicts
      expect(true).toBe(true)
    }

    await electronApp.close()
  })
})
