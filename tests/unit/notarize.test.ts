import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Verifies scripts/notarize.js (electron-builder afterSign hook):
 * - throws on a tagged CI build when Apple credentials are missing — a
 *   release must never silently produce an un-notarized mac artifact
 * - skips silently (no throw, no notarytool call) for local and non-tag builds
 * - is a no-op for non-darwin platforms
 *
 * The hook is exercised in a subprocess (same pattern as
 * fix-pty-permissions.test.ts) so process.env is fully controlled and the
 * real notarytool is never invoked (all covered paths return before the
 * notarization call — 'Notarizing' never appears in stdout).
 */
describe('notarize afterSign hook', () => {
  const scriptPath = join(__dirname, '..', '..', 'scripts', 'notarize.js')
  const appleVars = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  const controlledVars = [...appleVars, 'MACOS_RELEASE_BUILD']
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
    for (const key of ['CI', 'GITHUB_REF_TYPE', ...controlledVars]) delete env[key]
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

  it('throws on an explicitly requested release build when credentials are missing', () => {
    const result = runHook('darwin', { MACOS_RELEASE_BUILD: 'true' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('un-notarized mac release artifact')
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

  describe('Developer ID signature validation', () => {
    const { validateDeveloperIdSignature } = require(scriptPath) as {
      validateDeveloperIdSignature: (
        output: string,
        expectedBundleId: string,
        expectedTeamId: string
      ) => void
    }
    const validSignature = [
      'Identifier=md.tesseract.app',
      'Authority=Developer ID Application: Example Developer (ABCDE12345)',
      'Authority=Developer ID Certification Authority',
      'Authority=Apple Root CA',
      'TeamIdentifier=ABCDE12345'
    ].join('\n')

    it('accepts the expected Developer ID Application signature', () => {
      expect(() =>
        validateDeveloperIdSignature(validSignature, 'md.tesseract.app', 'ABCDE12345')
      ).not.toThrow()
    })

    it('rejects an Apple Development certificate', () => {
      expect(() =>
        validateDeveloperIdSignature(
          validSignature.replace(
            'Developer ID Application: Example Developer',
            'Apple Development: Example Developer'
          ),
          'md.tesseract.app',
          'ABCDE12345'
        )
      ).toThrow('Developer ID Application certificate')
    })

    it('rejects a mismatched bundle ID or Team ID', () => {
      expect(() =>
        validateDeveloperIdSignature(validSignature, 'com.example.other', 'ABCDE12345')
      ).toThrow('bundle ID')
      expect(() =>
        validateDeveloperIdSignature(validSignature, 'md.tesseract.app', 'OTHER12345')
      ).toThrow('Team ID')
    })
  })

  describe('notarytool status handling', () => {
    const { parseNotarytoolJson, readNotarizationTimeoutMs, waitForNotarization } = require(
      scriptPath
    ) as {
      parseNotarytoolJson: (output: string, operation: string) => Record<string, unknown>
      readNotarizationTimeoutMs: (value?: string) => number
      waitForNotarization: (options: Record<string, unknown>) => Promise<void>
    }
    const credentials = {
      appleId: 'someone@example.com',
      password: 'app-specific-password',
      teamId: 'ABCDE12345'
    }

    it('parses structured notarytool output and validates the timeout', () => {
      expect(parseNotarytoolJson('{"id":"submission-id"}', 'submit')).toEqual({
        id: 'submission-id'
      })
      expect(readNotarizationTimeoutMs()).toBe(90 * 60_000)
      expect(readNotarizationTimeoutMs('2.5')).toBe(150_000)
      expect(() => readNotarizationTimeoutMs('0')).toThrow('positive number')
      expect(() => parseNotarytoolJson('not json', 'submit')).toThrow('invalid JSON')
    })

    it('polls an Apple submission until it is accepted', async () => {
      let currentTime = 0
      const statuses = ['In Progress', 'Accepted']
      const messages: string[] = []

      await waitForNotarization({
        submissionId: 'submission-id',
        credentials,
        timeoutMs: 1000,
        pollIntervalMs: 10,
        heartbeatIntervalMs: 20,
        run: async () => ({
          code: 0,
          signal: null,
          output: JSON.stringify({ status: statuses.shift() })
        }),
        sleep: async (milliseconds: number) => {
          currentTime += milliseconds
        },
        now: () => currentTime,
        log: (message: string) => messages.push(message)
      })

      expect(messages).toEqual([
        'Apple notarization submission-id: In Progress (0m elapsed)',
        'Apple notarization submission-id: Accepted (0m elapsed)'
      ])
    })

    it('fails with the submission ID after the processing deadline', async () => {
      let currentTime = 0

      await expect(
        waitForNotarization({
          submissionId: 'submission-id',
          credentials,
          timeoutMs: 20,
          pollIntervalMs: 10,
          run: async () => ({
            code: 0,
            signal: null,
            output: JSON.stringify({ status: 'In Progress' })
          }),
          sleep: async (milliseconds: number) => {
            currentTime += milliseconds
          },
          now: () => currentTime,
          log: () => undefined
        })
      ).rejects.toThrow('submission-id timed out')
    })

    it('includes Apple diagnostics when a submission is invalid', async () => {
      await expect(
        waitForNotarization({
          submissionId: 'submission-id',
          credentials,
          timeoutMs: 1000,
          run: async (args: string[]) =>
            args[0] === 'info'
              ? {
                  code: 0,
                  signal: null,
                  output: JSON.stringify({ status: 'Invalid' })
                }
              : { code: 0, signal: null, output: 'Apple diagnostic details' },
          now: () => 0,
          log: () => undefined
        })
      ).rejects.toThrow('Apple diagnostic details')
    })
  })
})
