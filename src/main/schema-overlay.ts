/**
 * App-side writer for the mdvdb schema overlay (`.markdownvdb.schema.yml`).
 *
 * The overlay is core-documented YAML config the CLI merges into inferred
 * schemas on every full ingest. This module is the app's ONLY write path for
 * it (phase 41). Rules:
 *  - eemeli `yaml` Document API (`setIn`/`deleteIn`) so user comments and
 *    untouched entries survive — never hand-rolled string splicing.
 *  - Scope keys are relative folder paths WITHOUT a trailing slash (matching
 *    the CLI's `schema_key`); `null` targets the global `fields:` section.
 *  - A malformed existing overlay ABORTS the write — never clobbered.
 *  - Atomic dotfile-temp + rename, registered as an own-write so neither
 *    watcher tier reacts.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Document, isMap, parseDocument } from 'yaml'
import { atomicWriteFile } from './atomic-write'
import { registerOwnWrite } from './own-writes'
import type { OverlayFieldPatch } from '../preload/api'
import {
  PROPERTY_VALUE_ACCENT_COLOR_COUNT,
  PROPERTY_VALUE_NEUTRAL_COLOR_COUNT,
  type PropertyValueColors,
  type PropertyValueColorSelection
} from '../shared/value-colors'

export const OVERLAY_FILENAME = '.markdownvdb.schema.yml'

/** Error thrown when an existing overlay file is present but unparseable. */
export class MalformedOverlayError extends Error {
  constructor() {
    super(`Existing ${OVERLAY_FILENAME} is not valid YAML; refusing to overwrite it.`)
    this.name = 'MalformedOverlayError'
  }
}

/** Overlay `field_type` strings the CLI accepts (schema.rs parse_field_type_str). */
const VALID_FIELD_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bool',
  'list',
  'array',
  'date',
  'mixed',
  'relation',
  'file',
  'formula'
])

const VALID_FORMULA_RESULT_TYPES = new Set([
  'String',
  'Number',
  'Boolean',
  'Date',
  'DateTime',
  'List',
  'Json'
])

