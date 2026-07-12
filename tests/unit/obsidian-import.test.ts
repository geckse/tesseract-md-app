/**
 * Unit tests for the Obsidian vault topic auto-import & sync (phase 44).
 *
 * Extraction/scan functions run against REAL temp vaults on disk; the
 * electron-touching boundaries (store sync-state, CLI exec) are mocked.
 * The CLI mock is stateful — it implements list/add/update/remove over an
 * in-memory topic registry so multi-run sync semantics are exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Stateful CLI mock: an in-memory `clusters` registry ────────────────
interface FakeTopic {
  name: string
  seeds: string[]
}
let cliTopics: FakeTopic[] = []
const cliCalls: string[][] = []

const mockExecCommand = vi.fn(async (_cmd: string, args: string[]) => {
  cliCalls.push(args)
  switch (args[0]) {
    case 'list':
      return cliTopics.map((t) => ({ ...t, seeds: [...t.seeds] }))
    case 'add': {
      if (cliTopics.some((t) => t.name === args[1])) throw new Error('duplicate topic')
      cliTopics.push({ name: args[1], seeds: args[3].split(',') })
      return undefined
    }
    case 'update': {
      const topic = cliTopics.find((t) => t.name === args[1])
      if (!topic) throw new Error('topic not found')
      topic.seeds = args[3].split(',')
      return undefined
    }
    case 'remove': {
      cliTopics = cliTopics.filter((t) => t.name !== args[1])
      return undefined
    }
    default:
      throw new Error(`unexpected CLI call: ${args.join(' ')}`)
  }
})
vi.mock('../../src/main/cli', () => ({
  execCommand: (...args: unknown[]) => mockExecCommand(...(args as [string, string[], string]))
}))

// ── Store boundary mock: in-memory sync state ──────────────────────────
import type { ObsidianSyncState } from '../../src/main/store'
const syncStates = new Map<string, ObsidianSyncState>()
vi.mock('../../src/main/store', () => ({
  getObsidianSyncState: (id: string) => syncStates.get(id) ?? null,
  setObsidianSyncState: (id: string, state: ObsidianSyncState | null) => {
    if (state) syncStates.set(id, state)
    else syncStates.delete(id)
  },
  // frontmatter.ts (imported for splitDocument) pulls these bindings too
  getCollections: () => [],
  initStore: () => ({ get: () => ({}), set: () => {} })
}))

import {
  isObsidianVault,
  normalizeTag,
  extractFrontmatterTags,
  extractInlineTags,
  noteTitle,
  hashTopicDef,
  scanObsidianTopics,
  syncObsidianTopics,
  maybeSyncObsidianTopics,
  scheduleObsidianSync,
  cancelScheduledObsidianSyncs,
  OBSIDIAN_TOPICS_SYNCED_CHANNEL
} from '../../src/main/obsidian-import'
import type { Collection } from '../../src/main/store'
import type { WindowManager } from '../../src/main/window-manager'

let root: string

const collection = (): Collection => ({
  id: 'col-1',
  name: 'Vault',
  path: root,
  addedAt: 1,
  lastOpenedAt: 1
})

const fakeWindowManager = (): { broadcastToAll: ReturnType<typeof vi.fn> } => ({
  broadcastToAll: vi.fn()
})

const FRESH: ObsidianSyncState = { managed: true, topics: {} }

async function makeVault(obsidian = true): Promise<void> {
  if (obsidian) await mkdir(join(root, '.obsidian'), { recursive: true })
}

async function note(relPath: string, content: string): Promise<void> {
  const full = join(root, relPath)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'obsidian-import-'))
  cliTopics = []
  cliCalls.length = 0
  syncStates.clear()
  mockExecCommand.mockClear()
})

afterEach(async () => {
  cancelScheduledObsidianSyncs()
  await rm(root, { recursive: true, force: true })
})

describe('normalizeTag', () => {
  it('strips a leading # and keeps valid tags', () => {
    expect(normalizeTag('#foo')).toBe('foo')
    expect(normalizeTag('foo')).toBe('foo')
    expect(normalizeTag('Foo-Bar_2')).toBe('Foo-Bar_2')
    expect(normalizeTag('project/acme')).toBe('project/acme')
  })

  it('rejects purely numeric tags (Obsidian rule)', () => {
    expect(normalizeTag('123')).toBeNull()
    expect(normalizeTag(2026)).toBeNull()
  })

  it('rejects invalid characters, empties, and oversized tags', () => {
    expect(normalizeTag('foo bar')).toBeNull()
    expect(normalizeTag('foo:bar')).toBeNull()
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag(null)).toBeNull()
    expect(normalizeTag('x'.repeat(61))).toBeNull()
  })
})

describe('extractFrontmatterTags', () => {
  it('reads flow arrays, block lists, and string forms', () => {
    expect(extractFrontmatterTags('tags: [rag, ai]')).toEqual(['rag', 'ai'])
    expect(extractFrontmatterTags('tags:\n  - rag\n  - ai')).toEqual(['rag', 'ai'])
    expect(extractFrontmatterTags('tags: rag, ai')).toEqual(['rag', 'ai'])
    expect(extractFrontmatterTags('tags: rag ai')).toEqual(['rag', 'ai'])
  })

  it('accepts the singular `tag` and capitalized `Tags` keys', () => {
    expect(extractFrontmatterTags('tag: solo')).toEqual(['solo'])
    expect(extractFrontmatterTags('Tags: [caps]')).toEqual(['caps'])
  })

  it('filters invalid entries and survives bad YAML', () => {
    expect(extractFrontmatterTags('tags: [ok, 123, "sp ace"]')).toEqual(['ok'])
    expect(extractFrontmatterTags('tags: [unclosed')).toEqual([])
    expect(extractFrontmatterTags('title: no tags here')).toEqual([])
  })
})

describe('extractInlineTags', () => {
  it('finds tags after whitespace or line start', () => {
    expect(extractInlineTags('Body with #foo and #bar/baz here')).toEqual(['foo', 'bar/baz'])
    expect(extractInlineTags('#lead tag')).toEqual(['lead'])
  })

  it('does not match headings, link anchors, or URL fragments', () => {
    expect(extractInlineTags('# Heading Title')).toEqual([])
    expect(extractInlineTags('See [section](#some-heading) for more')).toEqual([])
    expect(extractInlineTags('Visit https://example.com/page#fragment now')).toEqual([])
  })

  it('ignores tags inside fenced blocks and inline code', () => {
    expect(extractInlineTags('```\n#include <stdio.h>\n```\nreal #tag')).toEqual(['tag'])
    expect(extractInlineTags('Use `#pragma` here')).toEqual([])
  })

  it('drops purely numeric tags', () => {
    expect(extractInlineTags('Issue #123 fixed, see #v2 notes')).toEqual(['v2'])
  })
})

describe('noteTitle', () => {
  it('uses the first heading, falling back to the file name', () => {
    expect(noteTitle('intro\n# My Title\nbody', '/v/x.md')).toBe('My Title')
    expect(noteTitle('no heading at all', '/v/some-note.md')).toBe('some-note')
  })
})

describe('isObsidianVault', () => {
  it('requires a .obsidian directory', async () => {
    expect(isObsidianVault(root)).toBe(false)
    await makeVault()
    expect(isObsidianVault(root)).toBe(true)
  })

  it('rejects a .obsidian regular file', async () => {
    await writeFile(join(root, '.obsidian'), 'not a dir', 'utf8')
    expect(isObsidianVault(root)).toBe(false)
  })
})

describe('scanObsidianTopics', () => {
  it('imports tags used in enough notes, seeded with note titles', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [shared]\n---\n# Alpha Note\nbody')
    await note('b.md', '---\ntags:\n  - shared\n---\n# Beta Note\nbody')
    await note('c.md', 'Body with inline #shared tag\n')
    await note('once.md', '---\ntags: [lonely]\n---\n# Lonely\n')

    const topics = await scanObsidianTopics(root)
    expect(topics).toHaveLength(1)
    expect(topics[0].name).toBe('shared')
    expect(topics[0].noteCount).toBe(3)
    expect(topics[0].seeds).toEqual(['Alpha Note', 'Beta Note', 'c'])
  })

  it('merges tag casings and counts each note once', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [Rag]\n---\n# A\nAlso inline #rag mention')
    await note('b.md', '---\ntags: [rag]\n---\n# B\n')

    const topics = await scanObsidianTopics(root)
    expect(topics).toHaveLength(1)
    expect(topics[0].name).toBe('Rag')
    expect(topics[0].noteCount).toBe(2)
  })

  it('pins graph color-group tags and imports plain-text groups', async () => {
    await makeVault()
    await writeFile(
      join(root, '.obsidian', 'graph.json'),
      JSON.stringify({
        colorGroups: [
          { query: 'tag:#lonely', color: { a: 1, rgb: 1 } },
          { query: 'production', color: { a: 1, rgb: 2 } },
          { query: 'path:docs', color: { a: 1, rgb: 3 } }
        ]
      }),
      'utf8'
    )
    await note('once.md', '---\ntags: [lonely]\n---\n# Lonely Note\n')
    await note('a.md', '---\ntags: [common]\n---\n# A\n')
    await note('b.md', '---\ntags: [common]\n---\n# B\n')

    const topics = await scanObsidianTopics(root)
    const names = topics.map((t) => t.name)
    // Graph groups first (graph.json order), then tags by note count.
    expect(names).toEqual(['lonely', 'production', 'common'])
    expect(topics[1].source).toBe('graph-group')
    expect(topics[1].seeds).toEqual(['production'])
  })

  it('skips hidden and build directories', async () => {
    await makeVault()
    await note('.obsidian/plug.md', '---\ntags: [hidden]\n---\n')
    await note('.trash/gone.md', '---\ntags: [hidden]\n---\n')
    await note('node_modules/dep.md', '---\ntags: [hidden]\n---\n')
    await note('real.md', '---\ntags: [hidden]\n---\n')

    const topics = await scanObsidianTopics(root)
    expect(topics).toEqual([])
  })

  it('caps the number of topics at 12, highest note counts first', async () => {
    await makeVault()
    const tags = Array.from({ length: 15 }, (_, i) => `tag${String.fromCharCode(97 + i)}`)
    await note('x.md', `---\ntags: [${tags.join(', ')}]\n---\n# X\n`)
    await note('y.md', `---\ntags: [${tags.join(', ')}]\n---\n# Y\n`)
    await note('z.md', '---\ntags: [taga, tagb]\n---\n# Z\n')

    const topics = await scanObsidianTopics(root)
    expect(topics).toHaveLength(12)
    expect(topics[0].name).toBe('taga')
    expect(topics[1].name).toBe('tagb')
  })

  it('sanitizes commas and pipes out of seed titles', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [t]\n---\n# Hello, World | Part 1\n')
    await note('b.md', '---\ntags: [t]\n---\n# Plain\n')

    const topics = await scanObsidianTopics(root)
    expect(topics[0].seeds).toContain('Hello World Part 1')
  })
})

describe('syncObsidianTopics', () => {
  async function twoTagVault(): Promise<void> {
    await makeVault()
    await note('a.md', '---\ntags: [alpha, beta]\n---\n# First\n')
    await note('b.md', '---\ntags: [alpha, beta]\n---\n# Second\n')
  }

  it('imports everything on the first run and records provenance hashes', async () => {
    await twoTagVault()
    const result = await syncObsidianTopics(root, FRESH)

    expect(result.added.sort()).toEqual(['alpha', 'beta'])
    expect(result.updated).toEqual([])
    expect(result.removed).toEqual([])
    expect(cliTopics.map((t) => t.name).sort()).toEqual(['alpha', 'beta'])
    expect(result.state.topics.alpha).toBe(hashTopicDef('alpha', ['First', 'Second']))
  })

  it('is a no-op when nothing changed', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)
    cliCalls.length = 0

    const second = await syncObsidianTopics(root, first.state)
    expect(second.added).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.removed).toEqual([])
    expect(second.state).toEqual(first.state)
    // Only the `list` read — no writes.
    expect(cliCalls.filter((args) => args[0] !== 'list')).toEqual([])
  })

  it('adds newly qualifying tags on later runs', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)

    await note('c.md', '---\ntags: [gamma]\n---\n# Third\n')
    await note('d.md', '---\ntags: [gamma]\n---\n# Fourth\n')
    const second = await syncObsidianTopics(root, first.state)

    expect(second.added).toEqual(['gamma'])
    expect(cliTopics.map((t) => t.name).sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('updates a managed, unmodified topic when its seeds change', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)

    await note('c.md', '---\ntags: [alpha]\n---\n# Another Alpha Note\n')
    const second = await syncObsidianTopics(root, first.state)

    expect(second.updated).toEqual(['alpha'])
    expect(cliTopics.find((t) => t.name === 'alpha')?.seeds).toContain('Another Alpha Note')
    expect(second.state.topics.alpha).toBe(
      hashTopicDef('alpha', ['Another Alpha Note', 'First', 'Second'])
    )
  })

  it('removes a managed, unmodified topic when its tag disappears', async () => {
    await twoTagVault()
    await note('c.md', '---\ntags: [gone]\n---\n# G1\n')
    await note('d.md', '---\ntags: [gone]\n---\n# G2\n')
    const first = await syncObsidianTopics(root, FRESH)
    expect(first.added).toContain('gone')

    await rm(join(root, 'c.md'))
    await rm(join(root, 'd.md'))
    const second = await syncObsidianTopics(root, first.state)

    expect(second.removed).toEqual(['gone'])
    expect(cliTopics.some((t) => t.name === 'gone')).toBe(false)
    expect(second.state.topics.gone).toBeUndefined()
  })

  it('releases a user-edited topic: never updates or removes it again', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)

    // User edits the seeds of 'alpha' in Settings.
    const alpha = cliTopics.find((t) => t.name === 'alpha')
    alpha!.seeds = ['my own curated seed']

    // Vault changes would normally update alpha AND remove it later.
    await note('c.md', '---\ntags: [alpha]\n---\n# New Alpha\n')
    const second = await syncObsidianTopics(root, first.state)
    expect(second.updated).toEqual([])
    expect(alpha!.seeds).toEqual(['my own curated seed'])
    expect(second.state.topics.alpha).toBeUndefined()

    // Even when the tag disappears entirely, the edited topic stays.
    await rm(join(root, 'a.md'))
    await rm(join(root, 'b.md'))
    await rm(join(root, 'c.md'))
    const third = await syncObsidianTopics(root, second.state)
    expect(third.removed).not.toContain('alpha')
    expect(cliTopics.some((t) => t.name === 'alpha')).toBe(true)
  })

  it('tombstones a user-deleted topic and never re-adds it', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)

    // User deletes 'beta' in Settings while the tag still exists.
    cliTopics = cliTopics.filter((t) => t.name !== 'beta')
    const second = await syncObsidianTopics(root, first.state)

    expect(second.added).toEqual([])
    expect(second.state.topics.beta).toBe('deleted')
    expect(cliTopics.some((t) => t.name === 'beta')).toBe(false)

    // And it stays deleted on every subsequent run.
    const third = await syncObsidianTopics(root, second.state)
    expect(third.added).toEqual([])
    expect(third.state.topics.beta).toBe('deleted')
  })

  it('never manages a user topic whose name collides with a candidate', async () => {
    await twoTagVault()
    cliTopics.push({ name: 'alpha', seeds: ['user seed'] })

    const result = await syncObsidianTopics(root, FRESH)
    expect(result.added).toEqual(['beta'])
    expect(result.updated).toEqual([])
    expect(cliTopics.find((t) => t.name === 'alpha')?.seeds).toEqual(['user seed'])
    expect(result.state.topics.alpha).toBeUndefined()
  })

  it('keeps provenance and retries when a CLI write fails', async () => {
    await twoTagVault()
    const first = await syncObsidianTopics(root, FRESH)

    await note('c.md', '---\ntags: [alpha]\n---\n# Extra\n')
    mockExecCommand.mockImplementationOnce(async (_c, args) => {
      cliCalls.push(args)
      return cliTopics.map((t) => ({ ...t }))
    })
    mockExecCommand.mockImplementationOnce(async () => {
      throw new Error('update failed')
    })

    const second = await syncObsidianTopics(root, first.state)
    expect(second.updated).toEqual([])
    // Hash not advanced — the next run retries the update.
    expect(second.state.topics.alpha).toBe(first.state.topics.alpha)
  })
})

describe('maybeSyncObsidianTopics', () => {
  it('does nothing for a non-Obsidian folder', async () => {
    const wm = fakeWindowManager()
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(mockExecCommand).not.toHaveBeenCalled()
    expect(syncStates.size).toBe(0)
  })

  it('marks a vault with pre-existing topics unmanaged and never syncs it', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [alpha]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha]\n---\n# B\n')
    cliTopics.push({ name: 'user-topic', seeds: ['mine'] })
    const wm = fakeWindowManager()

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(syncStates.get('col-1')).toEqual({ managed: false, topics: {} })
    expect(wm.broadcastToAll).not.toHaveBeenCalled()
    expect(cliTopics).toHaveLength(1)

    // Subsequent calls return before any CLI work.
    mockExecCommand.mockClear()
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(mockExecCommand).not.toHaveBeenCalled()
  })

  it('imports on first run and broadcasts the summary', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [alpha]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha]\n---\n# B\n')
    const wm = fakeWindowManager()

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(syncStates.get('col-1')?.managed).toBe(true)
    expect(wm.broadcastToAll).toHaveBeenCalledWith(OBSIDIAN_TOPICS_SYNCED_CHANNEL, {
      collectionId: 'col-1',
      root,
      added: ['alpha'],
      updated: [],
      removed: []
    })
  })

  it('stays silent when a later sync changes nothing', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [alpha]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha]\n---\n# B\n')
    const wm = fakeWindowManager()

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    wm.broadcastToAll.mockClear()

    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    expect(wm.broadcastToAll).not.toHaveBeenCalled()
  })

  it('broadcasts updates and removals from later syncs', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [alpha, gone]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha, gone]\n---\n# B\n')
    const wm = fakeWindowManager()
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    wm.broadcastToAll.mockClear()

    // 'alpha' gains a note (seed change); 'gone' loses its tag entirely.
    await note('c.md', '---\ntags: [alpha]\n---\n# C\n')
    await note('a.md', '---\ntags: [alpha]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha]\n---\n# B\n')
    await maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)

    expect(wm.broadcastToAll).toHaveBeenCalledWith(OBSIDIAN_TOPICS_SYNCED_CHANNEL, {
      collectionId: 'col-1',
      root,
      added: [],
      updated: ['alpha'],
      removed: ['gone']
    })
  })

  it('swallows CLI errors and leaves state unset for retry', async () => {
    await makeVault()
    mockExecCommand.mockRejectedValueOnce(new Error('no cli'))
    const wm = fakeWindowManager()

    await expect(
      maybeSyncObsidianTopics(collection(), wm as unknown as WindowManager)
    ).resolves.toBeUndefined()
    expect(syncStates.size).toBe(0)
  })
})

describe('scheduleObsidianSync', () => {
  it('coalesces rapid schedules into one debounced sync', async () => {
    await makeVault()
    await note('a.md', '---\ntags: [alpha]\n---\n# A\n')
    await note('b.md', '---\ntags: [alpha]\n---\n# B\n')
    const wm = fakeWindowManager()

    vi.useFakeTimers()
    try {
      scheduleObsidianSync(collection(), wm as unknown as WindowManager, 200)
      scheduleObsidianSync(collection(), wm as unknown as WindowManager, 200)
      scheduleObsidianSync(collection(), wm as unknown as WindowManager, 200)
      expect(mockExecCommand).not.toHaveBeenCalled()
      // Fire the single coalesced timer, then let the async sync (real fs
      // I/O) finish under real timers.
      await vi.advanceTimersByTimeAsync(250)
    } finally {
      vi.useRealTimers()
    }

    await vi.waitFor(() => expect(wm.broadcastToAll).toHaveBeenCalledTimes(1))
    expect(cliCalls.filter((args) => args[0] === 'list')).toHaveLength(1)
  })

  it('cancelScheduledObsidianSyncs drops pending timers', async () => {
    vi.useFakeTimers()
    try {
      await makeVault()
      const wm = fakeWindowManager()
      scheduleObsidianSync(collection(), wm as unknown as WindowManager, 200)
      cancelScheduledObsidianSyncs()
      await vi.runAllTimersAsync()
      expect(mockExecCommand).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
