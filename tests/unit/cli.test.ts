import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'

// Use vi.hoisted so the mock variables are available before vi.mock runs
const { mockExecFile, mockAccess, mockGetCliInfo, mockGetInstallPath, mockGetWellKnownBinDirs } =
  vi.hoisted(() => ({
    mockExecFile: vi.fn(),
    mockAccess: vi.fn(),
    mockGetCliInfo: vi.fn(),
    mockGetInstallPath: vi.fn(),
    mockGetWellKnownBinDirs: vi.fn()
  }))

vi.mock('node:child_process', () => {
  const mod = { execFile: mockExecFile }
  return { ...mod, default: mod }
})
vi.mock('node:util', () => {
  const promisify = (_fn: unknown) => {
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err)
          else resolve({ stdout, stderr })
        })
      })
    }
  }
  const mod = { promisify }
  return { ...mod, default: mod }
})
vi.mock('node:fs/promises', () => {
  const mod = { access: mockAccess, constants: { F_OK: 0, X_OK: 1 } }
  return { ...mod, default: mod }
})
vi.mock('../../src/main/store', () => ({
  getCliInfo: mockGetCliInfo
}))
vi.mock('../../src/main/cli-paths', () => ({
  getInstallPath: mockGetInstallPath,
  getWellKnownBinDirs: mockGetWellKnownBinDirs
}))

import { findCli, getCliVersion, execCommand, execRaw, resetCliPathCache } from '../../src/main/cli'
import {
  CliNotFoundError,
  CliExecutionError,
  CliParseError,
  CliTimeoutError
} from '../../src/main/errors'

beforeEach(() => {
  mockExecFile.mockReset()
  // Nothing on the store path or install path by default; the well-known-dir
  // probe finds nothing — resolution falls through to the which/where lookup.
  mockAccess.mockReset()
  mockAccess.mockRejectedValue(new Error('ENOENT'))
  mockGetCliInfo.mockReset()
  mockGetCliInfo.mockReturnValue({ path: null, version: null })
  mockGetInstallPath.mockReset()
  mockGetInstallPath.mockReturnValue('/mock/install/mdvdb')
  mockGetWellKnownBinDirs.mockReset()
  mockGetWellKnownBinDirs.mockReturnValue([])
  resetCliPathCache()
})

describe('findCli', () => {
  it('returns the path to mdvdb binary', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      }
    )

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
  })

  it('throws CliNotFoundError when binary not found', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(new Error('not found'), '', 'mdvdb not found')
      }
    )

    await expect(findCli()).rejects.toThrow(CliNotFoundError)
  })

  it('throws CliNotFoundError when which returns empty output', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, '  \n', '')
      }
    )

    await expect(findCli()).rejects.toThrow(CliNotFoundError)
  })

  it('takes first line when multiple paths returned', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, '/usr/local/bin/mdvdb\n/usr/bin/mdvdb\n', '')
      }
    )

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
  })
})

