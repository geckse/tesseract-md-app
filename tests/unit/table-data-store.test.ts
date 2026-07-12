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

  it('resizing a column changes its width but never its position', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')

    // 'status' is last alphabetically; a resize must not move it to the front
    tableStore.setColumnWidth(tabId, 'status', 320)

    expect(tableStore.visibleColumns(tabId).map((c) => c.name)).toEqual(['date', 'extra', 'status'])
    expect(tableStore.columnWidth(tabId, 'status')).toBe(320)

    // Resizing a second column keeps the order stable too
    tableStore.setColumnWidth(tabId, 'extra', 90)
    expect(tableStore.visibleColumns(tabId).map((c) => c.name)).toEqual(['date', 'extra', 'status'])
  })

  it('hiding and re-showing a column does not reorder the others', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')

    tableStore.toggleColumnHidden(tabId, 'date')
    expect(tableStore.visibleColumns(tabId).map((c) => c.name)).toEqual(['extra', 'status'])

    tableStore.toggleColumnHidden(tabId, 'date')
    const names = tableStore.visibleColumns(tabId).map((c) => c.name)
    expect(names).toHaveLength(3)
    expect(names.slice(0, 2)).toEqual(['extra', 'status']) // untouched columns keep their order
    expect(names).toContain('date')
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

  it('skips a refetch for an already-loaded signature; reload() forces one', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    expect(mockCollection).toHaveBeenCalledTimes(1)

    // Same server-affecting signature (e.g. client-only config changes) → no refetch.
    await tableStore.load(tabId, 'c1', '/root')
    expect(mockCollection).toHaveBeenCalledTimes(1)

    // Explicit reload bypasses the signature memo.
    await tableStore.reload(tabId)
    expect(mockCollection).toHaveBeenCalledTimes(2)
  })

  it('a failed load is not memoized — the next load retries', async () => {
    mockCollection.mockRejectedValueOnce(new Error('boom'))
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    expect(tableStore.state(tabId).error).toBe('boom')

    await tableStore.load(tabId, 'c1', '/root')
    expect(mockCollection).toHaveBeenCalledTimes(2)
    expect(tableStore.state(tabId).error).toBeNull()
    expect(tableStore.state(tabId).data?.rows).toHaveLength(3)
  })

  it('reload reuses row objects when the refetched data is equivalent', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    const before = tableStore.state(tabId).data!.rows

    // Same content, freshly parsed objects (as a real refetch delivers).
    mockCollection.mockResolvedValueOnce(JSON.parse(JSON.stringify(fixture)))
    await tableStore.reload(tabId)

    const after = tableStore.state(tabId).data!.rows
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })

  it('reload keeps augmented frontmatter for rows still reported as new/empty', async () => {
    const withNew = {
      ...fixture,
      rows: [...fixture.rows, row('blog/new.md', {}, 'new')]
    }
    mockCollection = vi.fn().mockResolvedValue(JSON.parse(JSON.stringify(withNew)))
    const readFile = vi.fn().mockResolvedValue('---\ntitle: Draft\nstatus: wip\n---\n')
    Object.defineProperty(globalThis, 'window', {
      value: { api: { collection: mockCollection, readFile } },
      configurable: true
    })

    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    await tableStore.augmentNewRow(tabId, 'blog/new.md')
    const augmented = tableStore.state(tabId).data!.rows.find((r) => r.path === 'blog/new.md')!
    expect(augmented.frontmatter).toEqual({ title: 'Draft', status: 'wip' })

    // A refetch reports the row as `new` with empty frontmatter again.
    mockCollection.mockResolvedValueOnce(JSON.parse(JSON.stringify(withNew)))
    await tableStore.reload(tabId)

    const kept = tableStore.state(tabId).data!.rows.find((r) => r.path === 'blog/new.md')!
    expect(kept.frontmatter).toEqual({ title: 'Draft', status: 'wip' })
  })

  it('reload applies genuinely changed rows without touching unchanged ones', async () => {
    const tabId = workspace.openTableTab('blog')
    await tableStore.load(tabId, 'c1', '/root')
    const before = tableStore.state(tabId).data!.rows

    const changed = JSON.parse(JSON.stringify(fixture)) as CollectionOutput
    changed.rows[1] = { ...changed.rows[1], frontmatter: { status: 'archived' } }
    mockCollection.mockResolvedValueOnce(changed)
    await tableStore.reload(tabId)

    const after = tableStore.state(tabId).data!.rows
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1].frontmatter).toEqual({ status: 'archived' })
    expect(after[2]).toBe(before[2])
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

  it('strips proxies from committed values so the IPC patch is structured-cloneable', async () => {
    const tabId = await setup()
    // Cells can commit reactive $state proxies (e.g. ListCell's tag array);
    // Electron IPC rejects proxies with "An object could not be cloned".
    const proxied = new Proxy(['a', 'b'], {})
    await tableStore.editCell(tabId, 'blog/a.md', 'tag', proxied)

    const patch = api.updateFrontmatter.mock.calls[0][2]
    expect(patch.set.tag).toEqual(['a', 'b'])
    expect(() => structuredClone(patch)).not.toThrow()
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

// ─── Phase 42: frontmatter relations ─────────────────────────────────────

import { cliFeatures } from '@renderer/lib/cli-features.svelte'
import type { RelationValue } from '@renderer/types/cli'

function relationRow(
  path: string,
  frontmatter: Record<string, unknown>,
  relations?: Record<string, RelationValue[]>
): CollectionRow {
  return { ...row(path, frontmatter), relations }
}

const relationFixture: CollectionOutput = {
  scope: 'invoices/',
  recursive: false,
  columns: [col('client', 'Relation'), col('status', 'String')],
  rows: [
    relationRow(
      'invoices/i1.md',
      { client: '[[clients/acme|Acme]]', status: 'sent' },
      {
        client: [
          {
            raw: '[[clients/acme|Acme]]',
            path: 'clients/acme.md',
            exists: true,
            title: 'Acme Corp',
            frontmatter: {}
          }
        ]
      }
    ),
    relationRow(
      'invoices/i2.md',
      { client: 'clients/acme.md', status: 'draft' },
      {
        client: [
          {
            raw: 'clients/acme.md',
            path: 'clients/acme.md',
            exists: true,
            title: 'Acme Corp',
            frontmatter: {}
          }
        ]
      }
    ),
    relationRow('invoices/i3.md', { client: 'not-a-link', status: 'draft' })
  ],
  total_rows: 3,
  offset: 0
}

describe('tableStore — relations (phase 42)', () => {
  let mockGetCliVersion: ReturnType<typeof vi.fn>

  beforeEach(() => {
    workspace.reset()
    cliFeatures.reset()
    mockCollection = vi.fn().mockResolvedValue(relationFixture)
    // Rejecting default = "no detectable CLI version" (capabilities stay off).
    mockGetCliVersion = vi.fn().mockRejectedValue(new Error('no cli'))
    Object.defineProperty(globalThis, 'window', {
      value: { api: { collection: mockCollection, getCliVersion: mockGetCliVersion } },
      configurable: true
    })
  })

  async function setupRelations(): Promise<string> {
    const tabId = workspace.openTableTab('invoices')
    await tableStore.load(tabId, 'c1', '/root')
    return tabId
  }

  it('passes populate iff the CLI supports relations (NEVER on old CLIs)', async () => {
    // Unsupported (version unknown): no populate key value.
    let tabId = await setupRelations()
    expect(mockCollection.mock.calls[0][2].populate).toBeUndefined()
    tableStore.dispose(tabId)

    // Supported: populate: true.
    cliFeatures.version = '0.2.0'
    tabId = workspace.openTableTab('invoices')
    await tableStore.load(tabId, 'c1', '/root')
    const lastCall = mockCollection.mock.calls[mockCollection.mock.calls.length - 1]
    expect(lastCall[2].populate).toBe(true)
  })

  it('a load racing async version detection awaits it — the FIRST fetch is populated', async () => {
    // Startup order: App fires detection fire-and-forget, then a restored
    // table tab loads immediately. The load must wait for detection instead
    // of fetching unpopulated (which renders every chip neutral/unlinked
    // until some other server input changes).
    let resolveVersion!: (v: string) => void
    mockGetCliVersion.mockReturnValue(new Promise<string>((resolve) => (resolveVersion = resolve)))
    void cliFeatures.init()

    const tabId = workspace.openTableTab('invoices')
    const loading = tableStore.load(tabId, 'c1', '/root')

    // No fetch while detection is in flight.
    await Promise.resolve()
    await Promise.resolve()
    expect(mockCollection).not.toHaveBeenCalled()

    resolveVersion('0.2.0')
    await loading
    expect(mockCollection).toHaveBeenCalledTimes(1)
    expect(mockCollection.mock.calls[0][2].populate).toBe(true)
  })

  it('equals filter matches [[wiki]], path.md, and bare-path forms interchangeably', async () => {
    const tabId = await setupRelations()
    for (const value of ['clients/acme', 'clients/acme.md', '[[clients/acme]]']) {
      workspace.setTableEphemeral(tabId, {
        filters: [{ columnName: 'client', op: 'equals', value }]
      })
      const paths = tableStore.filteredRows(tabId).map((r) => r.path)
      expect(paths).toEqual(['invoices/i1.md', 'invoices/i2.md'])
    }
  })

  it('equals filter behaves exactly as before for non-link values', async () => {
    const tabId = await setupRelations()
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'status', op: 'equals', value: 'draft' }]
    })
    expect(tableStore.filteredRows(tabId).map((r) => r.path)).toEqual([
      'invoices/i2.md',
      'invoices/i3.md'
    ])
    // A relation-looking filter never matches a plain string.
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'client', op: 'equals', value: 'not-a-link.md' }]
    })
    expect(tableStore.filteredRows(tabId)).toHaveLength(0)
  })

  it('in filter uses the same normalization', async () => {
    const tabId = await setupRelations()
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'client', op: 'in', values: ['clients/acme'] }]
    })
    expect(tableStore.filteredRows(tabId).map((r) => r.path)).toEqual([
      'invoices/i1.md',
      'invoices/i2.md'
    ])
  })

  it('contains matches the server-resolved title', async () => {
    const tabId = await setupRelations()
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'client', op: 'contains', value: 'Acme Corp' }]
    })
    expect(tableStore.filteredRows(tabId).map((r) => r.path)).toEqual([
      'invoices/i1.md',
      'invoices/i2.md'
    ])
    // Raw values still match (non-link items are never dropped).
    workspace.setTableEphemeral(tabId, {
      filters: [{ columnName: 'client', op: 'contains', value: 'not-a-link' }]
    })
    expect(tableStore.filteredRows(tabId).map((r) => r.path)).toEqual(['invoices/i3.md'])
  })

  it('group-by canonicalizes on the resolved path and labels with the title', async () => {
    const tabId = await setupRelations()
    workspace.setTableEphemeral(tabId, { groupBy: 'client' })
    const groups = tableStore.groups(tabId)!
    // i1 ([[clients/acme|Acme]]) and i2 (clients/acme.md) land in ONE group.
    const acme = groups.find((g) => g.value === 'clients/acme.md')!
    expect(acme.rows.map((r) => r.path)).toEqual(['invoices/i1.md', 'invoices/i2.md'])
    expect(acme.label).toBe('Acme Corp')
    // The non-link value keeps its raw key and no label.
    const plain = groups.find((g) => g.value === 'not-a-link')!
    expect(plain.rows.map((r) => r.path)).toEqual(['invoices/i3.md'])
    expect(plain.label).toBeUndefined()
  })
})
