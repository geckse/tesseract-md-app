import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  configureE2eRuntime,
  hasExplicitUserDataDir,
  isE2eRuntime,
  shouldAutoCompleteOnboarding,
  shouldAutoCreateExample
} from '../../src/main/e2e-runtime'

function fakeApp() {
  let quitHandler: (() => void) | undefined
  return {
    app: {
      setPath: vi.fn(),
      once: vi.fn((_event: string, handler: () => void) => {
        quitHandler = handler
        return undefined as never
      })
    },
    quit: () => quitHandler?.()
  }
}

describe('E2E Electron runtime isolation', () => {
  it('is disabled unless Playwright opts in explicitly', () => {
    expect(isE2eRuntime({})).toBe(false)
    expect(isE2eRuntime({ TESSERACT_E2E: '1' })).toBe(true)
    expect(shouldAutoCompleteOnboarding({ TESSERACT_E2E: '1' })).toBe(false)
    expect(
      shouldAutoCompleteOnboarding({
        TESSERACT_E2E: '1',
        TESSERACT_E2E_AUTO_COMPLETE_ONBOARDING: '1'
      })
    ).toBe(true)
    expect(
      shouldAutoCreateExample({ TESSERACT_E2E: '1', TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '1' }, [
        'electron'
      ])
    ).toBe(true)
    expect(
      shouldAutoCreateExample({ TESSERACT_E2E: '1', TESSERACT_E2E_AUTO_CREATE_EXAMPLE: '1' }, [
        'electron',
        '--user-data-dir=/tmp/seeded'
      ])
    ).toBe(false)
  })

  it('recognizes both user-data-dir argument forms', () => {
    expect(hasExplicitUserDataDir(['electron', '--user-data-dir=/tmp/profile'])).toBe(true)
    expect(hasExplicitUserDataDir(['electron', '--user-data-dir', '/tmp/profile'])).toBe(true)
    expect(hasExplicitUserDataDir(['electron', 'out/main/index.js'])).toBe(false)
  })

  it('creates and cleans a fresh profile for an unseeded E2E launch', () => {
    const { app, quit } = fakeApp()

    expect(configureE2eRuntime(app, { TESSERACT_E2E: '1' }, ['electron'])).toBe(true)
    const profileDir = app.setPath.mock.calls[0][1] as string
    expect(app.setPath).toHaveBeenCalledWith('userData', expect.stringContaining('tesseract-e2e-'))
    expect(existsSync(profileDir)).toBe(true)

    quit()
    expect(existsSync(profileDir)).toBe(false)
  })

  it('preserves an explicitly seeded profile and production behavior', () => {
    const seeded = fakeApp()
    expect(
      configureE2eRuntime(seeded.app, { TESSERACT_E2E: '1' }, [
        'electron',
        '--user-data-dir=/tmp/seeded'
      ])
    ).toBe(true)
    expect(seeded.app.setPath).not.toHaveBeenCalled()

    const production = fakeApp()
    expect(configureE2eRuntime(production.app, {}, ['electron'])).toBe(false)
    expect(production.app.setPath).not.toHaveBeenCalled()
  })
})
