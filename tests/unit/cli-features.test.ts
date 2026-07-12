import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  cliFeatures,
  compareSemver,
  MDVDB_RELATIONS_MIN_VERSION
} from '@renderer/lib/cli-features.svelte'

describe('compareSemver', () => {
  it('orders plain numeric semvers', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0)
    expect(compareSemver('0.2.1', '0.2.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
  })

  it('tolerates a leading v and pre-release suffixes', () => {
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0)
    expect(compareSemver('0.2.0-beta.1', '0.2.0')).toBe(0)
  })

  it('returns null for unparseable versions', () => {
    expect(compareSemver('dev', '0.2.0')).toBeNull()
    expect(compareSemver('0.2.0', '')).toBeNull()
    expect(compareSemver('a.b.c', '0.2.0')).toBeNull()
  })
})

describe('cliFeatures', () => {
  beforeEach(() => {
    cliFeatures.reset()
  })

  it('is unsupported while the version is unknown', () => {
    expect(cliFeatures.supportsRelations).toBe(false)
  })

  it('supports relations at and above the minimum version', () => {
    cliFeatures.version = MDVDB_RELATIONS_MIN_VERSION
    expect(cliFeatures.supportsRelations).toBe(true)
    cliFeatures.version = '9.0.0'
    expect(cliFeatures.supportsRelations).toBe(true)
  })

  it('does not support relations below the minimum version', () => {
    cliFeatures.version = '0.1.0'
    expect(cliFeatures.supportsRelations).toBe(false)
  })

  it('treats an unparseable version as unsupported (safe default)', () => {
    cliFeatures.version = 'not-a-version'
    expect(cliFeatures.supportsRelations).toBe(false)
  })

  it('init() fetches once and records the version; failures stay unsupported', async () => {
    const getCliVersion = vi.fn().mockResolvedValue('0.2.0')
    Object.defineProperty(globalThis, 'window', {
      value: { api: { getCliVersion } },
      configurable: true
    })
    await cliFeatures.init()
    await cliFeatures.init() // idempotent — no second fetch
    expect(getCliVersion).toHaveBeenCalledTimes(1)
    expect(cliFeatures.supportsRelations).toBe(true)

    cliFeatures.reset()
    getCliVersion.mockRejectedValue(new Error('no cli'))
    await cliFeatures.init()
    expect(cliFeatures.version).toBeNull()
    expect(cliFeatures.supportsRelations).toBe(false)
  })

  it('init() is single-flight — a caller during in-flight detection awaits the SAME fetch', async () => {
    let resolveVersion!: (v: string) => void
    const getCliVersion = vi
      .fn()
      .mockReturnValue(new Promise<string>((resolve) => (resolveVersion = resolve)))
    Object.defineProperty(globalThis, 'window', {
      value: { api: { getCliVersion } },
      configurable: true
    })

    const first = cliFeatures.init() // app startup (fire-and-forget)
    let secondSettled = false
    const second = cliFeatures.init().then(() => (secondSettled = true))

    // The second caller must NOT resolve before detection does — resolving
    // early is exactly the race that fetched tables unpopulated (neutral chips).
    await Promise.resolve()
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    resolveVersion('0.2.0')
    await Promise.all([first, second])
    expect(getCliVersion).toHaveBeenCalledTimes(1)
    expect(cliFeatures.supportsRelations).toBe(true)
  })
})
