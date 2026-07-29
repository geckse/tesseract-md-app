import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

import {
  captureOverlaySnapshot,
  restoreOverlaySnapshot,
  resolveOverlayFormulaScope,
  upsertOverlayField,
  removeOverlayField,
  removeOverlayFieldEverywhere,
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
  it('writes formula source and result type without disturbing comments', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      '# formulas stay in schema\nscopes:\n  invoices:\n    fields:\n      status:\n        field_type: string\n',
      'utf-8'
    )

    await upsertOverlayField(root, 'invoices', 'total', {
      fieldType: 'formula',
      formula: 'price * quantity',
      resultType: 'Number'
    })

    const raw = await readOverlay()
    const parsed = parseYaml(raw)
    expect(raw).toContain('# formulas stay in schema')
    expect(parsed.scopes.invoices.fields.total).toEqual({
      field_type: 'formula',
      formula: 'price * quantity',
      result_type: 'number'
    })
    expect(parsed.scopes.invoices.fields.status.field_type).toBe('string')
  })

  it('clears formula annotations and prunes empty scope maps', async () => {
    await upsertOverlayField(root, 'invoices', 'total', {
      fieldType: 'formula',
      formula: 'price * quantity',
      resultType: 'Number'
    })
    await upsertOverlayField(root, 'invoices', 'total', {
      fieldType: null,
      formula: null,
      resultType: null
    })

    expect(parseYaml(await readOverlay())).toEqual({})
  })

  it('rejects empty formulas and invalid result types', async () => {
    await expect(
      upsertOverlayField(root, 'docs', 'total', {
        fieldType: 'formula',
        formula: '  ',
        resultType: 'Number'
      })
    ).rejects.toThrow(/cannot be empty/)
    await expect(
      upsertOverlayField(root, 'docs', 'total', {
        fieldType: 'formula',
        formula: 'price',
        resultType: 'Currency' as never
      })
    ).rejects.toThrow(/result_type/)
  })

  it('accepts the File field type', async () => {
    await upsertOverlayField(root, null, 'attachments', { fieldType: 'file' })
    const parsed = parseYaml(await readOverlay())
    expect(parsed.fields.attachments.field_type).toBe('file')
  })

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

  it.each([
    ['scalar', 'this is valid yaml\n'],
    ['sequence', '- fields\n- scopes\n']
  ])('refuses to clobber a %s overlay root', async (_kind, source) => {
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await expect(
      upsertOverlayField(root, 'docs', 'total', {
        fieldType: 'formula',
        formula: 'price * quantity',
        resultType: 'Number'
      })
    ).rejects.toThrow(MalformedOverlayError)

    expect(await readOverlay()).toBe(source)
  })
})

describe('removeOverlayField', () => {
  it('removes only the selected formula field and preserves siblings/comments', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      '# keep me\nscopes:\n  invoices:\n    fields:\n      total:\n        field_type: formula\n        formula: price * quantity\n        result_type: number\n      status:\n        field_type: string\n',
      'utf-8'
    )

    await expect(removeOverlayField(root, 'invoices', 'total')).resolves.toBe(true)
    const raw = await readOverlay()
    const parsed = parseYaml(raw)
    expect(raw).toContain('# keep me')
    expect(parsed.scopes.invoices.fields.total).toBeUndefined()
    expect(parsed.scopes.invoices.fields.status).toEqual({ field_type: 'string' })
  })
})

