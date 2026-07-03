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
  saveTableView,
  updateTableView,
  deleteTableView,
  setDefaultTableView,
  cleanupCollectionTableViews,
  CURRENT_VIEW_VERSION
} from '../../src/main/table-views'
import type { SavedTableView } from '../../src/preload/api'

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

function viewsFile(dir: string): string {
  return join(dir, '.markdownvdb', 'table-views.json')
}

describe('table-views (main process, file-backed)', () => {
  beforeEach(async () => {
    backing = {}
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
  })

  it('starts empty on a corrupt views file without clobbering until the next save', async () => {
    await fs.mkdir(join(col1Dir, '.markdownvdb'), { recursive: true })
    await fs.writeFile(viewsFile(col1Dir), '{not json', 'utf-8')

    expect(await listTableViews('col1', 'blog')).toEqual([])

    await saveTableView('col1', 'blog', makeView('v1', 'Fresh'))
    const parsed = JSON.parse(await fs.readFile(viewsFile(col1Dir), 'utf-8'))
    expect(parsed.folders.blog).toHaveLength(1)
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
