import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron ipcMain and shell
const mockHandle = vi.fn()

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

// Mock store module
const mockGetCollections = vi.fn()
const mockAddCollection = vi.fn()
const mockRemoveCollection = vi.fn()
const mockSetActiveCollection = vi.fn()
const mockGetActiveCollection = vi.fn()
vi.mock('../../src/main/store', () => ({
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
  addCollection: (...args: unknown[]) => mockAddCollection(...args),
  removeCollection: (...args: unknown[]) => mockRemoveCollection(...args),
  setActiveCollection: (...args: unknown[]) => mockSetActiveCollection(...args),
  getActiveCollection: (...args: unknown[]) => mockGetActiveCollection(...args)
}))

// Mock collections module
const mockPickCollectionFolder = vi.fn()
const mockValidateCollectionPath = vi.fn()
const mockInitCollection = vi.fn()
const mockConfirmRemoveCollection = vi.fn()
const mockPromptInitCollection = vi.fn()
vi.mock('../../src/main/collections', () => ({
  pickCollectionFolder: (...args: unknown[]) => mockPickCollectionFolder(...args),
  validateCollectionPath: (...args: unknown[]) => mockValidateCollectionPath(...args),
  initCollection: (...args: unknown[]) => mockInitCollection(...args),
  confirmRemoveCollection: (...args: unknown[]) => mockConfirmRemoveCollection(...args),
  promptInitCollection: (...args: unknown[]) => mockPromptInitCollection(...args)
}))

// Mock node:fs for fs:read-file and fs:write-file handlers
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
vi.mock('node:fs', () => ({
  default: {
    promises: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args)
    }
  },
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args)
  }
}))

// Mock watcher module
const mockWatcherStart = vi.fn()
const mockWatcherStop = vi.fn()
const mockWatcherDestroy = vi.fn()
const mockWatcherGetState = vi.fn()
const mockWatcherIsRunning = vi.fn()
const mockWatcherOnEvent = vi.fn()
const mockWatcherOnError = vi.fn()
const mockWatcherOnStateChange = vi.fn()
const mockWatcherRemoveAllListeners = vi.fn()
vi.mock('../../src/main/watcher', () => ({
  WatcherManager: vi.fn().mockImplementation(() => ({
    start: (...args: unknown[]) => mockWatcherStart(...args),
    stop: (...args: unknown[]) => mockWatcherStop(...args),
    destroy: (...args: unknown[]) => mockWatcherDestroy(...args),
    getState: (...args: unknown[]) => mockWatcherGetState(...args),
    isRunning: (...args: unknown[]) => mockWatcherIsRunning(...args),
    onEvent: (...args: unknown[]) => mockWatcherOnEvent(...args),
    onError: (...args: unknown[]) => mockWatcherOnError(...args),
    onStateChange: (...args: unknown[]) => mockWatcherOnStateChange(...args),
    removeAllListeners: (...args: unknown[]) => mockWatcherRemoveAllListeners(...args)
  }))
}))

// Mock menu module
const mockRefreshRecentMenu = vi.fn()
vi.mock('../../src/main/menu', () => ({
  refreshRecentMenu: (...args: unknown[]) => mockRefreshRecentMenu(...args)
}))

// Mock electron shell and clipboard
const mockShellOpenPath = vi.fn()
const mockClipboardWriteText = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args)
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: (...args: unknown[]) => mockShellOpenPath(...args)
  },
  clipboard: {
    writeText: (...args: unknown[]) => mockClipboardWriteText(...args)
  }
}))

import { registerIpcHandlers } from '../../src/main/ipc-handlers'

