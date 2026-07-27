import { describe, expect, it } from 'vitest'
import {
  formatFileReference,
  isFileReference,
  isFileReferenceValue,
  parseFileReference
} from '../../src/shared/file-reference'

describe('file frontmatter references', () => {
  it('parses whole-value wiki and Markdown links to non-Markdown files', () => {
    expect(parseFileReference('[[assets/mockup.png]]')).toBe('assets/mockup.png')
    expect(parseFileReference('[spec](documents/spec.pdf)')).toBe('documents/spec.pdf')
    expect(isFileReference('[[assets/mockup.png]]')).toBe(true)
  })

  it('rejects Markdown, external, absolute, and escaping paths', () => {
    expect(parseFileReference('[[notes/readme.md]]')).toBeNull()
    expect(parseFileReference('[site](https://example.com/a.pdf)')).toBeNull()
    expect(parseFileReference('[[../outside.png]]')).toBeNull()
    expect(parseFileReference('[[/tmp/outside.png]]')).toBeNull()
  })

  it('allows explicit legacy extensionless values without inferring them', () => {
    expect(parseFileReference('assets/LICENSE', true)).toBe('assets/LICENSE')
    expect(parseFileReference('[[assets/LICENSE]]')).toBe('assets/LICENSE')
    expect(isFileReference('[[assets/LICENSE]]')).toBe(false)
  })

  it('classifies scalar and homogeneous list values consistently', () => {
    expect(isFileReferenceValue('[[assets/mockup.png]]')).toBe(true)
    expect(isFileReferenceValue(['[[assets/mockup.png]]', '[[documents/spec.pdf]]'])).toBe(true)
    expect(isFileReferenceValue([])).toBe(false)
    expect(isFileReferenceValue(['[[assets/mockup.png]]', '[[notes/readme.md]]'])).toBe(false)
    expect(isFileReferenceValue(['[[assets/mockup.png]]', 42])).toBe(false)
  })

  it('formats canonical root-relative wikilinks', () => {
    expect(formatFileReference('./assets\\mockup.png')).toBe('[[assets/mockup.png]]')
  })
})