describe('findCli resolution order', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  function whichSucceeds(path = '/usr/local/bin/mdvdb'): void {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, `${path}\n`, '')
      }
    )
  }

  function whichFails(): void {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(new Error('not found'), '', '')
      }
    )
  }

  /** Make only the given paths pass the fs access check */
  function onlyUsable(...paths: string[]): void {
    mockAccess.mockImplementation(async (p: string) => {
      if (!paths.includes(p)) {
        throw new Error('ENOENT')
      }
    })
  }

  it('uses the persisted store path when it is executable, without spawning which', async () => {
    mockGetCliInfo.mockReturnValue({ path: '/stored/bin/mdvdb', version: '0.2.0' })
    onlyUsable('/stored/bin/mdvdb')

    const path = await findCli()
    expect(path).toBe('/stored/bin/mdvdb')
    // X_OK (1) on non-win32 platforms
    expect(mockAccess).toHaveBeenCalledWith('/stored/bin/mdvdb', 1)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('skips a stale store path and falls through to the PATH lookup', async () => {
    mockGetCliInfo.mockReturnValue({ path: '/stale/bin/mdvdb', version: '0.1.0' })
    whichSucceeds('/usr/local/bin/mdvdb')

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
    expect(mockAccess).toHaveBeenCalledWith('/stale/bin/mdvdb', 1)
  })

  it('skips the store path when reading the store throws', async () => {
    mockGetCliInfo.mockImplementation(() => {
      throw new Error('store unavailable')
    })
    whichSucceeds('/usr/local/bin/mdvdb')

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
  })

  it('prefers the app-managed install path over the PATH lookup', async () => {
    onlyUsable('/mock/install/mdvdb')

    const path = await findCli()
    expect(path).toBe('/mock/install/mdvdb')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('falls back to well-known bin dirs when the PATH lookup fails', async () => {
    whichFails()
    mockGetWellKnownBinDirs.mockReturnValue(['/opt/homebrew/bin', '/usr/local/bin'])
    onlyUsable('/opt/homebrew/bin/mdvdb')

    const path = await findCli()
    expect(path).toBe('/opt/homebrew/bin/mdvdb')
  })

  it('uses a plain existence check for the store path on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const storedPath = 'C:\\bin\\mdvdb.exe'
    mockGetCliInfo.mockReturnValue({ path: storedPath, version: '0.2.0' })
    onlyUsable(storedPath)

    const path = await findCli()
    expect(path).toBe(storedPath)
    // F_OK (0) on win32 — X_OK is meaningless there
    expect(mockAccess).toHaveBeenCalledWith(storedPath, 0)
  })

  it('probes for mdvdb.exe in the LOCALAPPDATA well-known dir on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const localAppDir = join('C:\\Users\\test\\AppData\\Local', 'mdvdb')
    const candidate = join(localAppDir, 'mdvdb.exe')
    whichFails()
    mockGetWellKnownBinDirs.mockReturnValue([localAppDir])
    onlyUsable(candidate)

    const path = await findCli()
    expect(path).toBe(candidate)
    expect(mockAccess).toHaveBeenCalledWith(candidate, 0)
  })

  it('throws CliNotFoundError when nothing resolves', async () => {
    whichFails()
    mockGetWellKnownBinDirs.mockReturnValue(['/opt/homebrew/bin'])

    await expect(findCli()).rejects.toThrow(CliNotFoundError)
  })
})

describe('findCli caching', () => {
  function whichSucceeds(path = '/usr/local/bin/mdvdb'): void {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, `${path}\n`, '')
      }
    )
  }

  it('caches the resolved path — a second call does not re-probe', async () => {
    whichSucceeds()

    const first = await findCli()
    const accessCallsAfterFirst = mockAccess.mock.calls.length
    const second = await findCli()

    expect(first).toBe('/usr/local/bin/mdvdb')
    expect(second).toBe('/usr/local/bin/mdvdb')
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockAccess.mock.calls.length).toBe(accessCallsAfterFirst)
  })

  it('resetCliPathCache() forces re-resolution', async () => {
    whichSucceeds()

    await findCli()
    expect(mockExecFile).toHaveBeenCalledTimes(1)

    resetCliPathCache()

    await findCli()
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})

describe('getWellKnownBinDirs (real implementation)', () => {
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = { ...originalEnv }
  })

  async function realCliPaths(): Promise<typeof import('../../src/main/cli-paths')> {
    return vi.importActual<typeof import('../../src/main/cli-paths')>('../../src/main/cli-paths')
  }

  it('darwin: homebrew, /usr/local/bin, ~/.cargo/bin, ~/.local/bin', async () => {
    const { getWellKnownBinDirs } = await realCliPaths()
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    const dirs = getWellKnownBinDirs()
    expect(dirs[0]).toBe('/opt/homebrew/bin')
    expect(dirs[1]).toBe('/usr/local/bin')
    expect(dirs[2]).toMatch(/\.cargo\/bin$/)
    expect(dirs[3]).toMatch(/\.local\/bin$/)
    expect(dirs).toHaveLength(4)
  })

  it('linux: /usr/local/bin, ~/.cargo/bin, ~/.local/bin', async () => {
    const { getWellKnownBinDirs } = await realCliPaths()
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const dirs = getWellKnownBinDirs()
    expect(dirs[0]).toBe('/usr/local/bin')
    expect(dirs[1]).toMatch(/\.cargo\/bin$/)
    expect(dirs[2]).toMatch(/\.local\/bin$/)
    expect(dirs).toHaveLength(3)
  })

  it('win32: only %LOCALAPPDATA%/mdvdb', async () => {
    const { getWellKnownBinDirs } = await realCliPaths()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'

    const dirs = getWellKnownBinDirs()
    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toBe(join('C:\\Users\\test\\AppData\\Local', 'mdvdb'))
  })
})