async function loadOverlayDocument(root: string): Promise<{ doc: Document; existed: boolean }> {
  const path = join(root, OVERLAY_FILENAME)
  let raw: string | null = null
  try {
    raw = await fs.readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (raw === null) {
    return { doc: new Document({}), existed: false }
  }
  const doc = parseDocument(raw)
  if (doc.errors.length > 0) throw new MalformedOverlayError()
  // An empty file parses to null contents — ensure a map root for setIn. Any
  // other scalar/sequence root is valid YAML but not a schema overlay and must
  // never be silently replaced.
  if (doc.contents == null) {
    doc.contents = doc.createNode({}) as Document['contents']
  } else if (!isMap(doc.contents)) {
    throw new MalformedOverlayError()
  }
  return { doc, existed: true }
}

/** Atomic write of the overlay document (dotfile temp + rename + own-write). */
async function writeOverlayDocument(root: string, doc: Document): Promise<void> {
  const path = join(root, OVERLAY_FILENAME)
  const content = doc.toString()
  registerOwnWrite(path, 'write', content)
  await atomicWriteFile(path, content)
}

/** The YAML path to a field's map for a scope (`null` = global `fields:`). */
function fieldPath(scopeKey: string | null, key: string): (string | number)[] {
  return scopeKey === null ? ['fields', key] : ['scopes', scopeKey, 'fields', key]
}

/**
 * `yaml`'s `deleteIn()` throws when an intermediate path does not exist.
 * Clearing an optional annotation from a field with no overlay entry is a
 * legitimate no-op, so probe the full path before deleting it.
 */
function deleteInIfPresent(doc: Document, path: (string | number)[]): void {
  if (doc.hasIn(path)) doc.deleteIn(path)
}

function hasYamlComment(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const node = value as { comment?: unknown; commentBefore?: unknown }
  return Boolean(node.comment || node.commentBefore)
}

function deleteEmptyMap(doc: Document, path: (string | number)[]): void {
  const node = doc.getIn(path, true)
  if (!isMap(node) || node.items.length !== 0 || hasYamlComment(node)) return

  const parent = doc.getIn(path.slice(0, -1), true)
  const key = path.at(-1)
  const pair = isMap(parent)
    ? parent.items.find((item) => {
        const pairKey = (item.key as { value?: unknown } | null)?.value ?? item.key
        return pairKey === key
      })
    : undefined
  if (!hasYamlComment(pair)) doc.deleteIn(path)
}

function scopeMatchesPath(path: string, scope: string): boolean {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const normalizedScope = scope.replace(/^\/+|\/+$/g, '')
  return (
    normalizedScope === '' ||
    normalizedPath === normalizedScope ||
    normalizedPath.startsWith(`${normalizedScope}/`)
  )
}

function parseStoredValueColor(raw: unknown): PropertyValueColorSelection | null {
  if (
    Number.isInteger(raw) &&
    (raw as number) >= 0 &&
    (raw as number) < PROPERTY_VALUE_ACCENT_COLOR_COUNT
  ) {
    return { palette: 'accent', slot: raw as number }
  }

  if (typeof raw === 'string') {
    const match = /^(accent|neutral):(\d+)$/.exec(raw)
    if (!match) return null
    const palette = match[1] as PropertyValueColorSelection['palette']
    const slot = Number(match[2])
    const count =
      palette === 'accent' ? PROPERTY_VALUE_ACCENT_COLOR_COUNT : PROPERTY_VALUE_NEUTRAL_COLOR_COUNT
    return slot >= 0 && slot < count ? { palette, slot } : null
  }

  return null
}

function mergeValueColorFields(result: PropertyValueColors, fields: unknown): PropertyValueColors {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return result

  for (const [field, rawConfig] of Object.entries(fields)) {
    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) continue
    const rawColors = (rawConfig as Record<string, unknown>).value_colors
    if (typeof rawColors !== 'object' || rawColors === null || Array.isArray(rawColors)) continue

    const colors = { ...(result[field] ?? {}) }
    for (const [value, rawSelection] of Object.entries(rawColors)) {
      const selection = parseStoredValueColor(rawSelection)
      if (selection) colors[value] = selection
    }
    if (Object.keys(colors).length > 0) result[field] = colors
  }
  return result
}

/** Resolve global + matching scope value colors with the same layering as the CLI schema. */
function resolvedValueColors(doc: Document, scopeKey: string | null): PropertyValueColors {
  const overlay = doc.toJS() as {
    fields?: unknown
    scopes?: Record<string, { fields?: unknown }>
  } | null
  const result: PropertyValueColors = {}
  if (!overlay) return result

  mergeValueColorFields(result, overlay.fields)
  if (scopeKey === null || !overlay.scopes) return result

  const matchingScopes = Object.entries(overlay.scopes)
    .filter(([scope]) => scopeMatchesPath(scopeKey, scope))
    .sort(([left], [right]) => left.length - right.length)
  for (const [, scope] of matchingScopes) mergeValueColorFields(result, scope?.fields)
  return result
}

/** Read synced Select/Tags color overrides from `.markdownvdb.schema.yml`. */
export async function readOverlayValueColors(
  root: string,
  scopeKey: string | null
): Promise<PropertyValueColors> {
  const { doc } = await loadOverlayDocument(root)
  return resolvedValueColors(doc, scopeKey)
}

/**
 * Persist a palette selection alongside the field schema. Numeric values stay
 * backward compatible as accent slots; neutral slots use `neutral:N`.
 */
