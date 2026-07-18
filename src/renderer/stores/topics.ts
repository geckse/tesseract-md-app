/**
 * Topics (custom clusters) store — CLI-backed topic management.
 *
 * Topic definitions live in `.markdownvdb/config.yaml` and are managed
 * exclusively through the mdvdb CLI (`clusters add/update/remove/list`),
 * never through the legacy dotenv `.config` file (which the CLI ignores
 * once a YAML config exists). Mutations apply immediately — no draft/save
 * staging — and flag `topicsNeedIngest` so the UI can offer a re-ingest.
 */

import { writable } from 'svelte/store'
import type { TopicDef, CustomClusterSummary, TopicUnassigned } from '../types/cli'
import { parseCustomClusters } from '../lib/custom-clusters'
import { collectionConfig } from './settings'

/** Topic definitions from config (via `clusters list`). */
export const topicDefs = writable<TopicDef[]>([])

/** Computed topic summaries from the index (via `clusters --custom`). */
export const topicSummaries = writable<CustomClusterSummary[]>([])

/** Unassigned bucket (via `clusters unassigned`). Null when unavailable. */
export const topicUnassigned = writable<TopicUnassigned | null>(null)

/** True after any topic/config mutation until the next ingest. */
export const topicsNeedIngest = writable<boolean>(false)

/** Whether a topics load is in progress. */
export const topicsLoading = writable<boolean>(false)

let topicsGeneration = 0
let currentTopicsRoot: string | null = null

/** The legacy dotenv key that older app versions wrote (dead once YAML exists). */
export const LEGACY_TOPICS_KEY = 'MDVDB_CUSTOM_CLUSTERS'

function invokeTopicRead<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation)
}

/**
 * Load topic definitions, computed summaries, and the unassigned bucket.
 * Each sub-load fails independently (e.g. summaries need an index).
 */
export async function loadTopics(root: string): Promise<void> {
  const generation = ++topicsGeneration
  const rootChanged = currentTopicsRoot !== root
  currentTopicsRoot = root
  if (rootChanged) {
    topicDefs.set([])
    topicSummaries.set([])
    topicUnassigned.set(null)
    topicsNeedIngest.set(false)
  }
  topicsLoading.set(true)
  try {
    const [defs, summaries, unassigned] = await Promise.allSettled([
      invokeTopicRead(() => window.api.clusterDefinitions(root)),
      invokeTopicRead(() => window.api.customClusters(root)),
      invokeTopicRead(() => window.api.topicUnassigned(root))
    ])
    if (generation !== topicsGeneration || currentTopicsRoot !== root) return

    topicDefs.set(defs.status === 'fulfilled' && Array.isArray(defs.value) ? defs.value : [])
    topicSummaries.set(
      summaries.status === 'fulfilled' && Array.isArray(summaries.value) ? summaries.value : []
    )
    topicUnassigned.set(unassigned.status === 'fulfilled' ? (unassigned.value ?? null) : null)
  } finally {
    if (generation === topicsGeneration && currentTopicsRoot === root) {
      topicsLoading.set(false)
    }
  }
}

/** Add a topic (immediate CLI write), reload, and flag for re-ingest. */
export async function addTopic(root: string, def: TopicDef): Promise<void> {
  const scopeAtStart = currentTopicsRoot
  await window.api.addTopic(root, def)
  if (scopeAtStart !== null && currentTopicsRoot !== root) return
  await loadTopics(root)
  if (currentTopicsRoot === root) topicsNeedIngest.set(true)
}

/** Update a topic by its current name (immediate CLI write) and reload. */
export async function updateTopic(root: string, name: string, def: TopicDef): Promise<void> {
  const scopeAtStart = currentTopicsRoot
  await window.api.updateTopic(root, name, def)
  if (scopeAtStart !== null && currentTopicsRoot !== root) return
  await loadTopics(root)
  if (currentTopicsRoot === root) topicsNeedIngest.set(true)
}

/** Remove a topic (immediate CLI write) and reload. */
export async function removeTopic(root: string, name: string): Promise<void> {
  const scopeAtStart = currentTopicsRoot
  await window.api.removeTopic(root, name)
  if (scopeAtStart !== null && currentTopicsRoot !== root) return
  await loadTopics(root)
  if (currentTopicsRoot === root) topicsNeedIngest.set(true)
}

/**
 * Migrate legacy dotenv topic definitions (MDVDB_CUSTOM_CLUSTERS in
 * `.markdownvdb/.config`) to CLI-managed YAML config: parse the raw value,
 * add each definition via the CLI, then delete the dead dotenv key.
 * Returns the number of definitions successfully imported.
 */
export async function migrateLegacyDotenvTopics(root: string, raw: string): Promise<number> {
  const scopeAtStart = currentTopicsRoot
  const defs = parseCustomClusters(raw)
  let imported = 0
  for (const def of defs) {
    try {
      await window.api.addTopic(root, def)
      imported++
    } catch {
      // Skip defs the CLI rejects (e.g. duplicates) — keep migrating the rest
    }
  }
  await window.api.deleteCollectionConfig(root, LEGACY_TOPICS_KEY)
  if (scopeAtStart !== null && currentTopicsRoot !== root) return imported
  // Keep the in-memory settings mirror consistent with the deletion
  collectionConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[LEGACY_TOPICS_KEY]
    return next
  })
  await loadTopics(root)
  if (imported > 0 && currentTopicsRoot === root) topicsNeedIngest.set(true)
  return imported
}

/** Reset topics state (e.g. on collection switch). */
export function resetTopicsState(): void {
  topicsGeneration++
  currentTopicsRoot = null
  topicDefs.set([])
  topicSummaries.set([])
  topicUnassigned.set(null)
  topicsNeedIngest.set(false)
  topicsLoading.set(false)
}
