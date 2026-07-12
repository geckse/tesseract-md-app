import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { workspace } from '@renderer/stores/workspace.svelte'
import {
  tableHistory,
  snapshotOf,
  snapshotsEqual,
  type HistoryEntry,
  type CellSnapshot
} from '@renderer/stores/table-history.svelte'

function cellEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    kind: 'cell-edit',
    path: 'blog/a.md',
    column: 'status',
    before: { present: true, value: 'draft' },
    after: { present: true, value: 'published' },
    at: 1,
    ...overrides
  } as HistoryEntry
}

describe('snapshotOf', () => {
  it("normalizes '' / null / undefined to absent (editCell clearing rule)", () => {
    expect(snapshotOf('')).toEqual({ present: false })
    expect(snapshotOf(null)).toEqual({ present: false })
    expect(snapshotOf(undefined)).toEqual({ present: false })
  })

  it('keeps real values, including falsy ones', () => {
    expect(snapshotOf('draft')).toEqual({ present: true, value: 'draft' })
    expect(snapshotOf(0)).toEqual({ present: true, value: 0 })
    expect(snapshotOf(false)).toEqual({ present: true, value: false })
    expect(snapshotOf([])).toEqual({ present: true, value: [] })
  })
})

describe('snapshotsEqual', () => {
  it('deep-compares values (arrays, objects)', () => {
    const a: CellSnapshot = { present: true, value: ['x', 'y'] }
    const b: CellSnapshot = { present: true, value: ['x', 'y'] }
    const c: CellSnapshot = { present: true, value: ['x'] }
    expect(snapshotsEqual(a, b)).toBe(true)
    expect(snapshotsEqual(a, c)).toBe(false)
    expect(snapshotsEqual({ present: false }, { present: false })).toBe(true)
    expect(snapshotsEqual({ present: false }, { present: true, value: '' })).toBe(false)
  })
})

describe('tableHistory', () => {
  beforeEach(() => {
    workspace.reset()
    tableHistory.drop('t1')
    tableHistory.drop('t2')
    tableHistory.clearReveal()
  })

  it('starts empty', () => {
    expect(tableHistory.canUndo('t1')).toBe(false)
    expect(tableHistory.canRedo('t1')).toBe(false)
    expect(tableHistory.popUndo('t1')).toBeNull()
    expect(tableHistory.popRedo('t1')).toBeNull()
  })

  it('record pushes onto undo and flips canUndo', () => {
    tableHistory.record('t1', cellEntry())
    expect(tableHistory.canUndo('t1')).toBe(true)
    expect(tableHistory.canUndo('t2')).toBe(false)
  })

  it('record clears the redo stack', () => {
    tableHistory.record('t1', cellEntry({ at: 1 }))
    const popped = tableHistory.popUndo('t1')!
    tableHistory.pushRedoRaw('t1', popped)
    expect(tableHistory.canRedo('t1')).toBe(true)

    tableHistory.record('t1', cellEntry({ at: 2 }))
    expect(tableHistory.canRedo('t1')).toBe(false)
  })

  it('caps the undo stack at 100 dropping the oldest', () => {
    for (let i = 0; i < 110; i++) {
      tableHistory.record('t1', cellEntry({ at: i }))
    }
    const seen: number[] = []
    let e = tableHistory.popUndo('t1')
    while (e) {
      seen.push(e.at)
      e = tableHistory.popUndo('t1')
    }
    expect(seen).toHaveLength(100)
    expect(seen[0]).toBe(109) // newest first
    expect(seen[99]).toBe(10) // 0..9 dropped
  })

  it('popUndo → pushRedoRaw round-trips the exact entry without clearing undo', () => {
    tableHistory.record('t1', cellEntry({ at: 1 }))
    tableHistory.record('t1', cellEntry({ at: 2 }))

    const popped = tableHistory.popUndo('t1')!
    expect(popped.at).toBe(2)
    tableHistory.pushRedoRaw('t1', popped)

    expect(tableHistory.canUndo('t1')).toBe(true) // entry at:1 remains
    expect(tableHistory.popRedo('t1')).toEqual(popped)
  })

  it('pushUndoRaw does not clear redo (redo replays keep the chain)', () => {
    tableHistory.record('t1', cellEntry({ at: 1 }))
    const popped = tableHistory.popUndo('t1')!
    tableHistory.pushRedoRaw('t1', popped)

    const redone = tableHistory.popRedo('t1')!
    tableHistory.pushRedoRaw('t1', cellEntry({ at: 99 }))
    tableHistory.pushUndoRaw('t1', redone)

    expect(tableHistory.canUndo('t1')).toBe(true)
    expect(tableHistory.canRedo('t1')).toBe(true)
  })

  it('clearRedo empties only the redo stack', () => {
    tableHistory.record('t1', cellEntry({ at: 1 }))
    tableHistory.record('t1', cellEntry({ at: 2 }))
    tableHistory.pushRedoRaw('t1', tableHistory.popUndo('t1')!)

    tableHistory.clearRedo('t1')
    expect(tableHistory.canRedo('t1')).toBe(false)
    expect(tableHistory.canUndo('t1')).toBe(true)
  })

  it('drop removes both stacks', () => {
    tableHistory.record('t1', cellEntry())
    tableHistory.pushRedoRaw('t1', cellEntry())
    tableHistory.drop('t1')
    expect(tableHistory.canUndo('t1')).toBe(false)
    expect(tableHistory.canRedo('t1')).toBe(false)
  })

  it('drops history when its table tab is closed', () => {
    const tabId = workspace.openTableTab('blog')
    tableHistory.record(tabId, cellEntry())
    expect(tableHistory.canUndo(tabId)).toBe(true)

    workspace.closeTab(tabId)
    expect(tableHistory.canUndo(tabId)).toBe(false)
  })

  describe('notice', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('is scoped per tab and auto-expires', () => {
      tableHistory.setNotice('t1', 'Undo skipped')
      expect(tableHistory.noticeFor('t1')?.message).toBe('Undo skipped')
      expect(tableHistory.noticeFor('t2')).toBeNull()

      vi.advanceTimersByTime(4100)
      expect(tableHistory.noticeFor('t1')).toBeNull()
    })

    it('a newer notice replaces the old one and re-arms the timer', () => {
      tableHistory.setNotice('t1', 'first')
      vi.advanceTimersByTime(3000)
      tableHistory.setNotice('t1', 'second')
      vi.advanceTimersByTime(3000) // first timer would have fired by now
      expect(tableHistory.noticeFor('t1')?.message).toBe('second')
      vi.advanceTimersByTime(1100)
      expect(tableHistory.noticeFor('t1')).toBeNull()
    })
  })

  describe('reveal', () => {
    it('increments the token so repeated reveals of the same cell re-trigger', () => {
      tableHistory.requestReveal('t1', 'blog/a.md', 'status')
      const first = tableHistory.reveal!
      tableHistory.requestReveal('t1', 'blog/a.md', 'status')
      const second = tableHistory.reveal!
      expect(second.token).toBeGreaterThan(first.token)
      expect(second.path).toBe('blog/a.md')
      expect(second.column).toBe('status')

      tableHistory.clearReveal()
      expect(tableHistory.reveal).toBeNull()
    })
  })
})
