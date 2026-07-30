import { derived, get, writable } from 'svelte/store'
import type { ShardInfo, ShardList, ShardMutation } from '../types/cli'
import { activeCollection, activeCollectionId, collections } from './collections'

/** CLI-owned Shard definitions, cached per registered collection id. */
export const shardsByCollection = writable<Record<string, ShardInfo[]>>({})

/** Per-collection in-flight state keeps the collection tree responsive. */
export const shardsLoadingByCollection = writable<Record<string, boolean>>({})

/** Per-collection user-facing load errors. */
export const shardErrorsByCollection = writable<Record<string, string | null>>({})

export interface ProjectConfigInvalidation {
  /** Registered collection that owns the changed project config. */
  collectionId: string
  /** Absolute collection root received from the main-process watcher. */
  root: string
  /** Monotonic event identity, including repeated edits to the same root. */
  generation: number
}

/**
 * Shared project-config change signal.
 *
 * Shards, Topics, and Graph all derive from `.markdownvdb/config.yaml`. Keep
 * one preload listener and let each renderer store consume this monotonic
 * event with its own request-generation guards.
 */
export const projectConfigInvalidation = writable<ProjectConfigInvalidation | null>(null)

/** Selected Shard for the active collection; null means collection root. */
export const activeShardId = writable<string | null>(null)

/** Selected Shard definition, resolved from the active collection's cache. */
export const activeShard = derived(
  [activeCollectionId, activeShardId, shardsByCollection],
  ([$collectionId, $shardId, $byCollection]) => {
    if (!$collectionId || !$shardId) return null
    return $byCollection[$collectionId]?.find((shard) => shard.id === $shardId) ?? null
  }
)

/** Collection-root-relative path that acts as the active working lens. */
export const activeScopePath = derived(activeShard, ($shard) => $shard?.path ?? null)

const generations = new Map<string, number>()
let projectConfigInvalidationGeneration = 0

/** Normalize user/CLI paths for segment-safe comparisons. */
export function normalizeShardPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
}

/**
 * Normalize a user-entered definition path without converting an absolute or
 * escaping path into a seemingly valid collection-relative path.
 */
export function normalizeShardDefinitionPath(path: string): string {
  const slashPath = path.trim().replace(/\\/g, '/')
  if (slashPath.startsWith('/') || /^[a-zA-Z]:\//.test(slashPath)) {
    throw new Error('Shard folders must be relative to the collection.')
  }
  if (slashPath.split('/').includes('..')) {
    throw new Error('Shard folders cannot leave the collection.')
  }
  const normalized = normalizeShardPath(slashPath)
  if (!normalized) throw new Error('Choose a folder inside the collection.')
  if (normalized === '.markdownvdb' || normalized.startsWith('.markdownvdb/')) {
    throw new Error('The internal .markdownvdb folder cannot be a Shard.')
  }
  return normalized
}

/** True only for the scope itself or one of its descendants. */
export function isPathInShard(path: string, shardPath: string | null | undefined): boolean {
  if (!shardPath) return true
  const candidate = normalizeShardPath(path)
  const scope = normalizeShardPath(shardPath)
  return candidate === scope || candidate.startsWith(`${scope}/`)
}

/** Present a root-relative path relative to the active Shard where possible. */
export function pathRelativeToShard(path: string, shardPath: string | null | undefined): string {
  if (!shardPath) return normalizeShardPath(path)
  const candidate = normalizeShardPath(path)
  const scope = normalizeShardPath(shardPath)
  if (candidate === scope) return ''
  return candidate.startsWith(`${scope}/`) ? candidate.slice(scope.length + 1) : candidate
}

/** Resolve graph's ad-hoc folder filter against the non-removable Shard boundary. */
export function intersectShardScope(
  shardPath: string | null | undefined,
  pathFilter: string | null | undefined
): { path: string | null; disjoint: boolean } {
  const scope = shardPath ? normalizeShardPath(shardPath) : ''
  const filter = pathFilter ? normalizeShardPath(pathFilter) : ''
  if (!scope) return { path: filter || null, disjoint: false }
  if (!filter) return { path: scope, disjoint: false }
  if (filter === scope || filter.startsWith(`${scope}/`)) {
    return { path: filter, disjoint: false }
  }
  if (scope.startsWith(`${filter}/`)) return { path: scope, disjoint: false }
  return { path: null, disjoint: true }
}

