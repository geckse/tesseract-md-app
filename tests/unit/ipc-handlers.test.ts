import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron ipcMain
const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args)
  }
}))

// Mock CLI module
const mockFindCli = vi.fn()
const mockGetCliVersion = vi.fn()
const mockExecCommand = vi.fn()
const mockExecRaw = vi.fn()
vi.mock('../../src/main/cli', () => ({
  findCli: (...args: unknown[]) => mockFindCli(...args),
  getCliVersion: (...args: unknown[]) => mockGetCliVersion(...args),
  execCommand: (...args: unknown[]) => mockExecCommand(...args),
  execRaw: (...args: unknown[]) => mockExecRaw(...args)
}))

import { registerIpcHandlers } from '../../src/main/ipc-handlers'

beforeEach(() => {
  mockHandle.mockReset()
  mockFindCli.mockReset()
  mockGetCliVersion.mockReset()
  mockExecCommand.mockReset()
  mockExecRaw.mockReset()
})

describe('registerIpcHandlers', () => {
  it('registers all expected IPC channels', () => {
    registerIpcHandlers()

    const channels = mockHandle.mock.calls.map((call: unknown[]) => call[0])
    expect(channels).toContain('cli:find')
    expect(channels).toContain('cli:version')
    expect(channels).toContain('cli:search')
    expect(channels).toContain('cli:status')
    expect(channels).toContain('cli:ingest')
    expect(channels).toContain('cli:ingest-preview')
    expect(channels).toContain('cli:tree')
    expect(channels).toContain('cli:get')
    expect(channels).toContain('cli:links')
    expect(channels).toContain('cli:backlinks')
    expect(channels).toContain('cli:orphans')
    expect(channels).toContain('cli:clusters')
    expect(channels).toContain('cli:schema')
    expect(channels).toContain('cli:config')
    expect(channels).toContain('cli:doctor')
    expect(channels).toContain('cli:init')
    expect(channels).toHaveLength(16)
  })
})

