import type { CollectionColumn, JsonValue, RelationValue } from '../../../types/cli'

/**
 * Shared props contract for all data-cell editors.
 *
 * The parent `TableRow` owns which cell is editing and the write path:
 * `oncommit(value)` closes edit mode and persists (`null` unsets the key),
 * `oncancel()` closes edit mode without saving.
 */
export interface CellProps {
  column: CollectionColumn
  value: JsonValue | undefined
  editing: boolean
  /** True for `deleted` rows — the file is gone, cells must not edit. */
  readOnly: boolean
  oncommit: (value: JsonValue | null) => void
  oncancel: () => void
  /** Server-resolved relations for THIS cell = `row.relations?.[column.name]` (phase 42). */
  relations?: RelationValue[]
  /** Collection root — needed by cells that spawn CLI-backed pickers (RelationCell). */
  root?: string
  /** Collection id (recents lookup in the picker); optional. */
  collectionId?: string | null
}

/** Missing / cleared frontmatter values render as an em-dash placeholder. */
export function isEmptyValue(v: JsonValue | undefined): boolean {
  return v === undefined || v === null || v === ''
}

/** Autofocus + select an edit input when it mounts. */
export function autofocus(node: HTMLInputElement): void {
  node.focus()
  node.select?.()
}
