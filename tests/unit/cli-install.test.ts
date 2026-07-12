import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const { mockFindCli, mockGetCliVersion, mockResetCliPathCache } = vi.hoisted(() => ({
  mockFindCli: vi.fn(),
  mockGetCliVersion: vi.fn(),
  mockResetCliPathCache: vi.fn()
}))

vi.mock('../../src/main/cli', () => ({
  findCli: mockFindCli,
  getCliVersion: mockGetCliVersion,
  resetCliPathCache: mockResetCliPathCache
}))

const { mockCreateWriteStream, mockMkdir, mockChmod, mockRename, mockUnlink } = vi.hoisted(() => ({
  mockCreateWriteStream: vi.fn(),
  mockMkdir: vi.fn(),
  mockChmod: vi.fn(),
  mockRename: vi.fn(),
  mockUnlink: vi.fn()
}))

vi.mock('node:fs', () => {
  const mod = { createWriteStream: mockCreateWriteStream }
  return { ...mod, default: mod }
})
vi.mock('node:fs/promises', () => {
  const mod = { mkdir: mockMkdir, chmod: mockChmod, rename: mockRename, unlink: mockUnlink }
  return { ...mod, default: mod }
})

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  detectCli,
  getInstallPath,
  getAssetName,
  checkLatestVersion,
  installCli
} from '../../src/main/cli-install'

beforeEach(() => {
  mockFindCli.mockReset()
  mockGetCliVersion.mockReset()
  mockResetCliPathCache.mockReset()
  mockFetch.mockReset()
  mockCreateWriteStream.mockReset()
  mockMkdir.mockReset()
  mockMkdir.mockResolvedValue(undefined)
  mockChmod.mockReset()
  mockChmod.mockResolvedValue(undefined)
  mockRename.mockReset()
  mockRename.mockResolvedValue(undefined)
  mockUnlink.mockReset()
  mockUnlink.mockResolvedValue(undefined)
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
      'https://api.github.com/repos/geckse/markdown-vdb/releases/latest',
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

describe('installCli', () => {
  function makeMockWindow(): BrowserWindow {
    return {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow
  }

  function makeMockFileStream(): {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  } {
    return {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') cb()
      })
    }
  }

  function makeDownloadBody(chunks: Uint8Array[]): {
    getReader: () => { read: () => Promise<{ done: boolean; value: Uint8Array | undefined }> }
  } {
    let index = 0
    return {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }
      })
    }
  }

  it('fetches the geckse/markdown-vdb release and downloads the raw asset matching getAssetName()', async () => {
    const assetName = getAssetName()
    const downloadUrl = `https://github.com/geckse/markdown-vdb/releases/download/v0.2.0/${assetName}`

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: 'v0.2.0',
          assets: [
            { name: 'some-other-asset', browser_download_url: 'https://example.com/x', size: 1 },
            { name: assetName, browser_download_url: downloadUrl, size: 3 }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeDownloadBody([new Uint8Array([1, 2, 3])])
      })
    mockCreateWriteStream.mockReturnValue(makeMockFileStream())

    const result = await installCli(makeMockWindow())

    expect(result.success).toBe(true)
    expect(result.path).toBe(getInstallPath())
    expect(result.version).toBe('0.2.0')
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/geckse/markdown-vdb/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) })
      })
    )
    expect(mockFetch).toHaveBeenNthCalledWith(2, downloadUrl, expect.anything())
    expect(mockRename).toHaveBeenCalledWith(getInstallPath() + '.tmp', getInstallPath())
  })

  it('resets the CLI path cache after a successful install', async () => {
    const assetName = getAssetName()

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: 'v0.2.0',
          assets: [{ name: assetName, browser_download_url: 'https://example.com/dl', size: 3 }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeDownloadBody([new Uint8Array([1, 2, 3])])
      })
    mockCreateWriteStream.mockReturnValue(makeMockFileStream())

    const result = await installCli(makeMockWindow())

    expect(result.success).toBe(true)
    expect(mockResetCliPathCache).toHaveBeenCalledTimes(1)
  })

  it('fails with the expected asset name when no matching asset exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag_name: 'v0.2.0',
        assets: [
          { name: 'unrelated-asset', browser_download_url: 'https://example.com/x', size: 1 }
        ]
      })
    })

    const result = await installCli(makeMockWindow())

    expect(result.success).toBe(false)
    expect(result.error).toContain(getAssetName())
    expect(mockResetCliPathCache).not.toHaveBeenCalled()
  })
})
