import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// In-memory backing store, mocked in place of electron-store (legacy migration source).
let backing: Record<string, unknown> = {}
const fakeStore = {
  get: (key: string, def: unknown) => (key in backing ? backing[key] : def),
  set: (key: string, value: unknown) => {
    backing[key] = value
  }
}

// Two temp-dir collections stand in for real vaults.
let col1Dir = ''
let col2Dir = ''

vi.mock('../../src/main/store', () => ({
  initStore: () => fakeStore,
  getCollections: () => [
    { id: 'col1', name: 'One', path: col1Dir, addedAt: 1, lastOpenedAt: 1 },
    { id: 'col2', name: 'Two', path: col2Dir, addedAt: 1, lastOpenedAt: 1 }
  ]
}))

import {
  listTableViews,
  getDefaultTableColumns,
  saveDefaultTableColumns,
  saveTableView,
  updateTableView,
  deleteTableView,
  setDefaultTableView,
  removePropertyFromViews,
  renamePropertyInViews,
  cleanupCollectionTableViews,
  CURRENT_VIEW_VERSION
} from '../../src/main/table-views'
import type { SavedTableView } from '../../src/preload/api'
import { clearOwnWrites, matchAndConsumeOwnWrite } from '../../src/main/own-writes'

function makeView(id: string, name: string): SavedTableView {
  return {
    id,
    name,
    version: CURRENT_VIEW_VERSION,
    config: { sort: [], filters: [], columns: [], groupBy: null, collapsedGroups: [] },
    recursive: false,
    createdAt: 1,
    updatedAt: 1
  }
}