beforeEach(() => {
  mockHandle.mockReset()
  mockFindCli.mockReset()
  mockGetCliVersion.mockReset()
  mockExecCommand.mockReset()
  mockExecRaw.mockReset()
  mockGetCollections.mockReset()
  mockAddCollection.mockReset()
  mockRemoveCollection.mockReset()
  mockSetActiveCollection.mockReset()
  mockGetActiveCollection.mockReset()
  mockPickCollectionFolder.mockReset()
  mockValidateCollectionPath.mockReset()
  mockInitCollection.mockReset()
  mockConfirmRemoveCollection.mockReset()
  mockPromptInitCollection.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockWatcherStart.mockReset()
  mockWatcherStop.mockReset()
  mockWatcherDestroy.mockReset()
  mockWatcherGetState.mockReset()
  mockWatcherIsRunning.mockReset()
  mockWatcherOnEvent.mockReset()
  mockWatcherOnError.mockReset()
  mockWatcherOnStateChange.mockReset()
  mockWatcherRemoveAllListeners.mockReset()
  mockRefreshRecentMenu.mockReset()
  mockShellOpenPath.mockReset()
  mockClipboardWriteText.mockReset()
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
    expect(channels).toContain('collections:list')
    expect(channels).toContain('collections:add')
    expect(channels).toContain('collections:remove')
    expect(channels).toContain('collections:set-active')
    expect(channels).toContain('collections:get-active')
    expect(channels).toContain('fs:read-file')
    expect(channels).toContain('fs:write-file')
    expect(channels).toContain('shell:show-item-in-folder')
    expect(channels).toContain('cli:ingest-file')
    expect(channels).toContain('watcher:start')
    expect(channels).toContain('watcher:stop')
    expect(channels).toContain('watcher:status')
    expect(channels).toContain('shell:open-path')
    expect(channels).toContain('clipboard:write-text')
    expect(channels).toHaveLength(55)
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

describe('Collection IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  describe('collections:list', () => {
    it('returns all collections', async () => {
      const cols = [{ id: '1', name: 'docs', path: '/docs', addedAt: 1, lastOpenedAt: 1 }]
      mockGetCollections.mockReturnValue(cols)
      const handler = getHandler('collections:list')
      const result = await handler()
      expect(result).toEqual(cols)
      expect(mockGetCollections).toHaveBeenCalled()
    })
  })

  describe('collections:add', () => {
    it('returns null when folder picker is canceled', async () => {
      mockPickCollectionFolder.mockResolvedValue(null)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toBeNull()
    })

    it('adds collection when path is valid with config', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: true, name: 'proj' })
      mockAddCollection.mockReturnValue(col)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toEqual(col)
      expect(mockAddCollection).toHaveBeenCalledWith('/proj')
    })

    it('prompts init when path has no config and user accepts', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: false, name: 'proj' })
      mockPromptInitCollection.mockResolvedValue(true)
      mockInitCollection.mockResolvedValue(undefined)
      mockAddCollection.mockReturnValue(col)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(mockPromptInitCollection).toHaveBeenCalledWith('proj')
      expect(mockInitCollection).toHaveBeenCalledWith('/proj')
      expect(result).toEqual(col)
    })

    it('returns null when user declines init', async () => {
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: false, name: 'proj' })
      mockPromptInitCollection.mockResolvedValue(false)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toBeNull()
    })

    it('returns error when path is invalid', async () => {
      mockPickCollectionFolder.mockResolvedValue('/bad')
      mockValidateCollectionPath.mockResolvedValue({ valid: false, hasConfig: false, name: 'bad', error: 'Path does not exist' })
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toEqual(expect.objectContaining({ error: true, message: 'Path does not exist' }))
    })
  })

  describe('collections:remove', () => {
    it('removes collection when user confirms', async () => {
      mockGetCollections.mockReturnValue([{ id: 'x', name: 'proj', path: '/proj' }])
      mockConfirmRemoveCollection.mockResolvedValue(true)
      const handler = getHandler('collections:remove')
      await handler(fakeEvent, 'x')
      expect(mockConfirmRemoveCollection).toHaveBeenCalledWith('proj')
      expect(mockRemoveCollection).toHaveBeenCalledWith('x')
    })

    it('does not remove when user cancels', async () => {
      mockGetCollections.mockReturnValue([{ id: 'x', name: 'proj', path: '/proj' }])
      mockConfirmRemoveCollection.mockResolvedValue(false)
      const handler = getHandler('collections:remove')
      await handler(fakeEvent, 'x')
      expect(mockRemoveCollection).not.toHaveBeenCalled()
    })

    it('returns error when collection not found', async () => {
      mockGetCollections.mockReturnValue([])
      const handler = getHandler('collections:remove')
      const result = await handler(fakeEvent, 'missing')
      expect(result).toEqual(expect.objectContaining({ error: true }))
    })
  })

  describe('collections:set-active', () => {
    it('calls setActiveCollection with id', async () => {
      const handler = getHandler('collections:set-active')
      await handler(fakeEvent, 'abc')
      expect(mockSetActiveCollection).toHaveBeenCalledWith('abc')
    })
  })

  describe('collections:get-active', () => {
    it('returns active collection', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockGetActiveCollection.mockReturnValue(col)
      const handler = getHandler('collections:get-active')
      const result = await handler()
      expect(result).toEqual(col)
    })

    it('returns null when no active collection', async () => {
      mockGetActiveCollection.mockReturnValue(null)
      const handler = getHandler('collections:get-active')
      const result = await handler()
      expect(result).toBeNull()
    })
  })

  describe('fs:read-file', () => {
    it('reads file within a known collection', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadFile.mockResolvedValue('# Hello')
      const handler = getHandler('fs:read-file')
      const result = await handler(fakeEvent, '/proj/readme.md')
      expect(mockReadFile).toHaveBeenCalledWith('/proj/readme.md', 'utf-8')
      expect(result).toBe('# Hello')
    })

    it('denies access to paths outside collections', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:read-file')
      const result = await handler(fakeEvent, '/etc/passwd')
      expect(result).toEqual(expect.objectContaining({ error: true, message: 'Access denied: path is not within a known collection' }))
      expect(mockReadFile).not.toHaveBeenCalled()
    })
  })

  describe('fs:write-file', () => {
    it('writes file within a known collection', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockWriteFile.mockResolvedValue(undefined)
      const handler = getHandler('fs:write-file')
      const result = await handler(fakeEvent, '/proj/readme.md', '# Updated')
      expect(mockWriteFile).toHaveBeenCalledWith('/proj/readme.md', '# Updated', 'utf-8')
      expect(result).toBeUndefined()
    })

    it('denies access to paths outside collections', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:write-file')
      const result = await handler(fakeEvent, '/etc/shadow', 'malicious')
      expect(result).toEqual(expect.objectContaining({ error: true, message: 'Access denied: path is not within a known collection' }))
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('passes utf-8 encoding to writeFile', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockWriteFile.mockResolvedValue(undefined)
      const handler = getHandler('fs:write-file')
      await handler(fakeEvent, '/proj/notes.md', 'Héllo wörld 日本語')
      expect(mockWriteFile).toHaveBeenCalledWith('/proj/notes.md', 'Héllo wörld 日本語', 'utf-8')
    })

    it('returns serialized error when writeFile fails', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'))
      const handler = getHandler('fs:write-file')
      const result = await handler(fakeEvent, '/proj/readme.md', 'content')
      expect(result).toEqual(expect.objectContaining({ error: true, message: 'EACCES: permission denied' }))
    })
  })
})

