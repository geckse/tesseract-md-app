import { test, expect, _electron as electron, type Page } from '@playwright/test'
import axe from 'axe-core'
import { resolve } from 'node:path'
import { openExampleFile, waitForExampleCollection } from './support/example-collection'

const appPath = resolve(__dirname, '../../out/main/index.js')

interface AxeViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  help: string
  nodes: Array<{ target: string[]; failureSummary?: string }>
}

interface AxeResult {
  violations: AxeViolation[]
}

async function launch() {
  const electronApp = await electron.launch({ args: [appPath] })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await waitForExampleCollection(window)
  return { electronApp, window }
}

async function injectAxe(page: Page) {
  // Local package injection keeps the audit deterministic and compatible
  // with the production CSP; no CDN or script-src exception is involved.
  await page.evaluate(axe.source)
}

async function runAxe(page: Page, runOnly?: string[]): Promise<AxeResult> {
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is injected into the isolated renderer at runtime.
    return window.axe.run(rules ? { runOnly: { type: 'rule', values: rules } } : undefined)
  }, runOnly)
}

function formatViolations(violations: AxeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.impact ?? 'unknown'} ${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(' > ')}: ${node.failureSummary ?? ''}`)
          .join('\n')}`
    )
    .join('\n')
}

async function expectNoHighImpactViolations(page: Page) {
  await injectAxe(page)
  const results = await runAxe(page)
  const highImpact = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  )
  expect(highImpact, formatViolations(highImpact)).toEqual([])
}

test.describe('Accessibility', () => {
  test('has no critical or serious violations in the indexed workspace', async () => {
    const { electronApp, window } = await launch()

    await expectNoHighImpactViolations(window)

    await electronApp.close()
  })

  test('has no critical or serious violations with a document and Properties open', async () => {
    const { electronApp, window } = await launch()
    await openExampleFile(window)

    const properties = window.locator('.properties-panel')
    if (!(await properties.isVisible().catch(() => false))) {
      await window.getByTitle('Toggle Properties').click()
    }
    await expect(properties).toBeVisible()
    await expect(properties.getByRole('button', { name: 'Frontmatter' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    await expectNoHighImpactViolations(window)

    await electronApp.close()
  })

  test('has no critical or serious violations with real search results open', async () => {
    const { electronApp, window } = await launch()
    const input = window.getByRole('textbox', { name: 'Search database' })
    await input.fill('Tesseract')
    await expect(window.locator('.result-card').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('.search-results-overlay')).toHaveCount(1)

    await expectNoHighImpactViolations(window)

    await electronApp.close()
  })

  test('passes explicit button-name, form-label, heading-order, and contrast rules', async () => {
    const { electronApp, window } = await launch()
    await openExampleFile(window)
    await injectAxe(window)

    const results = await runAxe(window, [
      'button-name',
      'label',
      'heading-order',
      'color-contrast'
    ])
    expect(results.violations, formatViolations(results.violations)).toEqual([])

    await electronApp.close()
  })
})
