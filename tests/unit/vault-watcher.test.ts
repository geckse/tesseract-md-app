import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'

// Mock chokidar with an EventEmitter-backed fake watcher
const mockWatch = vi.fn()
vi.mock('chokidar', () => ({
  watch: (...args: unknown[]) => mockWatch(...args)
}))

// realpath canonicalizes the root through symlinks — mock it to the identity
// so these mocked-chokidar tests are deterministic. Real symlink behaviour is
// covered end-to-end in vault-watcher-realfs.test.ts.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, default: actual, realpath: (p: string) => Promise.resolve(p) }
})

import { VaultWatcher, isIgnoredPath } from '../../src/main/vault-watcher'
import { registerOwnWrite, clearOwnWrites } from '../../src/main/own-writes'
import type { VaultEventBatch } from '../../src/preload/api'

function createFakeChokidar() {
  const watcher = new EventEmitter() as EventEmitter & {
    close: ReturnType<typeof vi.fn>
  }
  watcher.close = vi.fn().mockResolvedValue(undefined)
  return watcher
}

function fileStats(size = 10): Stats {
  return { size, mtimeMs: 1000, isFile: () => true, isDirectory: () => false } as unknown as Stats
}

const ROOT = '/vault'

let fake: ReturnType<typeof createFakeChokidar>

beforeEach(() => {
  vi.useFakeTimers()
  clearOwnWrites()
  fake = createFakeChokidar()
  mockWatch.mockReset()
  mockWatch.mockImplementation(() => fake)
})

afterEach(() => {
  clearOwnWrites()
  vi.useRealTimers()
})

describe('isIgnoredPath', () => {
  const file = fileStats()
  const dir = { isFile: () => false, isDirectory: () => true } as unknown as Stats

  it.each([
    ['/vault/.markdownvdb/index', true],
    ['/vault/.git/HEAD', true],
    ['/vault/.obsidian/app.json', true],
    ['/vault/node_modules/pkg/readme.md', true],
    ['/vault/.hidden/note.md', true],
    ['/vault/notes/.DS_Store', true],
    ['/vault/a.tmp', true],
    ['/vault/b.md~', true],
    ['/vault/c.md.swp', true]
  ])('ignores %s', (path, expected) => {
    expect(isIgnoredPath(ROOT, path)).toBe(expected)
  })

  it('passes markdown and asset files, drops unknown types', () => {
    expect(isIgnoredPath(ROOT, '/vault/notes/deep/ok.md', file)).toBe(false)
    expect(isIgnoredPath(ROOT, '/vault/OK.MARKDOWN', file)).toBe(false)
    expect(isIgnoredPath(ROOT, '/vault/img/pic.png', file)).toBe(false)
    expect(isIgnoredPath(ROOT, '/vault/agent-state.json', file)).toBe(true)
    expect(isIgnoredPath(ROOT, '/vault/notes.log', file)).toBe(true)
  })

  it('passes directories regardless of name shape', () => {
    expect(isIgnoredPath(ROOT, '/vault/notes', dir)).toBe(false)
    expect(isIgnoredPath(ROOT, '/vault/archive.old', dir)).toBe(false)
  })

  it('never ignores the root itself and ignores paths outside the root', () => {
    expect(isIgnoredPath(ROOT, '/vault')).toBe(false)
    expect(isIgnoredPath(ROOT, '/elsewhere/a.md')).toBe(true)
  })
})

