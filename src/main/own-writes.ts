/**
 * Recent-own-writes registry for echo suppression.
 *
 * Every fs mutation the app performs (save, create, rename, delete, …) is
 * registered here BEFORE the operation starts. When the VaultWatcher later
 * observes a raw filesystem event, it consults this registry to tag the event
 * `origin: 'app'` (own write) vs `origin: 'external'` (agent/other program).
 *
 * Matched events are tagged, never dropped — renderers decide per consumer
 * whether app-origin events are relevant (tree mutators want them, editor
 * live-apply skips them).
 */

import { resolve } from 'node:path'
import type { VaultFileEventKind } from '../preload/api'

/** The kind of fs operation the app performed. */
export type OwnWriteOp =
  | 'write'
  | 'create'
  | 'delete'
  | 'mkdir'
  | 'rename-from'
  | 'rename-to'
  | 'copy'

interface OwnWriteEntry {
  op: OwnWriteOp
  /** Byte size of the written content, or null when unknowable (copy/delete/mkdir). */
  size: number | null
  ts: number
}

/**
 * How long a registered own-write can match an incoming watcher event.
 * Covers chokidar awaitWriteFinish (300ms) + micro-batching (≤250ms) + fs
 * latency with headroom, while staying short enough that an agent editing a
 * file the user saved seconds ago is classified external.
 */
const TTL_MS = 3_000

/** Sweep interval for expired entries (lazy eviction also happens on match). */
const SWEEP_INTERVAL_MS = 10_000

/** Per-path FIFO queues keyed by resolved absolute path. */
const registry = new Map<string, OwnWriteEntry[]>()

let sweepTimer: ReturnType<typeof setInterval> | null = null

function ensureSweeper(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - TTL_MS
    for (const [path, entries] of registry) {
      const live = entries.filter((e) => e.ts >= cutoff)
      if (live.length === 0) {
        registry.delete(path)
      } else if (live.length !== entries.length) {
        registry.set(path, live)
      }
    }
    if (registry.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
}

/**
 * Register an app-initiated fs operation. Call BEFORE initiating the fs call —
 * the OS event can only fire after the write begins, so registry-before-event
 * ordering is guaranteed within the main process.
 */
export function registerOwnWrite(absPath: string, op: OwnWriteOp, content?: string | Buffer): void {
  const key = resolve(absPath)
  const size =
    content == null
      ? null
      : typeof content === 'string'
        ? Buffer.byteLength(content, 'utf-8')
        : content.length
  const entries = registry.get(key) ?? []
  entries.push({ op, size, ts: Date.now() })
  registry.set(key, entries)
  ensureSweeper()
}

/** Which ops can legitimately produce which raw event kinds. */
function opMatchesKind(op: OwnWriteOp, kind: VaultFileEventKind): boolean {
  switch (kind) {
    case 'created':
    case 'modified':
      return (
        op === 'write' || op === 'create' || op === 'copy' || op === 'rename-to' || op === 'mkdir'
      )
    case 'deleted':
      return op === 'delete' || op === 'rename-from'
    case 'renamed':
      return op === 'rename-to'
  }
}

/**
 * Consume the oldest matching registry entry for a raw watcher event.
 * Match = same resolved path AND op compatible with the event kind AND within
 * TTL AND (size unknown on either side, or equal).
 *
 * Returns true when the event should be tagged `origin: 'app'`.
 */
export function matchAndConsumeOwnWrite(
  absPath: string,
  kind: VaultFileEventKind,
  stat: { size: number | null } | null
): boolean {
  const key = resolve(absPath)
  const entries = registry.get(key)
  if (!entries || entries.length === 0) return false

  const cutoff = Date.now() - TTL_MS
  const live = entries.filter((e) => e.ts >= cutoff)

  const idx = live.findIndex(
    (e) =>
      opMatchesKind(e.op, kind) && (e.size === null || stat?.size == null || e.size === stat.size)
  )

  if (idx === -1) {
    if (live.length !== entries.length) {
      if (live.length === 0) registry.delete(key)
      else registry.set(key, live)
    }
    return false
  }

  live.splice(idx, 1)
  if (live.length === 0) registry.delete(key)
  else registry.set(key, live)
  return true
}

/** Clear all registered writes (collection switch + tests). */
export function clearOwnWrites(): void {
  registry.clear()
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
