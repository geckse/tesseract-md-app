import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

let root: string

vi.mock('../../src/main/store', () => ({
  getCollections: () => [{ id: 'vault-1', name: 'Vault', path: root }],
  initStore: () => ({ get: () => ({}), set: () => {} })
}))

import {
  OVERLAY_FILENAME,
  resolveOverlayLookupRollupDefinition,
  upsertOverlayField
} from '../../src/main/schema-overlay'
import { renamePropertyInViews } from '../../src/main/table-views'
import { assertComputedOutputKeyAbsentOnDisk } from '../../src/main/computed-output-preflight'

const viewsPath = (): string => join(root, '.markdownvdb', 'table-views.json')

function savedView(folder: string, field: string): Record<string, unknown> {
  return {
    id: `view-${folder}`,
    name: folder,
    version: 1,
    config: {
      sort: [{ columnName: field, direction: 'asc' }],
      filters: [{ columnName: field, operator: 'exists', value: null }],
      columns: [{ name: field, hidden: false, width: 160, order: 0 }],
      groupBy: field,
      collapsedGroups: []
    },
    recursive: true,
    isDefault: false,
    createdAt: 1,
    updatedAt: 1
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lookup-rollup-rename-'))
  await mkdir(join(root, '.markdownvdb'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Lookup/Rollup rename persistence', () => {
  it('moves and edits an inherited definition at its true origin before updating scoped saved views', async () => {
    const overlay = [
      '# preserve root comment',
      'scopes:',
      '  contacts:',
      '    fields:',
      '      # preserve pair comment',
      '      client_domain:',
      '        field_type: lookup',
      '        relation_field: client',
      '        target_field: domain',
      '      untouched: { field_type: string }',
      ''
    ].join('\n')
    await writeFile(join(root, OVERLAY_FILENAME), overlay, 'utf-8')
    await writeFile(
      viewsPath(),
      JSON.stringify(
        {
          version: 1,
          folders: {
            contacts: [savedView('contacts', 'client_domain')],
            'contacts/enterprise': [savedView('enterprise', 'client_domain')],
            projects: [savedView('projects', 'client_domain')]
          }
        },
        null,
        2
      ) + '\n',
      'utf-8'
    )

    const resolved = await resolveOverlayLookupRollupDefinition(
      root,
      'contacts/enterprise',
      'client_domain'
    )
    expect(resolved).toEqual({ scope: 'contacts', kind: 'lookup' })

    await upsertOverlayField(
      root,
      resolved!.scope,
      'client_industry',
      { fieldType: 'lookup', relationField: 'client', targetField: 'industry' },
      { previousKey: 'client_domain' }
    )
    // This mirrors main-process ordering: auxiliary views publish only after
    // the guarded overlay mutation and module acceptance have completed.
    await renamePropertyInViews(
      'vault-1',
      resolved!.scope ?? '',
      'client_domain',
      'client_industry'
    )

    const rawOverlay = await readFile(join(root, OVERLAY_FILENAME), 'utf-8')
    const parsedOverlay = parseYaml(rawOverlay)
    expect(rawOverlay).toContain('# preserve root comment')
    expect(rawOverlay).toContain('# preserve pair comment')
    expect(parsedOverlay.scopes.contacts.fields.client_domain).toBeUndefined()
    expect(parsedOverlay.scopes.contacts.fields.client_industry).toEqual({
      field_type: 'lookup',
      relation_field: 'client',
      target_field: 'industry'
    })
    expect(parsedOverlay.scopes.contacts.fields.untouched).toEqual({ field_type: 'string' })

    const views = JSON.parse(await readFile(viewsPath(), 'utf-8'))
    expect(views.folders.contacts[0].config.sort[0].columnName).toBe('client_industry')
    expect(views.folders['contacts/enterprise'][0].config.groupBy).toBe('client_industry')
    expect(views.folders.projects[0].config.columns[0].name).toBe('client_domain')
  })

  it('leaves overlay and saved views byte-identical when a dependent definition blocks rename', async () => {
    const overlay = [
      'scopes:',
      '  contacts:',
      '    fields:',
      '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
      '  reports:',
      '    fields:',
      '      copied: { type: Lookup, relation_field: contact, target_field: client_domain }',
      ''
    ].join('\n')
    const views =
      JSON.stringify(
        {
          version: 1,
          folders: { contacts: [savedView('contacts', 'client_domain')] }
        },
        null,
        2
      ) + '\n'
    await writeFile(join(root, OVERLAY_FILENAME), overlay, 'utf-8')
    await writeFile(viewsPath(), views, 'utf-8')

    await expect(
      upsertOverlayField(
        root,
        'contacts',
        'client_industry',
        { fieldType: 'lookup', relationField: 'client', targetField: 'industry' },
        { previousKey: 'client_domain' }
      )
    ).rejects.toThrow(/reports\.copied/)

    expect(await readFile(join(root, OVERLAY_FILENAME), 'utf-8')).toBe(overlay)
    expect(await readFile(viewsPath(), 'utf-8')).toBe(views)
  })

  it.each(['create', 'rename'] as const)(
    'blocks %s against an unindexed raw frontmatter destination before overlay/module/file mutation',
    async (intent) => {
      await mkdir(join(root, 'contacts'), { recursive: true })
      const overlay =
        intent === 'rename'
          ? [
              '# original overlay generation',
              'scopes:',
              '  contacts:',
              '    fields:',
              '      client_domain: { field_type: lookup, relation_field: client, target_field: domain }',
              ''
            ].join('\n')
          : '# original overlay generation\nfields:\n  untouched: { field_type: string }\n'
      const markdown =
        '---\ntitle: Newly saved\nclient_industry: authored value\n---\nDo not touch this file.\n'
      await writeFile(join(root, OVERLAY_FILENAME), overlay, 'utf-8')
      await writeFile(join(root, 'contacts', 'new.md'), markdown, 'utf-8')
      let moduleRan = false

      await expect(
        (async () => {
          await assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'client_industry')
          await upsertOverlayField(
            root,
            'contacts',
            'client_industry',
            { fieldType: 'lookup', relationField: 'client', targetField: 'industry' },
            intent === 'rename' ? { previousKey: 'client_domain' } : { requireAbsent: true }
          )
          moduleRan = true
        })()
      ).rejects.toThrow(/contacts\/new\.md/)

      expect(moduleRan).toBe(false)
      expect(await readFile(join(root, OVERLAY_FILENAME), 'utf-8')).toBe(overlay)
      expect(await readFile(join(root, 'contacts', 'new.md'), 'utf-8')).toBe(markdown)
    }
  )
})
