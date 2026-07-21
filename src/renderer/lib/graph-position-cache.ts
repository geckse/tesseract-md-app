/** Persistent, bounded LRU cache for settled 3D graph positions. */

export type GraphCacheSettingValue =
  | string
  | number
  | boolean
  | null
  | readonly GraphCacheSettingValue[]
  | { readonly [key: string]: GraphCacheSettingValue }

export interface GraphPositionCacheIdentity {
  collectionId: string
  graphLevel: 'document' | 'chunk'
  revision: string
  scope?: string | null
  settings: Readonly<Record<string, GraphCacheSettingValue>>
}

export interface GraphPositionSnapshot {
  version: 1
  nodeIds: string[]
  /** Packed x/y/z triples in the same order as nodeIds. */
  positions: Float32Array
  createdAt: number
}

export interface GraphPositionRestoreResult {
  /** Packed x/y/z triples in targetNodeIds order; missing nodes contain NaN triples. */
  positions: Float32Array
  matchedNodeCount: number
}

export interface GraphPositionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface GraphPositionCacheOptions {
  storage: GraphPositionStorage
  namespace?: string
  maxEntries?: number
  maxBytes?: number
  maxEntryBytes?: number
  now?: () => number
}

export interface GraphPositionCacheStats {
  entries: number
  estimatedBytes: number
  maxEntries: number
  maxBytes: number
}

interface ManifestEntry {
  key: string
  storageKey: string
  estimatedBytes: number
  lastAccessedAt: number
}

interface CacheManifest {
  version: 1
  entries: ManifestEntry[]
}

interface SerializedSnapshot {
  version: 1
  key: string
  nodeIds: string[]
  positionsBase64: string
  createdAt: number
}

const DEFAULT_NAMESPACE = 'tesseract.graph-positions.v1'
const DEFAULT_MAX_ENTRIES = 6
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 1536 * 1024
const BASE64_CHUNK_SIZE = 0x8000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function stableStringify(value: GraphCacheSettingValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Graph cache settings must contain finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const objectValue = value as Readonly<Record<string, GraphCacheSettingValue>>
  const entries = Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
  return `{${entries.join(',')}}`
}

/** Produces the same key regardless of object-property insertion order. */
export function createGraphPositionCacheKey(identity: GraphPositionCacheIdentity): string {
  if (!identity.collectionId) throw new Error('Graph cache collectionId must not be empty')
  if (!identity.revision) throw new Error('Graph cache revision must not be empty')

  return stableStringify({
    version: 1,
    collectionId: identity.collectionId,
    graphLevel: identity.graphLevel,
    revision: identity.revision,
    scope: identity.scope ?? null,
    settings: identity.settings
  })
}

function hashKey(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + BASE64_CHUNK_SIZE))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function validateSnapshot(snapshot: GraphPositionSnapshot): void {
  if (snapshot.nodeIds.length * 3 !== snapshot.positions.length) {
    throw new Error('Graph position count must be exactly three times the node count')
  }
  if (new Set(snapshot.nodeIds).size !== snapshot.nodeIds.length) {
    throw new Error('Graph position node IDs must be unique')
  }
  if (!Number.isFinite(snapshot.createdAt)) {
    throw new Error('Graph position createdAt must be finite')
  }
  for (const position of snapshot.positions) {
    if (!Number.isFinite(position)) throw new Error('Graph positions must be finite')
  }
}

export function serializeGraphPositionSnapshot(
  key: string,
  snapshot: GraphPositionSnapshot
): string {
  validateSnapshot(snapshot)
  const bytes = new Uint8Array(
    snapshot.positions.buffer,
    snapshot.positions.byteOffset,
    snapshot.positions.byteLength
  )
  const serialized: SerializedSnapshot = {
    version: 1,
    key,
    nodeIds: [...snapshot.nodeIds],
    positionsBase64: bytesToBase64(bytes),
    createdAt: snapshot.createdAt
  }
  return JSON.stringify(serialized)
}

export function deserializeGraphPositionSnapshot(
  serialized: string,
  expectedKey?: string
): GraphPositionSnapshot | null {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.key !== 'string' ||
    (expectedKey != null && value.key !== expectedKey) ||
    !Array.isArray(value.nodeIds) ||
    !value.nodeIds.every((nodeId) => typeof nodeId === 'string') ||
    typeof value.positionsBase64 !== 'string' ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt)
  ) {
    return null
  }

  const bytes = base64ToBytes(value.positionsBase64)
  if (!bytes || bytes.byteLength !== value.nodeIds.length * 3 * Float32Array.BYTES_PER_ELEMENT) {
    return null
  }

  const alignedBytes = bytes.slice()
  const positions = new Float32Array(alignedBytes.buffer)
  if (!positions.every((position) => Number.isFinite(position))) return null

  const nodeIds = [...value.nodeIds] as string[]
  if (new Set(nodeIds).size !== nodeIds.length) return null

  return {
    version: 1,
    nodeIds,
    positions,
    createdAt: value.createdAt
  }
}

/** Remaps cached positions by stable node ID and leaves new nodes unseeded (NaN). */
export function restoreGraphPositions(
  targetNodeIds: readonly string[],
  snapshot: GraphPositionSnapshot
): GraphPositionRestoreResult {
  const positions = new Float32Array(targetNodeIds.length * 3)
  positions.fill(Number.NaN)

  const sourceIndex = new Map(snapshot.nodeIds.map((nodeId, index) => [nodeId, index]))
  let matchedNodeCount = 0
  targetNodeIds.forEach((nodeId, targetIndex) => {
    const index = sourceIndex.get(nodeId)
    if (index == null) return
    positions[targetIndex * 3] = snapshot.positions[index * 3]
    positions[targetIndex * 3 + 1] = snapshot.positions[index * 3 + 1]
    positions[targetIndex * 3 + 2] = snapshot.positions[index * 3 + 2]
    matchedNodeCount += 1
  })

  return { positions, matchedNodeCount }
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.storageKey === 'string' &&
    typeof value.estimatedBytes === 'number' &&
    Number.isFinite(value.estimatedBytes) &&
    value.estimatedBytes >= 0 &&
    typeof value.lastAccessedAt === 'number' &&
    Number.isFinite(value.lastAccessedAt)
  )
}