function makeColumnView(id: string, columnName: string, recursive = false): SavedTableView {
  return {
    ...makeView(id, id),
    recursive,
    config: {
      sort: [{ columnName, direction: 'asc' }],
      filters: [{ columnName, op: 'equals', value: 'acme.example' }],
      columns: [{ name: columnName, hidden: false, width: 160, order: 0 }],
      groupBy: columnName,
      collapsedGroups: ['acme.example']
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function viewsFile(dir: string): string {
  return join(dir, '.markdownvdb', 'table-views.json')
}

describe('table-views (main process, file-backed)', () => {
  beforeEach(async () => {
    backing = {}
    clearOwnWrites()
    col1Dir = await fs.mkdtemp(join(tmpdir(), 'mdvdb-views-1-'))
    col2Dir = await fs.mkdtemp(join(tmpdir(), 'mdvdb-views-2-'))
  })

  afterEach(async () => {
    await fs.rm(col1Dir, { recursive: true, force: true })
    await fs.rm(col2Dir, { recursive: true, force: true })
  })

  it('saves and lists views per collection + folder', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'By date'))
    const views = await listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('By date')
    // Isolated by folder + collection.
    expect(await listTableViews('col1', 'docs')).toHaveLength(0)
    expect(await listTableViews('col2', 'blog')).toHaveLength(0)
  })

  it('persists views INSIDE the collection at .markdownvdb/table-views.json', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'Shared'))

    const raw = await fs.readFile(viewsFile(col1Dir), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(CURRENT_VIEW_VERSION)
    expect(parsed.folders.blog).toHaveLength(1)
    expect(parsed.folders.blog[0].name).toBe('Shared')
    expect(parsed.defaultColumns).toEqual({})
  })

  it('persists the built-in All fields column layout per folder', async () => {
    const layout = [
      { name: 'author', hidden: false, width: 180, order: 0 },
      { name: 'status', hidden: true, width: 140, order: 1 }
    ]

    await saveDefaultTableColumns('col1', 'blog', layout)

    expect(await getDefaultTableColumns('col1', 'blog')).toEqual(layout)
    expect(await getDefaultTableColumns('col1', 'docs')).toBeNull()
    const persisted = JSON.parse(await fs.readFile(viewsFile(col1Dir), 'utf-8'))
    expect(persisted.defaultColumns.blog).toEqual(layout)
  })

  it('upserts by id (save replaces an existing view)', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'Original'))
    await saveTableView('col1', 'blog', { ...makeView('v1', 'Renamed'), recursive: true })
    const views = await listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('Renamed')
    expect(views[0].recursive).toBe(true)
  })

  it('updateTableView behaves as an upsert', async () => {
    await updateTableView('col1', 'blog', makeView('v1', 'A'))
    await updateTableView('col1', 'blog', makeView('v2', 'B'))
    expect(await listTableViews('col1', 'blog')).toHaveLength(2)
  })

  it('deletes a view by id', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'A'))
    await saveTableView('col1', 'blog', makeView('v2', 'B'))
    const remaining = await deleteTableView('col1', 'blog', 'v1')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('v2')
  })

  it('setDefault marks exactly one view as default', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'A'))
    await saveTableView('col1', 'blog', makeView('v2', 'B'))
    await setDefaultTableView('col1', 'blog', 'v2')
    const views = await listTableViews('col1', 'blog')
    expect(views.find((v) => v.id === 'v1')?.isDefault).toBe(false)
    expect(views.find((v) => v.id === 'v2')?.isDefault).toBe(true)
  })

  it('removes dropped-property references from saved views in every folder', async () => {
    const referenced: SavedTableView = {
      ...makeView('v1', 'By status'),
      config: {
        sort: [
          { columnName: 'status', direction: 'asc' },
          { columnName: 'date', direction: 'desc' }
        ],
        filters: [
          { columnName: 'status', op: 'equals', value: 'draft' },
          { columnName: 'author', op: 'exists' }
        ],
        columns: [
          { name: 'status', hidden: false, width: 120, order: 0 },
          { name: 'author', hidden: false, width: 180, order: 1 }
        ],
        groupBy: 'status',
        collapsedGroups: ['draft', 'published']
      }
    }
    const unaffected: SavedTableView = {
      ...makeView('v2', 'By author'),
      config: {
        sort: [{ columnName: 'author', direction: 'asc' }],
        filters: [],
        columns: [{ name: 'author', hidden: false, width: 180, order: 0 }],
        groupBy: null,
        collapsedGroups: ['kept']
      }
    }
    await saveTableView('col1', 'docs', referenced)
    await saveTableView('col1', 'notes/archive', referenced)
    await saveTableView('col1', 'other', unaffected)
    await saveDefaultTableColumns('col1', 'docs', referenced.config.columns)
    const unaffectedUpdatedAt = (await listTableViews('col1', 'other'))[0].updatedAt

    await removePropertyFromViews('col1', 'status')

    for (const folder of ['docs', 'notes/archive']) {
      const [view] = await listTableViews('col1', folder)
      expect(view.config).toEqual({
        sort: [{ columnName: 'date', direction: 'desc' }],
        filters: [{ columnName: 'author', op: 'exists' }],
        columns: [{ name: 'author', hidden: false, width: 180, order: 1 }],
        groupBy: null,
        collapsedGroups: []
      })
      expect(view.updatedAt).toBeGreaterThan(1)
    }

    const [kept] = await listTableViews('col1', 'other')
    expect(kept.config).toEqual(unaffected.config)
    expect(kept.updatedAt).toBe(unaffectedUpdatedAt)
    expect(await getDefaultTableColumns('col1', 'docs')).toEqual([
      { name: 'author', hidden: false, width: 180, order: 1 }
    ])
  })

  it('renames every saved-view reference in scope and in recursive ancestor views', async () => {
    await saveTableView('col1', '', makeColumnView('root-recursive', 'client_domain', true))
    await saveTableView('col1', '', makeColumnView('root-flat', 'client_domain'))
    await saveTableView('col1', 'contacts', makeColumnView('exact', 'client_domain'))
    await saveTableView('col1', 'contacts/vip', makeColumnView('descendant', 'client_domain'))
    await saveTableView('col1', 'projects', makeColumnView('sibling', 'client_domain'))
    await saveDefaultTableColumns('col1', 'contacts', [
      { name: 'client_domain', hidden: false, width: 160, order: 0 }
    ])

    await renamePropertyInViews('col1', 'contacts', 'client_domain', 'client_industry')

    for (const [folder, id] of [
      ['', 'root-recursive'],
      ['contacts', 'exact'],
      ['contacts/vip', 'descendant']
    ] as const) {
      const view = (await listTableViews('col1', folder)).find((item) => item.id === id)!
      expect(view.config).toEqual({
        sort: [{ columnName: 'client_industry', direction: 'asc' }],
        filters: [{ columnName: 'client_industry', op: 'equals', value: 'acme.example' }],
        columns: [{ name: 'client_industry', hidden: false, width: 160, order: 0 }],
        groupBy: 'client_industry',
        collapsedGroups: ['acme.example']
      })
    }
    const rootFlat = (await listTableViews('col1', '')).find((item) => item.id === 'root-flat')!
    const sibling = (await listTableViews('col1', 'projects'))[0]
    expect(rootFlat.config.sort[0].columnName).toBe('client_domain')
    expect(sibling.config.sort[0].columnName).toBe('client_domain')
    expect(await getDefaultTableColumns('col1', 'contacts')).toEqual([
      { name: 'client_industry', hidden: false, width: 160, order: 0 }
    ])
  })

  it('serializes a delayed save before a racing rename so neither generation is lost', async () => {
    await saveTableView('col1', 'contacts', makeColumnView('existing', 'client_domain'))
    const saveAtCommit = deferred()
    const releaseSave = deferred()
    let renamePrepared = false

    const save = saveTableView('col1', 'contacts', makeColumnView('concurrent', 'client_domain'), {
      beforeCommit: async () => {
        saveAtCommit.resolve()
        await releaseSave.promise
      }
    })
    await saveAtCommit.promise
    const rename = renamePropertyInViews('col1', 'contacts', 'client_domain', 'client_industry', {
      onPrepared: () => {
        renamePrepared = true
      }
    })

    await Promise.resolve()
    expect(renamePrepared).toBe(false)
    releaseSave.resolve()
    await Promise.all([save, rename])

    const views = await listTableViews('col1', 'contacts')
    expect(views.map((view) => view.id).sort()).toEqual(['concurrent', 'existing'])
    expect(views.every((view) => view.config.sort[0]?.columnName === 'client_industry')).toBe(true)
  })

  it('serializes a delayed rename before a racing save in invocation order', async () => {
    await saveTableView('col1', 'contacts', makeColumnView('existing', 'client_domain'))
    const renameAtCommit = deferred()
    const releaseRename = deferred()
    let savePrepared = false

    const rename = renamePropertyInViews('col1', 'contacts', 'client_domain', 'client_industry', {
      beforeCommit: async () => {
        renameAtCommit.resolve()
        await releaseRename.promise
      }
    })
    await renameAtCommit.promise
    const save = saveTableView(
      'col1',
      'contacts',
      makeColumnView('concurrent', 'client_industry'),
      {
        onPrepared: () => {
          savePrepared = true
        }
      }
    )

    await Promise.resolve()
    expect(savePrepared).toBe(false)
    releaseRename.resolve()
    await Promise.all([rename, save])

    const views = await listTableViews('col1', 'contacts')
    expect(views.map((view) => view.id).sort()).toEqual(['concurrent', 'existing'])
    expect(views.every((view) => view.config.sort[0]?.columnName === 'client_industry')).toBe(true)
  })

  it.runIf(process.platform !== 'win32')(
    'serializes collection path aliases through one canonical queue key',
    async () => {
      await fs.rm(col2Dir, { recursive: true, force: true })
      await fs.symlink(col1Dir, col2Dir, 'dir')
      await saveTableView('col1', 'contacts', makeView('existing', 'Existing'))
      const firstAtCommit = deferred()
      const releaseFirst = deferred()
      let aliasPrepared = false

      const first = saveTableView('col1', 'contacts', makeView('first', 'First'), {
        beforeCommit: async () => {
          firstAtCommit.resolve()
          await releaseFirst.promise
        }
      })
      await firstAtCommit.promise
      const throughAlias = saveTableView('col2', 'contacts', makeView('alias', 'Alias'), {
        onPrepared: () => {
          aliasPrepared = true
        }
      })

      await Promise.resolve()
      expect(aliasPrepared).toBe(false)
      releaseFirst.resolve()
      await Promise.all([first, throughAlias])

      expect((await listTableViews('col1', 'contacts')).map((view) => view.id).sort()).toEqual([
        'alias',
        'existing',
        'first'
      ])
    }
  )

  it('rejects an external same-inode generation change at the final content CAS', async () => {
    await saveTableView('col1', 'contacts', makeColumnView('existing', 'client_domain'))
    clearOwnWrites()
    const external = `${JSON.stringify(
      {
        version: CURRENT_VIEW_VERSION,
        folders: { external: [makeView('external', 'External generation')] }
      },
      null,
      2
    )}\n`

    await expect(
      renamePropertyInViews('col1', 'contacts', 'client_domain', 'client_industry', {
        beforeCommit: () => fs.writeFile(viewsFile(col1Dir), external, 'utf-8')
      })
    ).rejects.toThrow(/changed after this edit was prepared/)

    expect(await fs.readFile(viewsFile(col1Dir), 'utf-8')).toBe(external)
    expect(matchAndConsumeOwnWrite(viewsFile(col1Dir), 'modified', { size: null })).toBe(false)
  })

  it('retains legacy data when an external generation wins its first publication', async () => {
    backing.tableViews = { col1: { blog: [makeView('legacy', 'Legacy')] } }
    const external = `${JSON.stringify(
      {
        version: CURRENT_VIEW_VERSION,
        folders: { external: [makeView('external', 'External generation')] }
      },
      null,
      2
    )}\n`

    await expect(
      saveTableView('col1', 'blog', makeView('new', 'New'), {
        beforeCommit: () => fs.writeFile(viewsFile(col1Dir), external, 'utf-8')
      })
    ).rejects.toThrow(/changed after this edit was prepared/)

    expect(await fs.readFile(viewsFile(col1Dir), 'utf-8')).toBe(external)
    expect((backing.tableViews as Record<string, unknown>).col1).toBeDefined()
  })

  it('retains legacy data when publication becomes visible but final durability reports failure', async () => {
    backing.tableViews = { col1: { blog: [makeView('legacy', 'Legacy')] } }
    clearOwnWrites()

    await expect(
      saveTableView('col1', 'blog', makeView('new', 'New'), {
        onPublished: () => {
          throw new Error('simulated directory fsync failure')
        }
      })
    ).rejects.toThrow('simulated directory fsync failure')

    const published = JSON.parse(await fs.readFile(viewsFile(col1Dir), 'utf-8'))
    expect(published.folders.blog.map((view: SavedTableView) => view.id).sort()).toEqual([
      'legacy',
      'new'
    ])
    expect((backing.tableViews as Record<string, unknown>).col1).toBeDefined()
    expect(matchAndConsumeOwnWrite(viewsFile(col1Dir), 'modified', { size: null })).toBe(true)
  })

  it.runIf(process.platform !== 'win32')(
    'refuses to publish through a metadata directory symlink escaping the collection',
    async () => {
      const outsideMetadata = join(col2Dir, '.markdownvdb')
      await fs.mkdir(outsideMetadata, { recursive: true })
      await fs.symlink(outsideMetadata, join(col1Dir, '.markdownvdb'), 'dir')

      await expect(saveTableView('col1', 'blog', makeView('v1', 'Unsafe'))).rejects.toThrow(
        /outside the collection/
      )
      await expect(fs.access(join(outsideMetadata, 'table-views.json'))).rejects.toThrow()
    }
  )

  it('migrates legacy electron-store views into the collection file on first read', async () => {
    backing.tableViews = {
      col1: { blog: [makeView('legacy', 'From app store')] },
      col2: { docs: [makeView('other', 'Untouched')] }
    }

    const views = await listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('From app store')

    // Written to the vault file; legacy entry for col1 cleared, col2 kept.
    const parsed = JSON.parse(await fs.readFile(viewsFile(col1Dir), 'utf-8'))
    expect(parsed.folders.blog[0].id).toBe('legacy')
    const legacy = backing.tableViews as Record<string, unknown>
    expect(legacy.col1).toBeUndefined()
    expect(legacy.col2).toBeDefined()
  })

  it('never publishes malformed legacy saved views', async () => {
    backing.tableViews = {
      col1: { blog: [{ id: 'missing-name' }] }
    }
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await listTableViews('col1', 'blog')).toEqual([])
    await expect(saveTableView('col1', 'blog', makeView('new', 'New'))).rejects.toThrow(
      /refusing to overwrite/
    )
    await expect(fs.access(viewsFile(col1Dir))).rejects.toThrow()
    expect((backing.tableViews as Record<string, unknown>).col1).toBeDefined()
    warning.mockRestore()
  })

  it('migrates a malformed/partial stored view (defaults config + bumps version)', async () => {
    backing.tableViews = {
      col1: {
        blog: [
          {
            id: 'old',
            name: 'Legacy',
            version: 0,
            // config missing keys entirely
            config: { sort: [{ columnName: 'date', direction: 'asc' }] },
            recursive: undefined,
            createdAt: 5
          }
        ]
      }
    }
    const views = await listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    const v = views[0]
    expect(v.version).toBe(CURRENT_VIEW_VERSION)
    expect(v.config.filters).toEqual([])
    expect(v.config.columns).toEqual([])
    expect(v.config.groupBy).toBeNull()
    expect(v.config.collapsedGroups).toEqual([])
    expect(v.config.sort).toEqual([{ columnName: 'date', direction: 'asc' }])
    expect(v.recursive).toBe(false)
    expect(typeof v.updatedAt).toBe('number')

    const persisted = JSON.parse(await fs.readFile(viewsFile(col1Dir), 'utf-8'))
    expect(persisted.folders.blog[0]).toEqual(v)
  })

  it('treats invalid UTF-8 as corrupt and preserves the raw bytes', async () => {
    await fs.mkdir(join(col1Dir, '.markdownvdb'), { recursive: true })
    const corrupt = Buffer.concat([
      Buffer.from('{"version":1,"folders":{"blog":[{"id":"v1","name":"'),
      Buffer.from([0xff]),
      Buffer.from('"}]}}')
    ])
    await fs.writeFile(viewsFile(col1Dir), corrupt)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await listTableViews('col1', 'blog')).toEqual([])
    await expect(saveTableView('col1', 'blog', makeView('new', 'New'))).rejects.toThrow(
      /invalid UTF-8/
    )
    expect((await fs.readFile(viewsFile(col1Dir))).equals(corrupt)).toBe(true)
    warning.mockRestore()
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['invalid shape', '{"version":1,"folders":[]}'],
    ['future version', '{"version":999,"folders":{}}']
  ])('renders %s as empty but refuses to overwrite its exact bytes', async (_label, corrupt) => {
    await fs.mkdir(join(col1Dir, '.markdownvdb'), { recursive: true })
    await fs.writeFile(viewsFile(col1Dir), corrupt, 'utf-8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await listTableViews('col1', 'blog')).toEqual([])
    await expect(saveTableView('col1', 'blog', makeView('v1', 'Fresh'))).rejects.toThrow(
      /refusing to overwrite/
    )
    expect(await fs.readFile(viewsFile(col1Dir), 'utf-8')).toBe(corrupt)
    warning.mockRestore()
  })

  it('throws for an unknown collection', async () => {
    await expect(listTableViews('nope', 'blog')).rejects.toThrow('Unknown collection')
  })

  it('cleanup clears only legacy app-store data — the vault file stays (shared)', async () => {
    await saveTableView('col1', 'blog', makeView('v1', 'A'))
    backing.tableViews = { col1: { old: [makeView('x', 'Old')] } }

    cleanupCollectionTableViews('col1')

    expect((backing.tableViews as Record<string, unknown>).col1).toBeUndefined()
    // The collection file is untouched — views travel with the vault.
    expect(await listTableViews('col1', 'blog')).toHaveLength(1)
  })
})
