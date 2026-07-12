/**
 * VaultWatcher — Tier-1 raw filesystem watcher for the active collection.
 *
 * Watches the collection root with chokidar (independent of the mdvdb `watch`
 * subprocess, which only reports AFTER reindexing). Emits micro-batched,
 * per-path-coalesced `VaultFileEvent`s that drive editor live-updates,
 * conflict/diff detection, and incremental file-tree patching — even when the
 * mdvdb watcher is off.
 *
 * Lifecycle is main-owned: started for the active collection on app ready,
 * restarted on collection switch, stopped on quit. Renderers only listen.
 */

import { join, relative, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'

import { ALWAYS_SKIP_DIRS, getMimeCategory } from './asset-scanner'
import { matchAndConsumeOwnWrite } from './own-writes'
import type {
  VaultEventBatch,
  VaultFileEvent,
  VaultFileEventKind,
  VaultWatcherStatus
} from '../preload/api'

/** Trailing debounce between raw events and a batch flush. */
const FLUSH_DEBOUNCE_MS = 75

/** Hard cap: a steady event stream still flushes this often. */
const FLUSH_MAX_MS = 250

/** Max distinct paths per batch; beyond this the batch is truncated + flagged. */
const MAX_BATCH = 200

/** Delay before the single automatic restart after a chokidar error. */
const ERROR_RETRY_MS = 2_000

/** Directory names ignored in addition to the asset-scanner skip list. */
const EXTRA_SKIP_DIRS = new Set(['.obsidian', '.trash'])

/** Temp/lock file suffixes that editors and tools produce. */
const TEMP_SUFFIXES = ['~', '.tmp', '.swp', '.swx', '.crswap', '.part']

const MARKDOWN_RE = /\.(md|markdown)$/i

/** Resolve symlinks to the canonical path so macOS FSEvents matches events. */
async function canonicalize(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch {
    return p
  }
}

/**
 * Whether a path inside `root` should be ignored by the vault watcher.
 * Exported for unit tests. Mirrors the asset-scanner's skip rules plus
 * dotfiles and temp suffixes; files must be markdown or a known asset type.
 */
export function isIgnoredPath(root: string, absPath: string, stats?: Stats): boolean {
  const rel = relative(root, absPath)
  if (rel === '') return false
  // Outside the root (shouldn't happen) — ignore defensively
  if (rel.startsWith('..')) return true

  const segments = rel.split(sep)
  for (const segment of segments) {
    if (ALWAYS_SKIP_DIRS.has(segment) || EXTRA_SKIP_DIRS.has(segment)) return true
    if (segment.startsWith('.')) return true
  }

  const name = segments[segments.length - 1]
  for (const suffix of TEMP_SUFFIXES) {
    if (name.endsWith(suffix)) return true
  }

  // Extension filter only when we know it's a file — directories pass through.
  if (stats?.isFile()) {
    if (!MARKDOWN_RE.test(name) && getMimeCategory(name) === null) return true
  }

  return false
}

/** Classify a (non-directory) filename for consumers. */
function fileKindOf(name: string): 'markdown' | 'asset' | null {
  if (MARKDOWN_RE.test(name)) return 'markdown'
  return getMimeCategory(name) !== null ? 'asset' : null
}

/** Merge a new event into a pending one for the same path. Null = drop both. */
function mergeEvents(prev: VaultFileEvent, next: VaultFileEvent): VaultFileEvent | null {
  if (prev.kind === 'created' && next.kind === 'deleted') return null
  if (prev.kind === 'created' && next.kind === 'modified') {
    return { ...next, kind: 'created' }
  }
  if (prev.kind === 'deleted' && (next.kind === 'created' || next.kind === 'modified')) {
    // Atomic-replace pattern (delete + recreate) — surface as a modification
    return { ...next, kind: 'modified' }
  }
  if (prev.kind === 'renamed' && (next.kind === 'created' || next.kind === 'modified')) {
    // App-synthesized rename followed by the raw add for the new path
    return { ...prev, mtimeMs: next.mtimeMs, size: next.size, ts: next.ts }
  }
  return next
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  /** Original (possibly symlinked) root — reported in batch.root + status. */
  private root: string | null = null
  /** Canonical root actually handed to chokidar (for FSEvents + relative()). */
  private watchRoot: string | null = null
  private state: VaultWatcherStatus['state'] = 'stopped'
  private errorMessage: string | undefined

  private pending = new Map<string, VaultFileEvent>()
  private overflow = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private firstEnqueueTs: number | null = null

  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retriedAfterError = false

  private batchCallbacks: Array<(batch: VaultEventBatch) => void> = []
  private statusCallbacks: Array<(status: VaultWatcherStatus) => void> = []

  /** Idempotent. If already watching a different root, stops it first. */
  async start(root: string): Promise<void> {
    const normalizedRoot = resolve(root)
    if (this.root === normalizedRoot && (this.state === 'running' || this.state === 'starting')) {
      return
    }
    if (this.watcher) {
      await this.stop()
    }

    this.root = normalizedRoot
    // Resolve symlinks once; the retry path reuses this without re-awaiting.
    this.watchRoot = await canonicalize(normalizedRoot)
    this.retriedAfterError = false
    this.beginWatch()
  }

  /** Create the chokidar watcher for the already-resolved watchRoot. */
  private beginWatch(): void {
    if (!this.watchRoot) return
    const watchRoot = this.watchRoot
    this.setState('starting')

    const watcher = watch(watchRoot, {
      ignoreInitial: true,
      alwaysStat: true,
      followSymlinks: false,
      depth: 10,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: (path: string, stats?: Stats) => isIgnoredPath(watchRoot, path, stats)
    })
    this.watcher = watcher

    watcher.on('all', (eventName, path, stats) => {
      if (this.watcher !== watcher) return
      this.handleRawEvent(eventName, path, stats)
    })

    watcher.on('ready', () => {
      if (this.watcher !== watcher) return
      this.retriedAfterError = false
      this.setState('running')
    })

    watcher.on('error', (err) => {
      if (this.watcher !== watcher) return
      this.handleError(err instanceof Error ? err : new Error(String(err)))
    })
  }

  /** Flush any pending batch as-is, then close the underlying watcher. */
  async stop(): Promise<void> {
    this.clearRetryTimer()
    this.flush()

    const watcher = this.watcher
    this.watcher = null
    if (watcher) {
      await watcher.close().catch(() => {})
    }
    this.setState('stopped')
  }

  /** Stop and drop all callbacks. Called on app quit. */
  async destroy(): Promise<void> {
    await this.stop()
    this.batchCallbacks = []
    this.statusCallbacks = []
  }

  getStatus(): VaultWatcherStatus {
    return {
      state: this.state,
      root: this.state === 'stopped' ? null : this.root,
      ...(this.errorMessage ? { message: this.errorMessage } : {})
    }
  }

  onBatch(cb: (batch: VaultEventBatch) => void): void {
    this.batchCallbacks.push(cb)
  }

  onStatusChange(cb: (status: VaultWatcherStatus) => void): void {
    this.statusCallbacks.push(cb)
  }

  removeAllListeners(): void {
    this.batchCallbacks = []
    this.statusCallbacks = []
  }

  /**
   * Enqueue an app-synthesized event that chokidar cannot produce itself —
   * currently only paired renames from the fs:rename-file handler.
   */
  emitAppEvent(event: Pick<VaultFileEvent, 'kind' | 'path' | 'oldPath' | 'isDirectory'>): void {
    if (!this.root) return
    const name = event.path.split('/').pop() ?? event.path
    this.enqueue({
      kind: event.kind,
      path: event.path,
      ...(event.oldPath !== undefined ? { oldPath: event.oldPath } : {}),
      isDirectory: event.isDirectory,
      fileKind: event.isDirectory ? null : fileKindOf(name),
      mimeCategory: event.isDirectory ? null : getMimeCategory(name),
      mtimeMs: null,
      size: null,
      origin: 'app',
      ts: Date.now()
    })
  }

  // --- Private ---

  private handleRawEvent(eventName: string, absPath: string, stats?: Stats): void {
    if (!this.root || !this.watchRoot) return

    let kind: VaultFileEventKind
    let isDirectory: boolean
    switch (eventName) {
      case 'add':
        kind = 'created'
        isDirectory = false
        break
      case 'addDir':
        kind = 'created'
        isDirectory = true
        break
      case 'change':
        kind = 'modified'
        isDirectory = false
        break
      case 'unlink':
        kind = 'deleted'
        isDirectory = false
        break
      case 'unlinkDir':
        kind = 'deleted'
        isDirectory = true
        break
      default:
        return
    }

    const relNative = relative(this.watchRoot, absPath)
    if (relNative === '' || relNative.startsWith('..')) return
    const rel = relNative.split(sep).join('/')

    // Final extension filter — the ignored() predicate can be consulted
    // without stats, so unknown file types may reach us here.
    const name = rel.split('/').pop() ?? rel
    const fileKind = isDirectory ? null : fileKindOf(name)
    if (!isDirectory && fileKind === null) return

    const size = stats?.size ?? null
    // Own-write matching keys on the ORIGINAL-root path (that's what the fs
    // handlers registered), so map the canonical event path back through root.
    const ownWriteAbs = join(this.root, relNative)
    const isOwnWrite = matchAndConsumeOwnWrite(ownWriteAbs, kind, { size })

    this.enqueue({
      kind,
      path: rel,
      isDirectory,
      fileKind,
      mimeCategory: isDirectory ? null : getMimeCategory(name),
      mtimeMs: stats?.mtimeMs ?? null,
      size,
      origin: isOwnWrite ? 'app' : 'external',
      ts: Date.now()
    })
  }

  private enqueue(event: VaultFileEvent): void {
    const prev = this.pending.get(event.path)
    if (prev) {
      const merged = mergeEvents(prev, event)
      if (merged === null) {
        this.pending.delete(event.path)
      } else {
        this.pending.set(event.path, merged)
      }
    } else {
      this.pending.set(event.path, event)
      if (this.pending.size > MAX_BATCH) {
        this.overflow = true
      }
    }
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    const now = Date.now()
    if (this.firstEnqueueTs === null) {
      this.firstEnqueueTs = now
    }
    if (this.flushTimer) clearTimeout(this.flushTimer)

    const untilCap = this.firstEnqueueTs + FLUSH_MAX_MS - now
    const delay = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, untilCap))
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, delay)
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.firstEnqueueTs = null

    if (this.pending.size === 0 || !this.root) {
      this.pending.clear()
      this.overflow = false
      return
    }

    const events = [...this.pending.values()].slice(0, MAX_BATCH)
    const batch: VaultEventBatch = {
      root: this.root,
      events,
      overflow: this.overflow
    }
    this.pending.clear()
    this.overflow = false

    for (const cb of this.batchCallbacks) {
      cb(batch)
    }
  }

  private handleError(err: Error): void {
    this.errorMessage = err.message
    this.setState('error')

    // One automatic restart — chokidar errors (EMFILE, root deleted, lost
    // permissions) are rare and usually unrecoverable without user action.
    if (this.retriedAfterError || !this.watchRoot) return
    this.retriedAfterError = true

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      const watcher = this.watcher
      this.watcher = null
      const closing = watcher ? watcher.close().catch(() => {}) : Promise.resolve()
      void closing.then(() => {
        // Reuse the already-resolved watchRoot (no re-canonicalize).
        if (this.state === 'error') this.beginWatch()
      })
    }, ERROR_RETRY_MS)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private setState(state: VaultWatcherStatus['state']): void {
    if (state !== 'error') this.errorMessage = undefined
    if (this.state === state) return
    this.state = state
    const status = this.getStatus()
    for (const cb of this.statusCallbacks) {
      cb(status)
    }
  }
}

/** Singleton instance */
let vaultWatcher: VaultWatcher | null = null

/** Get or create the VaultWatcher singleton. */
export function getVaultWatcher(): VaultWatcher {
  if (!vaultWatcher) {
    vaultWatcher = new VaultWatcher()
  }
  return vaultWatcher
}

/** Destroy the vault watcher (call on app quit). */
export async function destroyVaultWatcher(): Promise<void> {
  if (vaultWatcher) {
    await vaultWatcher.destroy()
    vaultWatcher = null
  }
}
