import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection, Transaction } from '@codemirror/state'
import { computeMinimalChanges, WHOLE_REPLACE_THRESHOLD } from '../../src/renderer/lib/external-apply'

/** Apply a computed change set to a doc and return the resulting text. */
function applyChanges(oldText: string, newText: string): string {
  const state = EditorState.create({ doc: oldText })
  const tr = state.update({ changes: computeMinimalChanges(oldText, newText) })
  return tr.newDoc.toString()
}

describe('computeMinimalChanges', () => {
  it('returns no changes for identical text', () => {
    expect(computeMinimalChanges('hello', 'hello')).toEqual([])
  })

  it('round-trips arbitrary edits', () => {
    const cases: [string, string][] = [
      ['line one\nline two\nline three', 'line one\nline TWO\nline three'],
      ['abc', 'axbyc'],
      ['keep\nremove me\nkeep', 'keep\nkeep'],
      ['', 'brand new content'],
      ['old content', ''],
      ['# Title\n\nbody', '# Title\n\nbody\n\nappended paragraph']
    ]
    for (const [oldText, newText] of cases) {
      expect(applyChanges(oldText, newText)).toBe(newText)
    }
  })

  it('preserves a cursor after an edit region via change mapping', () => {
    const oldText = 'line one\nline two\nline three'
    const newText = 'line one\nline two CHANGED\nline three'
    const state = EditorState.create({
      doc: oldText,
      selection: EditorSelection.single(oldText.length) // cursor at very end
    })
    const tr = state.update({ changes: computeMinimalChanges(oldText, newText) })
    // Cursor stays at the end of the document (after the mapped change)
    expect(tr.newSelection.main.head).toBe(newText.length)
  })

  it('does not add to history when dispatched with addToHistory:false', () => {
    const oldText = 'abc'
    const newText = 'abcd'
    const state = EditorState.create({ doc: oldText })
    const tr = state.update({
      changes: computeMinimalChanges(oldText, newText),
      annotations: Transaction.addToHistory.of(false)
    })
    expect(tr.annotation(Transaction.addToHistory)).toBe(false)
    expect(tr.newDoc.toString()).toBe(newText)
  })

  it('falls back to a single whole-document change above the size threshold', () => {
    const oldText = 'x'.repeat(WHOLE_REPLACE_THRESHOLD + 10)
    const newText = 'y'.repeat(WHOLE_REPLACE_THRESHOLD + 10)
    const changes = computeMinimalChanges(oldText, newText)
    expect(changes).toEqual([{ from: 0, to: oldText.length, insert: newText }])
    expect(applyChanges(oldText, newText)).toBe(newText)
  })
})