describe('shell:open-path IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('opens path within a known collection', async () => {
    mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
    mockShellOpenPath.mockResolvedValue('')
    const handler = getHandler('shell:open-path')
    await handler(fakeEvent, '/proj/readme.md')
    expect(mockShellOpenPath).toHaveBeenCalledWith('/proj/readme.md')
  })

  it('denies access to paths outside collections', async () => {
    mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
    const handler = getHandler('shell:open-path')
    const result = await handler(fakeEvent, '/etc/passwd')
    expect(result).toEqual(expect.objectContaining({ error: true, message: 'Access denied: path is not within a known collection' }))
    expect(mockShellOpenPath).not.toHaveBeenCalled()
  })
})

describe('clipboard:write-text IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('writes text to clipboard', async () => {
    const handler = getHandler('clipboard:write-text')
    await handler(fakeEvent, '/proj/readme.md')
    expect(mockClipboardWriteText).toHaveBeenCalledWith('/proj/readme.md')
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

describe('Watcher IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  describe('watcher:start', () => {
    it('calls watcher start with root path', async () => {
      mockWatcherStart.mockResolvedValue(undefined)
      const handler = getHandler('watcher:start')
      await handler(fakeEvent, '/tmp/project')
      expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
    })

    it('sets up event forwarding listeners when mainWindow is provided', async () => {
      mockWatcherStart.mockResolvedValue(undefined)
      mockHandle.mockReset()
      const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      registerIpcHandlers(mockWindow as unknown as import('electron').BrowserWindow)
      const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
      const handler = call![1] as (...args: unknown[]) => Promise<unknown>
      await handler(fakeEvent, '/tmp/project')
      expect(mockWatcherRemoveAllListeners).toHaveBeenCalled()
      expect(mockWatcherOnEvent).toHaveBeenCalled()
      expect(mockWatcherOnError).toHaveBeenCalled()
      expect(mockWatcherOnStateChange).toHaveBeenCalled()
    })

    it('skips event forwarding when no mainWindow', async () => {
      mockWatcherStart.mockResolvedValue(undefined)
      const handler = getHandler('watcher:start')
      await handler(fakeEvent, '/tmp/project')
      expect(mockWatcherRemoveAllListeners).not.toHaveBeenCalled()
    })
  })

  describe('watcher:stop', () => {
    it('calls watcher stop', async () => {
      mockWatcherStop.mockResolvedValue(undefined)
      const handler = getHandler('watcher:stop')
      await handler(fakeEvent)
      expect(mockWatcherStop).toHaveBeenCalled()
    })
  })

  describe('watcher:status', () => {
    it('returns watcher state and running status', async () => {
      mockWatcherGetState.mockReturnValue('running')
      mockWatcherIsRunning.mockReturnValue(true)
      const handler = getHandler('watcher:status')
      const result = await handler(fakeEvent)
      expect(result).toEqual({ state: 'running', running: true })
    })

    it('returns stopped state when not running', async () => {
      mockWatcherGetState.mockReturnValue('stopped')
      mockWatcherIsRunning.mockReturnValue(false)
      const handler = getHandler('watcher:status')
      const result = await handler(fakeEvent)
      expect(result).toEqual({ state: 'stopped', running: false })
    })
  })
})

