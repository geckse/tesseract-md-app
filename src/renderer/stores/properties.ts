import { writable, derived, get } from 'svelte/store'
import type {
  DocumentInfo,
  BacklinksOutput,
  LinksOutput,
  NeighborhoodResult,
  JsonValue
} from '../types/cli'
import { cliFeatures } from '../lib/cli-features.svelte'
import { parseHeadings } from '../lib/markdown-structure'
import { parseFrontmatterData, splitFrontmatter } from '../lib/tiptap/markdown-bridge'
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

/** Last-request-wins guard for rapid tab/file/collection changes. */
let propertiesGeneration = 0

/** Parse YAML frontmatter from raw markdown content. */
function parseFrontmatter(content: string): Record<string, JsonValue> | null {
  const { frontmatter } = splitFrontmatter(content.replace(/\r\n/g, '\n'))
  if (frontmatter === null) return null
  const result = parseFrontmatterData(frontmatter)
  return Object.keys(result).length > 0 ? result : null
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
    if (
      $doc?.frontmatter &&
      typeof $doc.frontmatter === 'object' &&
      !Array.isArray($doc.frontmatter)
    ) {
      return $doc.frontmatter as Record<string, JsonValue>
    }
    return null
  }
)

export interface OutlineHeading {
  heading: string
  level: number
  line: number
}

/** Convert synchronous bridge failures into ordinary rejected promises. */
function invokePropertyRead<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation)
}

/** Outline headings parsed from the file content. */
export const outline = derived(propertiesFileContent, ($content): OutlineHeading[] => {
  if (!$content) return []
  return parseHeadings($content).map((h) => ({
    heading: h.text,
    level: h.level,
    line: h.line
  }))
})

/** Load properties (document info + backlinks) for a given file path.
 *  Runs sequentially to avoid Tantivy index lock contention.
 *  Silently handles "file not in index" — the file may not be ingested yet.
 */
export async function loadProperties(filePath: string): Promise<void> {
  const generation = ++propertiesGeneration
  const collection = get(activeCollection)

  if (!collection) {
    clearProperties()
    return
  }

  propertiesLoading.set(true)
  propertiesError.set(null)

  // Version detection is async — racing ahead of it would silently drop
  // `populate` on the first load after startup (neutral relation chips,
  // no Referenced-by). Settled detection resolves instantly.
  if (cliFeatures.version === null) await cliFeatures.init()
  if (generation !== propertiesGeneration || get(activeCollection)?.id !== collection.id) return

  // Run all read operations in parallel — Tantivy supports concurrent reads.
  // Populate (phase 42) resolves relations + referenced_by in the same `get`
  // call — never passed on CLIs that predate the flag.
  const [docResult, backlinksResult, linksResult, neighborhoodResult] = await Promise.allSettled([
    invokePropertyRead(() =>
      window.api.getFile(
        collection.path,
        filePath,
        cliFeatures.supportsRelations ? { populate: true } : undefined
      )
    ),
    invokePropertyRead(() => window.api.backlinks(collection.path, filePath)),
    invokePropertyRead(() => window.api.links(collection.path, filePath)),
    invokePropertyRead(() => window.api.neighborhood(collection.path, filePath, 1))
  ])

  if (generation !== propertiesGeneration || get(activeCollection)?.id !== collection.id) return

  documentInfo.set(docResult.status === 'fulfilled' ? docResult.value : null)
  backlinksInfo.set(backlinksResult.status === 'fulfilled' ? backlinksResult.value : null)
  linksInfo.set(linksResult.status === 'fulfilled' ? linksResult.value : null)
  neighborhoodInfo.set(neighborhoodResult.status === 'fulfilled' ? neighborhoodResult.value : null)

  propertiesLoading.set(false)
}

/** Clear all properties stores. */
export function clearProperties(): void {
  propertiesGeneration++
  documentInfo.set(null)
  backlinksInfo.set(null)
  linksInfo.set(null)
  neighborhoodInfo.set(null)
  propertiesFileContent.set(null)
  propertiesLoading.set(false)
  propertiesError.set(null)
}