describe('getCliVersion', () => {
  it('returns version string from JSON output', async () => {
    // First call: which, second call: --version --json
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(null, '{"version":"0.1.0"}\n', '')
        }
      }
    )

    const version = await getCliVersion()
    expect(version).toBe('0.1.0')
  })

  it('throws CliNotFoundError when binary not found', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(new Error('not found'), '', '')
      }
    )

    await expect(getCliVersion()).rejects.toThrow(CliNotFoundError)
  })

  it('throws CliExecutionError when --version fails', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(new Error('failed'), '', 'error')
        }
      }
    )

    await expect(getCliVersion()).rejects.toThrow(CliExecutionError)
  })
})

describe('execCommand', () => {
  function setupWhichAndExec(stdout: string, stderr = '') {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(null, stdout, stderr)
        }
      }
    )
  }

  it('parses JSON output from CLI', async () => {
    const data = { document_count: 5, chunk_count: 20 }
    setupWhichAndExec(JSON.stringify(data))

    const result = await execCommand<typeof data>('status', [], '/tmp/project')
    expect(result).toEqual(data)
  })

  it('passes --json and --root flags', async () => {
    setupWhichAndExec('{}')

    await execCommand('status', [], '/tmp/project')

    // Second call is the actual command
    const secondCall = mockExecFile.mock.calls[1]
    const args = secondCall[1] as string[]
    expect(args).toContain('--json')
    expect(args).toContain('--root')
    expect(args).toContain('/tmp/project')
    expect(args[0]).toBe('status')
  })

  it('passes additional args', async () => {
    setupWhichAndExec('{"results":[],"query":"test","total_results":0}')

    await execCommand('search', ['--limit', '10', 'test query'], '/tmp/project')

    const secondCall = mockExecFile.mock.calls[1]
    const args = secondCall[1] as string[]
    expect(args).toContain('--limit')
    expect(args).toContain('10')
    expect(args).toContain('test query')
  })

  it('uses a larger output buffer for graph data', async () => {
    setupWhichAndExec('{"nodes":[],"edges":[],"clusters":[],"level":"document"}')

    await execCommand('graph', [], '/tmp/project')

    const secondCall = mockExecFile.mock.calls[1]
    const opts = secondCall[2] as { maxBuffer: number }
    expect(opts.maxBuffer).toBe(256 * 1024 * 1024)
  })

  it('preserves compact graph contexts without expanding them per edge', async () => {
    const context = 'x'.repeat(1_000)
    setupWhichAndExec(
      JSON.stringify({
        format: 'mdvdb.graph.compact',
        version: 1,
        nodes: [],
        edges: [{ source: 'a.md', target: 'b.md', context_index: 0, field: null }],
        contexts: [context],
        clusters: [],
        level: 'document'
      })
    )

    const result = await execCommand<{
      edges: Array<{ context_index: number; context_text?: string }>
      contexts: string[]
    }>('graph', [], '/tmp/project')

    expect(result.contexts[0]).toBe(context)
    expect(result.edges[0].context_index).toBe(0)
    expect(result.edges[0].context_text).toBeUndefined()
  })

  it('returns undefined for empty stdout', async () => {
    setupWhichAndExec('  \n')

    const result = await execCommand('init', [], '/tmp/project')
    expect(result).toBeUndefined()
  })

  it('throws CliParseError for invalid JSON', async () => {
    setupWhichAndExec('not json at all')

    await expect(execCommand('status', [], '/tmp/project')).rejects.toThrow(CliParseError)
  })

  it('throws CliTimeoutError when process is killed', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('timed out'), { killed: true })
          cb(err, '', '')
        }
      }
    )

    await expect(execCommand('ingest', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliTimeoutError on ETIMEDOUT', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
          cb(err, '', '')
        }
      }
    )

    await expect(execCommand('ingest', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliExecutionError on non-zero exit', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('failed'), { exitCode: 2, stderr: 'index not found' })
          cb(err, '', '')
        }
      }
    )

    await expect(execCommand('status', [], '/tmp/project')).rejects.toThrow(CliExecutionError)
  })

  it('reports the Node error message when stderr is empty', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new RangeError('stdout maxBuffer length exceeded'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            stderr: ''
          })
          cb(err, '', '')
        }
      }
    )

    await expect(execCommand('status', [], '/tmp/project')).rejects.toThrow(
      /stdout maxBuffer length exceeded/
    )
  })

  it('respects custom timeout option', async () => {
    setupWhichAndExec('{}')

    await execCommand('ingest', [], '/tmp/project', { timeout: 300_000 })

    const secondCall = mockExecFile.mock.calls[1]
    const opts = secondCall[2] as { timeout: number }
    expect(opts.timeout).toBe(300_000)
  })

  it('retries on timeout when retries option is set', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          // which command
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else if (callCount === 2) {
          // First attempt - timeout
          const err = Object.assign(new Error('timed out'), { killed: true })
          cb(err, '', '')
        } else {
          // Second attempt - success
          cb(null, '{"status":"ok"}', '')
        }
      }
    )

    const result = await execCommand<{ status: string }>('status', [], '/tmp/project', {
      retries: 1
    })
    expect(result).toEqual({ status: 'ok' })
    expect(callCount).toBe(3) // which + 2 command attempts
  })

  it('retries on execution error when retries option is set', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          // which command
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else if (callCount === 2) {
          // First attempt - failure
          const err = Object.assign(new Error('failed'), { exitCode: 1, stderr: 'temporary error' })
          cb(err, '', '')
        } else {
          // Second attempt - success
          cb(null, '{"status":"ok"}', '')
        }
      }
    )

    const result = await execCommand<{ status: string }>('status', [], '/tmp/project', {
      retries: 1
    })
    expect(result).toEqual({ status: 'ok' })
    expect(callCount).toBe(3)
  })

  it('throws error after exhausting all retries', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          // which command
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          // All attempts - timeout
          const err = Object.assign(new Error('timed out'), { killed: true })
          cb(err, '', '')
        }
      }
    )

    await expect(execCommand('ingest', [], '/tmp/project', { retries: 2 })).rejects.toThrow(
      CliTimeoutError
    )

    expect(callCount).toBe(4) // which + 3 command attempts (initial + 2 retries)
  })

  it('does not retry CliParseError', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(null, 'not json', '')
        }
      }
    )

    await expect(execCommand('status', [], '/tmp/project', { retries: 2 })).rejects.toThrow(
      CliParseError
    )

    expect(callCount).toBe(2) // which + 1 command attempt (no retries)
  })

  it('includes retry info in error messages during retries', async () => {
    let callCount = 0
    let _errorMessage = ''
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('failed'), { exitCode: 1, stderr: 'error' })
          // Capture the error message during retry
          if (callCount === 2) {
            try {
              cb(err, '', '')
            } catch (e) {
              _errorMessage = (e as Error).message
              throw e
            }
          } else {
            cb(err, '', '')
          }
        }
      }
    )

    try {
      await execCommand('status', [], '/tmp/project', { retries: 2 })
    } catch (error) {
      const err = error as CliExecutionError
      expect(err.message).toContain('failed after')
      expect(err.message).toContain('attempts')
    }
  })
})