export interface ShardTreeNode {
  shard: ShardInfo
  children: ShardTreeNode[]
}

/** Build a deterministic hierarchy from the CLI's derived parent ids. */
export function buildShardTree(shards: ShardInfo[]): ShardTreeNode[] {
  const nodes = new Map<string, ShardTreeNode>()
  for (const shard of shards) nodes.set(shard.id, { shard, children: [] })

  const roots: ShardTreeNode[] = []
  for (const shard of shards) {
    const node = nodes.get(shard.id)!
    const parent = shard.parent_id ? nodes.get(shard.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortNodes = (list: ShardTreeNode[]): void => {
    list.sort(
      (left, right) =>
        left.shard.path.localeCompare(right.shard.path) ||
        left.shard.name.localeCompare(right.shard.name)
    )
    for (const node of list) sortNodes(node.children)
  }
  sortNodes(roots)
  return roots
}

/** Stable kebab-case id seed generated from a display name. */
export function slugifyShardId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'shard'
}

/** Resolve slug collisions predictably (`name`, `name-2`, `name-3`, ...). */
export function nextShardId(name: string, existing: ShardInfo[]): string {
  const base = slugifyShardId(name)
  const ids = new Set(existing.map((shard) => shard.id))
  if (!ids.has(base)) return base
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!ids.has(candidate)) return candidate
  }
}

function setLoading(collectionId: string, value: boolean): void {
  shardsLoadingByCollection.update((state) => ({ ...state, [collectionId]: value }))
}

function setError(collectionId: string, value: string | null): void {
  shardErrorsByCollection.update((state) => ({ ...state, [collectionId]: value }))
}

function apiSupportsShards(): boolean {
  return typeof window !== 'undefined' && typeof window.api?.listShards === 'function'
}

/**
 * Refresh one collection with last-request-wins guards.
 *
 * `restoreSelection` is used only on collection activation/startup. Ordinary
 * invalidations preserve the current context when the definition still exists.
 */
export async function refreshShards(
  collectionId: string,
  options: { restoreSelection?: boolean; preferredId?: string | null } = {}
): Promise<ShardInfo[]> {
  const collection = get(collections).find((item) => item.id === collectionId)
  if (!collection || !apiSupportsShards()) {
    shardsByCollection.update((state) => ({ ...state, [collectionId]: [] }))
    return []
  }

  const generation = (generations.get(collectionId) ?? 0) + 1
  generations.set(collectionId, generation)
  setLoading(collectionId, true)
  setError(collectionId, null)

  try {
    const persistedPromise = options.preferredId
      ? Promise.resolve(options.preferredId)
      : options.restoreSelection
        ? window.api.getActiveShardId(collectionId)
        : Promise.resolve(null)
    const [result, persistedId] = await Promise.all([
      window.api.listShards(collection.path),
      persistedPromise
    ])
    if (generations.get(collectionId) !== generation) return result.shards

    shardsByCollection.update((state) => ({ ...state, [collectionId]: result.shards }))

    if (get(activeCollectionId) === collectionId) {
      const desired = options.restoreSelection ? persistedId : get(activeShardId)
      const valid = desired
        ? result.shards.find((shard) => shard.id === desired && shard.exists)
        : null
      activeShardId.set(valid?.id ?? null)
      if (options.preferredId && valid) {
        await window.api.setActiveShardId(collectionId, valid.id)
      }
      if (desired && !valid) {
        await window.api.setActiveShardId(collectionId, null)
      }
    }
    return result.shards
  } catch (error) {
    if (generations.get(collectionId) === generation) {
      setError(
        collectionId,
        error instanceof Error ? error.message : 'Unable to load Shard definitions.'
      )
    }
    return get(shardsByCollection)[collectionId] ?? []
  } finally {
    if (generations.get(collectionId) === generation) setLoading(collectionId, false)
  }
}

/** Load all definitions for the collection tree in parallel. */
export async function refreshAllShards(): Promise<void> {
  await Promise.all(get(collections).map((collection) => refreshShards(collection.id)))
}

