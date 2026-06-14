import { describe, it, expect, beforeEach, vi } from 'vitest'
import { workspace } from '@renderer/stores/workspace.svelte'
import { tableStore, valueToString } from '@renderer/stores/table.svelte'
import type { CollectionColumn, CollectionOutput, CollectionRow } from '@renderer/types/cli'

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

const fixture: CollectionOutput = {
  scope: 'blog/',
  recursive: false,
  columns: [col('date', 'Date'), col('status', 'String'), col('extra', 'String', false)],
  rows: [
    row('blog/a.md', { status: 'published', date: '2024-01-01', tag: ['x'] }),
    row('blog/b.md', { status: 'draft', date: '2024-02-01' }),
    row('blog/c.md', { status: 'published', date: '2024-03-01' })
  ],
  total_rows: 3,
  offset: 0
}

let mockCollection: ReturnType<typeof vi.fn>

describe('valueToString', () => {
  it('stringifies scalars, arrays, and nullish values', () => {
    expect(valueToString('hi')).toBe('hi')
    expect(valueToString(42)).toBe('42')
    expect(valueToString(true)).toBe('true')
    expect(valueToString(null)).toBe('')
    expect(valueToString(undefined)).toBe('')
    expect(valueToString(['a', 'b'])).toBe('["a","b"]')
  })
})

describe('tableStore (renderer data store)', () => {
  beforeEach(() => {
    workspace.reset()
    mockCollection = vi.fn().mockResolvedValue(fixture)
    Object.defineProperty(globalThis, 'window', {
      value: { api: { collection: mockCollection } },
      configurable: true
    })
  })

  it('load() calls the CLI with folder path + recursive and stores the result', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')

    expect(mockCollection).toHaveBeenCalledWith('/root', 'blog', {
      recursive: false,
      sort: undefined,
      order: undefined
    })
    const state = tableStore.state(tabId)
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.data?.rows).toHaveLength(3)
  })

  it('visibleColumns returns data columns alphabetically when no layout is set', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    expect(tableStore.visibleColumns(tabId).map((c) => c.name)).toEqual(['date', 'extra', 'status'])
  })

  it('client-side filter narrows rows and rowCount', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'status', op: 'equals', value: 'published' }]
    })
    const rows = tableStore.filteredRows(tabId)
    expect(rows.map((r) => r.path)).toEqual(['blog/a.md', 'blog/c.md'])
    expect(tableStore.rowCount(tabId)).toBe(2)
  })

  it('group-by buckets rows by field value (sorted)', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    workspace.setTableEphemeral(tabId, { groupBy: 'status' })
    const groups = tableStore.groups(tabId)
    expect(groups?.map((g) => `${g.value}:${g.rows.length}`)).toEqual(['draft:1', 'published:2'])
  })

  it('changing sort re-issues the CLI call with server-side --sort/--order', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    workspace.setTableEphemeral(tabId, { sort: [{ columnName: 'date', direction: 'desc' }] })
    await tableStore.load(tabId, 'c1', '/root')
    expect(mockCollection).toHaveBeenLastCalledWith('/root', 'blog', {
      recursive: false,
      sort: 'date',
      order: 'desc'
    })
  })

  it('surfaces CLI errors without throwing', async () => {
    mockCollection.mockRejectedValueOnce(new Error('boom'))
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    expect(tableStore.state(tabId).error).toBe('boom')
  })
})

