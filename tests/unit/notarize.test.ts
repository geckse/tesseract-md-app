import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Verifies scripts/notarize.js (electron-builder afterSign hook):
 * - throws on a tagged CI build when Apple credentials are missing — a
 *   release must never silently produce an un-notarized mac artifact
 * - skips silently (no throw, no notarize call) for local and non-tag builds
 * - is a no-op for non-darwin platforms
 *
 * The hook is exercised in a subprocess (same pattern as
 * fix-pty-permissions.test.ts) so process.env is fully controlled and the
 * real @electron/notarize is never invoked (all covered paths return before
 * the notarize() call — 'Notarizing' never appears in stdout).
 */
describe('notarize afterSign hook', () => {
  const scriptPath = join(__dirname, '..', '..', 'scripts', 'notarize.js')
  const appleVars = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  let work: string
  let driverPath: string

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'notarize-hook-'))
    driverPath = join(work, 'driver.js')
    // Tiny driver: require the hook and run it with a fake electron-builder
    // context. Exits 0 on resolve, 1 with the error message on reject.
    writeFileSync(
      driverPath,
      `const hook = require(process.argv[2])
const context = {
  electronPlatformName: process.argv[3],
  appOutDir: process.argv[4] || '/nonexistent/out',
  packager: { appInfo: { productFilename: 'Tesseract' } }
}
hook.default(context).then(
  () => process.exit(0),
  (err) => {
    console.error(err.message)
    process.exit(1)
  }
)
`
    )
  })

  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
  })

  function runHook(
    platform: string,
    envOverrides: Record<string, string>
  ): { status: number; stdout: string; stderr: string } {
    // Start from the parent env (node needs PATH etc.) but strip every var
    // the hook branches on, then layer the scenario's overrides on top.
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of ['CI', 'GITHUB_REF_TYPE', ...appleVars]) delete env[key]
    Object.assign(env, envOverrides)

    try {
      const stdout = execFileSync('node', [driverPath, scriptPath, platform], {
        env,
        timeout: 15_000
      }).toString()
      return { status: 0, stdout, stderr: '' }
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer }
      return {
        status: e.status ?? -1,
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? ''
      }
    }
  }

  it('throws on a tagged CI build when all Apple credentials are missing', () => {
    const result = runHook('darwin', { CI: 'true', GITHUB_REF_TYPE: 'tag' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('un-notarized')
    for (const name of appleVars) {
      expect(result.stderr).toContain(name)
    }
  })

  it('throws on a tagged CI build listing only the missing credentials', () => {
    const result = runHook('darwin', {
      CI: 'true',
      GITHUB_REF_TYPE: 'tag',
      APPLE_ID: 'someone@example.com'
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID')
  })

  it('skips silently on local builds without credentials (no notarize call)', () => {
    const result = runHook('darwin', {})
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Skipping notarization')
    expect(result.stdout).not.toContain('Notarizing')
  })

  it('skips on CI non-tag builds (workflow_dispatch smoke builds) without credentials', () => {
    const result = runHook('darwin', { CI: 'true', GITHUB_REF_TYPE: 'branch' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Skipping notarization')
    expect(result.stdout).not.toContain('Notarizing')
  })

  it('is a no-op for non-darwin platforms even on a tagged CI build', () => {
    const result = runHook('win32', { CI: 'true', GITHUB_REF_TYPE: 'tag' })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('Skipping notarization')
    expect(result.stdout).not.toContain('Notarizing')
  })
})
