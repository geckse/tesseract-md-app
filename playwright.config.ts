import { defineConfig } from '@playwright/test'
import { execFileSync } from 'node:child_process'

function hasMdvdbOnPath(): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mdvdb'], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

// Electron's production single-instance lock is deliberately bypassed only in
// this test process. The app then gives every unseeded launch a temporary,
// isolated user-data directory; tests that need persistence pass one explicitly.
process.env['TESSERACT_E2E'] = '1'
process.env['TESSERACT_E2E_AUTO_COMPLETE_ONBOARDING'] = '1'
process.env['TESSERACT_E2E_AUTO_CREATE_EXAMPLE'] = hasMdvdbOnPath() ? '1' : '0'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.test.ts'
    }
  ]
})