describe('removeOverlayFieldEverywhere', () => {
  it('removes global and every scoped definition while preserving siblings and comments', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      [
        '# keep root comment',
        'fields:',
        '  status:',
        '    field_type: string',
        '  author:',
        '    field_type: string',
        'scopes:',
        '  docs:',
        '    fields:',
        '      status:',
        '        field_type: number',
        '      category:',
        '        field_type: string',
        '  docs/guides:',
        '    fields:',
        '      status:',
        '        description: Guide status',
        '  notes:',
        '    fields:',
        '      pinned:',
        '        field_type: boolean',
        ''
      ].join('\n'),
      'utf-8'
    )

    await expect(removeOverlayFieldEverywhere(root, 'status')).resolves.toBe(true)
    const raw = await readOverlay()
    const parsed = parseYaml(raw)
    expect(raw).toContain('# keep root comment')
    expect(parsed.fields).toEqual({ author: { field_type: 'string' } })
    expect(parsed.scopes.docs.fields).toEqual({
      category: { field_type: 'string' }
    })
    expect(parsed.scopes['docs/guides']).toBeUndefined()
    expect(parsed.scopes.notes.fields).toEqual({
      pinned: { field_type: 'boolean' }
    })
  })

  it('returns false without creating or rewriting an overlay when the field is absent', async () => {
    await expect(removeOverlayFieldEverywhere(root, 'status')).resolves.toBe(false)
    await expect(access(join(root, OVERLAY_FILENAME))).rejects.toThrow()

    const source = '# keep\nfields:\n  author:\n    field_type: string\n'
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')
    await expect(removeOverlayFieldEverywhere(root, 'status')).resolves.toBe(false)
    expect(await readOverlay()).toBe(source)
  })

  it('refuses malformed overlays without changing their bytes', async () => {
    const source = 'scopes: [unclosed\n'
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await expect(removeOverlayFieldEverywhere(root, 'status')).rejects.toThrow(
      MalformedOverlayError
    )
    expect(await readOverlay()).toBe(source)
  })
})

describe('formula overlay resolution and rollback', () => {
  it('resolves the most-specific inherited formula definition', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      [
        'fields:',
        '  total:',
        '    field_type: formula',
        '    formula: subtotal',
        '    result_type: number',
        'scopes:',
        '  invoices:',
        '    fields:',
        '      total:',
        '        field_type: formula',
        '        formula: subtotal + tax',
        '        result_type: number',
        '      tax:',
        '        field_type: formula',
        '        formula: subtotal * 0.2',
        '        result_type: number',
        '  invoices/archived:',
        '    fields:',
        '      total:',
        '        field_type: number',
        ''
      ].join('\n'),
      'utf-8'
    )

    await expect(resolveOverlayFormulaScope(root, null, 'total')).resolves.toBeNull()
    await expect(resolveOverlayFormulaScope(root, 'invoices/current', 'total')).resolves.toBe(
      'invoices'
    )
    await expect(resolveOverlayFormulaScope(root, 'invoices/archived/2025', 'total')).resolves.toBe(
      undefined
    )
  })

  it('matches inherited scopes on path-segment boundaries', async () => {
    await writeFile(
      join(root, OVERLAY_FILENAME),
      'scopes:\n  invoices:\n    fields:\n      tax:\n        field_type: formula\n        formula: subtotal * 0.2\n        result_type: number\n',
      'utf-8'
    )

    await expect(resolveOverlayFormulaScope(root, 'invoices/2026', 'tax')).resolves.toBe('invoices')
    await expect(resolveOverlayFormulaScope(root, 'invoices-old', 'tax')).resolves.toBeUndefined()
  })

  it('captures and restores an existing overlay byte-for-byte', async () => {
    const original =
      '# preserve this exact formatting\nfields: { total: { field_type: formula, formula: price } }\n'
    await writeFile(join(root, OVERLAY_FILENAME), original, 'utf-8')
    const snapshot = await captureOverlaySnapshot(root)

    await writeFile(join(root, OVERLAY_FILENAME), 'fields: {}\n', 'utf-8')
    await restoreOverlaySnapshot(root, snapshot)

    expect(await readOverlay()).toBe(original)
  })

  it('restores a missing overlay by removing the newly-created file', async () => {
    const snapshot = await captureOverlaySnapshot(root)
    await writeFile(join(root, OVERLAY_FILENAME), 'fields: {}\n', 'utf-8')

    await restoreOverlaySnapshot(root, snapshot)

    await expect(access(join(root, OVERLAY_FILENAME))).rejects.toThrow()
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
