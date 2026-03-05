import { describe, it, expect } from 'vitest'
import {
  splitFrontmatter,
  joinFrontmatter,
  parseFrontmatterData,
  serializeFrontmatter,
} from '../markdown-bridge'

describe('splitFrontmatter', () => {
  it('extracts frontmatter and body', () => {
    const content = '---\ntitle: Hello\n---\n# Body'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBe('title: Hello')
    expect(result.body).toBe('# Body')
  })

  it('returns null frontmatter when none exists', () => {
    const content = '# Just a heading'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe('# Just a heading')
  })

  it('returns null frontmatter for unclosed delimiters', () => {
    const content = '---\ntitle: Hello\n# No closing'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe(content)
  })

  it('returns null frontmatter for empty block', () => {
    const content = '---\n---\n# Body'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe('# Body')
  })
})

describe('joinFrontmatter', () => {
  it('joins frontmatter and body', () => {
    expect(joinFrontmatter('title: Hello', '# Body')).toBe('---\ntitle: Hello\n---\n# Body')
  })

  it('returns body only when frontmatter is null', () => {
    expect(joinFrontmatter(null, '# Body')).toBe('# Body')
  })
})

describe('parseFrontmatterData', () => {
  it('parses string values', () => {
    const data = parseFrontmatterData('title: Hello World')
    expect(data.title).toBe('Hello World')
  })

  it('parses boolean values', () => {
    const data = parseFrontmatterData('draft: true\npublished: false')
    expect(data.draft).toBe(true)
    expect(data.published).toBe(false)
  })

  it('parses numeric values', () => {
    const data = parseFrontmatterData('count: 42\nrating: 3.5')
    expect(data.count).toBe(42)
    expect(data.rating).toBe(3.5)
  })

  it('parses inline arrays', () => {
    const data = parseFrontmatterData('tags: [a, b, c]')
    expect(data.tags).toEqual(['a', 'b', 'c'])
  })

  it('parses block arrays', () => {
    const data = parseFrontmatterData('tags:\n  - one\n  - two')
    expect(data.tags).toEqual(['one', 'two'])
  })

  it('unquotes quoted strings', () => {
    const data = parseFrontmatterData('title: "Hello"')
    expect(data.title).toBe('Hello')
  })

  it('converts empty arrays to empty string', () => {
    const data = parseFrontmatterData('empty:')
    expect(data.empty).toBe('')
  })
})

describe('serializeFrontmatter', () => {
  it('serializes simple values', () => {
    const yaml = serializeFrontmatter({ title: 'Hello', count: 42, draft: true })
    expect(yaml).toContain('title: Hello')
    expect(yaml).toContain('count: 42')
    expect(yaml).toContain('draft: true')
  })

  it('serializes arrays as block style', () => {
    const yaml = serializeFrontmatter({ tags: ['a', 'b'] })
    expect(yaml).toBe('tags:\n  - a\n  - b')
  })

  it('serializes empty arrays', () => {
    const yaml = serializeFrontmatter({ tags: [] })
    expect(yaml).toBe('tags:')
  })

  it('quotes ambiguous string values', () => {
    const yaml = serializeFrontmatter({ val: 'true', num: '42' })
    expect(yaml).toContain('val: "true"')
    expect(yaml).toContain('num: "42"')
  })
})

describe('roundtrip', () => {
  it('split then join preserves content', () => {
    const original = '---\ntitle: Test\ntags:\n  - a\n  - b\n---\n# Hello\n\nWorld'
    const { frontmatter, body } = splitFrontmatter(original)
    const reassembled = joinFrontmatter(frontmatter, body)
    expect(reassembled).toBe(original)
  })
})
