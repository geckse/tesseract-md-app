import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory backing store, mocked in place of electron-store.
let backing: Record<string, unknown> = {}
const fakeStore = {
  get: (key: string, def: unknown) => (key in backing ? backing[key] : def),
  set: (key: string, value: unknown) => {
    backing[key] = value
  }
}

vi.mock('../../src/main/store', () => ({
  initStore: () => fakeStore
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

describe('table-views (main process)', () => {
  beforeEach(() => {
    backing = {}
  })

  it('saves and lists views per collection + folder', () => {
    saveTableView('col1', 'blog', makeView('v1', 'By date'))
    const views = listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('By date')
    // Isolated by folder + collection.
    expect(listTableViews('col1', 'docs')).toHaveLength(0)
    expect(listTableViews('col2', 'blog')).toHaveLength(0)
  })

  it('upserts by id (save replaces an existing view)', () => {
    saveTableView('col1', 'blog', makeView('v1', 'Original'))
    saveTableView('col1', 'blog', { ...makeView('v1', 'Renamed'), recursive: true })
    const views = listTableViews('col1', 'blog')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('Renamed')
    expect(views[0].recursive).toBe(true)
  })

  it('updateTableView behaves as an upsert', () => {
    updateTableView('col1', 'blog', makeView('v1', 'A'))
    updateTableView('col1', 'blog', makeView('v2', 'B'))
    expect(listTableViews('col1', 'blog')).toHaveLength(2)
  })

  it('deletes a view by id', () => {
    saveTableView('col1', 'blog', makeView('v1', 'A'))
    saveTableView('col1', 'blog', makeView('v2', 'B'))
    const remaining = deleteTableView('col1', 'blog', 'v1')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('v2')
  })

  it('setDefault marks exactly one view as default', () => {
    saveTableView('col1', 'blog', makeView('v1', 'A'))
    saveTableView('col1', 'blog', makeView('v2', 'B'))
    setDefaultTableView('col1', 'blog', 'v2')
    const views = listTableViews('col1', 'blog')
    expect(views.find((v) => v.id === 'v1')?.isDefault).toBe(false)
    expect(views.find((v) => v.id === 'v2')?.isDefault).toBe(true)
  })

  it('migrates a malformed/partial stored view (defaults config + bumps version)', () => {
    // Seed a legacy/partial view directly into the backing store.
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
    const views = listTableViews('col1', 'blog')
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

  it('cleanupCollectionTableViews removes all of a collection’s views', () => {
    saveTableView('col1', 'blog', makeView('v1', 'A'))
    saveTableView('col1', 'docs', makeView('v2', 'B'))
    saveTableView('col2', 'blog', makeView('v3', 'C'))
    cleanupCollectionTableViews('col1')
    expect(listTableViews('col1', 'blog')).toHaveLength(0)
    expect(listTableViews('col1', 'docs')).toHaveLength(0)
    expect(listTableViews('col2', 'blog')).toHaveLength(1)
  })
})
