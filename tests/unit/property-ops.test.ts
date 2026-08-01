import { describe, it, expect, vi } from 'vitest'

// Avoid loading electron / electron-store via transitive imports; the pure
// conversion + plan functions never touch them.
vi.mock('../../src/main/store', () => ({
  getCollections: () => []
}))
vi.mock('../../src/main/cli', () => ({
  execCommand: vi.fn()
}))

import {
  convertValue,
  planEntryFor,
  planPropertyOp,
  overlayScopeKey,
  overlayFieldTypeFor,
  storageKindFor,
  defaultValueForTarget,
  displayValue
} from '../../src/main/property-ops'
import type { PropertyOpRequest } from '../../src/preload/api'

describe('convertValue — to String (text/url/email/select)', () => {
  it('keeps strings unchanged', () => {
    expect(convertValue('hello', 'text')).toEqual({ ok: true, value: 'hello', changed: false })
    expect(convertValue('hello', 'url')).toEqual({ ok: true, value: 'hello', changed: false })
    expect(convertValue('hello', 'select')).toEqual({ ok: true, value: 'hello', changed: false })
  })

  it('stringifies numbers and booleans', () => {
    expect(convertValue(42, 'text')).toEqual({ ok: true, value: '42', changed: true })
    expect(convertValue(true, 'text')).toEqual({ ok: true, value: 'true', changed: true })
  })

  it('joins scalar lists with ", "', () => {
    expect(convertValue(['a', 'b'], 'text')).toEqual({ ok: true, value: 'a, b', changed: true })
    expect(convertValue([1, 'b'], 'text')).toEqual({ ok: true, value: '1, b', changed: true })
  })

  it('skips lists containing nested values', () => {
    const r = convertValue(['a', { x: 1 }], 'text')
    expect(r.ok).toBe(false)
  })

  it('skips nested mappings', () => {
    expect(convertValue({ a: 1 }, 'text').ok).toBe(false)
  })
})

describe('convertValue — to Number', () => {
  it('keeps numbers unchanged', () => {
    expect(convertValue(3.14, 'number')).toEqual({ ok: true, value: 3.14, changed: false })
  })

  it('parses strict decimal strings', () => {
    expect(convertValue('42', 'number')).toEqual({ ok: true, value: 42, changed: true })
    expect(convertValue(' -3.5 ', 'number')).toEqual({ ok: true, value: -3.5, changed: true })
  })

  it('rejects exponent notation and non-numeric strings', () => {
    expect(convertValue('1e3', 'number').ok).toBe(false)
    expect(convertValue('drafted', 'number').ok).toBe(false)
    expect(convertValue('1,5', 'number').ok).toBe(false)
  })

  it('converts booleans to 1/0', () => {
    expect(convertValue(true, 'number')).toEqual({ ok: true, value: 1, changed: true })
    expect(convertValue(false, 'number')).toEqual({ ok: true, value: 0, changed: true })
  })

  it('skips lists and maps', () => {
    expect(convertValue(['1'], 'number').ok).toBe(false)
    expect(convertValue({ n: 1 }, 'number').ok).toBe(false)
  })
})

describe('convertValue — to Boolean', () => {
  it('keeps booleans unchanged', () => {
    expect(convertValue(true, 'boolean')).toEqual({ ok: true, value: true, changed: false })
  })

  it('parses the token table case-insensitively', () => {
    for (const t of ['true', 'YES', 'On', '1']) {
      expect(convertValue(t, 'boolean')).toEqual({ ok: true, value: true, changed: true })
    }
    for (const f of ['false', 'No', 'OFF', '0']) {
      expect(convertValue(f, 'boolean')).toEqual({ ok: true, value: false, changed: true })
    }
  })

  it('rejects other strings', () => {
    expect(convertValue('drafted', 'boolean').ok).toBe(false)
  })

  it('converts only 0/1 numbers', () => {
    expect(convertValue(1, 'boolean')).toEqual({ ok: true, value: true, changed: true })
    expect(convertValue(0, 'boolean')).toEqual({ ok: true, value: false, changed: true })
    expect(convertValue(2, 'boolean').ok).toBe(false)
  })

  it('skips lists', () => {
    expect(convertValue(['true'], 'boolean').ok).toBe(false)
  })
})