export async function setOverlayValueColor(
  root: string,
  scopeKey: string | null,
  key: string,
  value: string,
  selection: PropertyValueColorSelection | null
): Promise<PropertyValueColors> {
  if (scopeKey !== null && (scopeKey === '' || scopeKey.endsWith('/'))) {
    throw new Error(
      `Overlay scope keys must be non-empty and have no trailing slash: "${scopeKey}"`
    )
  }
  if (!key || !value) throw new Error('Field and value are required for a property value color')
  if (selection !== null) {
    const count =
      selection.palette === 'accent'
        ? PROPERTY_VALUE_ACCENT_COLOR_COUNT
        : selection.palette === 'neutral'
          ? PROPERTY_VALUE_NEUTRAL_COLOR_COUNT
          : 0
    if (!Number.isInteger(selection.slot) || selection.slot < 0 || selection.slot >= count) {
      throw new Error(`Invalid ${selection.palette} property value color slot`)
    }
  }

  const { doc } = await loadOverlayDocument(root)
  const base = fieldPath(scopeKey, key)
  const colorsPath = [...base, 'value_colors']
  const existingColors = doc.getIn(colorsPath, true)
  if (existingColors !== undefined && !isMap(existingColors)) {
    throw new Error(`Expected YAML collection at ${key}.value_colors`)
  }

  const valuePath = [...colorsPath, value]
  if (selection === null) {
    if (!doc.hasIn(valuePath)) return resolvedValueColors(doc, scopeKey)
    doc.deleteIn(valuePath)
    deleteEmptyMap(doc, colorsPath)
    deleteEmptyMap(doc, base)

    const fieldsPath = scopeKey === null ? ['fields'] : ['scopes', scopeKey, 'fields']
    deleteEmptyMap(doc, fieldsPath)
    if (scopeKey !== null) {
      deleteEmptyMap(doc, ['scopes', scopeKey])
      deleteEmptyMap(doc, ['scopes'])
    }
  } else {
    doc.setIn(
      valuePath,
      selection.palette === 'accent' ? selection.slot : `neutral:${selection.slot}`
    )
  }

  await writeOverlayDocument(root, doc)
  return resolvedValueColors(doc, scopeKey)
}

/**
 * Insert or update one field's overlay entry. `null` patch members clear the
 * annotation; `undefined` members are left untouched.
 */
export async function upsertOverlayField(
  root: string,
  scopeKey: string | null,
  key: string,
  patch: OverlayFieldPatch
): Promise<void> {
  if (scopeKey !== null && (scopeKey === '' || scopeKey.endsWith('/'))) {
    throw new Error(
      `Overlay scope keys must be non-empty and have no trailing slash: "${scopeKey}"`
    )
  }
  if (
    patch.fieldType !== undefined &&
    patch.fieldType !== null &&
    !VALID_FIELD_TYPES.has(patch.fieldType)
  ) {
    throw new Error(`Invalid overlay field_type: "${patch.fieldType}"`)
  }
  if (
    patch.resultType !== undefined &&
    patch.resultType !== null &&
    !VALID_FORMULA_RESULT_TYPES.has(patch.resultType)
  ) {
    throw new Error(`Invalid formula result_type: "${patch.resultType}"`)
  }
  if (patch.formula !== undefined && patch.formula !== null && patch.formula.trim() === '') {
    throw new Error('Formula expression cannot be empty')
  }
  // Relation target folders follow the phase-41 folder-key grammar: relative
  // path, non-empty, NO trailing slash (the CLI emits `relation_target`
  // slash-less and accepts only this form from the app).
  if (patch.target !== undefined && patch.target !== null) {
    const target = patch.target
    if (target === '' || target.endsWith('/')) {
      throw new Error(
        `Relation target folders must be non-empty and have no trailing slash: "${target}"`
      )
    }
  }

  const { doc } = await loadOverlayDocument(root)
  const base = fieldPath(scopeKey, key)

  if (patch.fieldType !== undefined) {
    if (patch.fieldType === null) deleteInIfPresent(doc, [...base, 'field_type'])
    else doc.setIn([...base, 'field_type'], patch.fieldType)
  }
  if (patch.description !== undefined) {
    if (patch.description === null) deleteInIfPresent(doc, [...base, 'description'])
    else doc.setIn([...base, 'description'], patch.description)
  }
  if (patch.required !== undefined) {
    if (patch.required === null) deleteInIfPresent(doc, [...base, 'required'])
    else doc.setIn([...base, 'required'], patch.required)
  }
  if (patch.allowedValues !== undefined) {
    if (patch.allowedValues === null || patch.allowedValues.length === 0) {
      deleteInIfPresent(doc, [...base, 'allowed_values'])
    } else {
      doc.setIn([...base, 'allowed_values'], patch.allowedValues)
    }
  }
  if (patch.target !== undefined) {
    if (patch.target === null) deleteInIfPresent(doc, [...base, 'target'])
    else doc.setIn([...base, 'target'], patch.target)
  }
  if (patch.formula !== undefined) {
    if (patch.formula === null) deleteInIfPresent(doc, [...base, 'formula'])
    else doc.setIn([...base, 'formula'], patch.formula)
  }
  if (patch.resultType !== undefined) {
    if (patch.resultType === null) deleteInIfPresent(doc, [...base, 'result_type'])
    else doc.setIn([...base, 'result_type'], patch.resultType.toLowerCase())
  }

  // Clearing a formula definition may leave an empty field/scope shell. Prune
  // only empty maps; comments and unrelated annotations stay untouched.
  deleteEmptyMap(doc, base)
  const fieldsPath = scopeKey === null ? ['fields'] : ['scopes', scopeKey, 'fields']
  deleteEmptyMap(doc, fieldsPath)
  if (scopeKey !== null) {
    deleteEmptyMap(doc, ['scopes', scopeKey])
    deleteEmptyMap(doc, ['scopes'])
  }

  await writeOverlayDocument(root, doc)
}

