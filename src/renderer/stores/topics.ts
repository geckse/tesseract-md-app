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

/** The legacy dotenv key that older app versions wrote (dead once YAML exists). */
export const LEGACY_TOPICS_KEY = 'MDVDB_CUSTOM_CLUSTERS'

/**
 * Load topic definitions, computed summaries, and the unassigned bucket.
 * Each sub-load fails independently (e.g. summaries need an index).
 */
export async function loadTopics(root: string): Promise<void> {
  topicsLoading.set(true)
  try {
    try {
      const defs = await window.api.clusterDefinitions(root)
      topicDefs.set(Array.isArray(defs) ? defs : [])
    } catch {
      topicDefs.set([])
    }
    try {
      const summaries = await window.api.customClusters(root)
      topicSummaries.set(Array.isArray(summaries) ? summaries : [])
    } catch {
      topicSummaries.set([])
    }
    try {
      const unassigned = await window.api.topicUnassigned(root)
      topicUnassigned.set(unassigned ?? null)
    } catch {
      topicUnassigned.set(null)
    }
  } finally {
    topicsLoading.set(false)
  }
}

/** Add a topic (immediate CLI write), reload, and flag for re-ingest. */
export async function addTopic(root: string, def: TopicDef): Promise<void> {
  await window.api.addTopic(root, def)
  await loadTopics(root)
  topicsNeedIngest.set(true)
}

/** Update a topic by its current name (immediate CLI write) and reload. */
export async function updateTopic(root: string, name: string, def: TopicDef): Promise<void> {
  await window.api.updateTopic(root, name, def)
  await loadTopics(root)
  topicsNeedIngest.set(true)
}

/** Remove a topic (immediate CLI write) and reload. */
export async function removeTopic(root: string, name: string): Promise<void> {
  await window.api.removeTopic(root, name)
  await loadTopics(root)
  topicsNeedIngest.set(true)
}

/**
 * Migrate legacy dotenv topic definitions (MDVDB_CUSTOM_CLUSTERS in
 * `.markdownvdb/.config`) to CLI-managed YAML config: parse the raw value,
 * add each definition via the CLI, then delete the dead dotenv key.
 * Returns the number of definitions successfully imported.
 */
export async function migrateLegacyDotenvTopics(root: string, raw: string): Promise<number> {
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
  // Keep the in-memory settings mirror consistent with the deletion
  collectionConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[LEGACY_TOPICS_KEY]
    return next
  })
  await loadTopics(root)
  if (imported > 0) topicsNeedIngest.set(true)
  return imported
}

/** Reset topics state (e.g. on collection switch). */
export function resetTopicsState(): void {
  topicDefs.set([])
  topicSummaries.set([])
  topicUnassigned.set(null)
  topicsNeedIngest.set(false)
  topicsLoading.set(false)
}