describe('convertValue — to List (tags)', () => {
  it('splits strings on commas, trimming and dropping empties', () => {
    expect(convertValue('rust, search', 'tags')).toEqual({
      ok: true,
      value: ['rust', 'search'],
      changed: true
    })
    expect(convertValue('a,,b, ', 'tags')).toEqual({ ok: true, value: ['a', 'b'], changed: true })
  })

  it('wraps a comma-less string as a single-item list', () => {
    expect(convertValue('evaluation', 'tags')).toEqual({
      ok: true,
      value: ['evaluation'],
      changed: true
    })
  })

  it('wraps numbers/booleans as single stringified items', () => {
    expect(convertValue(42, 'tags')).toEqual({ ok: true, value: ['42'], changed: true })
    expect(convertValue(false, 'tags')).toEqual({ ok: true, value: ['false'], changed: true })
  })

  it('keeps string lists unchanged, stringifies scalar items', () => {
    expect(convertValue(['a', 'b'], 'tags')).toEqual({
      ok: true,
      value: ['a', 'b'],
      changed: false
    })
    expect(convertValue(['a', 2], 'tags')).toEqual({ ok: true, value: ['a', '2'], changed: true })
  })

  it('skips lists containing nested values and maps', () => {
    expect(convertValue([{ x: 1 }], 'tags').ok).toBe(false)
    expect(convertValue({ x: 1 }, 'tags').ok).toBe(false)
  })
})

describe('convertValue — to Date / Datetime', () => {
  it('keeps YYYY-MM-DD unchanged for date', () => {
    expect(convertValue('2026-01-15', 'date')).toEqual({
      ok: true,
      value: '2026-01-15',
      changed: false
    })
  })

  it('truncates ISO datetimes to the date for date targets', () => {
    expect(convertValue('2026-01-15T10:30:00', 'date')).toEqual({
      ok: true,
      value: '2026-01-15',
      changed: true
    })
  })

  it('keeps ISO datetimes and date-only values for datetime targets (no fabricated midnight)', () => {
    expect(convertValue('2026-01-15T10:30', 'datetime')).toEqual({
      ok: true,
      value: '2026-01-15T10:30',
      changed: false
    })
    expect(convertValue('2026-01-15', 'datetime')).toEqual({
      ok: true,
      value: '2026-01-15',
      changed: false
    })
  })

  it('rejects non-date strings and all non-strings (timestamps ambiguous)', () => {
    expect(convertValue('yesterday', 'date').ok).toBe(false)
    expect(convertValue(1718000000, 'date').ok).toBe(false)
    expect(convertValue(1718000000, 'datetime').ok).toBe(false)
    expect(convertValue(true, 'date').ok).toBe(false)
    expect(convertValue(['2026-01-15'], 'date').ok).toBe(false)
  })
})

describe('convertValue — to JSON', () => {
  it('parses valid JSON text into a typed value', () => {
    expect(convertValue(' {"myJSON": "a nice JSON"} ', 'complex')).toEqual({
      ok: true,
      value: { myJSON: 'a nice JSON' },
      changed: true
    })
    expect(convertValue('[1, true, null]', 'complex')).toEqual({
      ok: true,
      value: [1, true, null],
      changed: true
    })
  })

  it('keeps already-typed JSON values unchanged', () => {
    expect(convertValue({ nested: { enabled: true } }, 'complex')).toEqual({
      ok: true,
      value: { nested: { enabled: true } },
      changed: false
    })
  })

  it('rejects text that is not valid JSON', () => {
    expect(convertValue('plain text', 'complex')).toEqual({
      ok: false,
      reason: 'not valid JSON'
    })
  })
})

