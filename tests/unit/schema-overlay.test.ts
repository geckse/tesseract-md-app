import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

import {
  upsertOverlayField,
  renameOverlayField,
  readOverlayValueColors,
  setOverlayValueColor,
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

  it('treats clearing annotations on a missing scoped field as a no-op', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      'fields:\n  client:\n    field_type: relation\n    target: clients\nscopes:\n  invoices:\n    fields:\n      status:\n        field_type: string\n',
      'utf-8'
    )

    await upsertOverlayField(root, 'invoices', 'client', {
      description: null,
      required: null,
      allowedValues: null,
      target: 'clients'
    })

    const parsed = parseYaml(await readOverlay())
    expect(parsed.fields.client).toEqual({
      field_type: 'relation',
      target: 'clients'
    })
    expect(parsed.scopes.invoices.fields.client).toEqual({
      target: 'clients'
    })
  })

  it('rejects trailing-slash and empty scope keys', async () => {
    await expect(upsertOverlayField(root, 'docs/', 'a', { fieldType: 'string' })).rejects.toThrow(
      /trailing slash/
    )
    await expect(upsertOverlayField(root, '', 'a', { fieldType: 'string' })).rejects.toThrow()
  })

  it('rejects field types the CLI does not accept', async () => {
    await expect(upsertOverlayField(root, 'docs', 'a', { fieldType: 'url' })).rejects.toThrow(
      /Invalid overlay field_type/
    )
  })

  it('refuses to clobber a malformed overlay', async () => {
    await writeFile(join(root, OVERLAY_FILENAME), 'not: [valid: yaml: !!', 'utf-8')
    await expect(upsertOverlayField(root, 'docs', 'a', { fieldType: 'string' })).rejects.toThrow(
      MalformedOverlayError
    )
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

describe('Select/Tags value colors', () => {
  it('persists palette slots beside a scoped field without disturbing its schema annotations', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      '# synced schema\nscopes:\n  invoices:\n    fields:\n      status:\n        field_type: string\n        allowed_values: [draft, paid]\n',
      'utf-8'
    )

    await setOverlayValueColor(root, 'invoices', 'status', 'draft', {
      palette: 'accent',
      slot: 2
    })
    await setOverlayValueColor(root, 'invoices', 'status', 'paid', {
      palette: 'accent',
      slot: 23
    })

    const raw = await readOverlay()
    const parsed = parseYaml(raw)
    expect(raw).toContain('# synced schema')
    expect(parsed.scopes.invoices.fields.status).toEqual({
      field_type: 'string',
      allowed_values: ['draft', 'paid'],
      value_colors: { draft: 2, paid: 23 }
    })
  })

  it('layers global and matching folder-scope colors like the schema overlay', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      [
        'fields:',
        '  status:',
        '    value_colors:',
        '      draft: 1',
        '      paid: 2',
        'scopes:',
        '  invoices:',
        '    fields:',
        '      status:',
        '        value_colors:',
        '          paid: 8',
        '      tags:',
        '        value_colors:',
        '          urgent: 4',
        ''
      ].join('\n'),
      'utf-8'
    )

    await expect(readOverlayValueColors(root, 'invoices/2026')).resolves.toEqual({
      status: {
        draft: { palette: 'accent', slot: 1 },
        paid: { palette: 'accent', slot: 8 }
      },
      tags: { urgent: { palette: 'accent', slot: 4 } }
    })
  })

  it('persists and resolves neutral brightness slots', async () => {
    await setOverlayValueColor(root, 'invoices', 'status', 'archived', {
      palette: 'neutral',
      slot: 11
    })

    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.invoices.fields.status.value_colors.archived).toBe('neutral:11')
    await expect(readOverlayValueColors(root, 'invoices')).resolves.toEqual({
      status: { archived: { palette: 'neutral', slot: 11 } }
    })
  })

  it('restores automatic color by removing only the selected value annotation', async () => {
    await upsertOverlayField(root, 'invoices', 'status', {
      fieldType: 'string',
      allowedValues: ['draft']
    })
    await setOverlayValueColor(root, 'invoices', 'status', 'draft', {
      palette: 'accent',
      slot: 3
    })
    await setOverlayValueColor(root, 'invoices', 'status', 'draft', null)

    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.invoices.fields.status).toEqual({
      field_type: 'string',
      allowed_values: ['draft']
    })
  })

  it('rejects malformed value_colors instead of overwriting user YAML', async () => {
    const raw = 'scopes:\n  invoices:\n    fields:\n      status:\n        value_colors: invalid\n'
    await writeFile(join(root, OVERLAY_FILENAME), raw, 'utf-8')

    await expect(
      setOverlayValueColor(root, 'invoices', 'status', 'draft', {
        palette: 'accent',
        slot: 3
      })
    ).rejects.toThrow(/Expected YAML collection/)
    expect(await readOverlay()).toBe(raw)
  })

  it('validates palette slot bounds', async () => {
    await expect(
      setOverlayValueColor(root, null, 'status', 'draft', { palette: 'accent', slot: 24 })
    ).rejects.toThrow(/Invalid accent/)
    await expect(
      setOverlayValueColor(root, null, 'status', 'draft', { palette: 'neutral', slot: 12 })
    ).rejects.toThrow(/Invalid neutral/)
  })

  it('ignores malformed or out-of-range stored palette values', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      'fields:\n  status:\n    value_colors:\n      good: neutral:4\n      bad: neutral:12\n      unknown: warm:2\n',
      'utf-8'
    )
    await expect(readOverlayValueColors(root, null)).resolves.toEqual({
      status: { good: { palette: 'neutral', slot: 4 } }
    })
  })
})

describe('upsertOverlayField — relation target (phase 42)', () => {
  it('accepts the relation field_type', async () => {
    await upsertOverlayField(root, 'invoices', 'client', { fieldType: 'relation' })
    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.invoices.fields.client.field_type).toBe('relation')
  })

  it('writes and clears the target annotation', async () => {
    await upsertOverlayField(root, 'invoices', 'client', {
      fieldType: 'relation',
      target: 'clients'
    })
    let parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.invoices.fields.client.target).toBe('clients')

    await upsertOverlayField(root, 'invoices', 'client', { target: null })
    parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.invoices.fields.client.target).toBeUndefined()
    // The field_type pin survives a target-only clear.
    expect(parsed.scopes.invoices.fields.client.field_type).toBe('relation')
  })

  it('rejects trailing-slash and empty targets (phase-41 folder-key grammar)', async () => {
    await expect(
      upsertOverlayField(root, 'invoices', 'client', { target: 'clients/' })
    ).rejects.toThrow(/trailing slash/)
    await expect(upsertOverlayField(root, 'invoices', 'client', { target: '' })).rejects.toThrow(
      /non-empty/
    )
  })

  it('preserves comments when writing a target', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      '# my overlay\nscopes:\n  invoices:\n    fields:\n      client:\n        field_type: relation\n',
      'utf-8'
    )
    await upsertOverlayField(root, 'invoices', 'client', { target: 'clients' })
    const raw = await readOverlay()
    expect(raw).toContain('# my overlay')
    const parsed = parseYaml(raw)
    expect(parsed.scopes.invoices.fields.client.target).toBe('clients')
    expect(parsed.scopes.invoices.fields.client.field_type).toBe('relation')
  })
})
