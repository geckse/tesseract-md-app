import { describe, expect, it } from 'vitest'
import {
  computedFieldIcon,
  computedFieldMarker,
  computedFieldModule,
  isComputedFieldType,
  isLookupRollupFieldType
} from '@renderer/lib/computed-fields'

describe('computed field helpers', () => {
  it('classifies Formula, Lookup and Rollup without treating ordinary fields as computed', () => {
    expect(['Formula', 'Lookup', 'Rollup'].every(isComputedFieldType)).toBe(true)
    expect(isComputedFieldType('Relation')).toBe(false)
    expect(isLookupRollupFieldType('Formula')).toBe(false)
    expect(isLookupRollupFieldType('Lookup')).toBe(true)
  })

  it('routes Lookup and Rollup through one module while preserving distinct markers', () => {
    expect(computedFieldModule('Formula')).toBe('formula')
    expect(computedFieldModule('Lookup')).toBe('lookup_rollup')
    expect(computedFieldModule('Rollup')).toBe('lookup_rollup')
    expect(computedFieldIcon('Lookup')).toBe('manage_search')
    expect(computedFieldMarker('Formula')).toBe('ƒx')
    expect(computedFieldMarker('Lookup')).toBe('arrow_outward')
    expect(computedFieldMarker('Lookup')).not.toBe(computedFieldIcon('Lookup'))
    expect(computedFieldMarker('Rollup')).toBe('Σ')
  })
})