describe('storageKindFor / overlayFieldTypeFor', () => {
  it('maps UI types to storage kinds', () => {
    expect(storageKindFor('text')).toBe('string')
    expect(storageKindFor('url')).toBe('string')
    expect(storageKindFor('email')).toBe('string')
    expect(storageKindFor('select')).toBe('string')
    expect(storageKindFor('tags')).toBe('list')
    expect(storageKindFor('datetime')).toBe('datetime')
    expect(storageKindFor('complex')).toBe('json')
  })

  it('pins datetime as date in the overlay', () => {
    expect(overlayFieldTypeFor('datetime')).toBe('date')
    expect(overlayFieldTypeFor('tags')).toBe('list')
    expect(overlayFieldTypeFor('url')).toBe('string')
    expect(overlayFieldTypeFor('complex')).toBe('json')
  })
})

describe('defaultValueForTarget', () => {
  const now = new Date('2026-07-29T13:45:00.000Z')

  it('uses the same scalar defaults as Add property', () => {
    expect(defaultValueForTarget('text', now)).toBe('')
    expect(defaultValueForTarget('number', now)).toBe(0)
    expect(defaultValueForTarget('boolean', now)).toBe(false)
    expect(defaultValueForTarget('url', now)).toBe('https://')
    expect(defaultValueForTarget('email', now)).toBe('')
    expect(defaultValueForTarget('select', now)).toBe('')
    expect(defaultValueForTarget('relation', now)).toBe('')
    expect(defaultValueForTarget('date', now)).toBe('2026-07-29')
  })

  it('uses independent collection/object defaults', () => {
    expect(defaultValueForTarget('tags', now)).toEqual([])
    expect(defaultValueForTarget('file', now)).toEqual([])
    expect(defaultValueForTarget('complex', now)).toEqual({})
  })
})

describe('displayValue', () => {
  it('truncates long values to 200 chars + ellipsis', () => {
    const long = 'x'.repeat(300)
    const d = displayValue(long)!
    expect(d.length).toBe(201)
    expect(d.endsWith('…')).toBe(true)
  })

  it('renders null/undefined as null', () => {
    expect(displayValue(null)).toBeNull()
    expect(displayValue(undefined)).toBeNull()
  })

  it('stringifies structured values', () => {
    expect(displayValue(['a', 'b'])).toBe('["a","b"]')
  })
})

describe('planEntryFor', () => {
  const file = (fm: Record<string, unknown> | null) => ({
    path: 'docs/a.md',
    frontmatter: fm as never
  })

  it('flags malformed frontmatter as skip', () => {
    const e = planEntryFor(file(null), 'status', { kind: 'convert', target: 'number' })
    expect(e.action).toBe('skip')
    expect(e.reason).toBe('invalid YAML frontmatter')
  })

  it('classifies missing/null/empty values as no-value', () => {
    for (const fm of [{}, { status: null }, { status: '' }]) {
      const e = planEntryFor(file(fm), 'status', { kind: 'convert', target: 'number' })
      expect(e.action).toBe('no-value')
    }
  })

  it('classifies convertible, unchanged and skipped values', () => {
    expect(
      planEntryFor(file({ status: '3' }), 'status', { kind: 'convert', target: 'number' }).action
    ).toBe('convert')
    expect(
      planEntryFor(file({ status: 3 }), 'status', { kind: 'convert', target: 'number' }).action
    ).toBe('unchanged')
    const skipped = planEntryFor(file({ status: 'drafted' }), 'status', {
      kind: 'convert',
      target: 'number'
    })
    expect(skipped.action).toBe('skip')
    expect(skipped.reason).toBe('not a number')
  })

  it('rename: missing key untouched, collision skipped, value preserved', () => {
    expect(planEntryFor(file({}), 'status', { kind: 'rename', newKey: 'state' }).action).toBe(
      'no-value'
    )

    const collision = planEntryFor(file({ status: 'a', state: 'b' }), 'status', {
      kind: 'rename',
      newKey: 'state'
    })
    expect(collision.action).toBe('skip')
    expect(collision.reason).toBe('target key exists')

    const ok = planEntryFor(file({ status: 'a' }), 'status', { kind: 'rename', newKey: 'state' })
    expect(ok.action).toBe('rename')
    expect(ok.before).toBe('a')
  })

  it('add: creates only missing keys and never overwrites existing values', () => {
    const add = { kind: 'add', target: 'number' } as const
    expect(planEntryFor(file({}), 'score', add)).toEqual({
      path: 'docs/a.md',
      action: 'add',
      before: null,
      after: '0'
    })
    expect(planEntryFor(file({ score: 99 }), 'score', add)).toEqual({
      path: 'docs/a.md',
      action: 'unchanged',
      before: '99',
      after: '99',
      reason: 'property already exists'
    })
    expect(planEntryFor(file({ score: null }), 'score', add).action).toBe('unchanged')
  })

  it('drop: removes every present key, including null and empty values', () => {
    for (const value of ['draft', null, '', ['a'], { nested: true }]) {
      expect(planEntryFor(file({ status: value }), 'status', { kind: 'drop' })).toEqual({
        path: 'docs/a.md',
        action: 'drop',
        before: displayValue(value as never),
        after: null
      })
    }
    expect(planEntryFor(file({}), 'status', { kind: 'drop' })).toEqual({
      path: 'docs/a.md',
      action: 'no-value',
      before: null,
      after: null
    })
  })
})

