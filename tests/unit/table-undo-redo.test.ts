import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { workspace } from '@renderer/stores/workspace.svelte'
import { tableStore } from '@renderer/stores/table.svelte'
import { tableHistory } from '@renderer/stores/table-history.svelte'
import type {
  CollectionColumn,
  CollectionOutput,
  CollectionRow,
  JsonValue
} from '@renderer/types/cli'

function col(
  name: string,
  field_type: CollectionColumn['field_type'],
  in_schema = true
): CollectionColumn {
  return {
    name,
    field_type,
    description: null,
    occurrence_count: in_schema ? 3 : 0,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema
  }
}

function row(
  path: string,
  frontmatter: Record<string, unknown>,
  state: CollectionRow['state'] = 'indexed'
): CollectionRow {
  return {
    path,
    title: path.split('/').pop()!.replace('.md', ''),
    title_source: 'filename',
    frontmatter: frontmatter as CollectionRow['frontmatter'],
    content_hash: state === 'new' ? null : 'h',
    file_size: 1,
    modified_at: 1,
    indexed_at: state === 'new' ? null : 1,
    state
  }
}

function fixture(): CollectionOutput {
  return {
    scope: 'blog/',
    recursive: false,
    columns: [col('date', 'Date'), col('status', 'String')],
    rows: [
      row('blog/a.md', { status: 'published', date: '2024-01-01' }),
      row('blog/b.md', { status: 'draft', date: '2024-02-01' })
    ],
    total_rows: 2,
    offset: 0
  }
}

interface FrontmatterPatch {
  set?: Record<string, JsonValue>
  unset?: string[]
}

/** Per-path frontmatter "disk" the updateFrontmatter mock mutates + returns. */
let fmByPath: Record<string, Record<string, JsonValue>>

let api: {
  collection: ReturnType<typeof vi.fn>
  updateFrontmatter: ReturnType<typeof vi.fn>
  ingestFile: ReturnType<typeof vi.fn>
  createFile: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
}

async function openLoadedTab(): Promise<string> {
  const tabId = workspace.openTableTab('blog')
  await tableStore.load(tabId, 'c1', '/root')
  return tabId
}

