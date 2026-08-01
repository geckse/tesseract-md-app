import { describe, it, expect } from 'vitest'
import {
  FIELD_TO_DETECTED,
  detectedTypeForField,
  schemaPatchForPropertyTarget,
  UNION_CONGRUENT
} from '@renderer/lib/property-types'
import type { FieldType } from '@renderer/types/cli'
import type { PropertyTargetType } from '../../src/preload/api'

describe('property types — relation (phase 42)', () => {
  it('the two hand-synced type unions stay congruent (compile-time guard)', () => {
    // UNION_CONGRUENT only typechecks when DetectedType (PropertyRow.svelte)
    // and PropertyTargetType (api.d.ts) are identical unions — drift fails
    // `npm run typecheck` AND this import.
    expect(UNION_CONGRUENT).toBe(true)
  })

  it('maps every FieldType, including Relation → relation', () => {
    const fieldTypes: FieldType[] = [
      'String',
      'Number',
      'Boolean',
      'List',
      'Date',
      'Mixed',
      'Json',
      'Relation',
      'File'
    ]
    for (const ft of fieldTypes) {
      expect(FIELD_TO_DETECTED[ft]).toBeDefined()
    }
    expect(FIELD_TO_DETECTED.Relation).toBe('relation')
    expect(FIELD_TO_DETECTED.File).toBe('file')
    expect(FIELD_TO_DETECTED.Json).toBe('complex')
    expect(FIELD_TO_DETECTED.Mixed).toBe('text')
  })

  it('Relation wins over allowed_values in detectedTypeForField', () => {
    expect(detectedTypeForField('Relation', ['a', 'b'])).toBe('relation')
    expect(detectedTypeForField('Relation', null)).toBe('relation')
    // Non-relation fields keep the allowed_values → select rule.
    expect(detectedTypeForField('String', ['a'])).toBe('select')
  })

  it('maps every addable property type to its persisted schema field type', () => {
    const expected: Record<PropertyTargetType, string> = {
      text: 'string',
      number: 'number',
      boolean: 'boolean',
      date: 'date',
      datetime: 'date',
      url: 'string',
      email: 'string',
      select: 'string',
      tags: 'list',
      relation: 'relation',
      file: 'file',
      complex: 'json'
    }

    for (const [target, fieldType] of Object.entries(expected)) {
      expect(schemaPatchForPropertyTarget(target as PropertyTargetType)).toEqual({ fieldType })
    }
  })
})