describe('planPropertyOp', () => {
  const req = (over: Partial<PropertyOpRequest> = {}): PropertyOpRequest => ({
    collectionId: 'c1',
    scope: 'docs',
    filePath: null,
    key: 'status',
    op: { kind: 'convert', target: 'number' },
    ...over
  })

  it('computes totals across actions', () => {
    const plan = planPropertyOp(
      [
        { path: 'a.md', frontmatter: { status: '1' } },
        { path: 'b.md', frontmatter: { status: 2 } },
        { path: 'c.md', frontmatter: {} },
        { path: 'd.md', frontmatter: { status: 'bad' } },
        { path: 'e.md', frontmatter: null }
      ],
      req()
    )
    expect(plan.totals).toEqual({
      add: 0,
      convert: 1,
      drop: 0,
      unchanged: 1,
      noValue: 1,
      skip: 2
    })
    expect(plan.files).toHaveLength(5)
  })

  it('pins the schema for scoped converts (no trailing slash)', () => {
    const plan = planPropertyOp([], req({ scope: 'docs/guides/' }))
    expect(plan.schemaPin).toEqual({ scopeKey: 'docs/guides', fieldType: 'number' })
  })

  it('pins the global section for vault-wide scopes', () => {
    const plan = planPropertyOp([], req({ scope: '.' }))
    expect(plan.schemaPin).toEqual({ scopeKey: null, fieldType: 'number' })
  })

  it('includes allowed values for select targets', () => {
    const plan = planPropertyOp(
      [],
      req({ op: { kind: 'convert', target: 'select', allowedValues: ['a', 'b'] } })
    )
    expect(plan.schemaPin).toEqual({
      scopeKey: 'docs',
      fieldType: 'string',
      allowedValues: ['a', 'b']
    })
  })

  it('plans scoped adds, including an empty scope schema pin', () => {
    const plan = planPropertyOp(
      [
        { path: 'a.md', frontmatter: {} },
        { path: 'b.md', frontmatter: { priority: 7 } },
        { path: 'broken.md', frontmatter: null }
      ],
      req({ key: 'priority', op: { kind: 'add', target: 'number' } })
    )
    expect(plan.totals).toEqual({
      add: 1,
      convert: 0,
      drop: 0,
      unchanged: 1,
      noValue: 0,
      skip: 1
    })
    expect(plan.schemaPin).toEqual({ scopeKey: 'docs', fieldType: 'number' })

    expect(
      planPropertyOp([], req({ key: 'payload', op: { kind: 'add', target: 'complex' } })).schemaPin
    ).toEqual({ scopeKey: 'docs', fieldType: 'json' })
  })

  it('never pins for single-file (scope null) or rename ops', () => {
    expect(planPropertyOp([], req({ scope: null, filePath: 'a.md' })).schemaPin).toBeNull()
    expect(
      planPropertyOp([], req({ op: { kind: 'rename', newKey: 'state' } })).schemaPin
    ).toBeNull()
  })

  it('plans drop as vault-wide regardless of the requested origin scope', () => {
    const plan = planPropertyOp(
      [
        { path: 'docs/a.md', frontmatter: { status: '' } },
        { path: 'notes/b.md', frontmatter: { status: null } },
        { path: 'other.md', frontmatter: {} },
        { path: 'broken.md', frontmatter: null }
      ],
      req({ scope: 'docs', op: { kind: 'drop' } })
    )

    expect(plan.scope).toBe('.')
    expect(plan.totals).toEqual({
      add: 0,
      convert: 0,
      drop: 2,
      unchanged: 0,
      noValue: 1,
      skip: 1
    })
    expect(plan.schemaPin).toBeNull()
  })
})

