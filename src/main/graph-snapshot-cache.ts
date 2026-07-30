/**
 * Compact graph loading, validation, and bounded main-process caching.
 *
 * Browser tabs and graph popouts share this cache through Electron main. The
 * index + project-config stat revision is part of every key, so saved index or
 * analysis-definition changes automatically bypass stale snapshots without
 * renderer-side invalidation messages. Derived renderer/cache timestamps are
 * deliberately not part of this source identity.
 */

import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { CompactGraphData, GraphLevel } from '../renderer/types/cli'
import { execCommand } from './cli'
import { CliParseError } from './errors'

export const GRAPH_WIRE_FORMAT = 'mdvdb.graph.compact' as const
export const GRAPH_WIRE_VERSION = 1 as const

const DEFAULT_MAX_SNAPSHOTS = 4
const DEFAULT_MAX_IN_FLIGHT = 2
const DEFAULT_MAX_QUEUED = 8
const DEFAULT_MAX_SNAPSHOT_BYTES = 96 * 1024 * 1024
const MAX_REVISION_RETRIES = 2

const CACHE_CLEARED_MESSAGE = 'Graph snapshot cache cleared'
const QUEUE_FULL_MESSAGE = 'Graph snapshot request queue is full'
const UNSTABLE_REVISION_MESSAGE = 'Graph index kept changing while the snapshot was generated'

type ExecuteGraphCommand = (args: string[], root: string, signal?: AbortSignal) => Promise<unknown>
type ReadSourceRevision = (root: string) => Promise<string>

export interface GraphSnapshotCacheOptions {
  maxSnapshots?: number
  maxInFlight?: number
  maxQueued?: number
  maxSnapshotBytes?: number
  execute?: ExecuteGraphCommand
  readRevision?: ReadSourceRevision
}

export interface GraphSnapshotCacheStats {
  snapshots: number
  inFlight: number
  active: number
  queued: number
  snapshotBytes: number
}

interface CachedSnapshot {
  baseKey: string
  data: CompactGraphData
  estimatedBytes: number
}

interface InFlightSnapshot {
  baseKey: string
  promise: Promise<CompactGraphData>
  controller: AbortController
}

interface QueuedExecution {
  signal: AbortSignal
  start(): void
  reject(error: unknown): void
}

interface BaseRequestState {
  latestGeneration: number
  latestPromise: Promise<CompactGraphData> | null
  pendingRequests: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate the versioned CLI wire boundary without copying or expanding contexts. */
export function validateCompactGraphData(
  value: unknown,
  expectedShardId?: string
): CompactGraphData {
  if (!isRecord(value)) {
    throw new CliParseError('Compact graph output must be a JSON object')
  }
  if (value.format !== GRAPH_WIRE_FORMAT) {
    throw new CliParseError(
      `Unsupported graph format: expected '${GRAPH_WIRE_FORMAT}', received '${String(value.format)}'`
    )
  }
  if (value.version !== GRAPH_WIRE_VERSION) {
    throw new CliParseError(
      `Unsupported compact graph version: expected ${GRAPH_WIRE_VERSION}, received ${String(value.version)}`
    )
  }
  if (value.level !== 'document' && value.level !== 'chunk') {
    throw new CliParseError(`Invalid compact graph level: ${String(value.level)}`)
  }
  if (
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.clusters)
  ) {
    throw new CliParseError('Compact graph output requires nodes, edges, and clusters arrays')
  }
  if (
    !Array.isArray(value.contexts) ||
    !value.contexts.every((context) => typeof context === 'string')
  ) {
    throw new CliParseError('Compact graph contexts must be an array of full strings')
  }
  if (value.edge_clusters !== undefined && !Array.isArray(value.edge_clusters)) {
    throw new CliParseError('Compact graph edge_clusters must be an array when present')
  }
  if (value.custom_clusters !== undefined && !Array.isArray(value.custom_clusters)) {
    throw new CliParseError('Compact graph custom_clusters must be an array when present')
  }
  if (value.analysis !== undefined) {
    if (!isRecord(value.analysis)) {
      throw new CliParseError('Compact graph analysis must be an object when present')
    }
    const analysis = value.analysis
    if (analysis.context !== 'collection' && analysis.context !== 'shard') {
      throw new CliParseError('Compact graph analysis context must be collection or shard')
    }
    if (
      analysis.clusters !== 'ready' &&
      analysis.clusters !== 'disabled' &&
      analysis.clusters !== 'too_small' &&
      analysis.clusters !== 'error'
    ) {
      throw new CliParseError('Compact graph analysis has an invalid clusters status')
    }
    if (
      analysis.topics !== 'ready' &&
      analysis.topics !== 'none' &&
      analysis.topics !== 'needs_ingest' &&
      analysis.topics !== 'error'
    ) {
      throw new CliParseError('Compact graph analysis has an invalid topics status')
    }
    for (const key of ['shard_id', 'shard_path', 'message'] as const) {
      if (analysis[key] !== undefined && typeof analysis[key] !== 'string') {
        throw new CliParseError(`Compact graph analysis ${key} must be a string when present`)
      }
    }
  }
  if (expectedShardId) {
    if (!isRecord(value.analysis)) {
      throw new CliParseError(
        `Compact Shard graph '${expectedShardId}' is missing analysis metadata`
      )
    }
    if (value.analysis.context !== 'shard') {
      throw new CliParseError(
        `Compact Shard graph '${expectedShardId}' returned Collection analysis`
      )
    }
    if (value.analysis.shard_id !== expectedShardId) {
      throw new CliParseError(
        `Compact Shard graph identity mismatch: requested '${expectedShardId}', received '${String(
          value.analysis.shard_id
        )}'`
      )
    }
  }

