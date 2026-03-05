/**
 * CLI binary detection and installation.
 *
 * Detects whether the mdvdb CLI is installed, resolves platform-specific
 * install paths, checks for updates via GitHub Releases API, and downloads
 * binaries with streaming progress.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, chmod, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { findCli, getCliVersion } from './cli'

/** GitHub repository for releases */
const GITHUB_REPO = 'nickarino/markdown-vdb'

/** GitHub Releases API URL */
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** User-Agent header required by GitHub API */
const USER_AGENT = 'markdown-vdb-desktop/1.0'

/** IPC channel for streaming install progress to renderer */
const INSTALL_PROGRESS_CHANNEL = 'cli:install-progress'

/** Result of CLI detection */
export interface CliDetectResult {
  found: boolean
  path?: string
  version?: string
}

/** Result of CLI installation */
export interface CliInstallResult {
  success: boolean
  path: string
  version?: string
  error?: string
}

/** Progress update sent during installation */
export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'complete' | 'error'
  percent: number
  message: string
}

/** GitHub release asset shape (subset) */
interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

/** GitHub release shape (subset) */
interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

/**
 * Detect whether the mdvdb CLI is installed and get its version.
 * Wraps findCli() + getCliVersion() into a single safe result.
 */
export async function detectCli(): Promise<CliDetectResult> {
  try {
    const path = await findCli()
    try {
      const version = await getCliVersion()
      return { found: true, path, version }
    } catch {
      // Binary found but version check failed
      return { found: true, path }
    }
  } catch {
    return { found: false }
  }
}

/**
 * Get the platform-specific install path for the CLI binary.
 *
 * - macOS/Linux: ~/.local/bin/mdvdb
 * - Windows: %LOCALAPPDATA%\mdvdb\mdvdb.exe
 */
export function getInstallPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'mdvdb', 'mdvdb.exe')
  }
  return join(homedir(), '.local', 'bin', 'mdvdb')
}

/**
 * Get the expected GitHub Release asset name for the current platform and architecture.
 *
 * Returns a string like "mdvdb-x86_64-apple-darwin" or "mdvdb-x86_64-pc-windows-msvc.exe".
 */
export function getAssetName(): string {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch

  switch (process.platform) {
    case 'darwin':
      return `mdvdb-${arch}-apple-darwin`
    case 'linux':
      return `mdvdb-${arch}-unknown-linux-gnu`
    case 'win32':
      return `mdvdb-${arch}-pc-windows-msvc.exe`
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

/**
 * Check the latest CLI version available on GitHub Releases.
 * Returns the tag name (e.g., "v0.1.0") or null if the check fails.
 */
export async function checkLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github.v3+json'
      }
    })

    if (!response.ok) {
      return null
    }

    const release = (await response.json()) as GitHubRelease
    return release.tag_name
  } catch {
    return null
  }
}

/**
 * Install the CLI binary by downloading the matching asset from GitHub Releases.
 *
 * Streams download progress to the renderer via mainWindow.webContents.send().
 * Returns the install result with the path to the installed binary.
 */
export async function installCli(mainWindow: BrowserWindow): Promise<CliInstallResult> {
  const installPath = getInstallPath()
  const assetName = getAssetName()

  const sendProgress = (progress: InstallProgress): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(INSTALL_PROGRESS_CHANNEL, progress)
    }
  }

  try {
    // Fetch latest release metadata
    sendProgress({ stage: 'downloading', percent: 0, message: 'Checking latest release...' })

    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github.v3+json'
      }
    })

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`)
    }

    const release = (await response.json()) as GitHubRelease
    const asset = release.assets.find(a => a.name === assetName)

    if (!asset) {
      throw new Error(
        `No matching binary found for ${process.platform}/${process.arch}. ` +
        `Expected asset: ${assetName}`
      )
    }

    // Download the binary
    sendProgress({ stage: 'downloading', percent: 5, message: `Downloading ${asset.name}...` })

    const downloadResponse = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT }
    })

    if (!downloadResponse.ok || !downloadResponse.body) {
      throw new Error(`Failed to download binary: ${downloadResponse.status}`)
    }

    // Ensure install directory exists
    const installDir = join(installPath, '..')
    await mkdir(installDir, { recursive: true })

    // Stream download to a temp file, then rename atomically
    const tmpPath = installPath + '.tmp'
    const totalSize = asset.size
    let downloadedSize = 0

    const fileStream = createWriteStream(tmpPath)
    const reader = downloadResponse.body.getReader()

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        fileStream.write(Buffer.from(value))
        downloadedSize += value.byteLength

        const percent = Math.min(90, Math.round((downloadedSize / totalSize) * 85) + 5)
        sendProgress({
          stage: 'downloading',
          percent,
          message: `Downloading... ${Math.round(downloadedSize / 1024)}KB / ${Math.round(totalSize / 1024)}KB`
        })
      }
    } finally {
      fileStream.end()
      // Wait for the file stream to finish writing
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', resolve)
        fileStream.on('error', reject)
      })
    }

    // Install: set permissions and rename
    sendProgress({ stage: 'installing', percent: 92, message: 'Installing binary...' })

    if (process.platform !== 'win32') {
      await chmod(tmpPath, 0o755)
    }

    await rename(tmpPath, installPath)

    sendProgress({ stage: 'complete', percent: 100, message: 'Installation complete!' })

    // Detect version of newly installed binary
    let version: string | undefined
    try {
      version = release.tag_name.replace(/^v/, '')
    } catch {
      // Version detection is best-effort
    }

    return { success: true, path: installPath, version }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendProgress({ stage: 'error', percent: 0, message })

    // Clean up temp file if it exists
    try {
      await unlink(installPath + '.tmp')
    } catch {
      // Ignore cleanup errors
    }

    return { success: false, path: installPath, error: message }
  }
}
