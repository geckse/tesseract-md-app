import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock child_process - only need spawn
const mockSpawn = vi.fn()
vi.mock('node:child_process', () => ({
  default: { spawn: (...args: unknown[]) => mockSpawn(...args) },
  spawn: (...args: unknown[]) => mockSpawn(...args)
}))

// Mock readline - synchronous line parsing from EventEmitter stdout
const mockCreateInterface = (opts: { input: EventEmitter }) => {
  const rl = new EventEmitter()
  let buffer = ''
  opts.input.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      rl.emit('line', line)
    }
  })
  return rl
}
vi.mock('node:readline', () => {
  return {
    default: { createInterface: (...args: unknown[]) => mockCreateInterface(args[0] as { input: EventEmitter }) },
    createInterface: (...args: unknown[]) => mockCreateInterface(args[0] as { input: EventEmitter })
  }
})

// Mock findCli
const mockFindCli = vi.fn()
vi.mock('../../src/main/cli', () => ({
  findCli: () => mockFindCli()
}))

import { WatcherManager, type WatcherEvent, type WatcherState } from '../../src/main/watcher'

/** Create a fake ChildProcess with stdout/stderr as event emitters */
function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    pid: number
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  child.pid = 12345
  return child
}

/** Helper to push data to mock child stdout */
function pushStdout(child: ReturnType<typeof createMockChild>, data: string) {
  child.stdout.emit('data', Buffer.from(data))
}