/** Restore the last usable Shard after a collection becomes active. */
export async function restoreShardForCollection(
  collectionId: string,
  preferredId?: string | null
): Promise<void> {
  activeShardId.set(null)
  await refreshShards(collectionId, { restoreSelection: true, preferredId })
}

/** Select a Shard without resetting tabs, editor, watcher, or index state. */
export async function setActiveShard(shardId: string | null): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return
  if (shardId) {
    const shard = get(shardsByCollection)[collection.id]?.find((item) => item.id === shardId)
    if (!shard) throw new Error(`Shard not found: ${shardId}`)
    if (!shard.exists) throw new Error(`Shard folder is missing: ${shard.path}`)
  }
  activeShardId.set(shardId)
  await window.api.setActiveShardId(collection.id, shardId)
}

function collectionForShardMutation(collectionId?: string) {
  if (collectionId !== undefined) {
    const collection = get(collections).find((item) => item.id === collectionId)
    if (!collection) throw new Error(`Collection not found: ${collectionId}`)
    return collection
  }
  const collection = get(activeCollection)
  if (!collection) throw new Error('No collection selected')
  return collection
}

export async function addShardDefinition(
  name: string,
  path: string,
  createDir: boolean,
  collectionId?: string
): Promise<ShardMutation> {
  const collection = collectionForShardMutation(collectionId)
  const existing = get(shardsByCollection)[collection.id] ?? []
  const id = nextShardId(name, existing)
  const result = await window.api.addShard(
    collection.path,
    id,
    normalizeShardDefinitionPath(path),
    {
      name,
      createDir
    }
  )
  await refreshShards(collection.id)
  return result
}

export async function updateShardDefinition(
  id: string,
  name: string,
  path: string,
  createDir: boolean,
  collectionId?: string
): Promise<ShardMutation> {
  const collection = collectionForShardMutation(collectionId)
  const result = await window.api.updateShard(collection.path, id, {
    name,
    path: normalizeShardDefinitionPath(path),
    createDir
  })
  await refreshShards(collection.id)
  return result
}

export async function removeShardDefinition(
  id: string,
  collectionId?: string
): Promise<ShardMutation> {
  const collection = collectionForShardMutation(collectionId)
  const result = await window.api.removeShard(collection.path, id)
  if (get(activeCollectionId) === collection.id && get(activeShardId) === id) {
    await setActiveShard(null)
  }
  await refreshShards(collection.id)
  return result
}

/** Repair/update every Shard rooted at an in-app renamed folder. */
export async function retargetShardDefinitions(
  oldPrefix: string,
  newPrefix: string
): Promise<ShardMutation> {
  const collection = get(activeCollection)
  if (!collection) throw new Error('No collection selected')
  const result = await window.api.retargetShards(
    collection.path,
    normalizeShardDefinitionPath(oldPrefix),
    normalizeShardDefinitionPath(newPrefix)
  )
  await refreshShards(collection.id)
  return result
}

/** Subscribe to project config edits made by agents or another app window. */
export function setupShardInvalidationListener(): void {
  if (typeof window.api?.onShardsInvalidated !== 'function') return
  window.api.onShardsInvalidated(({ root }) => {
    const collection = get(collections).find((item) => item.path === root)
    if (!collection) return

    projectConfigInvalidation.set({
      collectionId: collection.id,
      root,
      generation: ++projectConfigInvalidationGeneration
    })
    void refreshShards(collection.id)
  })
}

export function teardownShardInvalidationListener(): void {
  window.api?.removeShardsInvalidatedListener?.()
}

/** Useful for tests and collection removal. */
export function clearShardState(collectionId?: string): void {
  if (collectionId) {
    generations.set(collectionId, (generations.get(collectionId) ?? 0) + 1)
    shardsByCollection.update((state) => {
      const next = { ...state }
      delete next[collectionId]
      return next
    })
    return
  }
  for (const id of generations.keys()) generations.set(id, (generations.get(id) ?? 0) + 1)
  shardsByCollection.set({})
  shardsLoadingByCollection.set({})
  shardErrorsByCollection.set({})
  activeShardId.set(null)
  projectConfigInvalidation.set(null)
}

/** Accept either the wrapped list contract or a future mutation payload in tests. */
export function shardInfosFromResult(result: ShardList | ShardMutation): ShardInfo[] {
  return result.shards
}
