/**
 * Shared FieldType ↔ UI-type mapping (phase 41).
 *
 * Single source of truth for translating the CLI's storage-level `FieldType`
 * into the UI-level property type used by the property panel and the table
 * view (formerly duplicated inline in `AddPropertyRow.svelte`).
 */

import type { FieldType } from '../types/cli'
import type { OverlayFieldPatch, PropertyTargetType } from '../../preload/api'
import { overlayFieldTypeForPropertyTarget } from '../../shared/property-schema'
import type { DetectedType } from '../components/wysiwyg/PropertyRow.svelte'

/** Immutable origin captured before a document-triggered schema mutation starts. */
export interface DocumentSchemaMutationContext {
  tabId: string
  filePath: string
  collectionPath: string
  collectionId: string
  scope: string | null
}

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
  Relation: 'relation',
  File: 'file',
  // Formula fields never enter editable type conversion; DocumentHeader
  // renders their materialized values through a dedicated read-only path.
  // This fallback keeps the storage-type mapping exhaustive.
  Formula: 'text'
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
  if (fieldType === 'File') return 'file'
  if (allowedValues?.length) return 'select'
  return FIELD_TO_DETECTED[fieldType] ?? 'text'
}

/**
 * Persisted schema-overlay representation for a UI property type.
 *
 * URL and Email are string presentation types, DateTime shares the schema's
 * Date storage type, and Select is a string field whose allowed values are
 * supplied separately by surfaces that collect them.
 */
export function schemaPatchForPropertyTarget(target: PropertyTargetType): OverlayFieldPatch {
  return { fieldType: overlayFieldTypeForPropertyTarget(target) }
}
