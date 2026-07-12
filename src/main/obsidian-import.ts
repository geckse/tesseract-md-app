/**
 * Obsidian vault topic auto-import & sync (phase 44).
 *
 * When a collection folder is an Obsidian vault (it contains a `.obsidian/`
 * directory), derive topic (custom cluster) definitions from the organization
 * the user already built in Obsidian — frontmatter/inline tags and graph-view
 * color groups — and keep them in sync via `mdvdb clusters add/update/remove`.
 *
 * Ownership model: sync only ever touches topics it created AND that are
 * still byte-identical (name+seeds hash) to what it last wrote. A topic the
 * user edits is released from management forever; a topic the user deletes
 * gets a tombstone and is never re-added. Collections that already had
 * user-defined topics before the first scan are never managed at all.
 * Frontmatter stays read-only — the only write path is the CLI into
 * `.markdownvdb/config.yaml`.
 */

import { promises as fs, statSync, watch, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { execCommand } from './cli'
import { splitDocument } from './frontmatter'
import { ALWAYS_SKIP_DIRS } from './asset-scanner'
import { getObsidianSyncState, setObsidianSyncState } from './store'
import type { Collection, ObsidianSyncState } from './store'
import type { WindowManager } from './window-manager'
import type { TopicDef } from '../renderer/types/cli'

/** A tag must appear in at least this many notes to become a topic. */
const MIN_NOTES_PER_TAG = 2

/** Never import more than this many topics from one vault. */
const MAX_TOPICS = 12

/** Seed phrases per topic (note titles of tagged notes). */
const MAX_SEEDS = 5

/** Safety cap on the number of markdown files scanned per vault. */
const MAX_FILES = 5000

/** Trailing debounce between vault file events and a triggered re-sync. */
const WATCHER_SYNC_DEBOUNCE_MS = 30_000

/** Tombstone hash value: the user deleted this managed topic — never re-add. */
const DELETED = 'deleted'

/** Broadcast channel for a completed sync that changed topics (main → renderers). */
export const OBSIDIAN_TOPICS_SYNCED_CHANNEL = 'topics:obsidian-synced'

/** Payload broadcast to renderers after a sync that changed at least one topic. */
export interface ObsidianTopicsSyncedEvent {
  collectionId: string
  root: string
  added: string[]
  updated: string[]
  removed: string[]
}

/** One derived topic definition, before it is handed to `clusters add`. */
export interface ObsidianTopicCandidate {
  name: string
  seeds: string[]
  noteCount: number
  source: 'tag' | 'graph-group'
}

/** Whether a collection root is an Obsidian vault. */
export function isObsidianVault(root: string): boolean {
  try {
    return statSync(join(root, '.obsidian')).isDirectory()
  } catch {
    return false
  }
}

/**
 * Normalize a raw tag value (frontmatter entry or inline capture) to a
 * canonical tag name, or null when it isn't a valid Obsidian tag.
 * Obsidian tags allow letters, digits, `_`, `-`, and `/` (nested tags), and
 * must contain at least one non-numerical character.
 */
export function normalizeTag(raw: unknown): string | null {
  const text = typeof raw === 'number' ? String(raw) : raw
  if (typeof text !== 'string') return null
  const tag = text.trim().replace(/^#/, '')
  if (!tag || tag.length > 60) return null
  if (!/^[A-Za-z0-9_/-]+$/.test(tag)) return null
  if (!/[A-Za-z_-]/.test(tag)) return null
  return tag
}

/** Extract tags from a frontmatter YAML block (`tags`, `tag`, or `Tags` key). */
export function extractFrontmatterTags(block: string): string[] {
  let data: unknown
  try {
    data = parseYaml(block)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const record = data as Record<string, unknown>
  const value = record.tags ?? record.tag ?? record.Tags
  const tags: string[] = []
  const push = (v: unknown): void => {
    const tag = normalizeTag(v)
    if (tag) tags.push(tag)
  }
  if (Array.isArray(value)) {
    value.forEach(push)
  } else if (typeof value === 'string') {
    // Obsidian accepts comma- or space-separated tag strings.
    value.split(/[,\s]+/).forEach(push)
  }
  return tags
}

/**
 * Extract inline `#tag` occurrences from a markdown body. Fenced blocks and
 * inline code are stripped first; a tag must follow start-of-line or
 * whitespace so link anchors (`](#heading)`) and URL fragments don't match.
 */
export function extractInlineTags(body: string): string[] {
  const stripped = body.replace(/^(```|~~~)[\s\S]*?^\1\s*$/gm, '').replace(/`[^`\n]*`/g, '')
  const tags: string[] = []
  const pattern = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(stripped)) !== null) {
    const tag = normalizeTag(match[2])
    if (tag) tags.push(tag)
  }
  return tags
}

/** First `# ` heading of the body, falling back to the file name. */
export function noteTitle(body: string, filePath: string): string {
  const heading = body.match(/^#\s+(.+)$/m)
  if (heading) return heading[1].trim()
  return basename(filePath).replace(/\.(md|markdown)$/i, '')
}

/**
 * Make a note title safe as a seed phrase: `clusters add --seeds` is
 * comma-joined and the CLI rejects `|` in seeds.
 */
function sanitizeSeed(title: string): string {
  return title.replace(/[,|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Recursively collect markdown files, skipping hidden and build directories. */
async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const stack = [root]
  while (stack.length > 0 && files.length < MAX_FILES) {
    const dir = stack.pop()
    if (!dir) break
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ALWAYS_SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        files.push(full)
        if (files.length >= MAX_FILES) break
      }
    }
  }
  return files.sort()
}

/** Read graph-view color group queries from `.obsidian/graph.json`. */
async function readGraphColorGroupQueries(root: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(join(root, '.obsidian', 'graph.json'), 'utf8')
    const parsed = JSON.parse(raw) as { colorGroups?: Array<{ query?: unknown }> }
    if (!Array.isArray(parsed.colorGroups)) return []
    return parsed.colorGroups
      .map((group) => (typeof group.query === 'string' ? group.query.trim() : ''))
      .filter((query) => query.length > 0)
  } catch {
    return []
  }
}

/**
 * Scan an Obsidian vault and derive topic candidates.
 *
 * Tags used in at least MIN_NOTES_PER_TAG notes become topics, seeded with the
 * titles of tagged notes. Graph-view color groups are treated as explicitly
 * user-defined groupings: `tag:` queries pin that tag regardless of note
 * count, plain-text queries become their own topic; `path:`/`file:`/boolean
 * queries are skipped. Ranked pinned-first then by note count; capped.
 */
export async function scanObsidianTopics(root: string): Promise<ObsidianTopicCandidate[]> {
  interface TagEntry {
    display: string
    titles: string[]
  }
  // Keyed by lowercase tag — Obsidian treats tag casing as equivalent.
  const tagEntries = new Map<string, TagEntry>()

  for (const file of await collectMarkdownFiles(root)) {
    let content: string
    try {
      content = await fs.readFile(file, 'utf8')
    } catch {
      continue
    }
    const { hasFrontmatter, closed, block, body } = splitDocument(content.replace(/\r\n/g, '\n'))
    const fmTags = hasFrontmatter && closed ? extractFrontmatterTags(block) : []
    const allTags = [...fmTags, ...extractInlineTags(body)]
    if (allTags.length === 0) continue

    const title = noteTitle(body, file)
    const seen = new Set<string>()
    for (const tag of allTags) {
      const lower = tag.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      let entry = tagEntries.get(lower)
      if (!entry) {
        entry = { display: tag, titles: [] }
        tagEntries.set(lower, entry)
      }
      entry.titles.push(title)
    }
  }

  // Graph color groups: explicit user-defined groupings.
  const pinnedRank = new Map<string, number>()
  const plainGroups: Array<{ name: string; rank: number }> = []
  const queries = await readGraphColorGroupQueries(root)
  queries.forEach((query, rank) => {
    if (query.toLowerCase().startsWith('tag:')) {
      const tag = normalizeTag(query.slice(4).trim())
      if (tag && !pinnedRank.has(tag.toLowerCase())) pinnedRank.set(tag.toLowerCase(), rank)
    } else if (!query.includes(':')) {
      const name = sanitizeSeed(query).slice(0, 60)
      if (name) plainGroups.push({ name, rank })
    }
    // `path:`, `file:`, and boolean queries have no topic equivalent — skip.
  })

  const candidates: Array<ObsidianTopicCandidate & { rank: number }> = []

  for (const [lower, entry] of tagEntries) {
    const pinned = pinnedRank.has(lower)
    if (!pinned && entry.titles.length < MIN_NOTES_PER_TAG) continue
    const seeds = [...new Set(entry.titles.map(sanitizeSeed).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_SEEDS)
    candidates.push({
      name: entry.display,
      seeds: seeds.length > 0 ? seeds : [entry.display],
      noteCount: entry.titles.length,
      source: 'tag',
      rank: pinnedRank.get(lower) ?? Number.POSITIVE_INFINITY
    })
  }

  // Pinned tags without any notes, and plain-text groups, still become topics —
  // the user defined them explicitly; the name itself is the only seed.
  for (const [lower, rank] of pinnedRank) {
    if (!tagEntries.has(lower)) {
      candidates.push({ name: lower, seeds: [lower], noteCount: 0, source: 'graph-group', rank })
    }
  }
  for (const group of plainGroups) {
    if (!candidates.some((c) => c.name.toLowerCase() === group.name.toLowerCase())) {
      candidates.push({
        name: group.name,
        seeds: [group.name],
        noteCount: 0,
        source: 'graph-group',
        rank: group.rank
      })
    }
  }

  candidates.sort(
    (a, b) => a.rank - b.rank || b.noteCount - a.noteCount || a.name.localeCompare(b.name)
  )
  return candidates.slice(0, MAX_TOPICS).map(({ rank: _rank, ...candidate }) => candidate)
}

/** Stable fingerprint of a managed topic definition (name + seeds as written). */
export function hashTopicDef(name: string, seeds: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([name, seeds]))
    .digest('hex')
}

/** Outcome of one sync run over a vault. */
export interface ObsidianSyncResult {
  added: string[]
  updated: string[]
  removed: string[]
  /** The provenance state to persist after this run. */
  state: ObsidianSyncState
}

/**
 * Diff the vault's derived candidates against its current topics and apply
 * the changes via the CLI, honoring the ownership model:
 *
 * - candidate with no topic and no provenance → `clusters add` (new tag)
 * - candidate whose managed topic is unmodified but stale → `clusters update`
 * - managed, unmodified topic whose candidate disappeared → `clusters remove`
 * - managed topic the user edited (hash mismatch) → released, never touched again
 * - managed topic the user deleted → tombstoned, never re-added
 * - candidate colliding with an unmanaged (user) topic name → skipped
 *
 * Individual CLI write failures are logged and retried on the next sync
 * (their provenance entry is simply not advanced).
 */
export async function syncObsidianTopics(
  root: string,
  state: ObsidianSyncState,
  existingDefs?: TopicDef[]
): Promise<ObsidianSyncResult> {
  const existing =
    existingDefs ?? (await execCommand<TopicDef[] | undefined>('clusters', ['list'], root)) ?? []
  const byName = new Map(existing.map((def) => [def.name, def]))
  const candidates = await scanObsidianTopics(root)

  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []
  const nextTopics: Record<string, string> = {}

  // Tombstones persist unconditionally — a user-deleted topic stays deleted.
  for (const [name, hash] of Object.entries(state.topics)) {
    if (hash === DELETED) nextTopics[name] = DELETED
  }

  const candidateNames = new Set(candidates.map((c) => c.name))

  for (const candidate of candidates) {
    const prevHash = state.topics[candidate.name]
    if (prevHash === DELETED) continue

    const current = byName.get(candidate.name)
    const desiredHash = hashTopicDef(candidate.name, candidate.seeds)

    if (!current) {
      if (prevHash !== undefined) {
        // We wrote this topic and it's gone → the user deleted it.
        nextTopics[candidate.name] = DELETED
        continue
      }
      try {
        await execCommand<void>(
          'clusters',
          ['add', candidate.name, '--seeds', candidate.seeds.join(',')],
          root
        )
        added.push(candidate.name)
        nextTopics[candidate.name] = desiredHash
      } catch (error) {
        console.error(`Obsidian topic sync: failed to add '${candidate.name}':`, error)
      }
      continue
    }

    if (prevHash === undefined) {
      // Name collision with a topic the user created — never manage it.
      continue
    }

    const currentHash = hashTopicDef(current.name, current.seeds)
    if (currentHash !== prevHash) {
      // The user edited this topic since we wrote it — release it for good
      // (no provenance entry carried forward ⇒ treated as a user topic).
      continue
    }

    if (currentHash === desiredHash) {
      nextTopics[candidate.name] = prevHash
      continue
    }

    try {
      await execCommand<void>(
        'clusters',
        ['update', candidate.name, '--seeds', candidate.seeds.join(',')],
        root
      )
      updated.push(candidate.name)
      nextTopics[candidate.name] = desiredHash
    } catch (error) {
      console.error(`Obsidian topic sync: failed to update '${candidate.name}':`, error)
      nextTopics[candidate.name] = prevHash
    }
  }

  // Managed topics whose candidate disappeared (tag gone / below the floor).
  for (const [name, prevHash] of Object.entries(state.topics)) {
    if (prevHash === DELETED || candidateNames.has(name)) continue
    const current = byName.get(name)
    if (!current) continue // already gone and no candidate — drop the entry
    if (hashTopicDef(current.name, current.seeds) !== prevHash) continue // user edited — release
    try {
      await execCommand<void>('clusters', ['remove', name], root)
      removed.push(name)
    } catch (error) {
      console.error(`Obsidian topic sync: failed to remove '${name}':`, error)
      nextTopics[name] = prevHash
    }
  }

  return { added, updated, removed, state: { managed: true, topics: nextTopics } }
}

/** Collections with a sync currently running (guards add → set-active races). */
const inFlight = new Set<string>()

/**
 * Sync Obsidian topics for a collection if it qualifies. Fire-and-forget
 * safe: never throws. First encounter decides management: a vault that
 * already has topics is marked unmanaged forever; otherwise every run
 * re-derives candidates and diffs them against provenance. Broadcasts a
 * summary so renderers can notify the user when anything changed.
 */
export async function maybeSyncObsidianTopics(
  collection: Collection,
  windowManager: WindowManager
): Promise<void> {
  if (inFlight.has(collection.id)) return
  if (!isObsidianVault(collection.path)) return

  let state = getObsidianSyncState(collection.id)
  if (state && !state.managed) return

  inFlight.add(collection.id)
  try {
    let existingDefs: TopicDef[] | undefined
    if (!state) {
      existingDefs =
        (await execCommand<TopicDef[] | undefined>('clusters', ['list'], collection.path)) ?? []
      if (existingDefs.length > 0) {
        // User already curates topics here — never manage this collection.
        setObsidianSyncState(collection.id, { managed: false, topics: {} })
        return
      }
      state = { managed: true, topics: {} }
    }

    const result = await syncObsidianTopics(collection.path, state, existingDefs)
    setObsidianSyncState(collection.id, result.state)

    if (result.added.length > 0 || result.updated.length > 0 || result.removed.length > 0) {
      const event: ObsidianTopicsSyncedEvent = {
        collectionId: collection.id,
        root: collection.path,
        added: result.added,
        updated: result.updated,
        removed: result.removed
      }
      windowManager.broadcastToAll(OBSIDIAN_TOPICS_SYNCED_CHANNEL, event)
    }
  } catch (error) {
    // Transient failure (CLI missing, unreadable vault) — state is not
    // advanced, so the next trigger retries.
    console.error('Obsidian topic sync failed:', error)
  } finally {
    inFlight.delete(collection.id)
  }
}

// ── Live triggers ────────────────────────────────────────────────────────

/** Pending debounced sync timers, keyed by collection id. */
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Schedule a debounced sync after vault file activity. Repeated calls within
 * the window coalesce; the sync itself re-checks every guard when it fires.
 */
export function scheduleObsidianSync(
  collection: Collection,
  windowManager: WindowManager,
  delayMs = WATCHER_SYNC_DEBOUNCE_MS
): void {
  const pending = syncTimers.get(collection.id)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    syncTimers.delete(collection.id)
    void maybeSyncObsidianTopics(collection, windowManager)
  }, delayMs)
  // Never keep the process alive just for a pending sync.
  timer.unref?.()
  syncTimers.set(collection.id, timer)
}

/** Cancel all pending debounced syncs (collection switch / shutdown). */
export function cancelScheduledObsidianSyncs(): void {
  for (const timer of syncTimers.values()) clearTimeout(timer)
  syncTimers.clear()
}

/** Active `.obsidian/` config watcher (one — only the active collection). */
let obsidianConfigWatcher: FSWatcher | null = null

/**
 * Watch the active collection's `.obsidian/` directory for config changes
 * (graph.json color groups live there, and the Tier-1 vault watcher skips
 * the directory entirely). Pass null to stop watching.
 */
export function watchObsidianConfig(
  collection: Collection | null,
  windowManager: WindowManager
): void {
  obsidianConfigWatcher?.close()
  obsidianConfigWatcher = null
  if (!collection || !isObsidianVault(collection.path)) return
  try {
    obsidianConfigWatcher = watch(join(collection.path, '.obsidian'), () => {
      scheduleObsidianSync(collection, windowManager)
    })
    obsidianConfigWatcher.on('error', () => {
      obsidianConfigWatcher?.close()
      obsidianConfigWatcher = null
    })
  } catch {
    // Missing directory or unsupported platform — activation syncs still run.
  }
}
