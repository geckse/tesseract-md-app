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
// Some agent shells use Electron as Node internally. Never leak that mode into
// the real Electron child process launched by Playwright.
delete process.env['ELECTRON_RUN_AS_NODE']
process.env['TESSERACT_E2E'] = '1'
process.env['TESSERACT_E2E_AUTO_COMPLETE_ONBOARDING'] = '1'
process.env['TESSERACT_E2E_AUTO_CREATE_EXAMPLE'] = hasMdvdbOnPath() ? '1' : '0'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  // Electron 43 reserves substantially more virtual memory per process. Keep
  // concurrent desktop instances bounded so macOS and Windows runners do not
  // abort launches under resource pressure.
  workers: process.env['CI'] ? 1 : 4,
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