describe('VaultWatcher', () => {
  async function startedWatcher(): Promise<{
    vw: VaultWatcher
    batches: VaultEventBatch[]
  }> {
    const vw = new VaultWatcher()
    const batches: VaultEventBatch[] = []
    vw.onBatch((b) => batches.push(b))
    await vw.start(ROOT)
    fake.emit('ready')
    return { vw, batches }
  }

  it('maps and batches raw events, coalescing per path', async () => {
    const { batches } = await startedWatcher()

    fake.emit('all', 'add', '/vault/a.md', fileStats(5))
    fake.emit('all', 'change', '/vault/a.md', fileStats(7))
    fake.emit('all', 'change', '/vault/b.md', fileStats(3))

    await vi.advanceTimersByTimeAsync(100)

    expect(batches).toHaveLength(1)
    expect(batches[0].root).toBe(ROOT)
    expect(batches[0].overflow).toBe(false)
    const byPath = new Map(batches[0].events.map((e) => [e.path, e]))
    // add + change merge into a single 'created'
    expect(byPath.get('a.md')?.kind).toBe('created')
    expect(byPath.get('a.md')?.size).toBe(7)
    expect(byPath.get('a.md')?.fileKind).toBe('markdown')
    expect(byPath.get('b.md')?.kind).toBe('modified')
    expect(batches[0].events).toHaveLength(2)
  })

  it('drops created+deleted pairs and folds deleted+created into modified', async () => {
    const { batches } = await startedWatcher()

    fake.emit('all', 'add', '/vault/gone.md', fileStats())
    fake.emit('all', 'unlink', '/vault/gone.md', undefined)
    fake.emit('all', 'unlink', '/vault/replaced.md', undefined)
    fake.emit('all', 'add', '/vault/replaced.md', fileStats())

    await vi.advanceTimersByTimeAsync(100)

    expect(batches).toHaveLength(1)
    expect(batches[0].events).toHaveLength(1)
    expect(batches[0].events[0]).toMatchObject({ path: 'replaced.md', kind: 'modified' })
  })

  it('filters unknown file types at the event layer too', async () => {
    const { batches } = await startedWatcher()

    fake.emit('all', 'add', '/vault/scratch.json', fileStats())
    await vi.advanceTimersByTimeAsync(100)

    expect(batches).toHaveLength(0)
  })

  it('flushes at the max-wait cap under a continuous event stream', async () => {
    const { batches } = await startedWatcher()

    for (let t = 0; t <= 200; t += 50) {
      fake.emit('all', 'change', `/vault/f${t}.md`, fileStats())
      await vi.advanceTimersByTimeAsync(50)
    }

    // 250ms cap forces a flush even though the 75ms debounce kept restarting
    expect(batches.length).toBeGreaterThanOrEqual(1)
    expect(batches[0].events.length).toBeGreaterThanOrEqual(4)
  })

  it('marks overflow beyond the batch cap and truncates events', async () => {
    const { batches } = await startedWatcher()

    for (let i = 0; i < 230; i++) {
      fake.emit('all', 'change', `/vault/f${i}.md`, fileStats())
    }
    await vi.advanceTimersByTimeAsync(300)

    expect(batches).toHaveLength(1)
    expect(batches[0].overflow).toBe(true)
    expect(batches[0].events).toHaveLength(200)
  })

  it('tags events matching the own-writes registry as origin app', async () => {
    const { batches } = await startedWatcher()

    registerOwnWrite('/vault/mine.md', 'write', '12345')
    fake.emit('all', 'change', '/vault/mine.md', fileStats(5))
    fake.emit('all', 'change', '/vault/theirs.md', fileStats(5))

    await vi.advanceTimersByTimeAsync(100)

    const byPath = new Map(batches[0].events.map((e) => [e.path, e]))
    expect(byPath.get('mine.md')?.origin).toBe('app')
    expect(byPath.get('theirs.md')?.origin).toBe('external')
  })

  it('merges app-synthesized renames with the raw add for the new path', async () => {
    const { vw, batches } = await startedWatcher()

    vw.emitAppEvent({ kind: 'renamed', path: 'new.md', oldPath: 'old.md', isDirectory: false })
    fake.emit('all', 'add', '/vault/new.md', fileStats(9))

    await vi.advanceTimersByTimeAsync(100)

    const renamed = batches[0].events.find((e) => e.path === 'new.md')
    expect(renamed).toMatchObject({
      kind: 'renamed',
      oldPath: 'old.md',
      origin: 'app',
      size: 9
    })
  })

  it('flushes pending events for the old root before switching roots', async () => {
    const { vw, batches } = await startedWatcher()
    const oldFake = fake

    fake.emit('all', 'change', '/vault/pending.md', fileStats())

    // New chokidar instance for the new root
    fake = createFakeChokidar()
    await vw.start('/other')

    expect(oldFake.close).toHaveBeenCalled()
    expect(batches).toHaveLength(1)
    expect(batches[0].root).toBe(ROOT)
    expect(batches[0].events[0].path).toBe('pending.md')
    expect(vw.getStatus().root).toBe('/other')
  })

  it('start is idempotent for the same root and stop is idempotent', async () => {
    const { vw } = await startedWatcher()
    expect(mockWatch).toHaveBeenCalledTimes(1)

    await vw.start(ROOT)
    expect(mockWatch).toHaveBeenCalledTimes(1)

    await vw.stop()
    await vw.stop()
    expect(vw.getStatus()).toMatchObject({ state: 'stopped', root: null })
  })

  it('emits status transitions and retries once after an error', async () => {
    const vw = new VaultWatcher()
    const states: string[] = []
    vw.onStatusChange((s) => states.push(s.state))

    await vw.start(ROOT)
    fake.emit('ready')
    expect(states).toEqual(['starting', 'running'])

    fake = createFakeChokidar()
    // Original watcher errors → one retry after 2s
    mockWatch.mock.results[0].value.emit('error', new Error('EMFILE'))
    expect(vw.getStatus()).toMatchObject({ state: 'error', message: 'EMFILE' })

    await vi.advanceTimersByTimeAsync(2_100)
    expect(mockWatch).toHaveBeenCalledTimes(2)
    fake.emit('ready')
    expect(vw.getStatus().state).toBe('running')
  })
})
