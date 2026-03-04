import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../../out/main/index.js')

// Helper to inject and run axe-core
async function injectAxe(page: any) {
  // Inject axe-core from CDN
  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.7.2/axe.min.js'
  })
}

async function runAxe(page: any) {
  return await page.evaluate(() => {
    // @ts-ignore - axe is injected at runtime
    return window.axe.run()
  })
}

interface AxeResult {
  violations: Array<{
    id: string
    impact: 'minor' | 'moderate' | 'serious' | 'critical'
    description: string
    help: string
    helpUrl: string
    nodes: Array<{
      html: string
      target: string[]
      failureSummary: string
    }>
  }>
  passes: any[]
  incomplete: any[]
  inapplicable: any[]
}

test.describe('Accessibility', () => {
  test('should have no critical or serious axe-core violations on main window', async () => {
    const electronApp = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000) // Wait for components to render

    // Inject axe-core
    await injectAxe(window)

    // Run axe accessibility audit
    const results = (await runAxe(window)) as AxeResult

    // Filter for critical and serious violations
    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    // Log violations for debugging
    if (criticalViolations.length > 0) {
      console.log('\n=== Critical/Serious Accessibility Violations ===')
      criticalViolations.forEach((violation) => {
        console.log(`\n${violation.impact.toUpperCase()}: ${violation.id}`)
        console.log(`Description: ${violation.description}`)
        console.log(`Help: ${violation.help}`)
        console.log(`Help URL: ${violation.helpUrl}`)
        console.log('Affected elements:')
        violation.nodes.forEach((node) => {
          console.log(`  - ${node.html}`)
          console.log(`    Target: ${node.target.join(' > ')}`)
        })
      })
      console.log('=== End Violations ===\n')
    }

    // Assert no critical or serious violations
    expect(criticalViolations).toHaveLength(0)

    await electronApp.close()
  })

  test('should have no critical or serious violations with collection open', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection if available
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)
    }

    // Inject axe-core
    await injectAxe(window)

    // Run axe accessibility audit
    const results = (await runAxe(window)) as AxeResult

    // Filter for critical and serious violations
    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    // Log violations for debugging
    if (criticalViolations.length > 0) {
      console.log('\n=== Critical/Serious Accessibility Violations (Collection Open) ===')
      criticalViolations.forEach((violation) => {
        console.log(`\n${violation.impact.toUpperCase()}: ${violation.id}`)
        console.log(`Description: ${violation.description}`)
        console.log(`Help: ${violation.help}`)
        console.log(`Help URL: ${violation.helpUrl}`)
        console.log('Affected elements:')
        violation.nodes.forEach((node) => {
          console.log(`  - ${node.html}`)
          console.log(`    Target: ${node.target.join(' > ')}`)
        })
      })
      console.log('=== End Violations ===\n')
    }

    // Assert no critical or serious violations
    expect(criticalViolations).toHaveLength(0)

    await electronApp.close()
  })

  test('should have no critical or serious violations with search results open', async () => {
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

      // Perform a search
      const searchInput = window.locator('.search-input')
      await searchInput.click()
      await searchInput.fill('test')
      await window.waitForTimeout(1000)

      // Inject axe-core
      await injectAxe(window)

      // Run axe accessibility audit
      const results = (await runAxe(window)) as AxeResult

      // Filter for critical and serious violations
      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      // Log violations for debugging
      if (criticalViolations.length > 0) {
        console.log('\n=== Critical/Serious Accessibility Violations (Search Results) ===')
        criticalViolations.forEach((violation) => {
          console.log(`\n${violation.impact.toUpperCase()}: ${violation.id}`)
          console.log(`Description: ${violation.description}`)
          console.log(`Help: ${violation.help}`)
          console.log(`Help URL: ${violation.helpUrl}`)
          console.log('Affected elements:')
          violation.nodes.forEach((node) => {
            console.log(`  - ${node.html}`)
            console.log(`    Target: ${node.target.join(' > ')}`)
          })
        })
        console.log('=== End Violations ===\n')
      }

      // Assert no critical or serious violations
      expect(criticalViolations).toHaveLength(0)
    }

    await electronApp.close()
  })

  test('should have no critical or serious violations with metadata panel', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Open a collection and file
    const collectionItems = window.locator('.collection-item')
    const count = await collectionItems.count()

    if (count > 0) {
      await collectionItems.first().click()
      await window.waitForTimeout(1000)

      // Open a file from the tree
      const fileTreeItems = window.locator('.file-tree-item')
      const fileCount = await fileTreeItems.count()

      if (fileCount > 0) {
        await fileTreeItems.first().click()
        await window.waitForTimeout(1000)

        // Open metadata panel if available
        const metadataButton = window.locator('[aria-label*="metadata"], [title*="metadata"]')
        const metadataExists = await metadataButton.count()

        if (metadataExists > 0) {
          await metadataButton.first().click()
          await window.waitForTimeout(500)
        }

        // Inject axe-core
        await injectAxe(window)

        // Run axe accessibility audit
        const results = (await runAxe(window)) as AxeResult

        // Filter for critical and serious violations
        const criticalViolations = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious'
        )

        // Log violations for debugging
        if (criticalViolations.length > 0) {
          console.log('\n=== Critical/Serious Accessibility Violations (Metadata Panel) ===')
          criticalViolations.forEach((violation) => {
            console.log(`\n${violation.impact.toUpperCase()}: ${violation.id}`)
            console.log(`Description: ${violation.description}`)
            console.log(`Help: ${violation.help}`)
            console.log(`Help URL: ${violation.helpUrl}`)
            console.log('Affected elements:')
            violation.nodes.forEach((node) => {
              console.log(`  - ${node.html}`)
              console.log(`    Target: ${node.target.join(' > ')}`)
            })
          })
          console.log('=== End Violations ===\n')
        }

        // Assert no critical or serious violations
        expect(criticalViolations).toHaveLength(0)
      }
    }

    await electronApp.close()
  })

  test('should have proper ARIA labels on interactive elements', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Check search input has proper label
    const searchInput = window.locator('.search-input')
    const searchInputExists = await searchInput.count()

    if (searchInputExists > 0) {
      const hasAriaLabel = await searchInput.evaluate((el) => {
        return (
          el.hasAttribute('aria-label') ||
          el.hasAttribute('aria-labelledby') ||
          (el.id && document.querySelector(`label[for="${el.id}"]`) !== null)
        )
      })
      expect(hasAriaLabel).toBe(true)
    }

    // Check buttons have accessible names
    const buttons = window.locator('button')
    const buttonCount = await buttons.count()

    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const button = buttons.nth(i)
      const isVisible = await button.isVisible()

      if (isVisible) {
        const hasAccessibleName = await button.evaluate((el) => {
          const text = el.textContent?.trim()
          const ariaLabel = el.getAttribute('aria-label')
          const ariaLabelledby = el.getAttribute('aria-labelledby')
          const title = el.getAttribute('title')

          return !!(text || ariaLabel || ariaLabelledby || title)
        })

        expect(hasAccessibleName).toBe(true)
      }
    }

    await electronApp.close()
  })

  test('should have proper heading hierarchy', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Check heading levels are sequential
    const headings = await window.evaluate(() => {
      const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
      return Array.from(headingElements).map((el) => {
        const level = parseInt(el.tagName.substring(1))
        return { level, text: el.textContent?.trim() }
      })
    })

    if (headings.length > 0) {
      // Should start with h1 or h2
      expect(headings[0].level).toBeLessThanOrEqual(2)

      // Check for no skipped levels
      for (let i = 1; i < headings.length; i++) {
        const levelDiff = headings[i].level - headings[i - 1].level
        // Level can stay same, go down any amount, or go up by 1
        expect(levelDiff).toBeLessThanOrEqual(1)
      }
    }

    await electronApp.close()
  })

  test('should have sufficient color contrast', async () => {
    const electronApp = await electron.launch({
      args: [appPath]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForTimeout(1000)

    // Inject axe-core
    await injectAxe(window)

    // Run axe with only color-contrast rule
    const results = (await window.evaluate(() => {
      // @ts-ignore
      return window.axe.run({
        runOnly: ['color-contrast']
      })
    })) as AxeResult

    // Filter for critical and serious violations
    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    // Log violations for debugging
    if (criticalViolations.length > 0) {
      console.log('\n=== Color Contrast Violations ===')
      criticalViolations.forEach((violation) => {
        console.log(`\n${violation.impact.toUpperCase()}: ${violation.id}`)
        console.log(`Description: ${violation.description}`)
        violation.nodes.forEach((node) => {
          console.log(`  - ${node.html}`)
        })
      })
      console.log('=== End Violations ===\n')
    }

    // Assert no critical or serious contrast violations
    expect(criticalViolations).toHaveLength(0)

    await electronApp.close()
  })
})
