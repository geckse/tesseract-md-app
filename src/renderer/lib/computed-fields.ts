import type { FieldType, FormulaResultType } from '../types/cli'

export type ComputedFieldType = Extract<FieldType, 'Formula' | 'Lookup' | 'Rollup'>

const COMPUTED_FIELD_TYPES = new Set<FieldType>(['Formula', 'Lookup', 'Rollup'])

export function isComputedFieldType(
  fieldType: FieldType | string | null | undefined
): fieldType is ComputedFieldType {
  return COMPUTED_FIELD_TYPES.has(fieldType as FieldType)
}

export function isLookupRollupFieldType(
  fieldType: FieldType | string | null | undefined
): fieldType is 'Lookup' | 'Rollup' {
  return fieldType === 'Lookup' || fieldType === 'Rollup'
}

export function computedFieldLabel(fieldType: ComputedFieldType): string {
  return fieldType
}

export function computedFieldIcon(fieldType: ComputedFieldType): string {
  if (fieldType === 'Lookup') return 'manage_search'
  if (fieldType === 'Rollup') return 'functions'
  return 'function'
}

export function computedFieldMarker(fieldType: ComputedFieldType): string {
  if (fieldType === 'Lookup') return 'arrow_outward'
  if (fieldType === 'Rollup') return 'Σ'
  return 'ƒx'
}

export function computedFieldModule(fieldType: ComputedFieldType): 'formula' | 'lookup_rollup' {
  return fieldType === 'Formula' ? 'formula' : 'lookup_rollup'
}

export function computedResultType(
  fieldType: FieldType,
  resultType: FormulaResultType | null | undefined
): FormulaResultType | null {
  return fieldType === 'Formula' || fieldType === 'Rollup' ? (resultType ?? 'Json') : null
}
