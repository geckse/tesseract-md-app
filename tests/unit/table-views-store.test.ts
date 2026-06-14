import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  degradeViewConfig,
  tableViewsStore,
  TITLE_COLUMN
} from '@renderer/stores/table-views.svelte'
import type { SavedTableView, TableViewConfig } from '../../src/preload/api'

describe('degradeViewConfig', () => {
  const config: TableViewConfig = {
    sort: [
      { columnName: 'date', direction: 'asc' },
      { columnName: 'ghost', direction: 'desc' }
    ],
    filters: [
      { columnName: 'status', op: 'equals', value: 'published' },
      { columnName: 'ghost', op: 'exists' }
    ],
    columns: [
      { name: TITLE_COLUMN, hidden: false, width: 240, order: 0 },
      { name: 'date', hidden: false, width: 120, order: 1 },
      { name: 'ghost', hidden: true, width: 100, order: 2 }
    ],
    groupBy: 'ghost',
    collapsedGroups: ['x']
  }

  it('drops references to columns absent from the live set', () => {
    const valid = new Set(['date', 'status'])
    const out = degradeViewConfig(config, valid)
    expect(out.sort.map((s) => s.columnName)).toEqual(['date'])
    expect(out.filters.map((f) => f.columnName)).toEqual(['status'])
    // Title column is always retained.
    expect(out.columns.map((c) => c.name)).toEqual([TITLE_COLUMN, 'date'])
    expect(out.groupBy).toBeNull() // 'ghost' no longer exists
    expect(out.collapsedGroups).toEqual(['x']) // group values are preserved
  })

  it('keeps everything when all columns are valid', () => {
    const valid = new Set(['date', 'status', 'ghost'])
    const out = degradeViewConfig(config, valid)
    expect(out.sort).toHaveLength(2)
    expect(out.groupBy).toBe('ghost')
  })
})

describe('tableViewsStore (renderer)', () => {
  let mockApi: {
    listTableViews: ReturnType<typeof vi.fn>
    saveTableView: ReturnType<typeof vi.fn>
    deleteTableView: ReturnType<typeof vi.fn>
    setDefaultTableView: ReturnType<typeof vi.fn>
  }

  function view(id: string, isDefault = false): SavedTableView {
    return {
      id,
      name: id,
      version: 1,
      config: { sort: [], filters: [], columns: [], groupBy: null, collapsedGroups: [] },
      recursive: false,
      isDefault,
      createdAt: 1,
      updatedAt: 1
    }
  }

  beforeEach(() => {
    mockApi = {
      listTableViews: vi.fn().mockResolvedValue([view('v1'), view('v2', true)]),
      saveTableView: vi.fn().mockResolvedValue([view('v1')]),
      deleteTableView: vi.fn().mockResolvedValue([]),
      setDefaultTableView: vi.fn().mockResolvedValue([view('v1', true)])
    }
    Object.defineProperty(globalThis, 'window', { value: { api: mockApi }, configurable: true })
  })

  it('load() caches views and exposes them by collection + folder', async () => {
    await tableViewsStore.load('c1', 'blog')
    expect(mockApi.listTableViews).toHaveBeenCalledWith('c1', 'blog')
    expect(tableViewsStore.getViews('c1', 'blog').map((v) => v.id)).toEqual(['v1', 'v2'])
    expect(tableViewsStore.getDefault('c1', 'blog')?.id).toBe('v2')
    expect(tableViewsStore.getById('c1', 'blog', 'v1')?.id).toBe('v1')
  })

  it('save() persists via the API and updates the cache', async () => {
    await tableViewsStore.save('c1', 'blog', view('v1'))
    expect(mockApi.saveTableView).toHaveBeenCalled()
    expect(tableViewsStore.getViews('c1', 'blog').map((v) => v.id)).toEqual(['v1'])
  })

  it('remove() clears the cache for the folder', async () => {
    await tableViewsStore.load('c1', 'blog')
    await tableViewsStore.remove('c1', 'blog', 'v1')
    expect(mockApi.deleteTableView).toHaveBeenCalledWith('c1', 'blog', 'v1')
    expect(tableViewsStore.getViews('c1', 'blog')).toEqual([])
  })
})