describe('tableStore undo/redo', () => {
  beforeEach(() => {
    // Fake timers: the 600 ms re-index debounce and the notice TTL must not
    // leak into later tests. Mocked promises still resolve (microtasks).
    vi.useFakeTimers()
    workspace.reset()
    fmByPath = {
      'blog/a.md': { status: 'published', date: '2024-01-01' },
      'blog/b.md': { status: 'draft', date: '2024-02-01' }
    }
    api = {
      collection: vi.fn().mockResolvedValue(fixture()),
      updateFrontmatter: vi
        .fn()
        .mockImplementation(async (_cid: string, path: string, patch: FrontmatterPatch) => {
          const next = { ...(fmByPath[path] ?? {}) }
          for (const k of patch.unset ?? []) delete next[k]
          Object.assign(next, patch.set ?? {})
          fmByPath[path] = next
          return next
        }),
      ingestFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('---\nstatus: draft\n---\n\n# b\n')
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cell edits', () => {
    it('records a successful edit; undo writes the inverse patch; redo reapplies', async () => {
      const tabId = await openLoadedTab()

      const ok = await tableStore.editCell(tabId, 'blog/b.md', 'status', 'published')
      expect(ok).toBe(true)
      expect(tableHistory.canUndo(tabId)).toBe(true)
      expect(tableHistory.canRedo(tabId)).toBe(false)

      await tableStore.undo(tabId)
      expect(api.updateFrontmatter).toHaveBeenLastCalledWith('c1', 'blog/b.md', {
        set: { status: 'draft' }
      })
      expect(tableHistory.canUndo(tabId)).toBe(false)
      expect(tableHistory.canRedo(tabId)).toBe(true)

      await tableStore.redo(tabId)
      expect(api.updateFrontmatter).toHaveBeenLastCalledWith('c1', 'blog/b.md', {
        set: { status: 'published' }
      })
      expect(tableHistory.canUndo(tabId)).toBe(true)
      expect(tableHistory.canRedo(tabId)).toBe(false)
    })

    it('undo of an absent→value edit unsets the key', async () => {
      const tabId = await openLoadedTab()

      await tableStore.editCell(tabId, 'blog/b.md', 'category', 'tech')
      await tableStore.undo(tabId)

      expect(api.updateFrontmatter).toHaveBeenLastCalledWith('c1', 'blog/b.md', {
        unset: ['category']
      })
    })

    it('a failed write records nothing', async () => {
      const tabId = await openLoadedTab()
      api.updateFrontmatter.mockRejectedValueOnce(new Error('disk full'))

      const ok = await tableStore.editCell(tabId, 'blog/b.md', 'status', 'published')
      expect(ok).toBe(false)
      expect(tableHistory.canUndo(tabId)).toBe(false)
    })

    it('a no-op edit (same value) writes but records nothing', async () => {
      const tabId = await openLoadedTab()

      await tableStore.editCell(tabId, 'blog/b.md', 'status', 'draft')
      expect(api.updateFrontmatter).toHaveBeenCalledTimes(1)
      expect(tableHistory.canUndo(tabId)).toBe(false)
    })

    it('skips a stale entry (external change) with a notice instead of clobbering', async () => {
      const tabId = await openLoadedTab()
      await tableStore.editCell(tabId, 'blog/b.md', 'status', 'published')
      expect(api.updateFrontmatter).toHaveBeenCalledTimes(1)

      // Another window / external editor changed the cell since our edit.
      tableStore.applyExternalContent(tabId, '/root/blog/b.md', '---\nstatus: external\n---\n')

      await tableStore.undo(tabId)
      expect(api.updateFrontmatter).toHaveBeenCalledTimes(1) // no second write
      expect(tableHistory.noticeFor(tabId)?.message).toContain('Undo skipped')
      expect(tableHistory.canRedo(tabId)).toBe(false) // entry dropped, not moved
    })
  })

  describe('delete row', () => {
    it('snapshots the file before trashing and undo recreates it verbatim', async () => {
      const tabId = await openLoadedTab()
      api.readFile.mockResolvedValue('---\nstatus: draft\n---\n\n# b body\n')

      const res = await tableStore.deleteRow(tabId, 'blog/b.md')
      expect(res.ok).toBe(true)
      // Snapshot read happened, and strictly before the trash.
      expect(api.readFile).toHaveBeenCalledWith('/root/blog/b.md')
      expect(api.readFile.mock.invocationCallOrder[0]).toBeLessThan(
        api.deleteFile.mock.invocationCallOrder[0]
      )
      expect(tableHistory.canUndo(tabId)).toBe(true)

      await tableStore.undo(tabId)
      expect(api.createFile).toHaveBeenCalledWith(
        '/root/blog/b.md',
        '---\nstatus: draft\n---\n\n# b body\n'
      )
      expect(api.ingestFile).toHaveBeenCalledWith('/root', 'blog/b.md', { reindex: true })
      expect(tableHistory.canRedo(tabId)).toBe(true)
    })

    it('undo shows a notice when the path reappeared (exclusive create fails)', async () => {
      const tabId = await openLoadedTab()
      await tableStore.deleteRow(tabId, 'blog/b.md')
      api.createFile.mockRejectedValueOnce(new Error('EEXIST'))

      await tableStore.undo(tabId)
      expect(tableHistory.noticeFor(tabId)?.message).toContain('Undo failed')
      expect(tableHistory.canRedo(tabId)).toBe(false)
    })

    it('an unreadable file still deletes but clears redo instead of recording', async () => {
      const tabId = await openLoadedTab()
      // Seed a redo entry that must not survive the unrecordable mutation.
      await tableStore.editCell(tabId, 'blog/a.md', 'status', 'draft')
      await tableStore.undo(tabId)
      expect(tableHistory.canRedo(tabId)).toBe(true)

      api.readFile.mockRejectedValueOnce(new Error('EACCES'))
      const res = await tableStore.deleteRow(tabId, 'blog/b.md')
      expect(res.ok).toBe(true)
      expect(api.deleteFile).toHaveBeenCalledWith('/root/blog/b.md')
      expect(tableHistory.canRedo(tabId)).toBe(false)
    })
  })

  describe('add row', () => {
    it('records the add; undo trashes the current bytes; redo recreates them', async () => {
      const tabId = await openLoadedTab()

      const res = await tableStore.addRow(tabId, 'new-note')
      expect(res.ok).toBe(true)
      const seededContent = api.createFile.mock.calls[0][1] as string
      expect(api.createFile).toHaveBeenCalledWith('/root/blog/new-note.md', seededContent)
      expect(tableHistory.canUndo(tabId)).toBe(true)

      // The user edited the body after adding — undo must capture what's on
      // disk NOW so redo restores it, not the original seed.
      api.readFile.mockResolvedValueOnce('---\ntitle: new-note\n---\n\nedited body\n')
      await tableStore.undo(tabId)
      expect(api.deleteFile).toHaveBeenCalledWith('/root/blog/new-note.md')
      expect(tableHistory.canRedo(tabId)).toBe(true)

      await tableStore.redo(tabId)
      expect(api.createFile).toHaveBeenLastCalledWith(
        '/root/blog/new-note.md',
        '---\ntitle: new-note\n---\n\nedited body\n'
      )
      expect(tableHistory.canUndo(tabId)).toBe(true)
    })
  })
})
