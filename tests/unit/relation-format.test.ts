import { describe, it, expect } from 'vitest'
import {
  parseLinkShaped,
  isLinkShaped,
  relationKey,
  coerceRelationFilterValue,
  formatRelationValue,
  relationBasename,
  fallbackChipText
} from '@renderer/lib/relation-format'

describe('parseLinkShaped (whole-value predicate, mirrors the CLI)', () => {
  it('parses wiki links with and without alias', () => {
    expect(parseLinkShaped('[[clients/acme]]')).toEqual({
      target: 'clients/acme',
      text: 'clients/acme',
      isWikilink: true
    })
    expect(parseLinkShaped('[[clients/acme|Acme Corp]]')).toEqual({
      target: 'clients/acme',
      text: 'Acme Corp',
      isWikilink: true
    })
  })

  it('parses markdown links and bare .md paths', () => {
    expect(parseLinkShaped('[Acme](clients/acme.md)')).toEqual({
      target: 'clients/acme.md',
      text: 'Acme',
      isWikilink: false
    })
    expect(parseLinkShaped('clients/acme.md')).toEqual({
      target: 'clients/acme.md',
      text: 'clients/acme.md',
      isWikilink: false
    })
  })

  it('is a WHOLE-value predicate — embedded links are not relations', () => {
    expect(isLinkShaped('See [[x]] for details')).toBe(false)
    expect(isLinkShaped('[[a]] and [[b]]')).toBe(false)
    expect(isLinkShaped('[text](a.md) trailing')).toBe(false)
  })

  it('rejects external targets, anchors, plain strings, and malformed input', () => {
    expect(isLinkShaped('[[https://example.com]]')).toBe(false)
    expect(isLinkShaped('[site](https://example.com)')).toBe(false)
    expect(isLinkShaped('[mail](mailto:x@y.com)')).toBe(false)
    expect(isLinkShaped('[sec](#heading)')).toBe(false)
    expect(isLinkShaped('acme')).toBe(false)
    expect(isLinkShaped('some plain.md text')).toBe(false)
    expect(isLinkShaped('[[]]')).toBe(false)
    expect(isLinkShaped('')).toBe(false)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isLinkShaped('  [[clients/acme]]  ')).toBe(true)
  })
})

describe('relationKey (CLI relation_key parity)', () => {
  it('normalizes all three syntaxes to the same key', () => {
    expect(relationKey('[[clients/acme|Acme]]')).toBe('clients/acme')
    expect(relationKey('[[clients/acme#top]]')).toBe('clients/acme')
    expect(relationKey('[Acme](clients/acme.md)')).toBe('clients/acme')
    expect(relationKey('clients/acme.md')).toBe('clients/acme')
    expect(relationKey('[[clients\\acme]]')).toBe('clients/acme')
  })

  it('returns null for non-link values', () => {
    expect(relationKey('plain string')).toBeNull()
    expect(relationKey('acme')).toBeNull()
  })

  it('coerces filter values: normalized when link-shaped, .md stripped otherwise', () => {
    expect(coerceRelationFilterValue('[[clients/acme]]')).toBe('clients/acme')
    expect(coerceRelationFilterValue('clients/acme.md')).toBe('clients/acme')
    expect(coerceRelationFilterValue('clients/acme')).toBe('clients/acme')
    expect(coerceRelationFilterValue('draft')).toBe('draft')
  })
})

describe('formatRelationValue (the ONE commit format)', () => {
  it('writes [[root-relative-path-sans-.md]] with no alias', () => {
    expect(formatRelationValue('clients/acme.md')).toBe('[[clients/acme]]')
    expect(formatRelationValue('clients/acme')).toBe('[[clients/acme]]')
  })
})

describe('display helpers', () => {
  it('relationBasename strips folders and the extension', () => {
    expect(relationBasename('clients/acme.md')).toBe('acme')
    expect(relationBasename('acme.md')).toBe('acme')
    expect(relationBasename('clients/acme')).toBe('acme')
  })

  it('fallbackChipText prefers the alias, then the basename, then the raw value', () => {
    expect(fallbackChipText('[[clients/acme|Acme Corp]]')).toBe('Acme Corp')
    expect(fallbackChipText('[[clients/acme]]')).toBe('acme')
    expect(fallbackChipText('clients/acme.md')).toBe('acme')
    expect(fallbackChipText('not a link')).toBe('not a link')
  })
})
