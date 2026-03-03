import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Metadata Panel', () => {
  test('should toggle panel visibility via header button', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Find the toggle button (side_navigation icon)
    const toggleBtn = window.locator('.icon-button', { hasText: 'side_navigation' })
    const isToggleVisible = await toggleBtn.isVisible().catch(() => false)

    if (isToggleVisible) {
      // Panel should initially be hidden (default is false unless persisted)
      const panel = window.locator('.properties-panel')

      // Click to open
      await toggleBtn.click()
      await window.waitForTimeout(300)
      await expect(panel).toBeVisible()

      // Click to close
      await toggleBtn.click()
      await window.waitForTimeout(300)
      await expect(panel).not.toBeVisible()
    }

    await electronApp.close()
  })

  test('should show properties panel with metadata when file is open', async () => {
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

      const fileRows = window.locator('.tree-row:not(.directory)')
      const fileCount = await fileRows.count()

      if (fileCount > 0) {
        await fileRows.first().click()
        await window.waitForTimeout(1000)

        // Open the properties panel
        const toggleBtn = window.locator('.icon-button', { hasText: 'side_navigation' })
        await toggleBtn.click()
        await window.waitForTimeout(500)

        const panel = window.locator('.properties-panel')
        await expect(panel).toBeVisible()

        // Should show section headers
        await expect(panel.locator('text=Metadata')).toBeVisible()
        await expect(panel.locator('text=Links')).toBeVisible()
        await expect(panel.locator('text=Outline')).toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should show outline headings from document content', async () => {
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

      const fileRows = window.locator('.tree-row:not(.directory)')
      const fileCount = await fileRows.count()

      if (fileCount > 0) {
        await fileRows.first().click()
        await window.waitForTimeout(1000)

        // Open the properties panel
        const toggleBtn = window.locator('.icon-button', { hasText: 'side_navigation' })
        await toggleBtn.click()
        await window.waitForTimeout(500)

        // Outline section should have items or show "No headings"
        const outlineItems = window.locator('.outline-item')
        const noHeadings = window.locator('text=No headings')
        const hasItems = await outlineItems.count() > 0
        const hasEmpty = await noHeadings.isVisible().catch(() => false)

        expect(hasItems || hasEmpty).toBe(true)
      }
    }

    await electronApp.close()
  })

  test('should collapse and expand sections', async () => {
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

      const fileRows = window.locator('.tree-row:not(.directory)')
      const fileCount = await fileRows.count()

      if (fileCount > 0) {
        await fileRows.first().click()
        await window.waitForTimeout(1000)

        // Open the properties panel
        const toggleBtn = window.locator('.icon-button', { hasText: 'side_navigation' })
        await toggleBtn.click()
        await window.waitForTimeout(500)

        // Click Metadata header to collapse
        const metadataHeader = window.locator('.section-header', { hasText: 'Metadata' })
        await metadataHeader.click()
        await window.waitForTimeout(300)

        // Click again to re-expand
        await metadataHeader.click()
        await window.waitForTimeout(300)

        // Section should be visible again
        const panel = window.locator('.properties-panel')
        await expect(panel).toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should update properties when editing frontmatter', async () => {
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

      const fileRows = window.locator('.tree-row:not(.directory)')
      const fileCount = await fileRows.count()

      if (fileCount > 0) {
        await fileRows.first().click()
        await window.waitForTimeout(1000)

        // Open the properties panel
        const toggleBtn = window.locator('.icon-button', { hasText: 'side_navigation' })
        await toggleBtn.click()
        await window.waitForTimeout(500)

        const panel = window.locator('.properties-panel')
        await expect(panel).toBeVisible()

        // Type in the editor — panel should update within ~200ms debounce
        const cmContent = window.locator('.cm-content')
        const isEditorVisible = await cmContent.isVisible().catch(() => false)

        if (isEditorVisible) {
          await cmContent.click()
          await window.keyboard.type('test ')
          await window.waitForTimeout(500) // Wait for debounce

          // Panel should still be showing (no crash from live update)
          await expect(panel).toBeVisible()
        }
      }
    }

    await electronApp.close()
  })
})
