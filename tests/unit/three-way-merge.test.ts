import { describe, it, expect } from 'vitest'
import { threeWayMerge } from '../../src/renderer/lib/three-way-merge'

describe('threeWayMerge', () => {
  it('is a no-op when neither side changed', () => {
    const r = threeWayMerge('a\nb\nc', 'a\nb\nc', 'a\nb\nc')
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('a\nb\nc')
  })

  it('takes the changed side when only one side edited', () => {
    // only ours changed
    let r = threeWayMerge('a\nb\nc', 'a\nB\nc', 'a\nb\nc')
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('a\nB\nc')
    // only theirs changed
    r = threeWayMerge('a\nb\nc', 'a\nb\nc', 'a\nb\nC')
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('a\nb\nC')
  })

  it('composes non-overlapping edits from both sides cleanly', () => {
    // ours edits line 1, theirs edits line 3
    const base = 'one\ntwo\nthree\nfour\nfive'
    const ours = 'ONE\ntwo\nthree\nfour\nfive'
    const theirs = 'one\ntwo\nthree\nFOUR\nfive'
    const r = threeWayMerge(base, ours, theirs)
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('ONE\ntwo\nthree\nFOUR\nfive')
  })

  it('merges an insertion on one side with an edit on another', () => {
    const base = 'title\nbody\nfooter'
    const ours = 'title\nbody\nfooter\nnew line at end'
    const theirs = 'TITLE\nbody\nfooter'
    const r = threeWayMerge(base, ours, theirs)
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('TITLE\nbody\nfooter\nnew line at end')
  })

  it('treats identical edits on both sides as clean', () => {
    const r = threeWayMerge('a\nb\nc', 'a\nBEE\nc', 'a\nBEE\nc')
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('a\nBEE\nc')
  })

  it('conflicts when both sides change the same line differently', () => {
    const r = threeWayMerge('a\nb\nc', 'a\nOURS\nc', 'a\nTHEIRS\nc')
    expect(r.clean).toBe(false)
    expect(r.conflicts).toBe(1)
    expect(r.merged).toContain('<<<<<<<')
    expect(r.merged).toContain('OURS')
    expect(r.merged).toContain('=======')
    expect(r.merged).toContain('THEIRS')
    expect(r.merged).toContain('>>>>>>>')
  })

  it('handles adjacent edits on different lines as clean', () => {
    const base = 'a\nb\nc\nd'
    const ours = 'a\nB\nc\nd' // edits line 2
    const theirs = 'a\nb\nC\nd' // edits line 3 (adjacent)
    const r = threeWayMerge(base, ours, theirs)
    expect(r.clean).toBe(true)
    expect(r.merged).toBe('a\nB\nC\nd')
  })

  it('conflicts on different insertions at the same position', () => {
    const base = 'a\nc'
    const ours = 'a\nOURS\nc'
    const theirs = 'a\nTHEIRS\nc'
    const r = threeWayMerge(base, ours, theirs)
    expect(r.clean).toBe(false)
    expect(r.conflicts).toBe(1)
  })

  it('merges edits at opposite ends of a long document', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
    const base = lines.join('\n')
    const ours = ['HEADER', ...lines.slice(1)].join('\n')
    const theirs = [...lines.slice(0, 49), 'FOOTER'].join('\n')
    const r = threeWayMerge(base, ours, theirs)
    expect(r.clean).toBe(true)
    expect(r.merged.split('\n')[0]).toBe('HEADER')
    expect(r.merged.split('\n')[49]).toBe('FOOTER')
  })

  it('declines to merge documents beyond the size guard', () => {
    const big = Array.from({ length: 3001 }, (_, i) => `l${i}`).join('\n')
    const r = threeWayMerge(big, big, big)
    expect(r.clean).toBe(false)
    expect(r.conflicts).toBe(-1)
  })

  it('uses the provided conflict labels', () => {
    const r = threeWayMerge('x', 'y', 'z', { ours: 'MINE', theirs: 'DISK' })
    expect(r.merged).toContain('<<<<<<< MINE')
    expect(r.merged).toContain('>>>>>>> DISK')
  })
})