/** Remove one complete overlay field entry while preserving the rest of the document. */
export async function removeOverlayField(
  root: string,
  scopeKey: string | null,
  key: string
): Promise<boolean> {
  const { doc, existed } = await loadOverlayDocument(root)
  if (!existed) return false
  const base = fieldPath(scopeKey, key)
  if (!doc.hasIn(base)) return false

  doc.deleteIn(base)
  const fieldsPath = scopeKey === null ? ['fields'] : ['scopes', scopeKey, 'fields']
  deleteEmptyMap(doc, fieldsPath)
  if (scopeKey !== null) {
    deleteEmptyMap(doc, ['scopes', scopeKey])
    deleteEmptyMap(doc, ['scopes'])
  }
  await writeOverlayDocument(root, doc)
  return true
}

/**
 * Remove every global and scoped definition for one field.
 *
 * Drop-column is deliberately vault-wide, so leaving a descendant override
 * behind would make the column reappear in that database after the next
 * schema refresh. The complete overlay is parsed and structurally checked
 * before the first mutation, then written once atomically.
 */
export async function removeOverlayFieldEverywhere(root: string, key: string): Promise<boolean> {
  const { doc, existed } = await loadOverlayDocument(root)
  if (!existed) return false

  const overlay = doc.toJS() as unknown
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
    throw new MalformedOverlayError()
  }
  const rootMap = overlay as Record<string, unknown>
  const fields = rootMap.fields
  if (
    fields !== undefined &&
    (fields === null || typeof fields !== 'object' || Array.isArray(fields))
  ) {
    throw new Error(`Expected YAML collection at fields`)
  }
  const scopes = rootMap.scopes
  if (
    scopes !== undefined &&
    (scopes === null || typeof scopes !== 'object' || Array.isArray(scopes))
  ) {
    throw new Error(`Expected YAML collection at scopes`)
  }

  const hasOwn = (value: object, property: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, property)
  const removeGlobal = fields !== undefined && hasOwn(fields as object, key)
  const scopedMatches: string[] = []

  if (scopes !== undefined) {
    for (const [scopeKey, rawScope] of Object.entries(scopes as Record<string, unknown>)) {
      if (rawScope === null || typeof rawScope !== 'object' || Array.isArray(rawScope)) {
        throw new Error(`Expected YAML collection at scopes.${scopeKey}`)
      }
      const scopeFields = (rawScope as Record<string, unknown>).fields
      if (
        scopeFields !== undefined &&
        (scopeFields === null || typeof scopeFields !== 'object' || Array.isArray(scopeFields))
      ) {
        throw new Error(`Expected YAML collection at scopes.${scopeKey}.fields`)
      }
      if (scopeFields !== undefined && hasOwn(scopeFields as object, key)) {
        scopedMatches.push(scopeKey)
      }
    }
  }

  if (!removeGlobal && scopedMatches.length === 0) return false

  if (removeGlobal) {
    doc.deleteIn(fieldPath(null, key))
    deleteEmptyMap(doc, ['fields'])
  }
  for (const scopeKey of scopedMatches) {
    doc.deleteIn(fieldPath(scopeKey, key))
    deleteEmptyMap(doc, ['scopes', scopeKey, 'fields'])
    deleteEmptyMap(doc, ['scopes', scopeKey])
  }
  deleteEmptyMap(doc, ['scopes'])

  await writeOverlayDocument(root, doc)
  return true
}

