import { expect, type Locator, type Page } from '@playwright/test'

export const EXAMPLE_COLLECTION_NAME = 'Tesseract Example'
export const EXAMPLE_FILE_COUNT = 8

/** Wait until the disposable indexed guide is visible and ready for UI tests. */
export async function waitForExampleCollection(page: Page): Promise<void> {
  await expect(page.locator('.switcher-label')).toHaveText(EXAMPLE_COLLECTION_NAME, {
    timeout: 15_000
  })
  await expect(page.locator('.file-tree-summary')).toContainText(`${EXAMPLE_FILE_COUNT} files`, {
    timeout: 15_000
  })
}

/** Open one of the generated guide pages through the real virtualized tree. */
export async function openExampleFile(page: Page, filename = 'Start Here.md'): Promise<Locator> {
  await waitForExampleCollection(page)
  const row = page.locator('.tree-row:not(.directory)', { hasText: filename }).first()
  if (!(await row.isVisible().catch(() => false))) {
    await page.getByTitle('Expand All').click()
  }
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await expect(page.getByRole('main', { name: 'Editor' })).toBeVisible({ timeout: 10_000 })
  return row
}

/** Switch the active document to its source editor. */
export async function openRawEditor(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Raw', exact: true }).click()
  const content = page.locator('.cm-content')
  await expect(content).toBeVisible({ timeout: 10_000 })
  return content
}
