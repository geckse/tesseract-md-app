/**
 * Integration tests for the Obsidian topic auto-import & sync (phase 44)
 * against a REAL mdvdb binary and a real temp vault on disk. The
 * electron-touching store module is mocked at the boundary (sync-state
 * persistence), everything else — scan, `clusters list/add/update/remove`,
 * config.yaml writes — is real. Skipped when mdvdb is not on PATH.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

function findMdvdbSync(): string {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const stdout = execFileSync(whichCmd, ['mdvdb'], { timeout: 5_000 }).toString()
    return stdout.trim().split('\n')[0].trim()
  } catch {
    return ''
  }
}

const cliAvailable = findMdvdbSync().length > 0

// Sync-state persistence is electron-store-backed — stub it at the boundary.
import type { ObsidianSyncState } from '../../src/main/store'
const syncStates = new Map<string, ObsidianSyncState>()
vi.mock('../../src/main/store', () => ({
  getObsidianSyncState: (id: string) => syncStates.get(id) ?? null,
  setObsidianSyncState: (id: string, state: ObsidianSyncState | null) => {
    if (state) syncStates.set(id, state)
    else syncStates.delete(id)
  },
  getCollections: () => [],
  initStore: () => ({ get: () => ({}), set: () => {} })
}))

import { maybeSyncObsidianTopics } from '../../src/main/obsidian-import'
import type { Collection } from '../../src/main/store'
import type { WindowManager } from '../../src/main/window-manager'

let root: string

const collection = (): Collection => ({
  id: 'int-1',
  name: 'vault',
  path: root,
  addedAt: 1,
  lastOpenedAt: 1
})

async function readCustomTopics(): Promise<Array<{ name: string; seeds?: string[] }>> {
  const config = parseYaml(await readFile(join(root, '.markdownvdb', 'config.yaml'), 'utf8')) as {
    clustering?: { custom?: Array<{ name: string; seeds?: string[] }> }
  }
  return config.clustering?.custom ?? []
}

async function makeVault(): Promise<void> {
  await mkdir(join(root, '.obsidian'), { recursive: true })
  await writeFile(
    join(root, '.obsidian', 'graph.json'),
    JSON.stringify({
      colorGroups: [{ query: 'production', color: { a: 1, rgb: 14701138 } }]
    }),
    'utf8'
  )
  await writeFile(
    join(root, 'rag-overview.md'),
    '---\ntags: [rag, ai]\n---\n# RAG Overview\nRetrieval basics.\n',
    'utf8'
  )
  await writeFile(
    join(root, 'chunking.md'),
    '---\ntags:\n  - rag\n  - indexing\n---\n# Chunking Strategies\nSplit by headings.\n',
    'utf8'
  )
  await writeFile(
    join(root, 'embeddings.md'),
    '# Vector Embeddings\nAbout #ai and #rag pipelines.\n',
    'utf8'
  )
  // Initialize .markdownvdb via the real CLI
  execFileSync(findMdvdbSync(), ['init', '--root', root], { timeout: 30_000 })
}

describe.skipIf(!cliAvailable)('obsidian-import integration (real mdvdb)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'obsidian-int-'))
    syncStates.clear()
    await makeVault()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('imports on first sync, then tracks vault changes on later syncs', async () => {
    const broadcasts: Array<Record<string, unknown>> = []
    const wm = {
      broadcastToAll: (_channel: string, event: Record<string, unknown>) => broadcasts.push(event)
    }

    // ── First sync: pure import into .markdownvdb/config.yaml ──────────
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)

    expect(broadcasts).toHaveLength(1)
    // rag (3 notes), ai (2 notes) qualify; indexing (1 note) does not;
    // 'production' comes from the graph color group.
    expect(broadcasts[0].added).toContain('rag')
    expect(broadcasts[0].added).toContain('ai')
    expect(broadcasts[0].added).toContain('production')
    expect(broadcasts[0].added).not.toContain('indexing')

    let topics = await readCustomTopics()
    const rag = topics.find((topic) => topic.name === 'rag')
    expect(rag?.seeds).toContain('RAG Overview')
    expect(rag?.seeds).toContain('Chunking Strategies')

    // ── No vault changes → silent no-op ─────────────────────────────────
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(broadcasts).toHaveLength(1)

    // ── Vault changes in "Obsidian": new tagged note (updates rag seeds,
    //    qualifies 'indexing'), graph color group removed ────────────────
    await writeFile(
      join(root, 'evaluation.md'),
      '---\ntags: [rag, indexing]\n---\n# Evaluation Framework\nMeasure quality.\n',
      'utf8'
    )
    await writeFile(join(root, '.obsidian', 'graph.json'), JSON.stringify({ colorGroups: [] }), {
      encoding: 'utf8'
    })

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(broadcasts).toHaveLength(2)
    expect(broadcasts[1].added).toContain('indexing')
    expect(broadcasts[1].updated).toContain('rag')
    expect(broadcasts[1].removed).toContain('production')

    topics = await readCustomTopics()
    expect(topics.some((topic) => topic.name === 'production')).toBe(false)
    expect(topics.find((topic) => topic.name === 'rag')?.seeds).toContain('Evaluation Framework')
    expect(topics.find((topic) => topic.name === 'indexing')?.seeds).toContain(
      'Evaluation Framework'
    )
  })

  it('never touches user-edited or user-deleted topics', async () => {
    const wm = { broadcastToAll: () => {} }
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)

    // User edits 'ai' seeds and deletes 'production' via the real CLI.
    execFileSync(
      findMdvdbSync(),
      ['clusters', 'update', 'ai', '--seeds', 'my own seed', '--root', root],
      { timeout: 30_000 }
    )
    execFileSync(findMdvdbSync(), ['clusters', 'remove', 'production', '--root', root], {
      timeout: 30_000
    })

    // Vault gains a note that would update 'ai'; 'production' is still a
    // graph color group — but neither may be touched.
    await writeFile(
      join(root, 'claude.md'),
      '---\ntags: [ai]\n---\n# Working with Claude\nAgents.\n',
      'utf8'
    )
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)

    const topics = await readCustomTopics()
    expect(topics.find((topic) => topic.name === 'ai')?.seeds).toEqual(['my own seed'])
    expect(topics.some((topic) => topic.name === 'production')).toBe(false)
  })

  it('never manages a vault that already had user topics', async () => {
    execFileSync(
      findMdvdbSync(),
      ['clusters', 'add', 'my-topic', '--seeds', 'mine', '--root', root],
      { timeout: 30_000 }
    )
    const wm = { broadcastToAll: vi.fn() }

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)

    expect(wm.broadcastToAll).not.toHaveBeenCalled()
    const topics = await readCustomTopics()
    expect(topics.map((topic) => topic.name)).toEqual(['my-topic'])
    expect(syncStates.get('int-1')).toEqual({ managed: false, topics: {} })
  })
})
