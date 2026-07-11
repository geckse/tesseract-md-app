/**
 * Custom Clusters — legacy dotenv parser
 *
 * Parses the legacy dotenv format into typed topic definitions.
 * Format: `Name1:seed1,seed2|Name2:seed3,seed4`
 *
 * Kept ONLY for the one-time migration of MDVDB_CUSTOM_CLUSTERS values
 * to CLI-managed YAML config (see stores/topics.ts). The encoder was
 * removed — the app never writes the dotenv format anymore.
 */

import type { CustomClusterDef } from '../types/cli'

/** Parse a raw MDVDB_CUSTOM_CLUSTERS config value into definitions. */
export function parseCustomClusters(raw: string): CustomClusterDef[] {
  if (!raw) return []
  return raw
    .split('|')
    .map((entry) => {
      const colonIdx = entry.indexOf(':')
      if (colonIdx === -1) return null
      const name = entry.slice(0, colonIdx).trim()
      const seedsStr = entry.slice(colonIdx + 1)
      const seeds = seedsStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (!name || seeds.length === 0) return null
      return { name, seeds }
    })
    .filter((c): c is CustomClusterDef => c !== null)
}
