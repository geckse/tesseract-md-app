import { describe, it, expect } from 'vitest'
import {
  FIELD_TO_DETECTED,
  detectedTypeForField,
  UNION_CONGRUENT
} from '@renderer/lib/property-types'
import type { FieldType } from '@renderer/types/cli'

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
      'Relation'
    ]
    for (const ft of fieldTypes) {
      expect(FIELD_TO_DETECTED[ft]).toBeDefined()
    }
    expect(FIELD_TO_DETECTED.Relation).toBe('relation')
  })

  it('Relation wins over allowed_values in detectedTypeForField', () => {
    expect(detectedTypeForField('Relation', ['a', 'b'])).toBe('relation')
    expect(detectedTypeForField('Relation', null)).toBe('relation')
    // Non-relation fields keep the allowed_values → select rule.
    expect(detectedTypeForField('String', ['a'])).toBe('select')
  })
})
