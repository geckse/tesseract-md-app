import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

import {
  upsertOverlayField,
  renameOverlayField,
  MalformedOverlayError,
  OVERLAY_FILENAME
} from '../../src/main/schema-overlay'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'schema-overlay-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function readOverlay(): Promise<string> {
  return readFile(join(root, OVERLAY_FILENAME), 'utf-8')
}

describe('upsertOverlayField', () => {
  it('creates the file on demand with a scoped field_type pin', async () => {
    await upsertOverlayField(root, 'knowledge-graph', 'status', { fieldType: 'number' })
    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes['knowledge-graph'].fields.status.field_type).toBe('number')
  })

  it('writes to the global fields section when scopeKey is null', async () => {
    await upsertOverlayField(root, null, 'author', { fieldType: 'string' })
    const parsed = parseYaml(await readOverlay())
    expect(parsed.fields.author.field_type).toBe('string')
    expect(parsed.scopes).toBeUndefined()
  })

  it('preserves comments and sibling entries on update', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      '# my overlay\nscopes:\n  docs:\n    fields:\n      status:\n        field_type: string\n      author:\n        description: Who wrote it\n',
      'utf-8'
    )
    await upsertOverlayField(root, 'docs', 'status', { fieldType: 'number' })
    const raw = await readOverlay()
    expect(raw).toContain('# my overlay')
    const parsed = parseYaml(raw)
    expect(parsed.scopes.docs.fields.status.field_type).toBe('number')
    expect(parsed.scopes.docs.fields.author.description).toBe('Who wrote it')
  })

  it('sets and clears annotations (null clears, undefined leaves untouched)', async () => {
    await upsertOverlayField(root, 'docs', 'status', {
      fieldType: 'string',
      description: 'Review status',
      required: true,
      allowedValues: ['drafted', 'published']
    })
    let parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.docs.fields.status).toEqual({
      field_type: 'string',
      description: 'Review status',
      required: true,
      allowed_values: ['drafted', 'published']
    })

    await upsertOverlayField(root, 'docs', 'status', {
      description: null,
      required: null,
      allowedValues: null
    })
    parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.docs.fields.status).toEqual({ field_type: 'string' })
  })

  it('rejects trailing-slash and empty scope keys', async () => {
    await expect(upsertOverlayField(root, 'docs/', 'a', { fieldType: 'string' })).rejects.toThrow(
      /trailing slash/
    )
    await expect(upsertOverlayField(root, '', 'a', { fieldType: 'string' })).rejects.toThrow()
  })

  it('rejects field types the CLI does not accept', async () => {
    await expect(
      upsertOverlayField(root, 'docs', 'a', { fieldType: 'url' })
    ).rejects.toThrow(/Invalid overlay field_type/)
  })

  it('refuses to clobber a malformed overlay', async () => {
    await writeFile(join(root, OVERLAY_FILENAME), 'not: [valid: yaml: !!', 'utf-8')
    await expect(
      upsertOverlayField(root, 'docs', 'a', { fieldType: 'string' })
    ).rejects.toThrow(MalformedOverlayError)
    // Untouched on disk.
    expect(await readOverlay()).toBe('not: [valid: yaml: !!')
  })
})

describe('renameOverlayField', () => {
  it('moves a scoped field entry to the new key', async () => {
    await upsertOverlayField(root, 'docs', 'status', {
      fieldType: 'string',
      description: 'Review status'
    })
    const renamed = await renameOverlayField(root, 'docs', 'status', 'state')
    expect(renamed).toBe(true)
    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.docs.fields.state).toEqual({
      field_type: 'string',
      description: 'Review status'
    })
    expect(parsed.scopes.docs.fields.status).toBeUndefined()
  })

  it('returns false (and writes nothing) when there is no overlay entry', async () => {
    expect(await renameOverlayField(root, 'docs', 'status', 'state')).toBe(false)
    await expect(access(join(root, OVERLAY_FILENAME))).rejects.toThrow()
  })
})