  for (const edge of value.edges) {
    if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      throw new CliParseError('Compact graph edges require string source and target fields')
    }
    if (!Object.prototype.hasOwnProperty.call(edge, 'field')) {
      throw new CliParseError('Compact graph edges require the field key')
    }
    if (edge.field !== null && typeof edge.field !== 'string') {
      throw new CliParseError('Compact graph edge field must be a string or null')
    }
    if (Object.prototype.hasOwnProperty.call(edge, 'context_text')) {
      throw new CliParseError(
        'Compact graph edges must reference contexts instead of expanding them'
      )
    }
    if (edge.context_index !== undefined && edge.context_index !== null) {
      if (
        !Number.isInteger(edge.context_index) ||
        (edge.context_index as number) < 0 ||
        (edge.context_index as number) >= value.contexts.length
      ) {
        throw new CliParseError('Compact graph edge context_index is outside the contexts table')
      }
    }
  }

  return value as unknown as CompactGraphData
}

/**
 * Produce a high-resolution revision for one persisted graph source.
 * Metadata fields are stringified because bigint values cannot enter JSON or
 * Electron structured-clone payloads consistently across supported platforms.
 */
async function readFileStatRevision(path: string): Promise<string> {
  try {
    const metadata = await stat(path, { bigint: true })
    return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(':')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

/** High-resolution revision for the persisted binary index only. */
export function readGraphIndexRevision(root: string): Promise<string> {
  return readFileStatRevision(join(root, '.markdownvdb', 'index'))
}

/**
 * Revision of every source that can change graph analysis output.
 *
 * Project config contains Shard and Topic definitions, so its revision belongs
 * beside the index revision. Runtime caches and response timestamps are not
 * source inputs and therefore never enter this identity.
 */
export async function readGraphSourceRevision(root: string): Promise<string> {
  const [indexRevision, configRevision] = await Promise.all([
    readGraphIndexRevision(root),
    readFileStatRevision(join(root, '.markdownvdb', 'config.yaml'))
  ])
  return `index=${indexRevision}\0config=${configRevision}`
}

function normalizeLevel(level?: GraphLevel): GraphLevel {
  if (level === undefined) return 'document'
  if (level === 'document' || level === 'chunk') return level
  throw new TypeError(`Invalid graph level: ${String(level)}`)
}

function boundedSize(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved)) throw new TypeError('Graph cache bounds must be finite numbers')
  return Math.max(1, Math.floor(resolved))
}

