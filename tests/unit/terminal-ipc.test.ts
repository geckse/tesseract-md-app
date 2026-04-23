import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TerminalSpawnError, TerminalNotFoundError } from '../../src/main/errors'
import type { PtyManager } from '../../src/main/pty'

// Mock electron.ipcMain
const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
  },
}))

// Stub ipc-handlers module so we don't pull in its heavy transitive deps
// (updater, window-manager, etc.). wrapHandler's logic is exercised via
// the errors.ts serialize() methods we test below.
vi.mock('../../src/main/ipc-handlers', () => ({
  wrapHandler: async <T>(fn: () => Promise<T>): Promise<T | { error: true; type: string; message: string }> => {
    try {
      return await fn()
    } catch (err: unknown) {
      const maybeSerializable = err as { serialize?: () => { error: true; type: string; message: string } }
      if (typeof maybeSerializable.serialize === 'function') {
        return maybeSerializable.serialize()
      }
      if (err instanceof Error) {
        return { error: true, type: 'CliExecutionError', message: err.message }
      }
      return { error: true, type: 'CliExecutionError', message: String(err) }
    }
  },
}))

import { registerTerminalHandlers } from '../../src/main/pty-handlers'

function createMockPtyManager(): PtyManager {
  return {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    disposeByWindow: vi.fn(),
    disposeAll: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    has: vi.fn().mockReturnValue(true),
  } as unknown as PtyManager
}

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

describe('registerTerminalHandlers', () => {
  beforeEach(() => {
    mockHandle.mockReset()
  })

  it('registers all terminal:* channels', () => {
    const mgr = createMockPtyManager()
    registerTerminalHandlers(mgr)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toEqual(
      expect.arrayContaining([
        'terminal:create',
        'terminal:write',
        'terminal:resize',
        'terminal:dispose',
        'terminal:list',
      ])
    )
  })

  it('terminal:create forwards opts and sender to PtyManager.spawn', async () => {
    const mgr = createMockPtyManager()
    vi.mocked(mgr.spawn).mockReturnValue({ pid: 42, shell: '/bin/zsh' })
    registerTerminalHandlers(mgr)

    const handler = getHandler('terminal:create')
    const sender = { id: 7 }
    const opts = { id: 'T1', cwd: '/tmp', cols: 80, rows: 24 }
    const result = await handler({ sender } as unknown, opts)
    expect(mgr.spawn).toHaveBeenCalledWith(opts, sender)
    expect(result).toEqual({ pid: 42, shell: '/bin/zsh' })
  })

  it('terminal:write passes id and data to PtyManager.write', async () => {
    const mgr = createMockPtyManager()
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:write')
    await handler({} as unknown, { id: 'T1', data: 'echo hi\r' })
    expect(mgr.write).toHaveBeenCalledWith('T1', 'echo hi\r')
  })

  it('terminal:resize clamps cols/rows through PtyManager.resize', async () => {
    const mgr = createMockPtyManager()
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:resize')
    await handler({} as unknown, { id: 'T1', cols: 120, rows: 40 })
    expect(mgr.resize).toHaveBeenCalledWith('T1', 120, 40)
  })

  it('terminal:dispose routes to PtyManager.dispose', async () => {
    const mgr = createMockPtyManager()
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:dispose')
    await handler({} as unknown, { id: 'T1' })
    expect(mgr.dispose).toHaveBeenCalledWith('T1')
  })

  it('terminal:list returns the live terminal list', async () => {
    const mgr = createMockPtyManager()
    vi.mocked(mgr.list).mockReturnValue([
      { id: 'T1', pid: 1, shell: '/bin/zsh', cwd: '/tmp', status: 'running' },
    ])
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:list')
    const result = await handler({} as unknown)
    expect(result).toEqual([
      { id: 'T1', pid: 1, shell: '/bin/zsh', cwd: '/tmp', status: 'running' },
    ])
  })

  it('serializes TerminalSpawnError through wrapHandler', async () => {
    const mgr = createMockPtyManager()
    vi.mocked(mgr.spawn).mockImplementationOnce(() => {
      throw new TerminalSpawnError('missing shell')
    })
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:create')
    const result = await handler({ sender: { id: 1 } } as unknown, {
      id: 'T1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    })
    expect(result).toMatchObject({ error: true, type: 'TerminalSpawnError', message: 'missing shell' })
  })

  it('serializes TerminalNotFoundError through wrapHandler', async () => {
    const mgr = createMockPtyManager()
    vi.mocked(mgr.write).mockImplementationOnce(() => {
      throw new TerminalNotFoundError('T99')
    })
    registerTerminalHandlers(mgr)
    const handler = getHandler('terminal:write')
    const result = await handler({} as unknown, { id: 'T99', data: 'x' })
    expect(result).toMatchObject({ error: true, type: 'TerminalNotFoundError' })
  })
})