describe('cli:ingest-file IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('passes --file flag with file path', async () => {
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })
    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md')

    expect(mockExecCommand).toHaveBeenCalledWith(
      'ingest', ['--file', 'readme.md'], '/tmp/project', { timeout: 300_000 }
    )
  })

  it('passes --reindex flag when requested', async () => {
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })
    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md', { reindex: true })

    const args = mockExecCommand.mock.calls[0][1] as string[]
    expect(args).toContain('--file')
    expect(args).toContain('readme.md')
    expect(args).toContain('--reindex')
  })
})

describe('Watcher pause during ingest', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers()
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('stops watcher before ingest and restarts after', async () => {
    // Trigger watcher:start first to initialise the watcherManager singleton
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    // Now the watcher is "running"
    mockWatcherIsRunning.mockReturnValue(true)
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ files_indexed: 3 })

    const ingestHandler = getHandler('cli:ingest')
    await ingestHandler(fakeEvent, '/tmp/project')

    // Watcher should have been stopped before ingest
    expect(mockWatcherStop).toHaveBeenCalled()
    // Ingest should have run
    expect(mockExecCommand).toHaveBeenCalledWith(
      'ingest', [], '/tmp/project', { timeout: 300_000 }
    )
    // Watcher should have been restarted after ingest
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })

  it('stops watcher before ingest-file and restarts after', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    mockWatcherIsRunning.mockReturnValue(true)
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })

    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md', { reindex: true })

    expect(mockWatcherStop).toHaveBeenCalled()
    expect(mockExecCommand).toHaveBeenCalled()
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })

  it('does not stop or restart watcher when it is not running', async () => {
    mockWatcherIsRunning.mockReturnValue(false)
    mockExecCommand.mockResolvedValue({ files_indexed: 3 })

    const handler = getHandler('cli:ingest')
    await handler(fakeEvent, '/tmp/project')

    expect(mockWatcherStop).not.toHaveBeenCalled()
    expect(mockExecCommand).toHaveBeenCalled()
    // watcher.start should not be called for restart
    // (it may have been called during registerIpcHandlers, so check call count)
    const startCallsAfterIngest = mockWatcherStart.mock.calls.filter(
      (c: unknown[]) => c[0] === '/tmp/project'
    )
    expect(startCallsAfterIngest).toHaveLength(0)
  })

  it('restarts watcher even when ingest fails', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    mockWatcherIsRunning.mockReturnValue(true)
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockRejectedValue(new Error('Tantivy lock error'))

    const handler = getHandler('cli:ingest')
    const result = await handler(fakeEvent, '/tmp/project')

    // Should be an error result (wrapHandler catches it)
    expect(result).toEqual(expect.objectContaining({ error: true }))
    // Watcher should still have been restarted
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })
})

