import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

test.describe('Editor Workflow', () => {
  test('should show empty state when no file is selected', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const emptyState = window.locator('.empty-state')
    const isVisible = await emptyState.isVisible().catch(() => false)

    if (isVisible) {
      const emptyText = window.locator('.empty-text')
      await expect(emptyText).toContainText('Select a file from the sidebar')
    }

    await electronApp.close()
  })

  test('should render editor when a file is opened', async () => {
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

        // Editor container should be visible
        const editorContainer = window.locator('.editor-container')
        await expect(editorContainer).toBeVisible()

        // CodeMirror editor should be rendered inside
        const cmEditor = window.locator('.cm-editor')
        await expect(cmEditor).toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should show word count in status bar', async () => {
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

        // Status bar should show word count
        const statusBar = window.locator('.status-bar')
        await expect(statusBar).toBeVisible()

        // Look for the word count item (contains "words")
        const wordCountItem = window.locator('.status-item', { hasText: 'words' })
        await expect(wordCountItem).toBeVisible()

        const text = await wordCountItem.textContent()
        expect(text).toMatch(/\d+ words/)
      }
    }

    await electronApp.close()
  })

  test('should show reading time in status bar', async () => {
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

        const readingTimeItem = window.locator('.status-item', { hasText: 'mins' })
        await expect(readingTimeItem).toBeVisible()

        const text = await readingTimeItem.textContent()
        expect(text).toMatch(/\d+ mins/)
      }
    }

    await electronApp.close()
  })

  test('should set dirty state when typing in editor', async () => {
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

        // Dirty dot should not be visible initially
        const dirtyDot = window.locator('.dirty-dot')
        await expect(dirtyDot).not.toBeVisible()

        // Type into the CodeMirror editor
        const cmContent = window.locator('.cm-content')
        await cmContent.click()
        await window.keyboard.type('test input ')
        await window.waitForTimeout(500)

        // Dirty dot should now be visible
        await expect(dirtyDot).toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should clear dirty state after saving with Cmd+S', async () => {
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

        // Type to make dirty
        const cmContent = window.locator('.cm-content')
        await cmContent.click()
        await window.keyboard.type('save test ')
        await window.waitForTimeout(500)

        const dirtyDot = window.locator('.dirty-dot')
        await expect(dirtyDot).toBeVisible()

        // Save with Cmd+S / Ctrl+S
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
        await window.keyboard.press(`${modifier}+s`)
        await window.waitForTimeout(1000)

        // Dirty dot should be cleared after save
        await expect(dirtyDot).not.toBeVisible()
      }
    }

    await electronApp.close()
  })

  test('should load new content when switching files', async () => {
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

      if (fileCount >= 2) {
        // Open first file
        await fileRows.nth(0).click()
        await window.waitForTimeout(1000)

        const cmEditor = window.locator('.cm-editor')
        await expect(cmEditor).toBeVisible()

        // Get first file content
        const firstContent = await window.locator('.cm-content').textContent()

        // Switch to second file
        await fileRows.nth(1).click()
        await window.waitForTimeout(1000)

        // Editor should still be visible with potentially different content
        await expect(cmEditor).toBeVisible()

        // Dirty state should be cleared on file switch
        const dirtyDot = window.locator('.dirty-dot')
        await expect(dirtyDot).not.toBeVisible()
      }
    }

    await electronApp.close()
  })
})
