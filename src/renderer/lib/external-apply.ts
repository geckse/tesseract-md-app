import { diff } from '@codemirror/merge'
import type { ChangeSpec } from '@codemirror/state'

/**
 * Pure helpers for applying externally-changed file content into a live
 * editor as a minimal change set (preserves cursor, scroll, and undo
 * position mapping) instead of a whole-document replace.
 */

/** Above this size, skip the Myers diff and emit one whole-document change. */
export const WHOLE_REPLACE_THRESHOLD = 1024 * 1024

/**
 * Compute a minimal CodeMirror ChangeSpec transforming oldText into newText.
 * Returns an empty array when the texts are identical.
 */
export function computeMinimalChanges(oldText: string, newText: string): ChangeSpec[] {
  if (oldText === newText) return []

  if (oldText.length > WHOLE_REPLACE_THRESHOLD || newText.length > WHOLE_REPLACE_THRESHOLD) {
    return [{ from: 0, to: oldText.length, insert: newText }]
  }

  return diff(oldText, newText).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: newText.slice(change.fromB, change.toB)
  }))
}