function stringBytes(value: string | null | undefined): number {
  // V8 retains ordinary JavaScript strings as one- or two-byte code units.
  // Counting two bytes is deliberately conservative for the memory ceiling.
  return value ? value.length * 2 : 0
}

/** Conservative retained-size estimate used by the byte-weighted LRU. */
export function estimateCompactGraphBytes(data: CompactGraphData): number {
  let bytes = 256
  for (const context of data.contexts) bytes += 16 + stringBytes(context)
  for (const node of data.nodes) {
    bytes += 112 + stringBytes(node.id) + stringBytes(node.path) + stringBytes(node.label)
    bytes += (node.custom_cluster_ids?.length ?? 0) * 8
    bytes += (node.custom_cluster_scores?.length ?? 0) * 8
  }
  for (const edge of data.edges) {
    bytes +=
      112 +
      stringBytes(edge.source) +
      stringBytes(edge.target) +
      stringBytes(edge.relationship_type) +
      stringBytes(edge.field)
  }
  for (const cluster of data.clusters) {
    bytes += 96 + stringBytes(cluster.label)
    for (const keyword of cluster.keywords) bytes += 8 + stringBytes(keyword)
  }
  for (const cluster of data.custom_clusters ?? []) {
    bytes += 96 + stringBytes(cluster.label) + stringBytes(cluster.description)
    for (const keyword of cluster.keywords) bytes += 8 + stringBytes(keyword)
  }
  for (const cluster of data.edge_clusters ?? []) {
    bytes += 64 + stringBytes(cluster.label)
  }
  if (data.analysis) {
    bytes +=
      96 +
      stringBytes(data.analysis.context) +
      stringBytes(data.analysis.shard_id) +
      stringBytes(data.analysis.shard_path) +
      stringBytes(data.analysis.clusters) +
      stringBytes(data.analysis.topics) +
      stringBytes(data.analysis.message)
  }
  return bytes
}

/** Bounded LRU snapshots plus a bounded concurrent-request dedupe registry. */
export class GraphSnapshotCache {
  private readonly maxSnapshots: number
  private readonly maxInFlight: number
  private readonly maxQueued: number
  private readonly maxSnapshotBytes: number
  private readonly execute: ExecuteGraphCommand
  private readonly readRevision: ReadSourceRevision
  private readonly snapshots = new Map<string, CachedSnapshot>()
  private readonly inFlight = new Map<string, InFlightSnapshot>()
  private readonly executionQueue: QueuedExecution[] = []
  private readonly baseRequests = new Map<string, BaseRequestState>()
  private cacheGeneration = 0
  private activeExecutions = 0
  private snapshotBytes = 0

  constructor(options: GraphSnapshotCacheOptions = {}) {
    this.maxSnapshots = boundedSize(options.maxSnapshots, DEFAULT_MAX_SNAPSHOTS)
    this.maxInFlight = boundedSize(options.maxInFlight, DEFAULT_MAX_IN_FLIGHT)
    this.maxQueued = boundedSize(options.maxQueued, DEFAULT_MAX_QUEUED)
    this.maxSnapshotBytes = boundedSize(options.maxSnapshotBytes, DEFAULT_MAX_SNAPSHOT_BYTES)
    this.execute =
      options.execute ??
      ((args, root, signal) => execCommand<unknown>('graph', args, root, { signal }))
    this.readRevision = options.readRevision ?? readGraphSourceRevision
  }

  get(
    root: string,
    level?: GraphLevel,
    path?: string,
    shardId?: string
  ): Promise<CompactGraphData> {
    const normalizedLevel = normalizeLevel(level)
    const normalizedPath = path || undefined
    const normalizedShardId = shardId || undefined
    const baseKey = JSON.stringify([
      resolve(root),
      normalizedLevel,
      normalizedPath ?? '',
      normalizedShardId ?? ''
    ])
    const cacheGeneration = this.cacheGeneration
    let state = this.baseRequests.get(baseKey)
    if (!state) {
      state = { latestGeneration: 0, latestPromise: null, pendingRequests: 0 }
      this.baseRequests.set(baseKey, state)
    }
    const requestGeneration = ++state.latestGeneration
    state.pendingRequests++

    const promise = this.getOrdered(
      root,
      normalizedLevel,
      normalizedPath,
      normalizedShardId,
      baseKey,
      state,
      requestGeneration,
      cacheGeneration
    ).finally(() => {
      state.pendingRequests--
      if (this.baseRequests.get(baseKey) === state && state.pendingRequests === 0) {
        this.baseRequests.delete(baseKey)
      }
    })
    state.latestPromise = promise
    return promise
  }

