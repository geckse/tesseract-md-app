/**
 * Platform-specific filesystem paths for the mdvdb CLI binary.
 *
 * Lives in its own module (instead of cli-install.ts) so that cli.ts can
 * resolve the app-managed install location without creating an import cycle
 * between cli.ts and cli-install.ts.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

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
 * Get the well-known directories where the CLI binary may live on this
 * platform. Used as a last-resort probe when the binary is not in the
 * persisted store path, the app-managed install path, or on PATH
 * (GUI apps on macOS often inherit a minimal PATH).
 */
export function getWellKnownBinDirs(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        join(homedir(), '.cargo', 'bin'),
        join(homedir(), '.local', 'bin')
      ]
    case 'linux':
      return ['/usr/local/bin', join(homedir(), '.cargo', 'bin'), join(homedir(), '.local', 'bin')]
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
      return [join(localAppData, 'mdvdb')]
    }
    default:
      return []
  }
}
