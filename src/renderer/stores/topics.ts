/**
 * Topics (custom clusters) store — CLI-backed, collection/Shard scoped.
 *
 * Topic definitions live in `.markdownvdb/config.yaml` and are managed only
 * through the mdvdb CLI. State is cached per `(collection root, Shard id)` so
 * switching a Settings scope never lets an older response repaint the newly
 * selected scope.
 */

import { derived, get, writable, type Writable } from 'svelte/store'
import type { TopicDef, CustomClusterSummary, TopicUnassigned } from '../types/cli'
import { parseCustomClusters } from '../lib/custom-clusters'
import { invalidateGraphAnalysis } from './graph'
import { projectConfigInvalidation } from './shards'
import { collectionConfig } from './settings'

export interface TopicScope {
  root: string
  /** null is the collection-wide topic scope. */
  shardId: string | null
}

export interface TopicScopeState extends TopicScope {
  definitions: TopicDef[]
  summaries: CustomClusterSummary[]
  unassigned: TopicUnassigned | null
  errors: {
    definitions: string | null
    summaries: string | null
    unassigned: string | null
  }
  /** False when a missing Shard permits definition CRUD but not index reads. */
  computedEnabled: boolean
  needsIngest: boolean
  loading: boolean
}

/** Cached topic state keyed by collection root + optional Shard id. */
export const topicStatesByScope = writable<Record<string, TopicScopeState>>({})

/** Scope currently presented by Settings and the legacy topic view stores. */
export const activeTopicScope = writable<TopicScope | null>(null)

/** Stable key safe for arbitrary filesystem roots. */
export function topicScopeKey(root: string, shardId: string | null = null): string {
  return JSON.stringify([root, shardId])
}

function emptyScopeState(root: string, shardId: string | null): TopicScopeState {
  return {
    root,
    shardId,
    definitions: [],
    summaries: [],
    unassigned: null,
    errors: {
      definitions: null,
      summaries: null,
      unassigned: null
    },
    computedEnabled: true,
    needsIngest: false,
    loading: false
  }
}

function ensureScopeState(root: string, shardId: string | null): void {
  const key = topicScopeKey(root, shardId)
  topicStatesByScope.update((states) =>
    states[key] ? states : { ...states, [key]: emptyScopeState(root, shardId) }
  )
}

function updateScopeState(
  root: string,
  shardId: string | null,
  update: (state: TopicScopeState) => TopicScopeState
): void {
  const key = topicScopeKey(root, shardId)
  topicStatesByScope.update((states) => ({
    ...states,
    [key]: update(states[key] ?? emptyScopeState(root, shardId))
  }))
}

function currentScopeState(
  scope: TopicScope | null,
  states: Record<string, TopicScopeState>
): TopicScopeState | null {
  if (!scope) return null
  return states[topicScopeKey(scope.root, scope.shardId)] ?? null
}

/** Select a cached collection/Shard topic scope without issuing I/O. */
export function selectTopicScope(root: string, shardId: string | null = null): void {
  ensureScopeState(root, shardId)
  activeTopicScope.set({ root, shardId })
}

const activeTopicState = derived([activeTopicScope, topicStatesByScope], ([$scope, $states]) =>
  currentScopeState($scope, $states)
)

/** Compatibility views for existing components; values follow activeTopicScope. */
export const topicDefs = derived(activeTopicState, ($state) => $state?.definitions ?? [])
export const topicSummaries = derived(activeTopicState, ($state) => $state?.summaries ?? [])
export const topicUnassigned = derived(activeTopicState, ($state) => $state?.unassigned ?? null)
export const topicsLoading = derived(activeTopicState, ($state) => $state?.loading ?? false)
export const topicErrors = derived(
  activeTopicState,
  ($state) =>
    $state?.errors ?? {
      definitions: null,
      summaries: null,
      unassigned: null
    }
)
export const topicComputedEnabled = derived(
  activeTopicState,
  ($state) => $state?.computedEnabled ?? true
)

const topicsNeedIngestView = derived(activeTopicState, ($state) => $state?.needsIngest ?? false)

function setActiveNeedsIngest(value: boolean): void {
  const scope = get(activeTopicScope)
  if (!scope) return
  markTopicsNeedIngest(scope.root, scope.shardId, value)
}

/**
 * Writable compatibility view. Direct `.set()` updates only the currently
 * selected scope; scoped callers should prefer `markTopicsNeedIngest`.
 */