describe('execRaw', () => {
  it('returns raw stdout/stderr without JSON parsing', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(null, 'raw output here', 'some warnings')
        }
      }
    )

    const result = await execRaw('tree', [], '/tmp/project')
    expect(result.stdout).toBe('raw output here')
    expect(result.stderr).toBe('some warnings')
    expect(result.exitCode).toBe(0)
  })

  it('does not pass --json flag', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          cb(null, '', '')
        }
      }
    )

    await execRaw('tree', [], '/tmp/project')

    const secondCall = mockExecFile.mock.calls[1]
    const args = secondCall[1] as string[]
    expect(args).not.toContain('--json')
    expect(args).toContain('--root')
  })

  it('throws CliTimeoutError on timeout', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('timed out'), { killed: true })
          cb(err, '', '')
        }
      }
    )

    await expect(execRaw('tree', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliExecutionError on failure', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('failed'), { exitCode: 1, stderr: 'error' })
          cb(err, '', '')
        }
      }
    )

    await expect(execRaw('tree', [], '/tmp/project')).rejects.toThrow(CliExecutionError)
  })

  it('retries on timeout when retries option is set', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else if (callCount === 2) {
          const err = Object.assign(new Error('timed out'), { killed: true })
          cb(err, '', '')
        } else {
          cb(null, 'success output', '')
        }
      }
    )

    const result = await execRaw('tree', [], '/tmp/project', { retries: 1 })
    expect(result.stdout).toBe('success output')
    expect(callCount).toBe(3)
  })

  it('throws error after exhausting all retries for execRaw', async () => {
    let callCount = 0
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        callCount++
        if (callCount === 1) {
          cb(null, '/usr/local/bin/mdvdb\n', '')
        } else {
          const err = Object.assign(new Error('failed'), { exitCode: 1, stderr: 'error' })
          cb(err, '', '')
        }
      }
    )

    await expect(execRaw('tree', [], '/tmp/project', { retries: 2 })).rejects.toThrow(
      CliExecutionError
    )

    expect(callCount).toBe(4) // which + 3 command attempts
  })
})
