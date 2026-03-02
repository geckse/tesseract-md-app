import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process before importing cli module
const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: mockExecFile
}))
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => {
    // Return a wrapper that calls our mock and returns a promise
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err)
          else resolve({ stdout, stderr })
        })
      })
    }
  }
}))

import { findCli, getCliVersion, execCommand, execRaw } from '../../src/main/cli'
import {
  CliNotFoundError,
  CliExecutionError,
  CliParseError,
  CliTimeoutError
} from '../../src/main/errors'

beforeEach(() => {
  mockExecFile.mockReset()
})

describe('findCli', () => {
  it('returns the path to mdvdb binary', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '/usr/local/bin/mdvdb\n', '')
    })

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
  })

  it('throws CliNotFoundError when binary not found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('not found'), '', 'mdvdb not found')
    })

    await expect(findCli()).rejects.toThrow(CliNotFoundError)
  })

  it('throws CliNotFoundError when which returns empty output', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '  \n', '')
    })

    await expect(findCli()).rejects.toThrow(CliNotFoundError)
  })

  it('takes first line when multiple paths returned', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '/usr/local/bin/mdvdb\n/usr/bin/mdvdb\n', '')
    })

    const path = await findCli()
    expect(path).toBe('/usr/local/bin/mdvdb')
  })
})

describe('getCliVersion', () => {
  it('returns version string', async () => {
    // First call: which, second call: --version
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(null, 'mdvdb 0.1.0\n', '')
      }
    })

    const version = await getCliVersion()
    expect(version).toBe('0.1.0')
  })

  it('handles plain version output without prefix', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(null, '0.2.0\n', '')
      }
    })

    const version = await getCliVersion()
    expect(version).toBe('0.2.0')
  })

  it('throws CliNotFoundError when binary not found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('not found'), '', '')
    })

    await expect(getCliVersion()).rejects.toThrow(CliNotFoundError)
  })

  it('throws CliExecutionError when --version fails', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(new Error('failed'), '', 'error')
      }
    })

    await expect(getCliVersion()).rejects.toThrow(CliExecutionError)
  })
})

describe('execCommand', () => {
  function setupWhichAndExec(stdout: string, stderr = '') {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(null, stdout, stderr)
      }
    })
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
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        const err = Object.assign(new Error('timed out'), { killed: true })
        cb(err, '', '')
      }
    })

    await expect(execCommand('ingest', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliTimeoutError on ETIMEDOUT', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
        cb(err, '', '')
      }
    })

    await expect(execCommand('ingest', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliExecutionError on non-zero exit', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        const err = Object.assign(new Error('failed'), { exitCode: 2, stderr: 'index not found' })
        cb(err, '', '')
      }
    })

    await expect(execCommand('status', [], '/tmp/project')).rejects.toThrow(CliExecutionError)
  })

  it('respects custom timeout option', async () => {
    setupWhichAndExec('{}')

    await execCommand('ingest', [], '/tmp/project', { timeout: 300_000 })

    const secondCall = mockExecFile.mock.calls[1]
    const opts = secondCall[2] as { timeout: number }
    expect(opts.timeout).toBe(300_000)
  })
})

describe('execRaw', () => {
  it('returns raw stdout/stderr without JSON parsing', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(null, 'raw output here', 'some warnings')
      }
    })

    const result = await execRaw('tree', [], '/tmp/project')
    expect(result.stdout).toBe('raw output here')
    expect(result.stderr).toBe('some warnings')
    expect(result.exitCode).toBe(0)
  })

  it('does not pass --json flag', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        cb(null, '', '')
      }
    })

    await execRaw('tree', [], '/tmp/project')

    const secondCall = mockExecFile.mock.calls[1]
    const args = secondCall[1] as string[]
    expect(args).not.toContain('--json')
    expect(args).toContain('--root')
  })

  it('throws CliTimeoutError on timeout', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        const err = Object.assign(new Error('timed out'), { killed: true })
        cb(err, '', '')
      }
    })

    await expect(execRaw('tree', [], '/tmp/project')).rejects.toThrow(CliTimeoutError)
  })

  it('throws CliExecutionError on failure', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, '/usr/local/bin/mdvdb\n', '')
      } else {
        const err = Object.assign(new Error('failed'), { exitCode: 1, stderr: 'error' })
        cb(err, '', '')
      }
    })

    await expect(execRaw('tree', [], '/tmp/project')).rejects.toThrow(CliExecutionError)
  })
})
