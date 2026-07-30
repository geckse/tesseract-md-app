/**
 * One process-wide watcher for every registered collection's Shard manifest.
 *
 * The vault watcher deliberately ignores `.markdownvdb`, so agent/CLI edits to
 * config.yaml need their own narrow invalidation channel. This watcher never
 * reads or writes configuration; the CLI remains the sole Shard authority.
 */

import { watch, type FSWatcher } from 'chokidar'
import { join, resolve } from 'node:path'
import type { Collection } from './store'
import type { WindowManager } from './window-manager'

const INVALIDATION_DEBOUNCE_MS = 120

class ShardManifestWatcher {
  private watcher: FSWatcher | null = null
  private rootsByConfig = new Map<string, string>()
  private pendingRoots = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private windowManager: WindowManager | null = null

  async configure(collections: Collection[], windowManager: WindowManager): Promise<void> {
    this.windowManager = windowManager
    const next = new Map(
      collections.map((collection) => [
        resolve(join(collection.path, '.markdownvdb', 'config.yaml')),
        resolve(collection.path)
      ])
    )

    if (!this.watcher) {
      this.rootsByConfig = next
      this.watcher = watch([...next.keys()], {
        ignoreInitial: true,
        followSymlinks: false,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 }
      })
      this.watcher.on('add', (path) => this.invalidate(path))
      this.watcher.on('change', (path) => this.invalidate(path))
      this.watcher.on('unlink', (path) => this.invalidate(path))
      return
    }

    const previousPaths = new Set(this.rootsByConfig.keys())
    const nextPaths = new Set(next.keys())
    const removed = [...previousPaths].filter((path) => !nextPaths.has(path))
    const added = [...nextPaths].filter((path) => !previousPaths.has(path))
    this.rootsByConfig = next
    if (removed.length > 0) await this.watcher.unwatch(removed)
    if (added.length > 0) this.watcher.add(added)
  }

  /** Broadcast immediately after app-owned CLI mutations; watcher events dedupe behind it. */
  broadcast(root: string): void {
    this.windowManager?.broadcastToAll('shards:invalidated', { root: resolve(root) })
  }

  private invalidate(configPath: string): void {
    const root = this.rootsByConfig.get(resolve(configPath))
    if (!root) return
    this.pendingRoots.add(root)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const roots = [...this.pendingRoots]
      this.pendingRoots.clear()
      for (const pendingRoot of roots) this.broadcast(pendingRoot)
    }, INVALIDATION_DEBOUNCE_MS)
  }

  async destroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pendingRoots.clear()
    this.rootsByConfig.clear()
    this.windowManager = null
    const watcher = this.watcher
    this.watcher = null
    if (watcher) await watcher.close()
  }
}

const shardManifestWatcher = new ShardManifestWatcher()

export function configureShardManifestWatcher(
  collections: Collection[],
  windowManager: WindowManager
): Promise<void> {
  return shardManifestWatcher.configure(collections, windowManager)
}

export function broadcastShardInvalidation(root: string): void {
  shardManifestWatcher.broadcast(root)
}

export function destroyShardManifestWatcher(): Promise<void> {
  return shardManifestWatcher.destroy()
}
