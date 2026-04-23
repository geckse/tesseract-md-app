import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock node-pty ────────────────────────────────────────────────────────

interface MockPty {
  pid: number
  process: string
  onData: (cb: (data: string) => void) => { dispose(): void }
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose(): void }
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
  _emitData?: (data: string) => void
  _emitExit?: (code: number, signal?: number) => void
}

const mockPtySpawn = vi.fn()
vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => mockPtySpawn(...args),
}))

// Stub electron — PtyManager only takes WebContents-like objects
vi.mock('electron', () => ({}))

// Mock the store getters that shell resolution consults
const mockGetShellPath = vi.fn(() => '')
const mockGetShellArgs = vi.fn(() => '')
vi.mock('../../src/main/store', () => ({
  getTerminalShellPath: (): string => mockGetShellPath(),
  getTerminalShellArgs: (): string => mockGetShellArgs(),
}))

import { PtyManager, resolveShell, buildPtyEnv } from '../../src/main/pty'

// ── Helpers ───────────────────────────────────────────────────────────────

function makeMockPty(): MockPty {
  let dataCb: ((data: string) => void) | null = null
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null
  return {
    pid: 9999,
    process: 'zsh',
    onData: (cb) => {
      dataCb = cb
      return { dispose: (): void => {} }
    },
    onExit: (cb) => {
      exitCb = cb
      return { dispose: (): void => {} }
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _emitData: (data): void => dataCb?.(data),
    _emitExit: (code, signal): void => exitCb?.({ exitCode: code, signal }),
  }
}

interface FakeWebContents {
  id: number
  isDestroyed(): boolean
  send: ReturnType<typeof vi.fn>
}

function makeFakeWebContents(id = 1): FakeWebContents {
  return {
    id,
    isDestroyed: (): boolean => false,
    send: vi.fn(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PtyManager', () => {
  beforeEach(() => {
    mockPtySpawn.mockReset()
    mockGetShellPath.mockReset()
    mockGetShellArgs.mockReset()
    mockGetShellPath.mockReturnValue('')
    mockGetShellArgs.mockReturnValue('')
  })

  describe('spawn', () => {
    it('calls pty.spawn with resolved shell, cwd, and merged env', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()

      const result = mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )

      expect(mockPtySpawn).toHaveBeenCalledOnce()
      const [shell, args, opts] = mockPtySpawn.mock.calls[0]
      expect(shell).toBe('/bin/bash')
      expect(args).toEqual([])
      expect(opts.cwd).toBe('/tmp')
      expect(opts.cols).toBe(80)
      expect(opts.rows).toBe(24)
      expect(opts.env.TERM).toBe('xterm-256color')
      expect(opts.env.COLORTERM).toBe('truecolor')
      expect(opts.env.MDVDB_COLLECTION_ROOT).toBe('/tmp')
      expect(result.pid).toBe(9999)
      expect(result.shell).toBe('/bin/bash')
    })

    it('forwards PTY stdout to webContents via terminal:data', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()

      mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )
      pty._emitData?.('hello')
      expect(wc.send).toHaveBeenCalledWith('terminal:data', { id: 'T1', data: 'hello' })
    })

    it('forwards PTY exit to webContents via terminal:exit', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()

      mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )
      pty._emitExit?.(0)
      expect(wc.send).toHaveBeenCalledWith('terminal:exit', { id: 'T1', code: 0, signal: undefined })
    })

    it('throws TerminalSpawnError when node-pty spawn fails', () => {
      mockPtySpawn.mockImplementationOnce(() => {
        throw new Error('ENOENT')
      })
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      expect(() =>
        mgr.spawn(
          { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
          wc as unknown as Parameters<typeof mgr.spawn>[1]
        )
      ).toThrow(/Failed to spawn shell.*ENOENT/)
    })

    it('falls back to home directory when cwd does not exist', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      // A path that definitely doesn't exist on the test runner
      mgr.spawn(
        { id: 'T1', cwd: '/definitely-does-not-exist-xyz123', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )
      const opts = mockPtySpawn.mock.calls[0][2]
      expect(opts.cwd).not.toBe('/definitely-does-not-exist-xyz123')
      expect(typeof opts.cwd).toBe('string')
    })
  })

  describe('write / resize / dispose', () => {
    it('write forwards data to the pty', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )

      mgr.write('T1', 'hello\n')
      expect(pty.write).toHaveBeenCalledWith('hello\n')
    })

    it('write throws TerminalNotFoundError for unknown id', () => {
      const mgr = new PtyManager()
      expect(() => mgr.write('unknown', 'x')).toThrow(/Terminal not found/)
    })

    it('resize forwards cols/rows', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )
      mgr.resize('T1', 120, 40)
      expect(pty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('dispose kills the pty and removes the entry', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      mgr.spawn(
        { id: 'T1', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' },
        wc as unknown as Parameters<typeof mgr.spawn>[1]
      )
      expect(mgr.has('T1')).toBe(true)
      mgr.dispose('T1')
      expect(pty.kill).toHaveBeenCalled()
      expect(mgr.has('T1')).toBe(false)
    })

    it('disposeByWindow only drops PTYs owned by that window', () => {
      const p1 = makeMockPty()
      const p2 = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const mgr = new PtyManager()
      const wcA = makeFakeWebContents(1)
      const wcB = makeFakeWebContents(2)
      mgr.spawn({ id: 'A', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' }, wcA as unknown as Parameters<typeof mgr.spawn>[1])
      mgr.spawn({ id: 'B', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' }, wcB as unknown as Parameters<typeof mgr.spawn>[1])

      mgr.disposeByWindow(1)
      expect(mgr.has('A')).toBe(false)
      expect(mgr.has('B')).toBe(true)
      expect(p1.kill).toHaveBeenCalled()
      expect(p2.kill).not.toHaveBeenCalled()
    })

    it('disposeAll kills every pty and clears the map', () => {
      const p1 = makeMockPty()
      const p2 = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      mgr.spawn({ id: 'A', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' }, wc as unknown as Parameters<typeof mgr.spawn>[1])
      mgr.spawn({ id: 'B', cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/bash' }, wc as unknown as Parameters<typeof mgr.spawn>[1])
      mgr.disposeAll()
      expect(p1.kill).toHaveBeenCalled()
      expect(p2.kill).toHaveBeenCalled()
      expect(mgr.list()).toHaveLength(0)
    })
  })

  describe('list', () => {
    it('reports active terminal info', () => {
      const pty = makeMockPty()
      mockPtySpawn.mockReturnValueOnce(pty)
      const mgr = new PtyManager()
      const wc = makeFakeWebContents()
      mgr.spawn({ id: 'A', cwd: '/proj', cols: 80, rows: 24, shell: '/bin/zsh' }, wc as unknown as Parameters<typeof mgr.spawn>[1])
      const list = mgr.list()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id: 'A', pid: 9999, shell: '/bin/zsh', status: 'running' })
    })
  })
})

describe('resolveShell', () => {
  beforeEach(() => {
    mockGetShellPath.mockReturnValue('')
    mockGetShellArgs.mockReturnValue('')
  })

  it('prefers the explicit argument', () => {
    mockGetShellPath.mockReturnValue('/override/shell')
    const { shell, args } = resolveShell('/explicit/shell')
    expect(shell).toBe('/explicit/shell')
    expect(args).toEqual([])
  })

  it('falls back to the settings override', () => {
    mockGetShellPath.mockReturnValue('/override/zsh')
    mockGetShellArgs.mockReturnValue('-l -i')
    const { shell, args } = resolveShell()
    expect(shell).toBe('/override/zsh')
    expect(args).toEqual(['-l', '-i'])
  })

  it('uses process.env.SHELL when no override exists', () => {
    const prev = process.env.SHELL
    process.env.SHELL = '/bin/custom-shell'
    try {
      const { shell } = resolveShell()
      expect(shell).toBe('/bin/custom-shell')
    } finally {
      process.env.SHELL = prev
    }
  })
})

describe('buildPtyEnv', () => {
  it('sets TERM, COLORTERM, and MDVDB_COLLECTION_ROOT', () => {
    const env = buildPtyEnv('/my/collection')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.MDVDB_COLLECTION_ROOT).toBe('/my/collection')
  })

  it('merges extra overrides', () => {
    const env = buildPtyEnv('/my/collection', { FOO: 'bar' })
    expect(env.FOO).toBe('bar')
  })
})