describe('overlayScopeKey', () => {
  it('normalizes to no-trailing-slash and null for vault-wide', () => {
    expect(overlayScopeKey('docs/')).toBe('docs')
    expect(overlayScopeKey('docs/guides')).toBe('docs/guides')
    expect(overlayScopeKey('.')).toBeNull()
    expect(overlayScopeKey('')).toBeNull()
  })
})

describe('convertValue — to Relation (phase 42: schema pin, never a rewrite)', () => {
  it('passes strings through UNCHANGED (no value rewrite)', () => {
    expect(convertValue('[[clients/acme]]', 'relation')).toEqual({
      ok: true,
      value: '[[clients/acme]]',
      changed: false
    })
    // Even plain strings pass — the pin is on the schema, the CLI decides
    // what is link-shaped.
    expect(convertValue('acme', 'relation')).toEqual({ ok: true, value: 'acme', changed: false })
  })

  it('passes string arrays through unchanged', () => {
    expect(convertValue(['[[a]]', '[[b]]'], 'relation')).toEqual({
      ok: true,
      value: ['[[a]]', '[[b]]'],
      changed: false
    })
  })

  it('skips (reports) numbers, booleans, mixed arrays, and objects', () => {
    expect(convertValue(42, 'relation').ok).toBe(false)
    expect(convertValue(true, 'relation').ok).toBe(false)
    expect(convertValue(['[[a]]', 42], 'relation').ok).toBe(false)
    expect(convertValue({ a: 1 }, 'relation').ok).toBe(false)
  })
})

describe('relation storage kind + overlay type (phase 42)', () => {
  it('stores as string, pins as relation', () => {
    expect(storageKindFor('relation')).toBe('string')
    expect(overlayFieldTypeFor('relation')).toBe('relation')
  })
})

describe('convertValue — to File', () => {
  it('normalizes a legacy scalar to the canonical list shape', () => {
    expect(convertValue('[[assets/mockup.png]]', 'file')).toEqual({
      ok: true,
      value: ['[[assets/mockup.png]]'],
      changed: true
    })
  })

  it('keeps string arrays and rejects non-string values', () => {
    const links = ['[[assets/mockup.png]]', '[[documents/spec.pdf]]']
    expect(convertValue(links, 'file')).toEqual({ ok: true, value: links, changed: false })
    expect(convertValue(['[[assets/mockup.png]]', 42], 'file').ok).toBe(false)
    expect(convertValue(42, 'file').ok).toBe(false)
    expect(convertValue('[[notes/readme.md]]', 'file').ok).toBe(false)
    expect(convertValue('https://example.com/spec.pdf', 'file').ok).toBe(false)
  })

  it('stores as a list and pins the File overlay type', () => {
    expect(storageKindFor('file')).toBe('list')
    expect(overlayFieldTypeFor('file')).toBe('file')
  })
})
