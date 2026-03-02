import { writable, derived, get } from 'svelte/store'
import type { DocumentInfo, BacklinksOutput, LinksOutput, JsonValue } from '../types/cli'
import { activeCollection } from './collections'

/** Document info for the selected file (from CLI `get` command). */
export const documentInfo = writable<DocumentInfo | null>(null)

/** Backlinks for the selected file (from CLI `backlinks` command). */
export const backlinksInfo = writable<BacklinksOutput | null>(null)

/** Outgoing links for the selected file (from CLI `links` command). */
export const linksInfo = writable<LinksOutput | null>(null)

/** Whether properties are currently loading. */
export const propertiesLoading = writable<boolean>(false)

/** Error message if properties loading failed. */
export const propertiesError = writable<string | null>(null)

/** File content mirror for outline derivation (set by files.ts to avoid circular imports). */
export const propertiesFileContent = writable<string | null>(null)

/** Parsed frontmatter as a key-value record. */
export const frontmatter = derived(documentInfo, ($doc) => {
  if (!$doc?.frontmatter) return null
  if (typeof $doc.frontmatter === 'object' && !Array.isArray($doc.frontmatter)) {
    return $doc.frontmatter as Record<string, JsonValue>
  }
  return null
})

export interface OutlineHeading {
  heading: string
  level: number
}

/** Outline headings parsed from the file content. */
export const outline = derived(propertiesFileContent, ($content): OutlineHeading[] => {
  if (!$content) return []
  const headings: OutlineHeading[] = []
  const lines = $content.split('\n')
  let inFrontmatter = false
  for (const line of lines) {
    // Skip frontmatter block
    if (line.trimEnd() === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        heading: match[2].trim(),
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

  // Run sequentially to avoid Tantivy lock contention between CLI invocations.
  // Each call is independently caught so one failure doesn't block the other.
  try {
    const doc = await window.api.getFile(collection.path, filePath)
    documentInfo.set(doc)
  } catch {
    // File may not be indexed yet — that's fine
    documentInfo.set(null)
  }

  try {
    const backlinks = await window.api.backlinks(collection.path, filePath)
    backlinksInfo.set(backlinks)
  } catch {
    backlinksInfo.set(null)
  }

  try {
    const links = await window.api.links(collection.path, filePath)
    linksInfo.set(links)
  } catch {
    linksInfo.set(null)
  }

  propertiesLoading.set(false)
}

/** Clear all properties stores. */
export function clearProperties(): void {
  documentInfo.set(null)
  backlinksInfo.set(null)
  linksInfo.set(null)
  propertiesFileContent.set(null)
  propertiesLoading.set(false)
  propertiesError.set(null)
}
