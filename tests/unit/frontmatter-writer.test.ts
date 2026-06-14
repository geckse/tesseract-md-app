import { describe, it, expect, vi } from 'vitest'

// Avoid loading electron-store (and electron) via './store'; the pure
// applyFrontmatterPatch never uses getCollections.
vi.mock('../../src/main/store', () => ({
  getCollections: () => []
}))

import {
  applyFrontmatterPatch,
  splitDocument,
  MalformedFrontmatterError
} from '../../src/main/frontmatter'

describe('splitDocument', () => {
  it('detects no frontmatter', () => {
    const r = splitDocument('# Hello\nbody')
    expect(r.hasFrontmatter).toBe(false)
    expect(r.body).toBe('# Hello\nbody')
  })

  it('detects a closed frontmatter block', () => {
    const r = splitDocument('---\ntitle: A\n---\nbody')
    expect(r.hasFrontmatter).toBe(true)
    expect(r.closed).toBe(true)
    expect(r.block).toBe('title: A')
    expect(r.body).toBe('body')
  })

  it('flags an unclosed leading --- as not closed', () => {
    const r = splitDocument('---\ntitle: A\nbody with no close')
    expect(r.hasFrontmatter).toBe(true)
    expect(r.closed).toBe(false)
  })
})

describe('applyFrontmatterPatch', () => {
  it('sets a scalar on existing frontmatter, body preserved', () => {
    const input = '---\ntitle: A\nstatus: draft\n---\n\n# Body\n'
    const { content, frontmatter } = applyFrontmatterPatch(input, {
      set: { status: 'published' }
    })
    expect(frontmatter).toEqual({ title: 'A', status: 'published' })
    expect(content).toContain('status: published')
    expect(content.endsWith('\n\n# Body\n')).toBe(true)
  })

  it('writes a number as an unquoted YAML number', () => {
    const { content, frontmatter } = applyFrontmatterPatch('---\ntitle: A\n---\nbody', {
      set: { count: 5 }
    })
    expect(frontmatter.count).toBe(5)
    expect(content).toMatch(/count: 5(\n|$)/)
    expect(content).not.toContain('count: "5"')
    expect(content).not.toContain("count: '5'")
  })

  it('writes a boolean as an unquoted YAML boolean', () => {
    const { content, frontmatter } = applyFrontmatterPatch('---\ntitle: A\n---\nbody', {
      set: { draft: true }
    })
    expect(frontmatter.draft).toBe(true)
    expect(content).toMatch(/draft: true(\n|$)/)
  })

  it('writes a date as an explicitly quoted string (not a timestamp)', () => {
    const { content, frontmatter } = applyFrontmatterPatch('---\ntitle: A\n---\nbody', {
      set: { date: '2024-01-15' }
    })
    expect(content).toContain('date: "2024-01-15"')
    // Round-trips as a string, not a Date.
    expect(frontmatter.date).toBe('2024-01-15')
    expect(typeof frontmatter.date).toBe('string')
  })

  it('writes a list as a block sequence and round-trips it', () => {
    const { content, frontmatter } = applyFrontmatterPatch('---\ntitle: A\n---\nbody', {
      set: { tags: ['news', 'rust'] }
    })
    expect(frontmatter.tags).toEqual(['news', 'rust'])
    expect(content).toContain('- news')
    expect(content).toContain('- rust')
  })

  it('unsets a key', () => {
    const { content, frontmatter } = applyFrontmatterPatch(
      '---\ntitle: A\nstatus: draft\n---\nbody',
      { unset: ['status'] }
    )
    expect(frontmatter).toEqual({ title: 'A' })
    expect(content).not.toContain('status:')
  })

  it('keeps the body byte-identical after an edit', () => {
    const body = '\nLine 1\n\nLine 2 with **bold**\n- item\n'
    const input = `---\ntitle: A\n---${body}`
    const { content } = applyFrontmatterPatch(input, { set: { status: 'x' } })
    expect(content.endsWith(body)).toBe(true)
  })

  it('preserves CRLF line endings', () => {
    const input = '---\r\ntitle: A\r\n---\r\n\r\nBody\r\n'
    const { content } = applyFrontmatterPatch(input, { set: { status: 'live' } })
    expect(content).toContain('\r\n')
    // No bare \n that isn't part of a \r\n.
    expect(/[^\r]\n/.test(content)).toBe(false)
    expect(content).toContain('status: live')
  })

  it('preserves the absence of a trailing newline', () => {
    const input = '---\ntitle: A\n---\nBody no newline'
    const { content } = applyFrontmatterPatch(input, { set: { status: 'x' } })
    expect(content.endsWith('Body no newline')).toBe(true)
    expect(content.endsWith('\n')).toBe(false)
  })

  it('synthesizes a frontmatter block only when there is no leading ---', () => {
    const input = '# Just a body\nno frontmatter here\n'
    const { content, frontmatter } = applyFrontmatterPatch(input, { set: { title: 'New' } })
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('title: New')
    expect(content.endsWith('# Just a body\nno frontmatter here\n')).toBe(true)
    expect(frontmatter).toEqual({ title: 'New' })
  })

  it('refuses to write when the existing frontmatter is malformed YAML', () => {
    const input = '---\ntitle: "unterminated\n---\nbody'
    expect(() => applyFrontmatterPatch(input, { set: { status: 'x' } })).toThrow(
      MalformedFrontmatterError
    )
  })

  it('refuses to write when a leading --- has no closing delimiter', () => {
    const input = '---\ntitle: A\nbody with no closing delimiter'
    expect(() => applyFrontmatterPatch(input, { set: { status: 'x' } })).toThrow(
      MalformedFrontmatterError
    )
  })

  it('treats an empty (---\\n---) block as valid empty frontmatter', () => {
    const input = '---\n---\nbody'
    const { frontmatter, content } = applyFrontmatterPatch(input, { set: { title: 'A' } })
    expect(frontmatter).toEqual({ title: 'A' })
    expect(content).toContain('title: A')
  })

  it('preserves unicode keys and values', () => {
    const input = '---\ntítulo: Café\n---\nbody'
    const { content, frontmatter } = applyFrontmatterPatch(input, { set: { ñame: 'José' } })
    expect(frontmatter['título']).toBe('Café')
    expect(frontmatter['ñame']).toBe('José')
    expect(content).toContain('José')
  })
})
