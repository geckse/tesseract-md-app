/**
 * Shared FieldType ↔ UI-type mapping (phase 41).
 *
 * Single source of truth for translating the CLI's storage-level `FieldType`
 * into the UI-level property type used by the property panel and the table
 * view (formerly duplicated inline in `AddPropertyRow.svelte`).
 */

import type { FieldType } from '../types/cli'
import type { PropertyTargetType } from '../../preload/api'

/** CLI storage type → UI property type. */
export const FIELD_TO_DETECTED: Record<FieldType, PropertyTargetType> = {
  String: 'text',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  List: 'tags',
  Mixed: 'text'
}

/**
 * UI property type for a schema field / table column: `allowed_values` wins
 * (renders a select everywhere), otherwise the storage type maps directly.
 */
export function detectedTypeForField(
  fieldType: FieldType,
  allowedValues?: string[] | null
): PropertyTargetType {
  if (allowedValues?.length) return 'select'
  return FIELD_TO_DETECTED[fieldType] ?? 'text'
}
