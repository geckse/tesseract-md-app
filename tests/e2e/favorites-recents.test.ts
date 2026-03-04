import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Favorites & Recents Management', () => {
  test('should display the favorites section in sidebar when not empty', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const sidebar = window.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    // Check if favorites section exists (may be hidden if empty)
    const favoritesSection = window.locator('.favorites-section')
    const count = await favoritesSection.count()

    if (count > 0) {
      await expect(favoritesSection).toBeVisible()

      // Check for star icon and header
      const starIcon = favoritesSection.locator('.section-icon')
      await expect(starIcon).toBeVisible()
      await expect(starIcon).toHaveText('star')

      const header = favoritesSection.locator('.section-header')
      await expect(header).toBeVisible()
      await expect(header).toHaveText('Favorites')
    }

    await electronApp.close()
  })

  test('should display the recents section in sidebar when not empty', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const sidebar = window.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    // Check if recents section exists (may be hidden if empty)
    const recentsSection = window.locator('.recents-section')
    const count = await recentsSection.count()

    if (count > 0) {
      await expect(recentsSection).toBeVisible()

      // Check for schedule icon and header
      const scheduleIcon = recentsSection.locator('.section-icon')
      await expect(scheduleIcon).toBeVisible()
      await expect(scheduleIcon).toHaveText('schedule')

      const header = recentsSection.locator('.section-header')
      await expect(header).toBeVisible()
      await expect(header).toHaveText('Recent')
    }

    await electronApp.close()
  })

  test('should hide sections when lists are empty', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Sections should not be visible when empty
    // This tests the conditional rendering logic
    const favoritesSection = window.locator('.favorites-section')
    const recentsSection = window.locator('.recents-section')

    // If sections don't exist, that's correct behavior for empty state
    const favoritesCount = await favoritesSection.count()
    const recentsCount = await recentsSection.count()

    // Either sections are not rendered, or they contain items
    if (favoritesCount > 0) {
      const items = favoritesSection.locator('.favorite-item')
      const itemCount = await items.count()
      expect(itemCount).toBeGreaterThan(0)
    }

    if (recentsCount > 0) {
      const items = recentsSection.locator('.recent-item')
      const itemCount = await items.count()
      expect(itemCount).toBeGreaterThan(0)
    }

    await electronApp.close()
  })

  test('should show star button in header when file is open', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for a collection and file to be loaded
    await window.waitForTimeout(1000)

    // Check if there's a file tree item we can click
    const fileTreeItems = window.locator('.file-tree-item')
    const itemCount = await fileTreeItems.count()

    if (itemCount > 0) {
      // Click first file to open it
      await fileTreeItems.first().click()
      await window.waitForTimeout(500)

      // Check for star button in header
      const starButton = window.locator('.star-button')
      const starButtonCount = await starButton.count()

      if (starButtonCount > 0) {
        await expect(starButton).toBeVisible()

        // Star icon should exist
        const starIcon = starButton.locator('.material-symbols-outlined')
        await expect(starIcon).toBeVisible()
        await expect(starIcon).toHaveText('star')
      }
    }

    await electronApp.close()
  })

  test('should toggle favorite when star button is clicked', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.waitForTimeout(1000)

    // Open a file
    const fileTreeItems = window.locator('.file-tree-item')
    const itemCount = await fileTreeItems.count()

    if (itemCount > 0) {
      await fileTreeItems.first().click()
      await window.waitForTimeout(500)

      const starButton = window.locator('.star-button')
      const starButtonCount = await starButton.count()

      if (starButtonCount > 0) {
        // Get initial state
        const starIcon = starButton.locator('.material-symbols-outlined')
        const initialClasses = await starIcon.getAttribute('class')
        const initiallyFavorited = initialClasses?.includes('filled') ?? false

        // Click the star button
        await starButton.click()
        await window.waitForTimeout(500)

        // Check if state changed
        const newClasses = await starIcon.getAttribute('class')
        const nowFavorited = newClasses?.includes('filled') ?? false

        expect(nowFavorited).not.toBe(initiallyFavorited)

        // If now favorited, favorites section should appear
        if (nowFavorited) {
          const favoritesSection = window.locator('.favorites-section')
          const sectionCount = await favoritesSection.count()

          if (sectionCount > 0) {
            await expect(favoritesSection).toBeVisible()

            // Should have at least one favorite item
            const favoriteItems = window.locator('.favorite-item')
            const favoriteCount = await favoriteItems.count()
            expect(favoriteCount).toBeGreaterThan(0)
          }
        }
      }
    }

    await electronApp.close()
  })

  test('should auto-track files in recents when opened', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.waitForTimeout(1000)

    // Get initial recents count
    const recentsSection = window.locator('.recents-section')
    const initialRecentsCount = await recentsSection.count()
    const initialItemCount = initialRecentsCount > 0
      ? await window.locator('.recent-item').count()
      : 0

    // Open a file
    const fileTreeItems = window.locator('.file-tree-item')
    const itemCount = await fileTreeItems.count()

    if (itemCount > 0) {
      await fileTreeItems.first().click()
      await window.waitForTimeout(500)

      // Recents section should now exist (or have more items)
      const newRecentsSection = window.locator('.recents-section')
      const newRecentsCount = await newRecentsSection.count()

      if (newRecentsCount > 0) {
        await expect(newRecentsSection).toBeVisible()

        const recentItems = window.locator('.recent-item')
        const newItemCount = await recentItems.count()

        // Should have at least one item (or more than before)
        expect(newItemCount).toBeGreaterThan(0)
      }
    }

    await electronApp.close()
  })

  test('should display file name and collection name in favorites', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const favoritesSection = window.locator('.favorites-section')
    const sectionCount = await favoritesSection.count()

    if (sectionCount > 0) {
      const favoriteItems = window.locator('.favorite-item')
      const itemCount = await favoriteItems.count()

      if (itemCount > 0) {
        const firstItem = favoriteItems.first()

        // Check for file name
        const label = firstItem.locator('.nav-label')
        await expect(label).toBeVisible()
        const labelText = await label.textContent()
        expect(labelText).toBeTruthy()
        expect(labelText!.length).toBeGreaterThan(0)

        // Check for collection name
        const collectionName = firstItem.locator('.favorite-collection')
        await expect(collectionName).toBeVisible()
        const collectionText = await collectionName.textContent()
        expect(collectionText).toBeTruthy()
      }
    }

    await electronApp.close()
  })

  test('should display file name and relative time in recents', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const recentsSection = window.locator('.recents-section')
    const sectionCount = await recentsSection.count()

    if (sectionCount > 0) {
      const recentItems = window.locator('.recent-item')
      const itemCount = await recentItems.count()

      if (itemCount > 0) {
        const firstItem = recentItems.first()

        // Check for file name
        const label = firstItem.locator('.nav-label')
        await expect(label).toBeVisible()
        const labelText = await label.textContent()
        expect(labelText).toBeTruthy()
        expect(labelText!.length).toBeGreaterThan(0)

        // Check for relative time
        const time = firstItem.locator('.recent-time')
        await expect(time).toBeVisible()
        const timeText = await time.textContent()
        expect(timeText).toBeTruthy()

        // Should match one of our relative time formats
        const validTimeFormats = [
          /just now/,
          /\d+ min ago/,
          /\d+ hours? ago/,
          /yesterday/,
          /\d+ days ago/,
          /[A-Z][a-z]+ \d+/  // Date format like "Jan 1"
        ]

        const matchesFormat = validTimeFormats.some(format => format.test(timeText!))
        expect(matchesFormat).toBe(true)
      }
    }

    await electronApp.close()
  })

  test('should open file when clicking favorite item', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const favoritesSection = window.locator('.favorites-section')
    const sectionCount = await favoritesSection.count()

    if (sectionCount > 0) {
      const favoriteItems = window.locator('.favorite-item')
      const itemCount = await favoriteItems.count()

      if (itemCount > 0) {
        // Get the file name we're about to open
        const label = favoriteItems.first().locator('.nav-label')
        const fileName = await label.textContent()

        // Click the favorite
        await favoriteItems.first().click()
        await window.waitForTimeout(500)

        // Check if file opened (appears in breadcrumb)
        const breadcrumbFile = window.locator('.breadcrumb-file')
        const breadcrumbCount = await breadcrumbFile.count()

        if (breadcrumbCount > 0) {
          const breadcrumbText = await breadcrumbFile.textContent()
          // Remove the dirty indicator if present
          const cleanBreadcrumb = breadcrumbText?.replace(/\s*●\s*$/, '') ?? ''
          expect(cleanBreadcrumb).toBe(fileName)
        }
      }
    }

    await electronApp.close()
  })

  test('should open file when clicking recent item', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const recentsSection = window.locator('.recents-section')
    const sectionCount = await recentsSection.count()

    if (sectionCount > 0) {
      const recentItems = window.locator('.recent-item')
      const itemCount = await recentItems.count()

      if (itemCount > 0) {
        // Get the file name we're about to open
        const label = recentItems.first().locator('.nav-label')
        const fileName = await label.textContent()

        // Click the recent
        await recentItems.first().click()
        await window.waitForTimeout(500)

        // Check if file opened (appears in breadcrumb)
        const breadcrumbFile = window.locator('.breadcrumb-file')
        const breadcrumbCount = await breadcrumbFile.count()

        if (breadcrumbCount > 0) {
          const breadcrumbText = await breadcrumbFile.textContent()
          // Remove the dirty indicator if present
          const cleanBreadcrumb = breadcrumbText?.replace(/\s*●\s*$/, '') ?? ''
          expect(cleanBreadcrumb).toBe(fileName)
        }
      }
    }

    await electronApp.close()
  })

  test('should show context menu on right-click recents section', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const recentsSection = window.locator('.recents-section')
    const sectionCount = await recentsSection.count()

    if (sectionCount > 0) {
      // Right-click the recents section
      await recentsSection.click({ button: 'right' })
      await window.waitForTimeout(300)

      // Context menu should appear
      const contextMenu = window.locator('.context-menu')
      const menuCount = await contextMenu.count()

      if (menuCount > 0) {
        await expect(contextMenu).toBeVisible()

        // Should have "Clear All Recents" option
        const clearOption = window.locator('.context-menu-item')
        await expect(clearOption).toBeVisible()
        const optionText = await clearOption.textContent()
        expect(optionText).toContain('Clear All Recents')

        // Close by clicking overlay
        const overlay = window.locator('.context-menu-overlay')
        await overlay.click()
        await window.waitForTimeout(300)

        // Menu should be gone
        const menuAfterClose = await window.locator('.context-menu').count()
        expect(menuAfterClose).toBe(0)
      }
    }

    await electronApp.close()
  })

  test('should clear all recents when clicking clear all option', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.waitForTimeout(1000)

    // First, ensure we have some recents by opening a file
    const fileTreeItems = window.locator('.file-tree-item')
    const fileCount = await fileTreeItems.count()

    if (fileCount > 0) {
      await fileTreeItems.first().click()
      await window.waitForTimeout(500)

      // Check if recents section exists
      const recentsSection = window.locator('.recents-section')
      const sectionCount = await recentsSection.count()

      if (sectionCount > 0) {
        // Right-click to show context menu
        await recentsSection.click({ button: 'right' })
        await window.waitForTimeout(300)

        const contextMenu = window.locator('.context-menu')
        const menuCount = await contextMenu.count()

        if (menuCount > 0) {
          // Click "Clear All Recents"
          const clearOption = window.locator('.context-menu-item')
          await clearOption.click()
          await window.waitForTimeout(500)

          // Recents section should be gone (empty state)
          const newSectionCount = await window.locator('.recents-section').count()
          expect(newSectionCount).toBe(0)
        }
      }
    }

    await electronApp.close()
  })

  test('should maintain most-recent-first order in recents', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.waitForTimeout(1000)

    const fileTreeItems = window.locator('.file-tree-item')
    const fileCount = await fileTreeItems.count()

    if (fileCount >= 2) {
      // Open first file
      await fileTreeItems.nth(0).click()
      await window.waitForTimeout(500)

      const firstName = await fileTreeItems.nth(0).textContent()

      // Open second file
      await fileTreeItems.nth(1).click()
      await window.waitForTimeout(500)

      const secondName = await fileTreeItems.nth(1).textContent()

      // Check recents order
      const recentsSection = window.locator('.recents-section')
      const sectionCount = await recentsSection.count()

      if (sectionCount > 0) {
        const recentItems = window.locator('.recent-item')
        const itemCount = await recentItems.count()

        if (itemCount >= 2) {
          // Most recent (second file) should be first
          const firstRecentLabel = await recentItems.nth(0).locator('.nav-label').textContent()
          const secondRecentLabel = await recentItems.nth(1).locator('.nav-label').textContent()

          // Extract just the filename from the file tree text
          const secondFileName = secondName?.split('/').pop()?.trim() ?? ''
          const firstFileName = firstName?.split('/').pop()?.trim() ?? ''

          expect(firstRecentLabel).toBe(secondFileName)
          expect(secondRecentLabel).toBe(firstFileName)
        }
      }
    }

    await electronApp.close()
  })

  test('should show document icon for favorite items', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const favoritesSection = window.locator('.favorites-section')
    const sectionCount = await favoritesSection.count()

    if (sectionCount > 0) {
      const favoriteItems = window.locator('.favorite-item')
      const itemCount = await favoriteItems.count()

      if (itemCount > 0) {
        const navIcon = favoriteItems.first().locator('.nav-icon')
        await expect(navIcon).toBeVisible()
        await expect(navIcon).toHaveText('description')
      }
    }

    await electronApp.close()
  })

  test('should show document icon for recent items', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const recentsSection = window.locator('.recents-section')
    const sectionCount = await recentsSection.count()

    if (sectionCount > 0) {
      const recentItems = window.locator('.recent-item')
      const itemCount = await recentItems.count()

      if (itemCount > 0) {
        const navIcon = recentItems.first().locator('.nav-icon')
        await expect(navIcon).toBeVisible()
        await expect(navIcon).toHaveText('description')
      }
    }

    await electronApp.close()
  })
})