export const topicsNeedIngest: Writable<boolean> = {
  subscribe: topicsNeedIngestView.subscribe,
  set: setActiveNeedsIngest,
  update(updater) {
    setActiveNeedsIngest(updater(get(topicsNeedIngestView)))
  }
}

/** Mark one exact collection/Shard topic scope as needing (or not needing) ingest. */
export function markTopicsNeedIngest(
  root: string,
  shardId: string | null,
  value: boolean = true
): void {
  updateScopeState(root, shardId, (state) => ({ ...state, needsIngest: value }))
}

/** Apply a collection-wide ingest state to every loaded Topic scope. */
export function markCollectionTopicsNeedIngest(root: string, value: boolean = true): void {
  ensureScopeState(root, null)
  topicStatesByScope.update((states) => {
    const next = { ...states }
    for (const [key, state] of Object.entries(next)) {
      if (state.root === root) next[key] = { ...state, needsIngest: value }
    }
    return next
  })
}

const generations = new Map<string, number>()

function invokeTopicRead<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readDefinitions(root: string, shardId: string | null): Promise<TopicDef[]> {
  return shardId
    ? window.api.clusterDefinitions(root, shardId)
    : window.api.clusterDefinitions(root)
}

function readSummaries(root: string, shardId: string | null): Promise<CustomClusterSummary[]> {
  return shardId ? window.api.customClusters(root, shardId) : window.api.customClusters(root)
}

function readUnassigned(root: string, shardId: string | null): Promise<TopicUnassigned> {
  return shardId ? window.api.topicUnassigned(root, shardId) : window.api.topicUnassigned(root)
}

/**
 * Load definitions, computed summaries, and Unassigned for one exact scope.
 *
 * Each sub-load fails independently. For a missing Shard, pass
 * `includeComputed: false`: definitions remain editable while index-derived
 * summaries are deliberately unavailable.
 */
export async function loadTopics(
  root: string,
  shardId: string | null = null,
  options: { activate?: boolean; includeComputed?: boolean } = {}
): Promise<void> {
  const key = topicScopeKey(root, shardId)
  const generation = (generations.get(key) ?? 0) + 1
  generations.set(key, generation)

  ensureScopeState(root, shardId)
  if (options.activate !== false) activeTopicScope.set({ root, shardId })
  const includeComputed = options.includeComputed !== false
  updateScopeState(root, shardId, (state) => ({
    ...state,
    loading: true,
    computedEnabled: includeComputed,
    errors: {
      definitions: null,
      summaries: includeComputed ? null : state.errors.summaries,
      unassigned: includeComputed ? null : state.errors.unassigned
    }
  }))

  try {
    const [defs, summaries, unassigned] = await Promise.allSettled([
      invokeTopicRead(() => readDefinitions(root, shardId)),
      includeComputed
        ? invokeTopicRead(() => readSummaries(root, shardId))
        : Promise.resolve<CustomClusterSummary[]>([]),
      includeComputed
        ? invokeTopicRead(() => readUnassigned(root, shardId))
        : Promise.resolve<TopicUnassigned | null>(null)
    ])
    if (generations.get(key) !== generation) return

    updateScopeState(root, shardId, (state) => {
      const next = { ...state, errors: { ...state.errors }, loading: false }
      if (defs.status === 'fulfilled') {
        if (Array.isArray(defs.value)) next.definitions = defs.value
      } else {
        next.errors.definitions = errorMessage(defs.reason)
      }
      if (!includeComputed) {
        next.errors.summaries = null
        next.errors.unassigned = null
      } else {
        if (summaries.status === 'fulfilled') {
          if (Array.isArray(summaries.value)) next.summaries = summaries.value
        } else {
          next.errors.summaries = errorMessage(summaries.reason)
        }
        if (unassigned.status === 'fulfilled') {
          next.unassigned = unassigned.value ?? null
        } else {
          next.errors.unassigned = errorMessage(unassigned.reason)
        }
      }
      // A ready CustomClusterState emits one summary per definition, including
      // Topics with zero assigned documents. Definitions without summaries
      // therefore mean the scope was changed since the last ingest. Only
      // derive this flag from a fully successful definitions + summaries read;
      // failures retain the last known value.
      if (
        includeComputed &&
        defs.status === 'fulfilled' &&
        Array.isArray(defs.value) &&
        summaries.status === 'fulfilled' &&
        Array.isArray(summaries.value)
      ) {
        next.needsIngest = defs.value.length > 0 && summaries.value.length === 0
      }
      return next
    })
  } finally {
    if (generations.get(key) === generation) {
      updateScopeState(root, shardId, (state) => ({ ...state, loading: false }))
    }
  }
}