  private async getOrdered(
    root: string,
    normalizedLevel: GraphLevel,
    normalizedPath: string | undefined,
    normalizedShardId: string | undefined,
    baseKey: string,
    state: BaseRequestState,
    requestGeneration: number,
    cacheGeneration: number
  ): Promise<CompactGraphData> {
    const revision = await this.readRevision(root)
    this.assertCurrentGeneration(cacheGeneration)

    // A later get() for the same base key owns all invalidation decisions. An
    // older stat completion joins that request instead of aborting newer work.
    if (state.latestGeneration !== requestGeneration) {
      if (!state.latestPromise) throw new Error('Graph snapshot request was superseded')
      return state.latestPromise
    }

    const key = `${baseKey}\0${revision}`

    this.removeStaleEntries(baseKey, key)

    const cached = this.snapshots.get(key)
    if (cached) {
      // Map insertion order doubles as the LRU queue.
      this.snapshots.delete(key)
      this.snapshots.set(key, cached)
      return cached.data
    }

    const pending = this.inFlight.get(key)
    if (pending) return pending.promise

    const args = ['--compact', '--level', normalizedLevel]
    if (normalizedShardId) args.push('--shard', normalizedShardId)
    if (normalizedPath) args.push('--path', normalizedPath)

    const controller = new AbortController()
    const promise = this.runWithExecutionSlot(
      () =>
        this.loadAndMaybeCache(
          root,
          args,
          normalizedLevel,
          normalizedShardId,
          baseKey,
          revision,
          controller.signal,
          cacheGeneration
        ),
      controller.signal
    ).finally(() => {
      if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key)
    })
    this.inFlight.set(key, { baseKey, promise, controller })
    return promise
  }

  clear(): void {
    this.cacheGeneration++
    const reason = new Error(CACHE_CLEARED_MESSAGE)
    for (const entry of this.inFlight.values()) entry.controller.abort(reason)
    this.snapshots.clear()
    this.inFlight.clear()
    this.baseRequests.clear()
    this.snapshotBytes = 0
  }

  stats(): GraphSnapshotCacheStats {
    return {
      snapshots: this.snapshots.size,
      inFlight: this.inFlight.size,
      active: this.activeExecutions,
      queued: this.executionQueue.length,
      snapshotBytes: this.snapshotBytes
    }
  }

  private runWithExecutionSlot<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const abortQueued = () => {
        const index = this.executionQueue.indexOf(item)
        if (index >= 0) this.executionQueue.splice(index, 1)
        rejectPromise(signal.reason ?? new Error('Graph request cancelled'))
      }
      const start = () => {
        signal.removeEventListener('abort', abortQueued)
        if (signal.aborted) {
          rejectPromise(signal.reason ?? new Error('Graph request cancelled'))
          return
        }
        this.activeExecutions++
        operation()
          .then(resolvePromise, rejectPromise)
          .finally(() => {
            this.activeExecutions--
            this.drainExecutionQueue()
          })
      }
      const item: QueuedExecution = { signal, start, reject: rejectPromise }
      if (
        this.activeExecutions >= this.maxInFlight &&
        this.executionQueue.length >= this.maxQueued
      ) {
        rejectPromise(new Error(QUEUE_FULL_MESSAGE))
        return
      }
      signal.addEventListener('abort', abortQueued, { once: true })
      this.executionQueue.push(item)
      this.drainExecutionQueue()
    })
  }

  private drainExecutionQueue(): void {
    while (this.activeExecutions < this.maxInFlight) {
      const next = this.executionQueue.shift()
      if (!next) return
      if (next.signal.aborted) {
        next.reject(next.signal.reason ?? new Error('Graph request cancelled'))
        continue
      }
      next.start()
    }
  }

  private deleteSnapshot(key: string): void {
    const entry = this.snapshots.get(key)
    if (!entry) return
    this.snapshots.delete(key)
    this.snapshotBytes = Math.max(0, this.snapshotBytes - entry.estimatedBytes)
  }

  private async loadAndMaybeCache(
    root: string,
    args: string[],
    expectedLevel: GraphLevel,
    expectedShardId: string | undefined,
    baseKey: string,
    initialRevision: string,
    signal: AbortSignal,
    cacheGeneration: number
  ): Promise<CompactGraphData> {
    let revisionBefore = initialRevision
    for (let attempt = 0; attempt <= MAX_REVISION_RETRIES; attempt++) {
      this.assertRequestCurrent(signal, cacheGeneration)
      const data = validateCompactGraphData(await this.execute(args, root, signal), expectedShardId)
      this.assertRequestCurrent(signal, cacheGeneration)
      if (data.level !== expectedLevel) {
        throw new CliParseError(
          `Compact graph level mismatch: requested ${expectedLevel}, received ${data.level}`
        )
      }
      const revisionAfter = await this.readRevision(root)
      this.assertRequestCurrent(signal, cacheGeneration)

      if (revisionAfter !== revisionBefore) {
        if (attempt === MAX_REVISION_RETRIES) throw new Error(UNSTABLE_REVISION_MESSAGE)
        revisionBefore = revisionAfter
        continue
      }

      const key = `${baseKey}\0${revisionBefore}`
      this.removeStaleSnapshots(baseKey, key)
      this.storeSnapshot(key, baseKey, data, signal, cacheGeneration)
      return data
    }

    throw new Error(UNSTABLE_REVISION_MESSAGE)
  }

  private storeSnapshot(
    key: string,
    baseKey: string,
    data: CompactGraphData,
    signal: AbortSignal,
    cacheGeneration: number
  ): void {
    const estimatedBytes = estimateCompactGraphBytes(data)
    this.assertRequestCurrent(signal, cacheGeneration)
    this.deleteSnapshot(key)
    if (estimatedBytes <= this.maxSnapshotBytes) {
      this.snapshots.set(key, { baseKey, data, estimatedBytes })
      this.snapshotBytes += estimatedBytes
    }
    while (this.snapshots.size > this.maxSnapshots || this.snapshotBytes > this.maxSnapshotBytes) {
      const oldest = this.snapshots.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.deleteSnapshot(oldest)
    }
  }

  private assertRequestCurrent(signal: AbortSignal, cacheGeneration: number): void {
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error(signal.reason ? String(signal.reason) : 'Graph request cancelled')
    }
    this.assertCurrentGeneration(cacheGeneration)
  }

  private assertCurrentGeneration(cacheGeneration: number): void {
    if (cacheGeneration !== this.cacheGeneration) throw new Error(CACHE_CLEARED_MESSAGE)
  }

  private removeStaleSnapshots(baseKey: string, currentKey: string): void {
    for (const [key, entry] of this.snapshots) {
      if (entry.baseKey === baseKey && key !== currentKey) this.deleteSnapshot(key)
    }
  }

  private removeStaleEntries(baseKey: string, currentKey: string): void {
    this.removeStaleSnapshots(baseKey, currentKey)
    for (const [key, entry] of this.inFlight) {
      if (entry.baseKey === baseKey && key !== currentKey) {
        entry.controller.abort(new Error('Graph index revision changed'))
        this.inFlight.delete(key)
      }
    }
  }
}

const graphSnapshotCache = new GraphSnapshotCache()

export function getGraphSnapshot(
  root: string,
  level?: GraphLevel,
  path?: string,
  shardId?: string
): Promise<CompactGraphData> {
  return graphSnapshotCache.get(root, level, path, shardId)
}

export function clearGraphSnapshotCache(): void {
  graphSnapshotCache.clear()
}

export function getGraphSnapshotCacheStats(): GraphSnapshotCacheStats {
  return graphSnapshotCache.stats()
}
