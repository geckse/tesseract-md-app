/**
 * Shared FieldType ↔ UI-type mapping (phase 41).
 *
 * Single source of truth for translating the CLI's storage-level `FieldType`
 * into the UI-level property type used by the property panel and the table
 * view (formerly duplicated inline in `AddPropertyRow.svelte`).
 */

import type { FieldType } from '../types/cli'
import type { PropertyTargetType } from '../../preload/api'
import type { DetectedType } from '../components/wysiwyg/PropertyRow.svelte'

/**
 * COMPILE-TIME congruence guard for the two hand-synced type unions:
 * `DetectedType` (PropertyRow.svelte) and `PropertyTargetType` (api.d.ts) are
 * intentionally duplicated across the renderer/preload boundary. Adding a
 * member to one but not the other fails `npm run typecheck` right here (and
 * the unit test importing UNION_CONGRUENT).
 */
type UnionCongruence = [DetectedType] extends [PropertyTargetType]
  ? [PropertyTargetType] extends [DetectedType]
    ? true
    : never
  : never
export const UNION_CONGRUENT: UnionCongruence = true

/** CLI storage type → UI property type. */
export const FIELD_TO_DETECTED: Record<FieldType, PropertyTargetType> = {
  String: 'text',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  List: 'tags',
  Mixed: 'text',
  Relation: 'relation'
}

/**
 * UI property type for a schema field / table column: `Relation` wins over
 * `allowed_values` (a relation with allowed values is nonsensical — guard
 * anyway), then `allowed_values` (renders a select everywhere), otherwise the
 * storage type maps directly.
 */
export function detectedTypeForField(
  fieldType: FieldType,
  allowedValues?: string[] | null
): PropertyTargetType {
  if (fieldType === 'Relation') return 'relation'
  if (allowedValues?.length) return 'select'
  return FIELD_TO_DETECTED[fieldType] ?? 'text'
}