/** Exact on-disk state used to roll back a failed formula module run. */
export interface OverlaySnapshot {
  existed: boolean
  content: string | null
}

export async function captureOverlaySnapshot(root: string): Promise<OverlaySnapshot> {
  const path = join(root, OVERLAY_FILENAME)
  try {
    return { existed: true, content: await fs.readFile(path, 'utf-8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { existed: false, content: null }
    }
    throw error
  }
}

export async function restoreOverlaySnapshot(
  root: string,
  snapshot: OverlaySnapshot
): Promise<void> {
  const path = join(root, OVERLAY_FILENAME)
  if (snapshot.existed) {
    const content = snapshot.content ?? ''
    registerOwnWrite(path, 'write', content)
    await atomicWriteFile(path, content)
  } else {
    registerOwnWrite(path, 'delete')
    await fs.rm(path, { force: true })
  }
}

/**
 * Locate the most-specific overlay definition that currently produces a
 * formula column for `scopeKey`. `undefined` means there is no formula
 * definition; `null` identifies the global `fields:` map.
 */
export async function resolveOverlayFormulaScope(
  root: string,
  scopeKey: string | null,
  key: string
): Promise<string | null | undefined> {
  const { doc } = await loadOverlayDocument(root)
  const overlay = doc.toJS() as {
    fields?: Record<string, { field_type?: unknown }>
    scopes?: Record<string, { fields?: Record<string, { field_type?: unknown }> }>
  } | null
  if (!overlay) return undefined

  let origin: string | null | undefined
  const global = overlay.fields?.[key]
  if (typeof global?.field_type === 'string' && global.field_type.toLowerCase() === 'formula') {
    origin = null
  }
  if (scopeKey === null || !overlay.scopes) return origin

  const matching = Object.entries(overlay.scopes)
    .filter(([scope]) => scopeMatchesPath(scopeKey, scope))
    .sort(([left], [right]) => left.length - right.length)
  for (const [scope, value] of matching) {
    const field = value.fields?.[key]
    if (field === undefined) continue
    origin =
      typeof field.field_type === 'string' && field.field_type.toLowerCase() === 'formula'
        ? scope
        : undefined
  }
  return origin
}

/**
 * Move a field's overlay entry to a new key within its scope. Returns whether
 * anything was actually renamed (false when the field had no overlay entry).
 */
export async function renameOverlayField(
  root: string,
  scopeKey: string | null,
  oldKey: string,
  newKey: string
): Promise<boolean> {
  const { doc, existed } = await loadOverlayDocument(root)
  if (!existed) return false

  const oldPath = fieldPath(scopeKey, oldKey)
  const node = doc.getIn(oldPath, true)
  if (node === undefined) return false

  doc.setIn(fieldPath(scopeKey, newKey), node)
  doc.deleteIn(oldPath)
  await writeOverlayDocument(root, doc)
  return true
}
