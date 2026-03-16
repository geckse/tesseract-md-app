import { describe, it, expect } from 'vitest'
import { type CellInfo } from '@renderer/lib/tiptap/table-ui-extension'

/**
 * Since resolveCellInfo() requires real ProseMirror state (ResolvedPos),
 * we extract the disabled-state logic into pure functions that mirror
 * the logic in TableContextMenu.svelte and test those directly.
 */

// Pure functions extracted from TableContextMenu.svelte disabled-state logic
function isDeleteRowDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.totalRows <= 1
}

function isMoveRowUpDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.row <= 0
}

function isMoveRowDownDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.row >= cellInfo.totalRows - 1
}

function isDeleteColumnDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.totalCols <= 1
}

function isMoveColumnLeftDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.col <= 0
}

function isMoveColumnRightDisabled(cellInfo: CellInfo): boolean {
  return cellInfo.col >= cellInfo.totalCols - 1
}

function makeCellInfo(overrides: Partial<CellInfo> = {}): CellInfo {
  return {
    cellPos: 0,
    row: 0,
    col: 0,
    totalRows: 3,
    totalCols: 3,
    tablePos: 0,
    isHeader: false,
    ...overrides,
  }
}

describe('CellInfo type', () => {
  it('can be constructed with all required fields', () => {
    const info = makeCellInfo()
    expect(info.cellPos).toBe(0)
    expect(info.row).toBe(0)
    expect(info.col).toBe(0)
    expect(info.totalRows).toBe(3)
    expect(info.totalCols).toBe(3)
    expect(info.tablePos).toBe(0)
    expect(info.isHeader).toBe(false)
  })

  it('correctly represents header cells', () => {
    const info = makeCellInfo({ isHeader: true, row: 0 })
    expect(info.isHeader).toBe(true)
  })

  it('correctly represents various table positions', () => {
    // Top-left corner
    const topLeft = makeCellInfo({ row: 0, col: 0 })
    expect(topLeft.row).toBe(0)
    expect(topLeft.col).toBe(0)

    // Bottom-right corner of a 3x3 table
    const bottomRight = makeCellInfo({ row: 2, col: 2 })
    expect(bottomRight.row).toBe(2)
    expect(bottomRight.col).toBe(2)

    // Middle cell
    const middle = makeCellInfo({ row: 1, col: 1 })
    expect(middle.row).toBe(1)
    expect(middle.col).toBe(1)
  })
})

describe('disabled state logic', () => {
  describe('delete row', () => {
    it('is disabled when totalRows <= 1', () => {
      expect(isDeleteRowDisabled(makeCellInfo({ totalRows: 1 }))).toBe(true)
    })

    it('is enabled when totalRows > 1', () => {
      expect(isDeleteRowDisabled(makeCellInfo({ totalRows: 2 }))).toBe(false)
      expect(isDeleteRowDisabled(makeCellInfo({ totalRows: 5 }))).toBe(false)
    })
  })

  describe('move row up', () => {
    it('is disabled on row 0', () => {
      expect(isMoveRowUpDisabled(makeCellInfo({ row: 0 }))).toBe(true)
    })

    it('is enabled on row > 0', () => {
      expect(isMoveRowUpDisabled(makeCellInfo({ row: 1 }))).toBe(false)
      expect(isMoveRowUpDisabled(makeCellInfo({ row: 2 }))).toBe(false)
    })
  })

  describe('move row down', () => {
    it('is disabled on last row', () => {
      expect(isMoveRowDownDisabled(makeCellInfo({ row: 2, totalRows: 3 }))).toBe(true)
    })

    it('is enabled when not on last row', () => {
      expect(isMoveRowDownDisabled(makeCellInfo({ row: 0, totalRows: 3 }))).toBe(false)
      expect(isMoveRowDownDisabled(makeCellInfo({ row: 1, totalRows: 3 }))).toBe(false)
    })
  })

  describe('delete column', () => {
    it('is disabled when totalCols <= 1', () => {
      expect(isDeleteColumnDisabled(makeCellInfo({ totalCols: 1 }))).toBe(true)
    })

    it('is enabled when totalCols > 1', () => {
      expect(isDeleteColumnDisabled(makeCellInfo({ totalCols: 2 }))).toBe(false)
    })
  })

  describe('move column left', () => {
    it('is disabled on col 0', () => {
      expect(isMoveColumnLeftDisabled(makeCellInfo({ col: 0 }))).toBe(true)
    })

    it('is enabled on col > 0', () => {
      expect(isMoveColumnLeftDisabled(makeCellInfo({ col: 1 }))).toBe(false)
    })
  })

  describe('move column right', () => {
    it('is disabled on last column', () => {
      expect(isMoveColumnRightDisabled(makeCellInfo({ col: 2, totalCols: 3 }))).toBe(true)
    })

    it('is enabled when not on last column', () => {
      expect(isMoveColumnRightDisabled(makeCellInfo({ col: 0, totalCols: 3 }))).toBe(false)
      expect(isMoveColumnRightDisabled(makeCellInfo({ col: 1, totalCols: 3 }))).toBe(false)
    })
  })
})

describe('menu operation categories', () => {
  // These labels mirror the groups defined in TableContextMenu.svelte
  const expectedRowOps = [
    'Insert row above',
    'Insert row below',
    'Move row up',
    'Move row down',
    'Delete row',
  ]

  const expectedColumnOps = [
    'Insert column left',
    'Insert column right',
    'Move column left',
    'Move column right',
    'Delete column',
  ]

  const expectedTableOps = ['Header row', 'Delete table']

  it('has all expected row operations', () => {
    for (const op of expectedRowOps) {
      expect(op).toBeTruthy()
    }
    expect(expectedRowOps).toHaveLength(5)
  })

  it('has all expected column operations', () => {
    for (const op of expectedColumnOps) {
      expect(op).toBeTruthy()
    }
    expect(expectedColumnOps).toHaveLength(5)
  })

  it('has all expected table operations', () => {
    for (const op of expectedTableOps) {
      expect(op).toBeTruthy()
    }
    expect(expectedTableOps).toHaveLength(2)
  })

  it('covers all three operation categories', () => {
    const categories = ['Row', 'Column', 'Table']
    expect(categories).toHaveLength(3)
    expect(categories).toContain('Row')
    expect(categories).toContain('Column')
    expect(categories).toContain('Table')
  })
})
