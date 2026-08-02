import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/store', () => ({
  getCollections: () => []
}))

import {
  applyFrontmatterPatch,
  assertRenderedFrontmatterPatchInvariant,
  FrontmatterInvariantError
} from '../../src/main/frontmatter'

describe('rendered frontmatter patch invariant', () => {
  it('rejects a rendered patch that drops all unrelated frontmatter', () => {
    const original = [
      'title: Keep me',
      'status: draft',
      'Precise Total: 0.3000000000000000000000000001 # exact'
    ].join('\n')
    const rendered = 'status: published\n'

    expect(() =>
      assertRenderedFrontmatterPatchInvariant(original, rendered, {
        set: { status: 'published' }
      })
    ).toThrow(FrontmatterInvariantError)
  })

  it('rejects a semantically incorrect touched value even when untouched bytes are exact', () => {
    const original = 'title: Keep me\nstatus: draft'
    const rendered = 'title: Keep me\nstatus: review\n'

    expect(() =>
      assertRenderedFrontmatterPatchInvariant(original, rendered, {
        set: { status: 'published' }
      })
    ).toThrow(FrontmatterInvariantError)
  })

  it('rejects byte changes to a semantically equivalent untouched pair', () => {
    const original = 'title: Keep me\nstatus: draft'
    const rendered = 'title: "Keep me"\nstatus: published\n'

    expect(() =>
      assertRenderedFrontmatterPatchInvariant(original, rendered, {
        set: { status: 'published' }
      })
    ).toThrow(FrontmatterInvariantError)
  })

  it('keeps lossless production patches valid', () => {
    const input = [
      '---',
      'title : "Keep me" # exact',
      'status: draft',
      'Precise Total: 0.3000000000000000000000000001 # exact',
      '---',
      'Body'
    ].join('\n')

    const { content, frontmatter } = applyFrontmatterPatch(input, {
      set: { status: 'published' }
    })

    expect(content).toBe(
      [
        '---',
        'title : "Keep me" # exact',
        'status: published',
        'Precise Total: 0.3000000000000000000000000001 # exact',
        '---',
        'Body'
      ].join('\n')
    )
    expect(frontmatter).toEqual({
      title: 'Keep me',
      status: 'published',
      'Precise Total': 0.3
    })
  })
})
