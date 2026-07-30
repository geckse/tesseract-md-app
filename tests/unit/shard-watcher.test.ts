import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '../../src/main/store'
import type { WindowManager } from '../../src/main/window-manager'

const mockWatch = vi.fn()

vi.mock('chokidar', () => ({
  watch: (...args: unknown[]) => mockWatch(...args)
}))

import {
  broadcastShardInvalidation,
  configureShardManifestWatcher,
  destroyShardManifestWatcher
} from '../../src/main/shard-watcher'

function collection(id: string, path: string): Collection {
  return {
    id,
    name: id,
    path,
    addedAt: 1,
    lastOpenedAt: 1
  }
}

function createFakeWatcher() {
  const watcher = new EventEmitter() as EventEmitter & {
    add: ReturnType<typeof vi.fn>
    unwatch: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  watcher.add = vi.fn().mockReturnValue(watcher)
  watcher.unwatch = vi.fn().mockResolvedValue(undefined)
  watcher.close = vi.fn().mockResolvedValue(undefined)
  return watcher
}

function createWindowManager() {
  return {
    broadcastToAll: vi.fn()
  } as unknown as WindowManager
}

let fakeWatcher: ReturnType<typeof createFakeWatcher>

beforeEach(async () => {
  await destroyShardManifestWatcher()
  vi.useFakeTimers()
  fakeWatcher = createFakeWatcher()
  mockWatch.mockReset()
  mockWatch.mockReturnValue(fakeWatcher)
})

afterEach(async () => {
  await destroyShardManifestWatcher()
  vi.useRealTimers()
})

describe('Shard manifest watcher', () => {
  it('watches only each registered collection config with narrow safe options', async () => {
    const manager = createWindowManager()

    await configureShardManifestWatcher(
      [collection('one', '/vault/one'), collection('two', '/vault/two')],
      manager
    )

    expect(mockWatch).toHaveBeenCalledOnce()
    expect(mockWatch).toHaveBeenCalledWith(
      [
        resolve('/vault/one/.markdownvdb/config.yaml'),
        resolve('/vault/two/.markdownvdb/config.yaml')
      ],
      {
        ignoreInitial: true,
        followSymlinks: false,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 }
      }
    )
  })

  it.each(['add', 'change', 'unlink'])(
    'broadcasts a debounced invalidation for an exact registered config %s event',
    async (eventName) => {
      const manager = createWindowManager()
      await configureShardManifestWatcher([collection('one', '/vault/one')], manager)

      fakeWatcher.emit(eventName, '/vault/one/.markdownvdb/config.yaml')
      await vi.advanceTimersByTimeAsync(119)
      expect(manager.broadcastToAll).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(manager.broadcastToAll).toHaveBeenCalledOnce()
      expect(manager.broadcastToAll).toHaveBeenCalledWith('shards:invalidated', {
        root: resolve('/vault/one')
      })
    }
  )

  it('coalesces repeated events while retaining every affected collection root', async () => {
    const manager = createWindowManager()
    await configureShardManifestWatcher(
      [collection('one', '/vault/one'), collection('two', '/vault/two')],
      manager
    )

    fakeWatcher.emit('add', '/vault/one/.markdownvdb/config.yaml')
    await vi.advanceTimersByTimeAsync(60)
    fakeWatcher.emit('change', '/vault/one/.markdownvdb/config.yaml')
    fakeWatcher.emit('unlink', '/vault/two/.markdownvdb/config.yaml')

    await vi.advanceTimersByTimeAsync(119)
    expect(manager.broadcastToAll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(manager.broadcastToAll).toHaveBeenCalledTimes(2)
    expect(manager.broadcastToAll).toHaveBeenNthCalledWith(1, 'shards:invalidated', {
      root: resolve('/vault/one')
    })
    expect(manager.broadcastToAll).toHaveBeenNthCalledWith(2, 'shards:invalidated', {
      root: resolve('/vault/two')
    })
  })

  it('ignores temporary, sibling, and unregistered config paths', async () => {
    const manager = createWindowManager()
    await configureShardManifestWatcher([collection('one', '/vault/one')], manager)

    fakeWatcher.emit('change', '/vault/one/.markdownvdb/config.yaml.tmp')
    fakeWatcher.emit('change', '/vault/one/.markdownvdb/other.yaml')
    fakeWatcher.emit('change', '/vault/unregistered/.markdownvdb/config.yaml')
    await vi.advanceTimersByTimeAsync(500)

    expect(manager.broadcastToAll).not.toHaveBeenCalled()
  })

  it('updates the exact watched set without replacing the process-wide watcher', async () => {
    const manager = createWindowManager()
    await configureShardManifestWatcher([collection('one', '/vault/one')], manager)
    await configureShardManifestWatcher([collection('two', '/vault/two')], manager)

    expect(mockWatch).toHaveBeenCalledOnce()
    expect(fakeWatcher.unwatch).toHaveBeenCalledWith([
      resolve('/vault/one/.markdownvdb/config.yaml')
    ])
    expect(fakeWatcher.add).toHaveBeenCalledWith([resolve('/vault/two/.markdownvdb/config.yaml')])

    fakeWatcher.emit('change', '/vault/one/.markdownvdb/config.yaml')
    fakeWatcher.emit('change', '/vault/two/.markdownvdb/config.yaml')
    await vi.advanceTimersByTimeAsync(120)

    expect(manager.broadcastToAll).toHaveBeenCalledOnce()
    expect(manager.broadcastToAll).toHaveBeenCalledWith('shards:invalidated', {
      root: resolve('/vault/two')
    })
  })

  it('broadcasts app-owned mutations immediately and destroy cancels pending work', async () => {
    const manager = createWindowManager()
    await configureShardManifestWatcher([collection('one', '/vault/one')], manager)

    broadcastShardInvalidation('/vault/one/../one')
    expect(manager.broadcastToAll).toHaveBeenCalledWith('shards:invalidated', {
      root: resolve('/vault/one')
    })

    manager.broadcastToAll = vi.fn()
    fakeWatcher.emit('change', '/vault/one/.markdownvdb/config.yaml')
    await destroyShardManifestWatcher()
    await vi.advanceTimersByTimeAsync(500)

    expect(manager.broadcastToAll).not.toHaveBeenCalled()
    expect(fakeWatcher.close).toHaveBeenCalledOnce()
  })
})