/**
 * Refresh the Topic scope currently cached for Settings after project config
 * changes made by another window or the CLI. The cached computed flag keeps
 * missing-Shard reads definition-only; Shard-definition changes separately
 * update Settings' scope and trigger its guarded load.
 */
export async function refreshActiveTopicsForConfig(root: string): Promise<void> {
  const scope = get(activeTopicScope)
  if (!scope || scope.root !== root) return
  const state = get(topicStatesByScope)[topicScopeKey(scope.root, scope.shardId)]

  await loadTopics(root, scope.shardId, {
    activate: false,
    includeComputed: state?.computedEnabled !== false
  })
}

projectConfigInvalidation.subscribe((event) => {
  if (!event) return
  void refreshActiveTopicsForConfig(event.root)
})

function scopeMatches(left: TopicScope | null, root: string, shardId: string | null): boolean {
  return left?.root === root && left.shardId === shardId
}

async function refreshAfterMutation(root: string, shardId: string | null): Promise<void> {
  const state = get(topicStatesByScope)[topicScopeKey(root, shardId)]
  await loadTopics(root, shardId, {
    activate: false,
    includeComputed: state?.computedEnabled !== false
  })
  markTopicsNeedIngest(root, shardId)
  // Topic definitions are project config, not index bytes. Invalidate the
  // graph analysis identity so stale Topic selections are cleared, active
  // views receive needs_ingest, and hidden views stay dirty until activation.
  invalidateGraphAnalysis().catch(() => {})
}

/** Add a topic definition in the collection or one Shard. */
export async function addTopic(
  root: string,
  def: TopicDef,
  shardId: string | null = null
): Promise<void> {
  if (!get(activeTopicScope)) {
    selectTopicScope(root, shardId)
  }
  if (shardId) await window.api.addTopic(root, def, shardId)
  else await window.api.addTopic(root, def)
  await refreshAfterMutation(root, shardId)
}

/** Update a topic by its current name in the collection or one Shard. */
export async function updateTopic(
  root: string,
  name: string,
  def: TopicDef,
  shardId: string | null = null
): Promise<void> {
  if (!get(activeTopicScope)) {
    selectTopicScope(root, shardId)
  }
  if (shardId) await window.api.updateTopic(root, name, def, shardId)
  else await window.api.updateTopic(root, name, def)
  await refreshAfterMutation(root, shardId)
}

/** Remove a topic definition from the collection or one Shard. */
export async function removeTopic(
  root: string,
  name: string,
  shardId: string | null = null
): Promise<void> {
  if (!get(activeTopicScope)) {
    selectTopicScope(root, shardId)
  }
  if (shardId) await window.api.removeTopic(root, name, shardId)
  else await window.api.removeTopic(root, name)
  await refreshAfterMutation(root, shardId)
}

/** The legacy dotenv key older app versions wrote at collection scope. */
export const LEGACY_TOPICS_KEY = 'MDVDB_CUSTOM_CLUSTERS'

/**
 * Migrate collection-wide legacy definitions. Shard-local topics never use
 * the legacy dotenv representation.
 */
export async function migrateLegacyDotenvTopics(root: string, raw: string): Promise<number> {
  let activeAtStart = get(activeTopicScope)
  if (!activeAtStart) {
    selectTopicScope(root, null)
    activeAtStart = { root, shardId: null }
  }
  const defs = parseCustomClusters(raw)
  let imported = 0
  for (const def of defs) {
    try {
      await window.api.addTopic(root, def)
      imported++
    } catch {
      // Skip definitions rejected by the CLI and continue migrating the rest.
    }
  }
  await window.api.deleteCollectionConfig(root, LEGACY_TOPICS_KEY)
  if (
    activeAtStart &&
    !scopeMatches(get(activeTopicScope), activeAtStart.root, activeAtStart.shardId)
  ) {
    return imported
  }
  collectionConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[LEGACY_TOPICS_KEY]
    return next
  })
  await loadTopics(root, null, { activate: scopeMatches(get(activeTopicScope), root, null) })
  if (imported > 0) {
    markTopicsNeedIngest(root, null)
    invalidateGraphAnalysis().catch(() => {})
  }
  return imported
}

/** Clear all per-scope topic state (for tests or full app teardown). */
export function resetTopicsState(): void {
  generations.clear()
  activeTopicScope.set(null)
  topicStatesByScope.set({})
}
