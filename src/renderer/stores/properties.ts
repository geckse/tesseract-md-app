import { writable, derived, get } from 'svelte/store'
import type { DocumentInfo, BacklinksOutput, LinksOutput, NeighborhoodResult, JsonValue } from '../types/cli'
import { activeCollection } from './collections'

/** Document info for the selected file (from CLI `get` command). */
export const documentInfo = writable<DocumentInfo | null>(null)

/** Backlinks for the selected file (from CLI `backlinks` command). */
export const backlinksInfo = writable<BacklinksOutput | null>(null)

/** Outgoing links for the selected file (from CLI `links` command). */
export const linksInfo = writable<LinksOutput | null>(null)

/** Multi-hop neighborhood tree for the selected file (depth 2). */
export const neighborhoodInfo = writable<NeighborhoodResult | null>(null)

/** Whether properties are currently loading. */
export const propertiesLoading = writable<boolean>(false)

/** Error message if properties loading failed. */
export const propertiesError = writable<string | null>(null)

/** File content mirror for outline derivation (set by files.ts to avoid circular imports). */
export const propertiesFileContent = writable<string | null>(null)

/** Parse YAML frontmatter from raw markdown content. */
function parseFrontmatter(content: string): Record<string, JsonValue> | null {
  const lines = content.split('\n')
  if (lines[0]?.trimEnd() !== '---') return null

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return null

  const result: Record<string, JsonValue> = {}
  let currentKey: string | null = null

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i]
    // Array continuation item (e.g. "  - value")
    if (/^\s+-\s+/.test(line) && currentKey) {
      const item = line.replace(/^\s+-\s+/, '').trim()
      const existing = result[currentKey]
      if (Array.isArray(existing)) {
        existing.push(unquote(item))
      }
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 1).trim()
    currentKey = key

    if (rawValue === '') {
      // Could be start of a block array or multiline — init as empty array
      result[key] = []
    } else if (/^\[.*\]$/.test(rawValue)) {
      // Inline array: [a, b, c]
      const inner = rawValue.slice(1, -1)
      result[key] = inner.split(',').map((s) => unquote(s.trim()))
    } else if (rawValue === 'true') {
      result[key] = true
    } else if (rawValue === 'false') {
      result[key] = false
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      result[key] = Number(rawValue)
    } else {
      result[key] = unquote(rawValue)
    }
  }

  // Clean up: convert empty arrays back to null if they never got items
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v) && v.length === 0) {
      result[k] = ''
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** Parsed frontmatter — live from editor content, falls back to index data. */
export const frontmatter = derived(
  [propertiesFileContent, documentInfo],
  ([$content, $doc]): Record<string, JsonValue> | null => {
    // Prefer live parsing from editor content
    if ($content) {
      const parsed = parseFrontmatter($content)
      if (parsed) return parsed
    }
    // Fall back to index data
    if ($doc?.frontmatter && typeof $doc.frontmatter === 'object' && !Array.isArray($doc.frontmatter)) {
      return $doc.frontmatter as Record<string, JsonValue>
    }
    return null
  },
)

export interface OutlineHeading {
  heading: string
  level: number
  line: number
}

/** Outline headings parsed from the file content. */
export const outline = derived(propertiesFileContent, ($content): OutlineHeading[] => {
  if (!$content) return []
  const headings: OutlineHeading[] = []
  const lines = $content.split('\n')
  let inFrontmatter = false
  let inCodeBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip frontmatter block (only at start of file)
    if (line.trimEnd() === '---' && (!inFrontmatter ? i === 0 || (i > 0 && headings.length === 0 && !inCodeBlock) : true)) {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue

    // Track fenced code blocks
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        heading: match[2].trim(),
        line: i + 1, // 1-indexed line number
      })
    }
  }
  return headings
})

/** Load properties (document info + backlinks) for a given file path.
 *  Runs sequentially to avoid Tantivy index lock contention.
 *  Silently handles "file not in index" — the file may not be ingested yet.
 */
export async function loadProperties(filePath: string): Promise<void> {
  const collection = get(activeCollection)

  if (!collection) {
    clearProperties()
    return
  }

  propertiesLoading.set(true)
  propertiesError.set(null)

  // Run all read operations in parallel — Tantivy supports concurrent reads.
  const [docResult, backlinksResult, linksResult, neighborhoodResult] = await Promise.allSettled([
    window.api.getFile(collection.path, filePath),
    window.api.backlinks(collection.path, filePath),
    window.api.links(collection.path, filePath),
    window.api.neighborhood(collection.path, filePath, 2),
  ])

  documentInfo.set(docResult.status === 'fulfilled' ? docResult.value : null)
  backlinksInfo.set(backlinksResult.status === 'fulfilled' ? backlinksResult.value : null)
  linksInfo.set(linksResult.status === 'fulfilled' ? linksResult.value : null)
  neighborhoodInfo.set(neighborhoodResult.status === 'fulfilled' ? neighborhoodResult.value : null)

  propertiesLoading.set(false)
}

/** Clear all properties stores. */
export function clearProperties(): void {
  documentInfo.set(null)
  backlinksInfo.set(null)
  linksInfo.set(null)
  neighborhoodInfo.set(null)
  propertiesFileContent.set(null)
  propertiesLoading.set(false)
  propertiesError.set(null)
}
