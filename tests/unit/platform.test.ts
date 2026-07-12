import { describe, it, expect, afterEach, vi } from 'vitest'
import { platform, isMac, isWindows, isLinux } from '@renderer/lib/platform'

/** Stub window.electron.process.platform (the @electron-toolkit/preload shape). */
function setPreloadPlatform(value: string | undefined): void {
  ;(window as unknown as Record<string, unknown>).electron =
    value === undefined ? undefined : { process: { platform: value } }
}

describe('platform detection', () => {
  afterEach(() => {
    setPreloadPlatform(undefined)
    vi.restoreAllMocks()
  })

  it('prefers the preload-exposed Node platform', () => {
    setPreloadPlatform('win32')
    expect(platform()).toBe('win32')
    expect(isWindows()).toBe(true)
    expect(isMac()).toBe(false)
    expect(isLinux()).toBe(false)
  })

  it('reports darwin from the preload platform', () => {
    setPreloadPlatform('darwin')
    expect(platform()).toBe('darwin')
    expect(isMac()).toBe(true)
  })

  it('falls back to the user agent when preload is unavailable', () => {
    setPreloadPlatform(undefined)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    )
    expect(platform()).toBe('darwin')
  })

  it('detects Windows from the user agent fallback', () => {
    setPreloadPlatform(undefined)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    )
    expect(platform()).toBe('win32')
  })

  it('defaults to linux for anything else', () => {
    setPreloadPlatform(undefined)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Ubuntu) AppleWebKit/537.36'
    )
    expect(platform()).toBe('linux')
    expect(isLinux()).toBe(true)
  })
})
