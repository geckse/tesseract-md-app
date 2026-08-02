import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Avoid loading electron-store (and electron) via './store'; the pure
// applyFrontmatterPatch never uses getCollections.
vi.mock('../../src/main/store', () => ({
  getCollections: () => []
}))

import {
  applyFrontmatterPatch,
  splitDocument,
  MalformedFrontmatterError,
  writePatchedFile
} from '../../src/main/frontmatter'
import { clearOwnWrites, matchAndConsumeOwnWrite } from '../../src/main/own-writes'

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

  it('keeps unrelated computed YAML pairs exact during a batch-style unset', () => {
    const precise = 'Precise Total: 0.3000000000000000000000000001 # computed exact'
    const nested = 'computed_payload: {amount: 1.2300000000000000001, tags: [one, two]}'
    const body = '\n# Body\nNever rewrite this.\n'
    const input = `---\nstatus: draft\n${precise}\n${nested}\n---${body}`

    const { content, frontmatter } = applyFrontmatterPatch(input, { unset: ['status'] })

    expect(content).not.toContain('status:')
    expect(content).toContain(`${precise}\n`)
    expect(content).toContain(`${nested}\n`)
    expect(content.match(/Precise Total:/g)).toHaveLength(1)
    expect(content.endsWith(body)).toBe(true)
    expect(frontmatter['Precise Total']).toBe(0.3)
  })

  it('keeps untouched comments, key spacing, nesting, ordering, and footer trivia exact', () => {
    const preserved = [
      '# lookup value: keep this comment exactly',
      '"Client Domain" : "example.com" # inline lookup comment',
      'computed_payload: { amount : 1.2300000000000000001, tags: [one, two] }',
      'nested_rollup:',
      '  totals:',
      '    - 0.1000000000000000001',
      '    - 0.2000000000000000002'
    ].join('\n')
    const footer = '# footer belongs to the mapping\n\n'
    const input = `---\nstatus: draft\n${preserved}\n\n${footer}---\nBody\n`

    const { content } = applyFrontmatterPatch(input, { unset: ['status'] })

    expect(content).toBe(`---\n${preserved}\n\n${footer}---\nBody\n`)
    expect(content.indexOf('Client Domain')).toBeLessThan(content.indexOf('computed_payload'))
    expect(content.indexOf('computed_payload')).toBeLessThan(content.indexOf('nested_rollup'))
  })

  it('inserts a new pair without normalizing an existing footer comment or blank lines', () => {
    const input = '---\ntitle: Safe\n\n# exact footer\n\n---\nBody\n'

    const { content } = applyFrontmatterPatch(input, { set: { priority: 0 } })

    expect(content).toBe('---\ntitle: Safe\npriority: 0\n\n# exact footer\n\n---\nBody\n')
  })

  it('does not treat an indented delimiter inside a block scalar as the closing envelope', () => {
    const description = 'description: |\n  before\n  ---\n  after'
    const input = `---\n${description}\nstatus: draft\n---\nBody\n`

    const { content } = applyFrontmatterPatch(input, { set: { status: 'published' } })

    expect(content).toContain(`${description}\n`)
    expect(content).toContain('status: published\n---\nBody\n')
  })

  it.each(['--- ', '---\t', '--- # comment'])(
    'fails closed when the only apparent closing delimiter is %j',
    (suffixDelimiter) => {
      const input = `---\ntitle: Safe\n${suffixDelimiter}\nBody\n`

      expect(() => applyFrontmatterPatch(input, { unset: ['title'] })).toThrow(
        MalformedFrontmatterError
      )
    }
  )

  it('preserves a closing delimiter at EOF without adding a terminal newline', () => {
    const input = '---\ntitle: A\nstatus: draft\n---'

    const { content } = applyFrontmatterPatch(input, { set: { status: 'published' } })

    expect(content).toBe('---\ntitle: A\nstatus: published\n---')
    expect(content.endsWith('\n')).toBe(false)
  })

  it('preserves a UTF-8 BOM as the single first byte sequence', () => {
    const input = '\uFEFF---\r\ntitle: A\r\nstatus: draft\r\n---\r\nBody\r\n'
    const { content } = applyFrontmatterPatch(input, { unset: ['status'] })

    expect(content.startsWith('\uFEFF---\r\n')).toBe(true)
    expect(content.match(/\uFEFF/g)).toHaveLength(1)
    expect(content.endsWith('---\r\nBody\r\n')).toBe(true)
  })

  it('fails closed on mixed newline styles', () => {
    const input = '---\r\ntitle: A\nstatus: draft\r\n---\r\nBody\n'
    expect(() => applyFrontmatterPatch(input, { unset: ['status'] })).toThrow(
      MalformedFrontmatterError
    )
  })

  it('keeps a frontmatter envelope when removing its final key', () => {
    const input = '---\nonly: value\n---\nBody\n'
    const { content, frontmatter } = applyFrontmatterPatch(input, { unset: ['only'] })

    expect(content).toBe('---\n{}\n---\nBody\n')
    expect(content.split('\n').filter((line) => line === '---')).toHaveLength(2)
    expect(frontmatter).toEqual({})
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

  it('rejects a non-mapping YAML root instead of replacing the whole frontmatter', () => {
    const input = '---\n- one\n- two\n---\nBody\n'
    expect(() => applyFrontmatterPatch(input, { set: { status: 'x' } })).toThrow(
      MalformedFrontmatterError
    )
  })
})

describe('writePatchedFile CAS', () => {
  it('leaves a concurrent source and own-write classification untouched', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'frontmatter-cas-'))
    const path = join(dir, 'note.md')
    const baseline = '---\nstatus: draft\n---\nBaseline\n'
    const concurrent = '---\nstatus: revised\n---\nConcurrent\n'
    await fs.writeFile(path, concurrent, 'utf-8')
    clearOwnWrites()

    try {
      await expect(
        writePatchedFile(path, { unset: ['status'] }, null, {
          expectedContent: baseline,
          collectionRoot: dir
        })
      ).rejects.toThrow(/changed on disk/)
      expect(await fs.readFile(path, 'utf-8')).toBe(concurrent)
      expect(
        matchAndConsumeOwnWrite(path, 'modified', {
          size: Buffer.byteLength(concurrent, 'utf-8')
        })
      ).toBe(false)
    } finally {
      clearOwnWrites()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
