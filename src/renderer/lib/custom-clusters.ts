/**
 * Custom Clusters — parse/encode helpers
 *
 * Converts between the dotenv config format and typed arrays.
 * Format: `Name1:seed1,seed2|Name2:seed3,seed4`
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

/** Encode custom cluster definitions back to the dotenv format. */
export function encodeCustomClusters(defs: CustomClusterDef[]): string {
  return defs.map((d) => `${d.name}:${d.seeds.join(',')}`).join('|')
}