beforeEach(() => {
  vi.useFakeTimers()
  mockSpawn.mockReset()
  mockFindCli.mockReset()
  mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WatcherManager', () => {
  describe('start', () => {
    it('spawns mdvdb watch with correct args', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/mdvdb',
        ['watch', '--json', '--root', '/tmp/project'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      )
    })

    it('transitions to starting then running on first event', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const states: WatcherState[] = []
      const wm = new WatcherManager()
      wm.onStateChange((s) => states.push(s))

      await wm.start('/tmp/project')
      expect(states).toContain('starting')

      // Emit a JSON line on stdout
      pushStdout(child,'{"type":"ready"}\n')
      await vi.advanceTimersByTimeAsync(0)

      expect(states).toContain('running')
      expect(wm.isRunning()).toBe(true)
    })

    it('transitions to running after 2s timeout if no events', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      expect(wm.getState()).toBe('starting')

      await vi.advanceTimersByTimeAsync(2000)
      expect(wm.getState()).toBe('running')
    })

    it('does nothing if already running', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)
      expect(wm.isRunning()).toBe(true)

      mockSpawn.mockClear()
      await wm.start('/tmp/project')
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('enters error state when CLI not found', async () => {
      mockFindCli.mockRejectedValue(new Error('CLI not found'))

      const errors: Error[] = []
      const wm = new WatcherManager()
      wm.onError((e) => errors.push(e))

      await wm.start('/tmp/project')

      expect(wm.getState()).toBe('error')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('CLI not found')
    })
  })

  describe('stop', () => {
    it('sends SIGTERM and transitions to stopped', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)

      // When kill is called, simulate close event
      child.kill.mockImplementation(() => {
        setTimeout(() => child.emit('close', 0), 10)
      })

      const stopPromise = wm.stop()
      await vi.advanceTimersByTimeAsync(50)
      await stopPromise

      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(wm.getState()).toBe('stopped')
    })

    it('resolves immediately if already stopped', async () => {
      const wm = new WatcherManager()
      await wm.stop()
      expect(wm.getState()).toBe('stopped')
    })
  })

  describe('destroy', () => {
    it('sets destroying flag and kills child', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)

      child.kill.mockImplementation(() => {
        setTimeout(() => child.emit('close', 0), 10)
      })

      const destroyPromise = wm.destroy()
      await vi.advanceTimersByTimeAsync(50)
      await destroyPromise

      expect(wm.getState()).toBe('stopped')
    })

    it('resolves immediately if no child process', async () => {
      const wm = new WatcherManager()
      await wm.destroy()
      expect(wm.getState()).toBe('stopped')
    })

    it('sends SIGKILL after timeout if SIGTERM fails', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)

      // Don't emit close on SIGTERM
      child.kill.mockImplementation(() => {})

      const destroyPromise = wm.destroy()

      // Advance past the 5s kill timeout
      await vi.advanceTimersByTimeAsync(5000)
      await destroyPromise

      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(wm.getState()).toBe('stopped')
    })
  })

  describe('auto-restart', () => {
    it('retries with exponential backoff on unexpected exit', async () => {
      const child1 = createMockChild()
      mockSpawn.mockReturnValue(child1)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)

      // Simulate unexpected exit
      const child2 = createMockChild()
      mockSpawn.mockReturnValue(child2)
      child1.emit('close', 1)

      // First retry after 1s backoff
      expect(mockSpawn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it('enters error state after MAX_RETRIES', async () => {
      const errors: Error[] = []
      const wm = new WatcherManager()
      wm.onError((e) => errors.push(e))

      // Initial spawn
      const child0 = createMockChild()
      mockSpawn.mockReturnValue(child0)
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000) // become running

      // Crash 5 times (retries 0-4) then the 6th crash triggers error
      for (let i = 0; i < 5; i++) {
        const nextChild = createMockChild()
        mockSpawn.mockReturnValue(nextChild)

        // Crash current child
        if (i === 0) child0.emit('close', 1)
        else {
          // The previous nextChild is now the active one
        }

        // Wait for backoff + spawn + become running
        await vi.advanceTimersByTimeAsync(60_000)
        // Crash the newly spawned child
        nextChild.emit('close', 1)
      }

      // After 5 retries, should be in error state
      expect(wm.getState()).toBe('error')
      expect(errors.some((e) => e.message.includes('giving up'))).toBe(true)
    })

    it('does not restart when stop was called', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const wm = new WatcherManager()
      await wm.start('/tmp/project')
      await vi.advanceTimersByTimeAsync(2000)

      child.kill.mockImplementation(() => {
        child.emit('close', 0)
      })

      await wm.stop()
      mockSpawn.mockClear()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockSpawn).not.toHaveBeenCalled()
    })
  })

  describe('NDJSON parsing', () => {
    it('parses valid JSON lines as events', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const events: WatcherEvent[] = []
      const wm = new WatcherManager()
      wm.onEvent((e) => events.push(e))

      await wm.start('/tmp/project')

      pushStdout(child,'{"type":"change","path":"test.md"}\n')
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'change', path: 'test.md' })
    })

    it('ignores non-JSON lines', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const events: WatcherEvent[] = []
      const wm = new WatcherManager()
      wm.onEvent((e) => events.push(e))

      await wm.start('/tmp/project')

      pushStdout(child,'not json\n')
      pushStdout(child,'{"type":"ok"}\n')
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('ok')
    })

    it('ignores empty lines', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const events: WatcherEvent[] = []
      const wm = new WatcherManager()
      wm.onEvent((e) => events.push(e))

      await wm.start('/tmp/project')

      pushStdout(child,'\n\n  \n')
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(0)
    })
  })

  describe('callbacks', () => {
    it('removeAllListeners clears all callbacks', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const events: WatcherEvent[] = []
      const states: WatcherState[] = []
      const wm = new WatcherManager()
      wm.onEvent((e) => events.push(e))
      wm.onStateChange((s) => states.push(s))

      wm.removeAllListeners()

      await wm.start('/tmp/project')
      pushStdout(child,'{"type":"test"}\n')
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(0)
      expect(states).toHaveLength(0)
    })

    it('error callback receives spawn errors', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const errors: Error[] = []
      const wm = new WatcherManager()
      wm.onError((e) => errors.push(e))

      await wm.start('/tmp/project')

      child.emit('error', new Error('ENOENT'))
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('ENOENT')
    })
  })

  describe('getState / isRunning', () => {
    it('initial state is stopped', () => {
      const wm = new WatcherManager()
      expect(wm.getState()).toBe('stopped')
      expect(wm.isRunning()).toBe(false)
    })
  })
})
