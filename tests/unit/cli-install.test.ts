import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFindCli, mockGetCliVersion } = vi.hoisted(() => ({
  mockFindCli: vi.fn(),
  mockGetCliVersion: vi.fn()
}))

vi.mock('../../src/main/cli', () => ({
  findCli: mockFindCli,
  getCliVersion: mockGetCliVersion
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { detectCli, getInstallPath, getAssetName, checkLatestVersion } from '../../src/main/cli-install'

beforeEach(() => {
  mockFindCli.mockReset()
  mockGetCliVersion.mockReset()
  mockFetch.mockReset()
})

describe('detectCli', () => {
  it('returns {found: true, path, version} when findCli succeeds', async () => {
    mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
    mockGetCliVersion.mockResolvedValue('0.1.0')

    const result = await detectCli()
    expect(result).toEqual({ found: true, path: '/usr/local/bin/mdvdb', version: '0.1.0' })
  })

  it('returns {found: false} when findCli throws', async () => {
    mockFindCli.mockRejectedValue(new Error('not found'))

    const result = await detectCli()
    expect(result).toEqual({ found: false })
  })

  it('returns {found: true, path} without version when getCliVersion throws', async () => {
    mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
    mockGetCliVersion.mockRejectedValue(new Error('version failed'))

    const result = await detectCli()
    expect(result).toEqual({ found: true, path: '/usr/local/bin/mdvdb' })
  })
})

describe('getInstallPath', () => {
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = { ...originalEnv }
  })

  it('returns ~/.local/bin/mdvdb on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const result = getInstallPath()
    expect(result).toMatch(/\.local\/bin\/mdvdb$/)
    expect(result).not.toMatch(/\.exe$/)
  })

  it('returns ~/.local/bin/mdvdb on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const result = getInstallPath()
    expect(result).toMatch(/\.local\/bin\/mdvdb$/)
    expect(result).not.toMatch(/\.exe$/)
  })

  it('returns %LOCALAPPDATA%\\mdvdb\\mdvdb.exe on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'
    const result = getInstallPath()
    expect(result).toContain('mdvdb')
    expect(result).toMatch(/mdvdb\.exe$/)
  })
})

describe('getAssetName', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
  })

  it('returns correct asset for darwin-arm64', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    expect(getAssetName()).toBe('mdvdb-aarch64-apple-darwin')
  })

  it('returns correct asset for darwin-x64', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getAssetName()).toBe('mdvdb-x86_64-apple-darwin')
  })

  it('returns correct asset for linux-x64', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getAssetName()).toBe('mdvdb-x86_64-unknown-linux-gnu')
  })

  it('returns correct asset for windows-x64', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getAssetName()).toBe('mdvdb-x86_64-pc-windows-msvc.exe')
  })
})

describe('checkLatestVersion', () => {
  it('parses GitHub API response and returns tag_name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v0.2.0', assets: [] })
    })

    const version = await checkLatestVersion()
    expect(version).toBe('v0.2.0')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) })
      })
    )
  })

  it('returns null when API returns non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 })

    const version = await checkLatestVersion()
    expect(version).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const version = await checkLatestVersion()
    expect(version).toBeNull()
  })
})