describe('tableStore editing (39b)', () => {
  let api: {
    collection: ReturnType<typeof vi.fn>
    updateFrontmatter: ReturnType<typeof vi.fn>
    ingestFile: ReturnType<typeof vi.fn>
    createFile: ReturnType<typeof vi.fn>
    deleteFile: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    workspace.reset()
    vi.useFakeTimers()
    api = {
      collection: vi.fn().mockResolvedValue(fixture),
      updateFrontmatter: vi
        .fn()
        .mockResolvedValue({ status: 'published', date: '2024-01-01', tag: ['x'] }),
      ingestFile: vi.fn().mockResolvedValue({}),
      createFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('')
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
  })

  afterEach(async () => {
    await vi.runAllTimersAsync()
    vi.useRealTimers()
  })

  async function setup(): Promise<string> {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    return tabId
  }

  it('edits a cell optimistically and reconciles with the authoritative result', async () => {
    const tabId = await setup()
    await tableStore.editCell(tabId, 'blog/a.md', 'status', 'archived')
    expect(api.updateFrontmatter).toHaveBeenCalledWith('c1', 'blog/a.md', {
      set: { status: 'archived' }
    })
    const r = tableStore.state(tabId).data!.rows.find((x) => x.path === 'blog/a.md')!
    expect(r.frontmatter.status).toBe('published') // authoritative value from the writer
    expect(tableStore.cellState(tabId, 'blog/a.md', 'status').saving).toBe(false)
  })

  it('clearing a cell sends an unset patch', async () => {
    const tabId = await setup()
    await tableStore.editCell(tabId, 'blog/a.md', 'status', '')
    expect(api.updateFrontmatter).toHaveBeenCalledWith('c1', 'blog/a.md', {
      unset: ['status']
    })
  })

  it('reverts the optimistic value and records an error on writer failure', async () => {
    const tabId = await setup()
    api.updateFrontmatter.mockRejectedValueOnce(new Error('EACCES'))
    await tableStore.editCell(tabId, 'blog/b.md', 'status', 'archived')
    const r = tableStore.state(tabId).data!.rows.find((x) => x.path === 'blog/b.md')!
    expect(r.frontmatter.status).toBe('draft') // reverted
    expect(tableStore.cellState(tabId, 'blog/b.md', 'status').error).toBe('EACCES')
  })

  it('re-indexes the edited file (debounced) and refetches', async () => {
    const tabId = await setup()
    await tableStore.editCell(tabId, 'blog/a.md', 'status', 'archived')
    await vi.runAllTimersAsync()
    expect(api.ingestFile).toHaveBeenCalledWith('/root', 'blog/a.md', { reindex: true })
  })

  it('addRow creates a schema-seeded .md, re-indexes, and refetches', async () => {
    const tabId = await setup()
    const result = await tableStore.addRow(tabId, 'new-post')
    expect(result.ok).toBe(true)
    expect(api.createFile).toHaveBeenCalledTimes(1)
    const [absPath, content] = api.createFile.mock.calls[0]
    expect(absPath).toBe('/root/blog/new-post.md')
    expect(content).toContain('title: new-post')
    // Seeded from in_schema columns (date, status) but not the ad-hoc `extra`.
    expect(content).toContain('date:')
    expect(content).toContain('status:')
    expect(content).not.toContain('extra:')
    expect(api.ingestFile).toHaveBeenCalledWith('/root', 'blog/new-post.md', { reindex: true })
  })

  it('addRow rejects an empty file name', async () => {
    const tabId = await setup()
    const result = await tableStore.addRow(tabId, '   ')
    expect(result.ok).toBe(false)
    expect(api.createFile).not.toHaveBeenCalled()
  })

  it('deleteRow trashes the file and refetches', async () => {
    const tabId = await setup()
    const result = await tableStore.deleteRow(tabId, 'blog/a.md')
    expect(result.ok).toBe(true)
    expect(api.deleteFile).toHaveBeenCalledWith('/root/blog/a.md')
  })

  it('applyExternalContent reconciles a row from a broadcast (multi-window)', async () => {
    const tabId = await setup()
    tableStore.applyExternalContent(
      tabId,
      '/root/blog/a.md',
      '---\nstatus: edited-elsewhere\n---\nbody'
    )
    const r = tableStore.state(tabId).data!.rows.find((x) => x.path === 'blog/a.md')!
    expect(r.frontmatter.status).toBe('edited-elsewhere')
  })
})
