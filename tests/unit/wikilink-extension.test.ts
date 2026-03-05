import { describe, it, expect } from 'vitest'
import { parseWikilinkText, serializeWikilink } from '@renderer/lib/tiptap/wikilink-extension'

describe('parseWikilinkText', () => {
  it('parses simple target', () => {
    expect(parseWikilinkText('[[My Page]]')).toEqual({
      target: 'My Page',
      anchor: null,
      display: null,
    })
  })

  it('parses target with anchor', () => {
    expect(parseWikilinkText('[[My Page#section]]')).toEqual({
      target: 'My Page',
      anchor: 'section',
      display: null,
    })
  })

  it('parses target with display text', () => {
    expect(parseWikilinkText('[[My Page|click here]]')).toEqual({
      target: 'My Page',
      anchor: null,
      display: 'click here',
    })
  })

  it('parses target with anchor and display', () => {
    expect(parseWikilinkText('[[My Page#section|click here]]')).toEqual({
      target: 'My Page',
      anchor: 'section',
      display: 'click here',
    })
  })

  it('handles empty anchor gracefully', () => {
    // [[Page#]] → anchor is empty string, treated as null
    expect(parseWikilinkText('[[Page#]]')).toEqual({
      target: 'Page',
      anchor: null,
      display: null,
    })
  })
})

describe('serializeWikilink', () => {
  it('serializes simple target', () => {
    expect(serializeWikilink({ target: 'My Page', anchor: null, display: null })).toBe(
      '[[My Page]]'
    )
  })

  it('serializes target with anchor', () => {
    expect(serializeWikilink({ target: 'My Page', anchor: 'section', display: null })).toBe(
      '[[My Page#section]]'
    )
  })

  it('serializes target with display', () => {
    expect(serializeWikilink({ target: 'My Page', anchor: null, display: 'click here' })).toBe(
      '[[My Page|click here]]'
    )
  })

  it('serializes target with anchor and display', () => {
    expect(
      serializeWikilink({ target: 'My Page', anchor: 'section', display: 'click here' })
    ).toBe('[[My Page#section|click here]]')
  })
})

describe('round-trip parse/serialize', () => {
  const cases = ['[[Simple]]', '[[Page#anchor]]', '[[Page|display]]', '[[Page#anchor|display]]']

  for (const input of cases) {
    it(`round-trips ${input}`, () => {
      const parsed = parseWikilinkText(input)
      const serialized = serializeWikilink(parsed)
      expect(serialized).toBe(input)
    })
  }
})
