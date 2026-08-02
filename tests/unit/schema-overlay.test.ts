import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access, symlink, link } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

import {
  captureOverlaySnapshot,
  restoreOverlaySnapshot,
  resolveOverlayFormulaScope,
  resolveOverlayLookupRollupDefinition,
  resolveOverlayLookupRollupScope,
  upsertOverlayField,
  removeOverlayField,
  removeOverlayFieldEverywhere,
  renameOverlayField,
  readOverlayValueColors,
  setOverlayValueColor,
  MalformedOverlayError,
  OVERLAY_FILENAME
} from '../../src/main/schema-overlay'
import { clearOwnWrites, matchAndConsumeOwnWrite } from '../../src/main/own-writes'

let root: string

beforeEach(async () => {
  clearOwnWrites()
  root = await mkdtemp(join(tmpdir(), 'schema-overlay-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function readOverlay(): Promise<string> {
  return readFile(join(root, OVERLAY_FILENAME), 'utf-8')
}

describe('upsertOverlayField', () => {
  it('writes outgoing Lookup definitions without direction or scope', async () => {
    await upsertOverlayField(root, 'contacts', 'client_domain', {
      fieldType: 'lookup',
      relationField: 'client',
      targetField: 'domain',
      relationDirection: null,
      relationScope: null
    })

    expect(parseYaml(await readOverlay()).scopes.contacts.fields.client_domain).toEqual({
      field_type: 'lookup',
      relation_field: 'client',
      target_field: 'domain'
    })
  })

  it('writes incoming Rollup definitions and preserves adjacent comments', async () => {
    await writeFile(join(root, OVERLAY_FILENAME), '# keep me\nfields: {}\n', 'utf-8')
    await upsertOverlayField(root, 'clients', 'invoice_total', {
      fieldType: 'rollup',
      relationField: 'client',
      targetField: 'total',
      relationDirection: 'incoming',
      relationScope: 'invoices',
      formula: 'values.reduce((sum, value) => sum + value, 0)',
      resultType: 'Number'
    })

    const raw = await readOverlay()
    expect(raw).toContain('# keep me')
    expect(parseYaml(raw).scopes.clients.fields.invoice_total).toEqual({
      field_type: 'rollup',
      relation_field: 'client',
      target_field: 'total',
      relation_direction: 'incoming',
      relation_scope: 'invoices',
      formula: 'values.reduce((sum, value) => sum + value, 0)',
      result_type: 'number'
    })
  })

  it('atomically renames and edits one Lookup pair while preserving comments and sibling bytes', async () => {
    const source = [
      '# schema header',
      'scopes:',
      '  contacts:',
      '    fields:',
      '      before:',
      '        field_type: string # untouched sibling',
      '      # keep definition comment',
      '      client_domain:',
      '        field_type: Lookup',
      '        relation_field: client',
      '        target_field: domain',
      '      after:',
      '        field_type: number',
      '# schema footer',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await upsertOverlayField(
      root,
      'contacts',
      'client_industry',
      {
        fieldType: 'lookup',
        relationField: 'client',
        targetField: 'industry',
        relationDirection: null,
        relationScope: null,
        formula: null,
        resultType: null
      },
      { previousKey: 'client_domain' }
    )

    const raw = await readOverlay()
    const fields = parseYaml(raw).scopes.contacts.fields
    expect(fields.client_domain).toBeUndefined()
    expect(fields.client_industry).toEqual({
      field_type: 'lookup',
      relation_field: 'client',
      target_field: 'industry'
    })
    expect(raw).toContain('# schema header')
    expect(raw).toContain('# keep definition comment')
    expect(raw).toContain('# schema footer')
    expect(raw).toContain('      before:\n        field_type: string # untouched sibling\n')
    expect(raw.indexOf('      before:')).toBeLessThan(raw.indexOf('      client_industry:'))
    expect(raw.indexOf('      client_industry:')).toBeLessThan(raw.indexOf('      after:'))
  })

  it('rejects missing sources, kind changes, reserved names, and overlapping destination collisions without writing', async () => {
    const source = [
      'fields:',
      '  global_collision:',
      '    field_type: string',
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain:',
      '        field_type: lookup',
      '        relation_field: client',
      '        target_field: domain',
      '  contacts/vip:',
      '    fields:',
      '      child_collision:',
      '        field_type: number',
      '  projects:',
      '    fields:',
      '      sibling_only:',
      '        field_type: string',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')
    const lookupPatch = {
      fieldType: 'lookup' as const,
      relationField: 'client',
      targetField: 'industry'
    }

    await expect(
      upsertOverlayField(root, 'contacts', 'renamed', lookupPatch, {
        previousKey: 'missing'
      })
    ).rejects.toThrow(/not defined at its resolved origin/)
    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'client_domain',
        { ...lookupPatch, fieldType: 'rollup' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/from lookup to rollup/)
    await expect(
      upsertOverlayField(root, 'contacts', 'global_collision', lookupPatch, {
        previousKey: 'client_domain'
      })
    ).rejects.toThrow(/destination already exists.*global schema/)
    await expect(
      upsertOverlayField(root, 'contacts', 'child_collision', lookupPatch, {
        previousKey: 'client_domain'
      })
    ).rejects.toThrow(/destination already exists.*contacts\/vip/)
    await expect(
      upsertOverlayField(root, 'contacts', 'title', lookupPatch, {
        previousKey: 'client_domain'
      })
    ).rejects.toThrow(/reserved/)
    await expect(
      upsertOverlayField(root, 'contacts', 'bad\nkey', lookupPatch, {
        previousKey: 'client_domain'
      })
    ).rejects.toThrow(/control characters/)

    expect(await readOverlay()).toBe(source)
  })

  it('blocks a rename when other Lookup/Rollup definitions retrieve the old output key', async () => {
    const source = [
      '# dependency graph must stay intact',
      'scopes:',
      '  clients:',
      '    fields:',
      '      domain:',
      '        field_type: Lookup',
      '        relation_field: account',
      '        target_field: hostname',
      '  contacts:',
      '    fields:',
      '      client_domain:',
      '        field_type: lookup',
      '        relation_field: client',
      '        target_field: domain',
      '  reports:',
      '    fields:',
      '      domains:',
      '        field_type: Rollup',
      '        relation_field: contacts',
      '        target_field: client_domain',
      '        formula: values',
      '        result_type: list',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'account_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/reports\.domains/)

    expect(await readOverlay()).toBe(source)
  })

  it.each(['string', 'formula', 'lookup'])(
    'create-only refuses to replace an existing %s overlay field',
    async (fieldType) => {
      const source = [
        '# create must never become overwrite',
        'fields:',
        '  occupied:',
        `    field_type: ${fieldType}`,
        ...(fieldType === 'formula'
          ? ['    formula: 1', '    result_type: number']
          : fieldType === 'lookup'
            ? ['    relation_field: client', '    target_field: domain']
            : []),
        ''
      ].join('\n')
      await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

      await expect(
        upsertOverlayField(
          root,
          'contacts',
          'occupied',
          { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
          { requireAbsent: true }
        )
      ).rejects.toThrow(/Cannot create.*destination already exists/)

      expect(await readOverlay()).toBe(source)
    }
  )

  it('accepts an alias-authored source case-insensitively but blocks alias-authored downstream dependents', async () => {
    const source = [
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain:',
      '        type: Lookup',
      '        relation_field: client',
      '        target_field: domain',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    expect(
      await resolveOverlayLookupRollupDefinition(root, 'contacts/enterprise', 'client_domain')
    ).toEqual({ scope: 'contacts', kind: 'lookup' })
    await upsertOverlayField(
      root,
      'contacts',
      'account_domain',
      { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
      { previousKey: 'client_domain' }
    )
    expect(parseYaml(await readOverlay()).scopes.contacts.fields.account_domain).toMatchObject({
      type: 'Lookup',
      field_type: 'lookup',
      target_field: 'domain'
    })

    const withDependent = [
      await readOverlay(),
      '  reports:',
      '    fields:',
      '      copied_domain:',
      '        type: LOOKUP',
      '        relation_field: contact',
      '        target_field: account_domain',
      ''
    ].join('\n')
    // Append under the existing `scopes:` map; the serialized overlay ends
    // with the contacts subtree and has no second top-level key.
    await writeFile(join(root, OVERLAY_FILENAME), withDependent, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'renamed_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'account_domain' }
      )
    ).rejects.toThrow(/reports\.copied_domain/)
    expect(await readOverlay()).toBe(withDependent)
  })

  it('fails closed on conflicting field_type/type semantics', async () => {
    const source = [
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain:',
      '        field_type: lookup',
      '        type: rollup',
      '        relation_field: client',
      '        target_field: domain',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await expect(
      resolveOverlayLookupRollupDefinition(root, 'contacts', 'client_domain')
    ).rejects.toThrow(/Conflicting field_type\/type/)
    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'account_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/Conflicting field_type\/type/)
    expect(await readOverlay()).toBe(source)
  })

  it('blocks ancestor and descendant same-key definitions but allows unrelated sibling scopes', async () => {
    const base = [
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
      '  contacts/vip:',
      '    fields:',
      '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
      '  projects:',
      '    fields:',
      '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), base, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'account_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/contacts\/vip/)
    await expect(
      upsertOverlayField(
        root,
        'contacts/vip',
        'account_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/overlapping overlay scopes: contacts/)
    expect(await readOverlay()).toBe(base)

    await removeOverlayField(root, 'contacts/vip', 'client_domain')
    await upsertOverlayField(
      root,
      'contacts',
      'account_domain',
      { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
      { previousKey: 'client_domain' }
    )
    const parsed = parseYaml(await readOverlay())
    expect(parsed.scopes.contacts.fields.account_domain.field_type).toBe('lookup')
    expect(parsed.scopes.projects.fields.client_domain.field_type).toBe('lookup')
  })

  it('blocks a self-named target conservatively and identifies the source definition', async () => {
    const source = [
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain:',
      '        field_type: lookup',
      '        relation_field: client',
      '        target_field: client_domain',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'account_domain',
        { fieldType: 'lookup', relationField: 'client', targetField: 'domain' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/contacts\.client_domain/)
    expect(await readOverlay()).toBe(source)
  })

  it('exposes exact prepared/published generations so a post-publication failure rolls back byte-for-byte', async () => {
    const source = [
      '# preserve this exact generation',
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), source, 'utf-8')
    let prepared: Awaited<ReturnType<typeof captureOverlaySnapshot>> | undefined
    let published: Awaited<ReturnType<typeof captureOverlaySnapshot>> | undefined

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'client_industry',
        { fieldType: 'lookup', relationField: 'client', targetField: 'industry' },
        {
          previousKey: 'client_domain',
          onPrepared: (snapshot) => {
            prepared = snapshot
          },
          onPublished: (snapshot) => {
            published = snapshot
            throw new Error('simulated failure after publication')
          }
        }
      )
    ).rejects.toThrow('simulated failure after publication')

    expect(prepared).toEqual({ existed: true, content: source })
    expect(published?.content).toContain('client_industry')
    expect(await readOverlay()).toBe(published?.content)
    await restoreOverlaySnapshot(root, prepared!, published!)
    expect(await readOverlay()).toBe(source)
  })

  it('rejects blank relation fields, invalid directions, and trailing relation scopes', async () => {
    await expect(upsertOverlayField(root, null, 'bad', { relationField: ' ' })).rejects.toThrow(
      'Relation field'
    )
    await expect(
      upsertOverlayField(root, null, 'bad', {
        relationDirection: 'sideways' as 'incoming'
      })
    ).rejects.toThrow('Invalid relation direction')
    await expect(
      upsertOverlayField(root, null, 'bad', { relationScope: 'invoices/' })
    ).rejects.toThrow('Relation scopes')
  })

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

  it('accepts the JSON field type', async () => {
    await upsertOverlayField(root, null, 'payload', { fieldType: 'json' })
    const parsed = parseYaml(await readOverlay())
    expect(parsed.fields.payload.field_type).toBe('json')
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

  it.runIf(process.platform !== 'win32')(
    'refuses symlinked and hard-linked overlay targets without changing either source',
    async () => {
      const symbolicSource = join(root, 'symbolic-source.yml')
      const hardSource = join(root, 'hard-source.yml')
      const original = 'fields:\n  keep:\n    field_type: string\n'

      await writeFile(symbolicSource, original, 'utf-8')
      await symlink(symbolicSource, join(root, OVERLAY_FILENAME))
      await expect(
        upsertOverlayField(root, null, 'danger', { fieldType: 'string' })
      ).rejects.toThrow(/symbolic-link/)
      expect(await readFile(symbolicSource, 'utf-8')).toBe(original)
      expect(
        matchAndConsumeOwnWrite(join(root, OVERLAY_FILENAME), 'modified', { size: null })
      ).toBe(false)

      await rm(join(root, OVERLAY_FILENAME))
      await writeFile(hardSource, original, 'utf-8')
      await link(hardSource, join(root, OVERLAY_FILENAME))
      await expect(
        upsertOverlayField(root, null, 'danger', { fieldType: 'string' })
      ).rejects.toThrow(/hard-linked/)
      expect(await readFile(hardSource, 'utf-8')).toBe(original)
      expect(
        matchAndConsumeOwnWrite(join(root, OVERLAY_FILENAME), 'modified', { size: null })
      ).toBe(false)
    }
  )

  it('rechecks the exact overlay baseline immediately before publication', async () => {
    const original = 'fields:\n  original:\n    field_type: string\n'
    const concurrent =
      '# concurrent editor generation\nfields: { concurrent: { field_type: number } }\n'
    await writeFile(join(root, OVERLAY_FILENAME), original, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        null,
        'danger',
        { fieldType: 'string' },
        {
          beforeCommit: async () => {
            await writeFile(join(root, OVERLAY_FILENAME), concurrent, 'utf-8')
          }
        }
      )
    ).rejects.toThrow(/changed.*refusing to overwrite/)

    expect(await readOverlay()).toBe(concurrent)
    expect(matchAndConsumeOwnWrite(join(root, OVERLAY_FILENAME), 'modified', { size: null })).toBe(
      false
    )
  })
})

describe('resolveOverlayLookupRollupScope', () => {
  it('resolves the most-specific computed origin and respects ordinary masking', async () => {
    await upsertOverlayField(root, null, 'domain', {
      fieldType: 'lookup',
      relationField: 'client',
      targetField: 'domain'
    })
    await upsertOverlayField(root, 'contacts/vip', 'domain', {
      fieldType: 'rollup',
      relationField: 'clients',
      targetField: 'domain',
      formula: 'values[0] ?? null',
      resultType: 'String'
    })

    expect(await resolveOverlayLookupRollupScope(root, 'contacts', 'domain')).toBeNull()
    expect(await resolveOverlayLookupRollupScope(root, 'contacts/vip', 'domain')).toBe(
      'contacts/vip'
    )
    expect(await resolveOverlayLookupRollupDefinition(root, 'contacts/vip', 'domain')).toEqual({
      scope: 'contacts/vip',
      kind: 'rollup'
    })

    await upsertOverlayField(root, 'contacts/vip/private', 'domain', { fieldType: 'string' })
    expect(
      await resolveOverlayLookupRollupScope(root, 'contacts/vip/private', 'domain')
    ).toBeUndefined()
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

  it('CAS-restores only while the mutated overlay is still current', async () => {
    const original = 'fields: { original: { field_type: string } }\n'
    const mutated = 'fields: { computed: { field_type: formula, formula: 1 } }\n'
    await writeFile(join(root, OVERLAY_FILENAME), original, 'utf-8')
    const originalSnapshot = await captureOverlaySnapshot(root)
    await writeFile(join(root, OVERLAY_FILENAME), mutated, 'utf-8')
    const mutatedSnapshot = await captureOverlaySnapshot(root)

    await restoreOverlaySnapshot(root, originalSnapshot, mutatedSnapshot)

    expect(await readOverlay()).toBe(original)
  })

  it('refuses rollback after a concurrent overlay edit', async () => {
    const original = 'fields: { original: { field_type: string } }\n'
    const mutated = 'fields: { computed: { field_type: formula, formula: 1 } }\n'
    const concurrent = '# external edit\nfields: {}\n'
    await writeFile(join(root, OVERLAY_FILENAME), original, 'utf-8')
    const originalSnapshot = await captureOverlaySnapshot(root)
    await writeFile(join(root, OVERLAY_FILENAME), mutated, 'utf-8')
    const mutatedSnapshot = await captureOverlaySnapshot(root)
    await writeFile(join(root, OVERLAY_FILENAME), concurrent, 'utf-8')

    await expect(restoreOverlaySnapshot(root, originalSnapshot, mutatedSnapshot)).rejects.toThrow(
      'refusing to overwrite'
    )
    expect(await readOverlay()).toBe(concurrent)
  })

  it('rechecks rollback CAS immediately before publication and preserves the racing generation', async () => {
    const original = 'fields: { original: { field_type: string } }\n'
    const mutated = 'fields: { computed: { field_type: formula, formula: 1 } }\n'
    const concurrent =
      '# external edit during rollback\nfields: { newer: { field_type: number } }\n'
    await writeFile(join(root, OVERLAY_FILENAME), original, 'utf-8')
    const originalSnapshot = await captureOverlaySnapshot(root)
    await writeFile(join(root, OVERLAY_FILENAME), mutated, 'utf-8')
    const mutatedSnapshot = await captureOverlaySnapshot(root)

    await expect(
      restoreOverlaySnapshot(root, originalSnapshot, mutatedSnapshot, {
        beforeCommit: async () => {
          await writeFile(join(root, OVERLAY_FILENAME), concurrent, 'utf-8')
        }
      })
    ).rejects.toThrow(/changed.*refusing to overwrite/)

    expect(await readOverlay()).toBe(concurrent)
    expect(matchAndConsumeOwnWrite(join(root, OVERLAY_FILENAME), 'modified', { size: null })).toBe(
      false
    )
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
