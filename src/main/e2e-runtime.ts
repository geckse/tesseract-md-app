import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'

type E2eApp = Pick<App, 'setPath' | 'once'>

/** Explicit opt-in used only by the Playwright Electron process. */
export function isE2eRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['TESSERACT_E2E'] === '1'
}

/** Most suites exercise the app shell; onboarding tests explicitly opt out. */
export function shouldAutoCompleteOnboarding(env: NodeJS.ProcessEnv = process.env): boolean {
  return isE2eRuntime(env) && env['TESSERACT_E2E_AUTO_COMPLETE_ONBOARDING'] === '1'
}

/** Seed the shared example only for disposable, unseeded Playwright profiles. */
export function shouldAutoCreateExample(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv
): boolean {
  return (
    isE2eRuntime(env) &&
    env['TESSERACT_E2E_AUTO_CREATE_EXAMPLE'] === '1' &&
    !hasExplicitUserDataDir(argv)
  )
}

export function hasExplicitUserDataDir(argv: string[] = process.argv): boolean {
  return argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))
}

/**
 * Keep E2E launches away from the user's real Electron profile. A fresh profile
 * per process also lets Playwright run independent app instances concurrently.
 * Tests that intentionally verify persistence pass their own --user-data-dir.
 */
export function configureE2eRuntime(
  app: E2eApp,
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv
): boolean {
  if (!isE2eRuntime(env)) return false
  if (hasExplicitUserDataDir(argv)) return true

  const profileDir = mkdtempSync(join(tmpdir(), 'tesseract-e2e-'))
  app.setPath('userData', profileDir)
  app.once('quit', () => {
    rmSync(profileDir, { recursive: true, force: true })
  })
  return true
}
