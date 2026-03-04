import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Performance', () => {
  test('should render file tree with 1000+ files within 2 seconds', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Find a collection to open
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      // Click on first collection
      await collectionItems.first().click()

      // Measure render time
      const startTime = Date.now()

      // Wait for file tree to load
      await window.waitForSelector('.file-tree-container', { timeout: 3000 })

      // Wait for tree items to appear
      const treeRows = window.locator('.tree-row')
      await treeRows.first().waitFor({ timeout: 3000 })

      const renderTime = Date.now() - startTime

      // Get the count of files in the tree
      const fileCount = await window.evaluate(() => {
        const summaryItems = document.querySelectorAll('.summary-item')
        for (const item of summaryItems) {
          const text = item.textContent || ''
          if (text.includes('file')) {
            const match = text.match(/(\d+)/)
            return match ? parseInt(match[1], 10) : 0
          }
        }
        return 0
      })

      // Log performance metrics
      console.log(`\n=== Performance Metrics ===`)
      console.log(`File count: ${fileCount}`)
      console.log(`Render time: ${renderTime}ms`)
      console.log(`===========================\n`)

      // Assert render time is under 2 seconds
      // Note: This test only validates if there are enough files
      // If the collection has 1000+ files, verify the render time
      if (fileCount >= 1000) {
        expect(renderTime).toBeLessThan(2000)
      } else {
        console.log(
          `⚠️  Warning: Collection has only ${fileCount} files. Need 1000+ for meaningful performance test.`
        )
        // Still verify that rendering doesn't take too long for smaller sets
        expect(renderTime).toBeLessThan(2000)
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })

  test('should maintain smooth scrolling performance with large file tree', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Find the file tree scroll container
      const fileTreeContainer = window.locator('.file-tree-container')
      await expect(fileTreeContainer).toBeVisible()

      // Get scroll container element
      const scrollContainer = fileTreeContainer.locator('.file-tree-scroll')

      // Verify scroll container exists
      const scrollExists = await scrollContainer.count()
      if (scrollExists > 0) {
        // Measure multiple scroll operations
        const scrollMetrics: number[] = []

        for (let i = 0; i < 5; i++) {
          const startTime = Date.now()

          // Scroll by a chunk
          await scrollContainer.evaluate((el, offset) => {
            el.scrollTop = offset * 500
          }, i)

          await window.waitForTimeout(100) // Wait for render

          const scrollTime = Date.now() - startTime
          scrollMetrics.push(scrollTime)
        }

        const avgScrollTime =
          scrollMetrics.reduce((a, b) => a + b, 0) / scrollMetrics.length

        console.log(`\n=== Scroll Performance ===`)
        console.log(`Average scroll time: ${avgScrollTime.toFixed(2)}ms`)
        console.log(`Min: ${Math.min(...scrollMetrics)}ms`)
        console.log(`Max: ${Math.max(...scrollMetrics)}ms`)
        console.log(`==========================\n`)

        // Scrolling should be responsive (under 200ms per scroll event)
        expect(avgScrollTime).toBeLessThan(200)
      } else {
        console.log('⚠️  File tree scroll container not found. Skipping scroll test.')
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })

  test('should only render visible items in virtualized file tree', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Count total files vs rendered DOM nodes
      const metrics = await window.evaluate(() => {
        // Get total file count from summary
        let totalFiles = 0
        const summaryItems = document.querySelectorAll('.summary-item')
        for (const item of summaryItems) {
          const text = item.textContent || ''
          if (text.includes('file')) {
            const match = text.match(/(\d+)/)
            totalFiles = match ? parseInt(match[1], 10) : 0
            break
          }
        }

        // Count rendered DOM nodes
        const renderedNodes = document.querySelectorAll('.tree-row').length

        return {
          totalFiles,
          renderedNodes
        }
      })

      console.log(`\n=== Virtualization Metrics ===`)
      console.log(`Total files: ${metrics.totalFiles}`)
      console.log(`Rendered DOM nodes: ${metrics.renderedNodes}`)
      console.log(
        `Rendering ratio: ${((metrics.renderedNodes / metrics.totalFiles) * 100).toFixed(1)}%`
      )
      console.log(`==============================\n`)

      // If we have many files, verify virtualization is working
      // (rendered nodes should be much less than total files)
      if (metrics.totalFiles >= 100) {
        // With virtualization, we should render much less than 100% of nodes
        // Typically visible items + buffer (e.g., 50-100 items visible at once)
        expect(metrics.renderedNodes).toBeLessThan(metrics.totalFiles)

        // More specifically, for 1000+ files, we shouldn't render more than ~200 items
        if (metrics.totalFiles >= 1000) {
          expect(metrics.renderedNodes).toBeLessThan(300)
        }
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })

  test('should handle rapid scroll events without performance degradation', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Find the scroll container
      const scrollContainer = window.locator('.file-tree-scroll')
      const scrollExists = await scrollContainer.count()

      if (scrollExists > 0) {
        const startTime = Date.now()

        // Rapid scroll simulation (10 quick scrolls)
        for (let i = 0; i < 10; i++) {
          await scrollContainer.evaluate((el, offset) => {
            el.scrollTop = offset * 100 + Math.random() * 100
          }, i)
        }

        // Wait for all renders to settle
        await window.waitForTimeout(500)

        const totalTime = Date.now() - startTime

        console.log(`\n=== Rapid Scroll Test ===`)
        console.log(`Total time for 10 rapid scrolls: ${totalTime}ms`)
        console.log(`Average per scroll: ${(totalTime / 10).toFixed(2)}ms`)
        console.log(`=========================\n`)

        // Rapid scrolling should complete in reasonable time
        // With throttling, should handle bursts without hanging
        expect(totalTime).toBeLessThan(1500)

        // Verify tree is still responsive after rapid scrolling
        const treeRows = window.locator('.tree-row')
        const visibleCount = await treeRows.count()
        expect(visibleCount).toBeGreaterThan(0)
      } else {
        console.log('⚠️  Scroll container not found. Skipping test.')
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })

  test('should expand and collapse directories without lag', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Find directory nodes
      const dirRows = window.locator('.tree-row.directory')
      const dirCount = await dirRows.count()

      if (dirCount > 0) {
        const expandTimes: number[] = []
        const collapseTimes: number[] = []

        // Test first 3 directories (or fewer if not available)
        const testCount = Math.min(3, dirCount)

        for (let i = 0; i < testCount; i++) {
          const dir = dirRows.nth(i)

          // Measure expand time
          const expandStart = Date.now()
          await dir.click()
          await window.waitForTimeout(50) // Wait for animation
          expandTimes.push(Date.now() - expandStart)

          // Measure collapse time
          const collapseStart = Date.now()
          await dir.click()
          await window.waitForTimeout(50) // Wait for animation
          collapseTimes.push(Date.now() - collapseStart)
        }

        const avgExpandTime = expandTimes.reduce((a, b) => a + b, 0) / expandTimes.length
        const avgCollapseTime = collapseTimes.reduce((a, b) => a + b, 0) / collapseTimes.length

        console.log(`\n=== Expand/Collapse Performance ===`)
        console.log(`Average expand time: ${avgExpandTime.toFixed(2)}ms`)
        console.log(`Average collapse time: ${avgCollapseTime.toFixed(2)}ms`)
        console.log(`===================================\n`)

        // Expand/collapse should be responsive (under 300ms including animation)
        expect(avgExpandTime).toBeLessThan(300)
        expect(avgCollapseTime).toBeLessThan(300)
      } else {
        console.log('⚠️  No directories found in tree. Skipping test.')
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })

  test('should handle keyboard navigation with large file tree efficiently', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Click on file tree to focus it
      const fileTree = window.locator('.file-tree-container')
      await fileTree.click()

      // Measure keyboard navigation performance
      const startTime = Date.now()

      // Simulate rapid arrow key presses (10 down, 10 up)
      for (let i = 0; i < 10; i++) {
        await window.keyboard.press('ArrowDown')
        await window.waitForTimeout(20)
      }

      for (let i = 0; i < 10; i++) {
        await window.keyboard.press('ArrowUp')
        await window.waitForTimeout(20)
      }

      const totalTime = Date.now() - startTime

      console.log(`\n=== Keyboard Navigation Performance ===`)
      console.log(`20 arrow key presses completed in: ${totalTime}ms`)
      console.log(`Average per keypress: ${(totalTime / 20).toFixed(2)}ms`)
      console.log(`=======================================\n`)

      // Keyboard navigation should be responsive
      // Even with rendering updates, should complete quickly
      expect(totalTime).toBeLessThan(1000)

      // Verify focus is still visible and tree is responsive
      const focusedRow = window.locator('.tree-row.keyboard-focused')
      const focusExists = await focusedRow.count()

      if (focusExists > 0) {
        await expect(focusedRow).toBeVisible()
      }
    } else {
      console.log('⚠️  No collections found. Skipping test.')
    }

    await electronApp.close()
  })
})