/** LocalStorage-compatible cache with entry-count and estimated-byte LRU limits. */
export class GraphPositionCache {
  private readonly storage: GraphPositionStorage
  private readonly namespace: string
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly maxEntryBytes: number
  private readonly now: () => number

  constructor(options: GraphPositionCacheOptions) {
    this.storage = options.storage
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
    this.now = options.now ?? Date.now

    assertPositiveInteger(this.maxEntries, 'maxEntries')
    assertPositiveInteger(this.maxBytes, 'maxBytes')
    assertPositiveInteger(this.maxEntryBytes, 'maxEntryBytes')
  }

  get(key: string): GraphPositionSnapshot | null {
    const manifest = this.readManifest()
    const entry = manifest.entries.find((candidate) => candidate.key === key)
    if (!entry) return null

    const serialized = this.safeGet(entry.storageKey)
    const snapshot = serialized ? deserializeGraphPositionSnapshot(serialized, key) : null
    if (!snapshot) {
      this.safeRemove(entry.storageKey)
      manifest.entries = manifest.entries.filter((candidate) => candidate !== entry)
      this.writeManifest(manifest)
      return null
    }

    entry.lastAccessedAt = this.now()
    this.writeManifest(manifest)
    return snapshot
  }

  set(key: string, snapshot: GraphPositionSnapshot): boolean {
    const serialized = serializeGraphPositionSnapshot(key, snapshot)
    const estimatedBytes = serialized.length * 2
    if (estimatedBytes > this.maxEntryBytes || estimatedBytes > this.maxBytes) return false

    const manifest = this.readManifest()
    const existing = manifest.entries.find((entry) => entry.key === key)
    if (existing) {
      this.safeRemove(existing.storageKey)
      manifest.entries = manifest.entries.filter((entry) => entry !== existing)
    }

    while (
      manifest.entries.length >= this.maxEntries ||
      this.totalBytes(manifest) + estimatedBytes > this.maxBytes
    ) {
      if (!this.evictOldest(manifest)) return false
    }

    const storageKey = `${this.namespace}.entry.${hashKey(key)}`
    while (!this.safeSet(storageKey, serialized)) {
      if (!this.evictOldest(manifest)) return false
    }

    manifest.entries.push({
      key,
      storageKey,
      estimatedBytes,
      lastAccessedAt: this.now()
    })
    if (!this.writeManifest(manifest)) {
      this.safeRemove(storageKey)
      return false
    }
    return true
  }

  delete(key: string): boolean {
    const manifest = this.readManifest()
    const entry = manifest.entries.find((candidate) => candidate.key === key)
    if (!entry) return false
    this.safeRemove(entry.storageKey)
    manifest.entries = manifest.entries.filter((candidate) => candidate !== entry)
    this.writeManifest(manifest)
    return true
  }

  clear(): void {
    const manifest = this.readManifest()
    manifest.entries.forEach((entry) => this.safeRemove(entry.storageKey))
    this.safeRemove(this.manifestKey)
  }

  stats(): GraphPositionCacheStats {
    const manifest = this.readManifest()
    return {
      entries: manifest.entries.length,
      estimatedBytes: this.totalBytes(manifest),
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes
    }
  }

  private get manifestKey(): string {
    return `${this.namespace}.manifest`
  }

  private readManifest(): CacheManifest {
    const serialized = this.safeGet(this.manifestKey)
    if (!serialized) return { version: 1, entries: [] }

    let value: unknown
    try {
      value = JSON.parse(serialized)
    } catch {
      return { version: 1, entries: [] }
    }
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.entries) ||
      !value.entries.every(isManifestEntry)
    ) {
      return { version: 1, entries: [] }
    }

    return { version: 1, entries: value.entries.map((entry) => ({ ...entry })) }
  }

  private writeManifest(manifest: CacheManifest): boolean {
    return this.safeSet(this.manifestKey, JSON.stringify(manifest))
  }

  private totalBytes(manifest: CacheManifest): number {
    return manifest.entries.reduce((total, entry) => total + entry.estimatedBytes, 0)
  }

  private evictOldest(manifest: CacheManifest): boolean {
    if (manifest.entries.length === 0) return false
    let oldestIndex = 0
    for (let index = 1; index < manifest.entries.length; index += 1) {
      if (manifest.entries[index].lastAccessedAt < manifest.entries[oldestIndex].lastAccessedAt) {
        oldestIndex = index
      }
    }
    const [entry] = manifest.entries.splice(oldestIndex, 1)
    this.safeRemove(entry.storageKey)
    return true
  }

  private safeGet(key: string): string | null {
    try {
      return this.storage.getItem(key)
    } catch {
      return null
    }
  }

  private safeSet(key: string, value: string): boolean {
    try {
      this.storage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }

  private safeRemove(key: string): void {
    try {
      this.storage.removeItem(key)
    } catch {
      // Storage access is best-effort; an unavailable cache must not break Graph View.
    }
  }
}

/** Creates the browser cache when persistent storage is available. */
export function createBrowserGraphPositionCache(
  options: Omit<GraphPositionCacheOptions, 'storage'> = {}
): GraphPositionCache | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return new GraphPositionCache({ ...options, storage: localStorage })
  } catch {
    return null
  }
}