describe('IPC handler argument passing', () => {
  /** Helper: register handlers, find the one for `channel`, invoke it */
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {} // IPC event stub

  describe('cli:find', () => {
    it('calls findCli', async () => {
      mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
      const handler = getHandler('cli:find')
      const result = await handler()
      expect(result).toBe('/usr/local/bin/mdvdb')
      expect(mockFindCli).toHaveBeenCalled()
    })
  })

  describe('cli:version', () => {
    it('calls getCliVersion', async () => {
      mockGetCliVersion.mockResolvedValue('0.1.0')
      const handler = getHandler('cli:version')
      const result = await handler()
      expect(result).toBe('0.1.0')
      expect(mockGetCliVersion).toHaveBeenCalled()
    })
  })

  describe('cli:search', () => {
    it('passes query as first arg', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'test', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'test')

      expect(mockExecCommand).toHaveBeenCalledWith(
        'search',
        ['test'],
        '/tmp/project'
      )
    })

    it('passes search options as CLI args', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'test', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'test', {
        limit: 5,
        mode: 'semantic',
        path: 'docs/',
        filter: 'status:published'
      })

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).toContain('test')
      expect(args).toContain('--limit')
      expect(args).toContain('5')
      expect(args).toContain('--mode')
      expect(args).toContain('semantic')
      expect(args).toContain('--path')
      expect(args).toContain('docs/')
      expect(args).toContain('--filter')
      expect(args).toContain('status:published')
    })

    it('omits undefined options', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'q', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'q', {})

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).toEqual(['q'])
    })
  })

  describe('cli:status', () => {
    it('calls execCommand with status and empty args', async () => {
      mockExecCommand.mockResolvedValue({ document_count: 5 })
      const handler = getHandler('cli:status')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('status', [], '/tmp/project')
    })
  })

  describe('cli:ingest', () => {
    it('calls execCommand with 5 minute timeout', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith(
        'ingest', [], '/tmp/project', { timeout: 300_000 }
      )
    })

    it('passes --reindex flag when requested', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project', { reindex: true })

      expect(mockExecCommand).toHaveBeenCalledWith(
        'ingest', ['--reindex'], '/tmp/project', { timeout: 300_000 }
      )
    })

    it('omits --reindex flag when not requested', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project', { reindex: false })

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).not.toContain('--reindex')
    })
  })

  describe('cli:ingest-preview', () => {
    it('passes --preview flag', async () => {
      mockExecCommand.mockResolvedValue({ files: [] })
      const handler = getHandler('cli:ingest-preview')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('ingest', ['--preview'], '/tmp/project')
    })
  })

  describe('cli:tree', () => {
    it('calls with empty args when no path given', async () => {
      mockExecCommand.mockResolvedValue({ root: {} })
      const handler = getHandler('cli:tree')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('tree', [], '/tmp/project')
    })

    it('passes --path when path specified', async () => {
      mockExecCommand.mockResolvedValue({ root: {} })
      const handler = getHandler('cli:tree')
      await handler(fakeEvent, '/tmp/project', 'docs/')

      expect(mockExecCommand).toHaveBeenCalledWith('tree', ['--path', 'docs/'], '/tmp/project')
    })
  })

  describe('cli:get', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ path: 'readme.md' })
      const handler = getHandler('cli:get')
      await handler(fakeEvent, '/tmp/project', 'readme.md')

      expect(mockExecCommand).toHaveBeenCalledWith('get', ['readme.md'], '/tmp/project')
    })
  })

  describe('cli:links', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ outgoing: [], incoming: [] })
      const handler = getHandler('cli:links')
      await handler(fakeEvent, '/tmp/project', 'notes.md')

      expect(mockExecCommand).toHaveBeenCalledWith('links', ['notes.md'], '/tmp/project')
    })
  })

  describe('cli:backlinks', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ backlinks: [] })
      const handler = getHandler('cli:backlinks')
      await handler(fakeEvent, '/tmp/project', 'notes.md')

      expect(mockExecCommand).toHaveBeenCalledWith('backlinks', ['notes.md'], '/tmp/project')
    })
  })

  describe('cli:orphans', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({ orphans: [] })
      const handler = getHandler('cli:orphans')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('orphans', [], '/tmp/project')
    })
  })

  describe('cli:clusters', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue([])
      const handler = getHandler('cli:clusters')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('clusters', [], '/tmp/project')
    })
  })

  describe('cli:schema', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({ fields: [] })
      const handler = getHandler('cli:schema')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('schema', [], '/tmp/project')
    })
  })

  describe('cli:config', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({})
      const handler = getHandler('cli:config')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('config', [], '/tmp/project')
    })
  })

  describe('cli:doctor', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({ checks: [] })
      const handler = getHandler('cli:doctor')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('doctor', [], '/tmp/project')
    })
  })

  describe('cli:init', () => {
    it('calls with empty args', async () => {
      mockExecRaw.mockResolvedValue('')
      const handler = getHandler('cli:init')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecRaw).toHaveBeenCalledWith('init', [], '/tmp/project')
    })
  })
})

describe('IPC error serialization', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  it('serializes CliNotFoundError for IPC transport', async () => {
    const { CliNotFoundError } = await import('../../src/main/errors')
    mockFindCli.mockRejectedValue(new CliNotFoundError())
    const handler = getHandler('cli:find')

    const result = await handler()
    expect(result).toEqual({
      error: true,
      type: 'CliNotFoundError',
      message: 'mdvdb CLI binary not found on PATH'
    })
  })

  it('serializes CliExecutionError with exitCode and stderr', async () => {
    const { CliExecutionError } = await import('../../src/main/errors')
    mockExecCommand.mockRejectedValue(new CliExecutionError('command failed', 2, 'index not found'))
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'command failed',
      exitCode: 2,
      stderr: 'index not found'
    })
  })

  it('serializes CliTimeoutError for IPC transport', async () => {
    const { CliTimeoutError } = await import('../../src/main/errors')
    mockExecCommand.mockRejectedValue(new CliTimeoutError())
    const handler = getHandler('cli:ingest')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliTimeoutError',
      message: 'CLI command timed out'
    })
  })

  it('serializes generic errors with type and message', async () => {
    mockExecCommand.mockRejectedValue(new TypeError('unexpected'))
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'unexpected'
    })
  })

  it('serializes non-Error values as strings', async () => {
    mockExecCommand.mockRejectedValue('string error')
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'string error'
    })
  })
})
