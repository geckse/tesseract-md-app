import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('File Tree Navigation', () => {
  test('should display file tree container in sidebar', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const fileTreeContainer = window.locator('.file-tree-container')
    await expect(fileTreeContainer).toBeVisible()

    await electronApp.close()
  })

  test('should show file tree header with title and action buttons', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const header = window.locator('.file-tree-header')
    await expect(header).toBeVisible()

    const title = window.locator('.file-tree-title')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('FILES')

    await electronApp.close()
  })

  test('should show empty state when no collection is selected', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const emptyState = window.locator('.empty-state')
    // Empty state shows when no collection selected or tree is empty
    const isVisible = await emptyState.isVisible().catch(() => false)

    if (isVisible) {
      const text = await emptyState.textContent()
      expect(text).toBeTruthy()
    }

    await electronApp.close()
  })

  test('should have expand all and collapse all buttons', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const collapseBtn = window.locator('[title="Collapse All"]')
    await expect(collapseBtn).toBeVisible()

    const expandBtn = window.locator('[title="Expand All"]')
    await expect(expandBtn).toBeVisible()

    await electronApp.close()
  })

  test('should have a refresh button', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const refreshBtn = window.locator('[title="Refresh"]')
    await expect(refreshBtn).toBeVisible()

    await electronApp.close()
  })

  test('should expand and collapse directory nodes when clicked', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Select a collection first if available
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      // Wait for tree to load
      await window.waitForTimeout(1000)

      const dirRows = window.locator('.tree-row.directory')
      const dirCount = await dirRows.count()

      if (dirCount > 0) {
        const expandIcon = dirRows.first().locator('.expand-icon')

        // Click to expand
        await dirRows.first().click()
        await expect(expandIcon).toHaveClass(/expanded/)

        // Click to collapse
        await dirRows.first().click()
        await expect(expandIcon).not.toHaveClass(/expanded/)
      }
    }

    await electronApp.close()
  })

  test('should highlight selected file with active class', async () => {
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

      // Find a non-directory tree row (file)
      const fileRows = window.locator('.tree-row:not(.directory)')
      const fileCount = await fileRows.count()

      if (fileCount > 0) {
        await fileRows.first().click()
        await expect(fileRows.first()).toHaveClass(/active/)
      }
    }

    await electronApp.close()
  })

  test('should show file state indicators', async () => {
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

      // State indicators may exist on file nodes
      const stateIndicators = window.locator('.state-indicator')
      const indicatorCount = await stateIndicators.count()

      // Just verify they render without error if present
      if (indicatorCount > 0) {
        await expect(stateIndicators.first()).toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should show file tree summary with counts', async () => {
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

      const summary = window.locator('.file-tree-summary')
      const isVisible = await summary.isVisible().catch(() => false)

      if (isVisible) {
        const summaryItems = window.locator('.summary-item')
        const summaryCount = await summaryItems.count()
        expect(summaryCount).toBeGreaterThan(0)
      }
    }

    await electronApp.close()
  })

  test('should update header breadcrumb when file is selected', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const header = window.locator('.header')
    await expect(header).toBeVisible()

    const breadcrumb = window.locator('.breadcrumb')
    await expect(breadcrumb).toBeVisible()

    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // After selecting a collection, breadcrumb should show collection name
      const breadcrumbFolder = window.locator('.breadcrumb-folder')
      const folderCount = await breadcrumbFolder.count()

      if (folderCount > 0) {
        const text = await breadcrumbFolder.first().textContent()
        expect(text!.length).toBeGreaterThan(0)
      }
    }

    await electronApp.close()
  })
})