describe('Watcher event envelope wrapping', () => {
  it('wraps watch events in { type: "watch-event", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const mockSend = vi.fn()
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }
    registerIpcHandlers(mockWindow as unknown as import('electron').BrowserWindow)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    // Get the onEvent callback that was registered
    const onEventCall = mockWatcherOnEvent.mock.calls[0]
    const onEventCallback = onEventCall[0] as (event: unknown) => void

    // Simulate a raw watcher event (as it comes from NDJSON)
    const rawEvent = { event_type: 'Modified', path: 'readme.md', chunks_processed: 3, duration_ms: 42, success: true, error: null }
    onEventCallback(rawEvent)

    expect(mockSend).toHaveBeenCalledWith('watcher:event', {
      type: 'watch-event',
      data: rawEvent
    })
  })

  it('wraps errors in { type: "error", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const mockSend = vi.fn()
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }
    registerIpcHandlers(mockWindow as unknown as import('electron').BrowserWindow)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    const onErrorCall = mockWatcherOnError.mock.calls[0]
    const onErrorCallback = onErrorCall[0] as (error: Error) => void

    onErrorCallback(new Error('watcher crashed'))

    expect(mockSend).toHaveBeenCalledWith('watcher:event', {
      type: 'error',
      data: { message: 'watcher crashed' }
    })
  })

  it('wraps state changes in { type: "state-change", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const mockSend = vi.fn()
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }
    registerIpcHandlers(mockWindow as unknown as import('electron').BrowserWindow)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    const onStateCall = mockWatcherOnStateChange.mock.calls[0]
    const onStateCallback = onStateCall[0] as (state: string) => void

    onStateCallback('running')

    expect(mockSend).toHaveBeenCalledWith('watcher:event', {
      type: 'state-change',
      data: 'running'
    })
  })

  it('sends all event types on the single watcher:event channel', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const mockSend = vi.fn()
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } }
    registerIpcHandlers(mockWindow as unknown as import('electron').BrowserWindow)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    // Fire all three callback types
    const onEventCb = mockWatcherOnEvent.mock.calls[0][0] as (e: unknown) => void
    const onErrorCb = mockWatcherOnError.mock.calls[0][0] as (e: Error) => void
    const onStateCb = mockWatcherOnStateChange.mock.calls[0][0] as (s: string) => void

    onEventCb({ event_type: 'Created', path: 'new.md' })
    onErrorCb(new Error('fail'))
    onStateCb('stopped')

    // All three should go to 'watcher:event' channel, not separate channels
    const channels = mockSend.mock.calls.map((c: unknown[]) => c[0])
    expect(channels.every((ch: string) => ch === 'watcher:event')).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(3)
  })
})
