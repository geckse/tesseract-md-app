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
import { Document, isMap, isScalar, parseDocument } from 'yaml'
import { atomicDeleteFile, atomicWriteFile } from './atomic-write'
import { registerOwnWrite } from './own-writes'
import { withSerializedFileWrite } from './file-write-queue'
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
  'json',
  'relation',
  'file',
  'formula',
  'lookup',
  'rollup'
])

const VALID_RELATION_DIRECTIONS = new Set(['outgoing', 'incoming'])

const VALID_FORMULA_RESULT_TYPES = new Set([
  'String',
  'Number',
  'Boolean',
  'Date',
  'DateTime',
  'List',
  'Json'
])

export interface OverlaySnapshot {
  existed: boolean
  content: string | null
}

export interface OverlayMutationOptions {
  /** Exact generation this mutation was prepared from. Callers that may need
   * to roll back must use this snapshot rather than racing a separate read. */
  onPrepared?: (snapshot: OverlaySnapshot) => void
  /** Final coordination hook, primarily for deterministic race tests. The
   * exact-baseline CAS always runs after this hook. */
  beforeCommit?: () => void | Promise<void>
  /** Called synchronously once the new overlay generation is visible, even if
   * the subsequent directory fsync reports an error. */
  onPublished?: (snapshot: OverlaySnapshot) => void
  /** Rename an existing Lookup/Rollup definition while applying `patch`.
   * The source must exist at `scopeKey`, retain its computed kind, and the
   * destination must not collide with any overlay field whose scope overlaps
   * the source definition's effective subtree. */
  previousKey?: string
  /** Create-only guard. The destination must be absent from every overlay
   * layer overlapping `scopeKey` in the same generation being published. */
  requireAbsent?: boolean
}

function snapshotsEqual(left: OverlaySnapshot, right: OverlaySnapshot): boolean {
  return left.existed === right.existed && left.content === right.content
}

function overlayChangedError(context: string): Error {
  return new Error(
    `${OVERLAY_FILENAME} changed ${context}; refusing to overwrite the newer overlay.`
  )
}

function revokeOwnWrite(callback: unknown): void {
  if (typeof callback === 'function') callback()
}

async function captureOverlaySnapshotUnlocked(root: string): Promise<OverlaySnapshot> {
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

async function loadOverlayDocument(
  root: string
): Promise<{ doc: Document; existed: boolean; snapshot: OverlaySnapshot }> {
  const path = join(root, OVERLAY_FILENAME)
  let raw: string | null = null
  try {
    raw = await fs.readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (raw === null) {
    const snapshot = { existed: false, content: null } as const
    return { doc: new Document({}), existed: false, snapshot }
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
  return { doc, existed: true, snapshot: { existed: true, content: raw } }
}

/**
 * Serialize publication of one exact overlay generation. The baseline is
 * checked after entering the per-file queue and again immediately before the
 * atomic rename. A stale app window therefore fails closed instead of erasing
 * another window's schema edit.
 */
async function writeOverlayDocument(
  root: string,
  doc: Document,
  expected: OverlaySnapshot,
  options: OverlayMutationOptions = {}
): Promise<OverlaySnapshot> {
  const path = join(root, OVERLAY_FILENAME)
  const content = doc.toString()
  const publishedSnapshot: OverlaySnapshot = { existed: true, content }
  return withSerializedFileWrite(path, async () => {
    if (!snapshotsEqual(await captureOverlaySnapshotUnlocked(root), expected)) {
      throw overlayChangedError('after this edit was prepared')
    }

    let cancelOwnWrite: (() => void) | null = null
    let published = false
    try {
      await atomicWriteFile(path, content, {
        allowedRoot: root,
        beforeCommit: async () => {
          await options.beforeCommit?.()
          if (!snapshotsEqual(await captureOverlaySnapshotUnlocked(root), expected)) {
            throw overlayChangedError('before this edit could be committed')
          }
          cancelOwnWrite = registerOwnWrite(path, 'write', content)
        },
        onPublished: () => {
          published = true
          options.onPublished?.(publishedSnapshot)
        }
      })
    } catch (error) {
      if (!published) revokeOwnWrite(cancelOwnWrite)
      throw error
    }
    return publishedSnapshot
  })
}

/** The YAML path to a field's map for a scope (`null` = global `fields:`). */
function fieldPath(scopeKey: string | null, key: string): (string | number)[] {
  return scopeKey === null ? ['fields', key] : ['scopes', scopeKey, 'fields', key]
}

function yamlKeyValue(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as { value?: unknown }).value
  }
  return value
}

function validateComputedFieldKey(key: string, label: string): void {
  if (key.trim() === '') throw new Error(`${label} is required`)
  if (key !== key.trim()) throw new Error(`${label} cannot start or end with spaces`)
  if (
    [...key].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new Error(`${label} cannot contain control characters`)
  }
  if (key === 'title' || key === 'path') {
    throw new Error(`"${key}" is reserved and cannot be a computed field`)
  }
}

function normalizedOverlayFieldType(
  fieldType: unknown,
  typeAlias: unknown,
  location: string
): string | undefined {
  const normalize = (value: unknown, key: 'field_type' | 'type'): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'string') {
      throw new Error(`Expected ${location}.${key} to be a string`)
    }
    return value.toLowerCase()
  }
  const primary = normalize(fieldType, 'field_type')
  const alias = normalize(typeAlias, 'type')
  if (primary !== undefined && alias !== undefined && primary !== alias) {
    throw new Error(
      `Conflicting field_type/type definitions at ${location}: "${fieldType}" vs "${typeAlias}"`
    )
  }
  return primary ?? alias
}

function scopeDomainsOverlap(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return true
  return scopeMatchesPath(left, right) || scopeMatchesPath(right, left)
}

/** Find a destination field that would overlap the renamed definition's
 * effective scope. A global definition overlaps every folder; scoped
 * definitions overlap ancestors and descendants but not sibling trees. */
function findOverlayFieldCollision(
  doc: Document,
  sourceScope: string | null,
  key: string
): string | null | undefined {
  const globalFields = doc.getIn(['fields'], true)
  if (globalFields !== undefined && !isMap(globalFields)) {
    throw new Error('Expected YAML collection at fields')
  }
  if (doc.hasIn(fieldPath(null, key))) return null

  const scopes = doc.getIn(['scopes'], true)
  if (scopes === undefined) return undefined
  if (!isMap(scopes)) throw new Error('Expected YAML collection at scopes')

  for (const item of scopes.items) {
    const scope = yamlKeyValue(item.key)
    if (typeof scope !== 'string') throw new Error('Overlay scope keys must be strings')
    if (!scopeDomainsOverlap(sourceScope, scope)) continue
    const fields = doc.getIn(['scopes', scope, 'fields'], true)
    if (fields !== undefined && !isMap(fields)) {
      throw new Error(`Expected YAML collection at scopes.${scope}.fields`)
    }
    if (doc.hasIn(fieldPath(scope, key))) return scope
  }
  return undefined
}

function overlappingOverlayFieldsWithKey(
  doc: Document,
  sourceScope: string | null,
  key: string
): string[] {
  const matches: string[] = []
  const globalFields = doc.getIn(['fields'], true)
  if (globalFields !== undefined && !isMap(globalFields)) {
    throw new Error('Expected YAML collection at fields')
  }
  if (sourceScope !== null && doc.hasIn(fieldPath(null, key))) matches.push('global')

  const scopes = doc.getIn(['scopes'], true)
  if (scopes === undefined) return matches
  if (!isMap(scopes)) throw new Error('Expected YAML collection at scopes')
  for (const item of scopes.items) {
    const scope = yamlKeyValue(item.key)
    if (typeof scope !== 'string') throw new Error('Overlay scope keys must be strings')
    if (scope === sourceScope || !scopeDomainsOverlap(sourceScope, scope)) continue
    const fields = doc.getIn(['scopes', scope, 'fields'], true)
    if (fields !== undefined && !isMap(fields)) {
      throw new Error(`Expected YAML collection at scopes.${scope}.fields`)
    }
    if (doc.hasIn(fieldPath(scope, key))) matches.push(scope)
  }
  return matches.sort()
}

function lookupRollupDependents(doc: Document, sourceKey: string): string[] {
  const dependents: string[] = []
  const inspectFields = (scope: string | null, fields: unknown): void => {
    if (fields === undefined) return
    if (!isMap(fields)) {
      const location = scope === null ? 'fields' : `scopes.${scope}.fields`
      throw new Error(`Expected YAML collection at ${location}`)
    }
    for (const item of fields.items) {
      const field = yamlKeyValue(item.key)
      if (typeof field !== 'string') throw new Error('Overlay field keys must be strings')
      if (!isMap(item.value)) {
        const location = scope === null ? field : `scopes.${scope}.fields.${field}`
        throw new Error(`Expected YAML collection at ${location}`)
      }
      const location = scope === null ? `fields.${field}` : `scopes.${scope}.fields.${field}`
      const fieldType = normalizedOverlayFieldType(
        item.value.get('field_type'),
        item.value.get('type'),
        location
      )
      if (fieldType !== 'lookup' && fieldType !== 'rollup') continue
      if (item.value.get('target_field') !== sourceKey) continue
      dependents.push(scope === null ? `global.${field}` : `${scope}.${field}`)
    }
  }

  inspectFields(null, doc.getIn(['fields'], true))
  const scopes = doc.getIn(['scopes'], true)
  if (scopes === undefined) return dependents
  if (!isMap(scopes)) throw new Error('Expected YAML collection at scopes')
  for (const item of scopes.items) {
    const scope = yamlKeyValue(item.key)
    if (typeof scope !== 'string') throw new Error('Overlay scope keys must be strings')
    if (!isMap(item.value)) throw new Error(`Expected YAML collection at scopes.${scope}`)
    inspectFields(scope, item.value.get('fields', true))
  }
  return dependents.sort()
}

/** Rename a key in place so Pair/value comments and field order survive. */
function renameOverlayFieldPair(
  doc: Document,
  scopeKey: string | null,
  oldKey: string,
  newKey: string
): void {
  const parentPath = fieldPath(scopeKey, oldKey).slice(0, -1)
  const fields = doc.getIn(parentPath, true)
  if (!isMap(fields)) {
    throw new Error(`Lookup/Rollup definition "${oldKey}" is not defined at its resolved origin`)
  }
  const pair = fields.items.find((item) => yamlKeyValue(item.key) === oldKey)
  if (!pair) {
    throw new Error(`Lookup/Rollup definition "${oldKey}" is not defined at its resolved origin`)
  }
  if (isScalar(pair.key)) pair.key.value = newKey
  else pair.key = doc.createNode(newKey)
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

  const { doc, snapshot } = await loadOverlayDocument(root)
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

  await writeOverlayDocument(root, doc, snapshot)
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
  patch: OverlayFieldPatch,
  options: OverlayMutationOptions = {}
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
  for (const [label, value] of [
    ['Relation field', patch.relationField],
    ['Target field', patch.targetField]
  ] as const) {
    if (value !== undefined && value !== null && (value.trim() === '' || value !== value.trim())) {
      throw new Error(`${label} must be non-empty and have no surrounding spaces`)
    }
  }
  if (
    patch.relationDirection !== undefined &&
    patch.relationDirection !== null &&
    !VALID_RELATION_DIRECTIONS.has(patch.relationDirection)
  ) {
    throw new Error(`Invalid relation direction: "${patch.relationDirection}"`)
  }
  if (patch.relationScope !== undefined && patch.relationScope !== null) {
    const relationScope = patch.relationScope
    if (
      relationScope.trim() === '' ||
      relationScope !== relationScope.trim() ||
      relationScope.endsWith('/')
    ) {
      throw new Error(
        `Relation scopes must be non-empty and have no surrounding or trailing slash: "${relationScope}"`
      )
    }
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

  const previousKey = options.previousKey
  if (previousKey !== undefined && options.requireAbsent) {
    throw new Error('Overlay mutation cannot be both create-only and an edit')
  }
  if (previousKey !== undefined || options.requireAbsent) {
    validateComputedFieldKey(key, 'Computed field name')
    if (patch.fieldType !== 'lookup' && patch.fieldType !== 'rollup') {
      throw new Error('Lookup/Rollup mutation requires a complete Lookup or Rollup definition')
    }
  }
  if (previousKey !== undefined) {
    validateComputedFieldKey(previousKey, 'Previous computed field name')
  }

  const { doc, snapshot } = await loadOverlayDocument(root)
  options.onPrepared?.(snapshot)

  if (options.requireAbsent) {
    const collisionScope = findOverlayFieldCollision(doc, scopeKey, key)
    if (collisionScope !== undefined) {
      const location = collisionScope === null ? 'the global schema' : `scope "${collisionScope}"`
      throw new Error(
        `Cannot create computed field "${key}": the destination already exists in ${location}`
      )
    }
  }

  if (previousKey !== undefined) {
    const previousBase = fieldPath(scopeKey, previousKey)
    const previousNode = doc.getIn(previousBase, true)
    if (!isMap(previousNode)) {
      throw new Error(
        `Lookup/Rollup definition "${previousKey}" is not defined at its resolved origin`
      )
    }
    const previousType = normalizedOverlayFieldType(
      doc.getIn([...previousBase, 'field_type']),
      doc.getIn([...previousBase, 'type']),
      `computed field "${previousKey}"`
    )
    if (previousType !== 'lookup' && previousType !== 'rollup') {
      throw new Error(`"${previousKey}" is not a Lookup or Rollup definition`)
    }
    if (previousType !== patch.fieldType) {
      throw new Error(
        `Cannot change computed field "${previousKey}" from ${previousType} to ${patch.fieldType}`
      )
    }

    if (previousKey !== key) {
      const overlappingDefinitions = overlappingOverlayFieldsWithKey(doc, scopeKey, previousKey)
      if (overlappingDefinitions.length > 0) {
        throw new Error(
          `Cannot rename computed field "${previousKey}" because the same field is also defined in overlapping overlay scopes: ${overlappingDefinitions.join(', ')}`
        )
      }
      const dependents = lookupRollupDependents(doc, previousKey)
      if (dependents.length > 0) {
        throw new Error(
          `Cannot rename computed field "${previousKey}" because Lookup/Rollup definitions retrieve it as target_field: ${dependents.join(', ')}`
        )
      }
      const collisionScope = findOverlayFieldCollision(doc, scopeKey, key)
      if (collisionScope !== undefined) {
        const location = collisionScope === null ? 'the global schema' : `scope "${collisionScope}"`
        throw new Error(
          `Cannot rename computed field "${previousKey}" to "${key}": the destination already exists in ${location}`
        )
      }
      renameOverlayFieldPair(doc, scopeKey, previousKey, key)
    }
  }

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
  if (patch.relationField !== undefined) {
    if (patch.relationField === null) deleteInIfPresent(doc, [...base, 'relation_field'])
    else doc.setIn([...base, 'relation_field'], patch.relationField)
  }
  if (patch.targetField !== undefined) {
    if (patch.targetField === null) deleteInIfPresent(doc, [...base, 'target_field'])
    else doc.setIn([...base, 'target_field'], patch.targetField)
  }
  if (patch.relationDirection !== undefined) {
    if (patch.relationDirection === null || patch.relationDirection === 'outgoing') {
      deleteInIfPresent(doc, [...base, 'relation_direction'])
    } else doc.setIn([...base, 'relation_direction'], patch.relationDirection)
  }
  if (patch.relationScope !== undefined) {
    if (patch.relationScope === null || patch.relationDirection === 'outgoing') {
      deleteInIfPresent(doc, [...base, 'relation_scope'])
    } else doc.setIn([...base, 'relation_scope'], patch.relationScope)
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

  await writeOverlayDocument(root, doc, snapshot, options)
}

/** Remove one complete overlay field entry while preserving the rest of the document. */
export async function removeOverlayField(
  root: string,
  scopeKey: string | null,
  key: string,
  options: OverlayMutationOptions = {}
): Promise<boolean> {
  const { doc, existed, snapshot } = await loadOverlayDocument(root)
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
  await writeOverlayDocument(root, doc, snapshot, options)
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
  const { doc, existed, snapshot } = await loadOverlayDocument(root)
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

  await writeOverlayDocument(root, doc, snapshot)
  return true
}

export async function captureOverlaySnapshot(root: string): Promise<OverlaySnapshot> {
  return captureOverlaySnapshotUnlocked(root)
}

export async function restoreOverlaySnapshot(
  root: string,
  snapshot: OverlaySnapshot,
  expectedCurrent?: OverlaySnapshot,
  options: OverlayMutationOptions = {}
): Promise<void> {
  const path = join(root, OVERLAY_FILENAME)
  await withSerializedFileWrite(path, async () => {
    const baseline = await captureOverlaySnapshotUnlocked(root)
    if (expectedCurrent && !snapshotsEqual(baseline, expectedCurrent)) {
      throw overlayChangedError('after the computed-field mutation')
    }
    if (snapshotsEqual(baseline, snapshot)) return

    let cancelOwnWrite: (() => void) | null = null
    let published = false
    const assertBaseline = async (): Promise<void> => {
      if (!snapshotsEqual(await captureOverlaySnapshotUnlocked(root), baseline)) {
        throw overlayChangedError('before rollback could be committed')
      }
    }

    try {
      if (snapshot.existed) {
        const content = snapshot.content ?? ''
        await atomicWriteFile(path, content, {
          allowedRoot: root,
          beforeCommit: async () => {
            await options.beforeCommit?.()
            await assertBaseline()
            cancelOwnWrite = registerOwnWrite(path, 'write', content)
          },
          onPublished: () => {
            published = true
          }
        })
      } else {
        await atomicDeleteFile(path, {
          allowedRoot: root,
          beforeCommit: async () => {
            await options.beforeCommit?.()
            await assertBaseline()
            cancelOwnWrite = registerOwnWrite(path, 'delete')
          },
          onPublished: () => {
            published = true
          }
        })
      }
    } catch (error) {
      if (!published) revokeOwnWrite(cancelOwnWrite)
      throw error
    }
  })
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
  const resolved = await resolveOverlayComputedDefinition(root, scopeKey, key, ['formula'])
  return resolved === undefined ? undefined : resolved.scope
}

/** Locate the inherited Lookup/Rollup definition that is effective for a scope. */
export async function resolveOverlayLookupRollupScope(
  root: string,
  scopeKey: string | null,
  key: string
): Promise<string | null | undefined> {
  const resolved = await resolveOverlayLookupRollupDefinition(root, scopeKey, key)
  return resolved === undefined ? undefined : resolved.scope
}

export interface ResolvedOverlayLookupRollupDefinition {
  scope: string | null
  kind: 'lookup' | 'rollup'
}

/** Resolve both the true overlay origin and authored kind for an effective
 * Lookup/Rollup definition. Ordinary fields at a more-specific layer mask an
 * inherited computed definition. */
export async function resolveOverlayLookupRollupDefinition(
  root: string,
  scopeKey: string | null,
  key: string
): Promise<ResolvedOverlayLookupRollupDefinition | undefined> {
  const resolved = await resolveOverlayComputedDefinition(root, scopeKey, key, ['lookup', 'rollup'])
  if (resolved === undefined) return undefined
  return {
    scope: resolved.scope,
    kind: resolved.type as ResolvedOverlayLookupRollupDefinition['kind']
  }
}

async function resolveOverlayComputedDefinition(
  root: string,
  scopeKey: string | null,
  key: string,
  acceptedTypes: string[]
): Promise<{ scope: string | null; type: string } | undefined> {
  const { doc } = await loadOverlayDocument(root)
  const overlay = doc.toJS() as {
    fields?: Record<string, { field_type?: unknown; type?: unknown }>
    scopes?: Record<string, { fields?: Record<string, { field_type?: unknown; type?: unknown }> }>
  } | null
  if (!overlay) return undefined

  let resolved: { scope: string | null; type: string } | undefined
  const global = overlay.fields?.[key]
  if (global !== undefined) {
    const fieldType = normalizedOverlayFieldType(global.field_type, global.type, `fields.${key}`)
    if (fieldType !== undefined && acceptedTypes.includes(fieldType)) {
      resolved = { scope: null, type: fieldType }
    }
  }
  if (scopeKey === null || !overlay.scopes) return resolved

  const matching = Object.entries(overlay.scopes)
    .filter(([scope]) => scopeMatchesPath(scopeKey, scope))
    .sort(([left], [right]) => left.length - right.length)
  for (const [scope, value] of matching) {
    const field = value.fields?.[key]
    if (field === undefined) continue
    const fieldType = normalizedOverlayFieldType(
      field.field_type,
      field.type,
      `scopes.${scope}.fields.${key}`
    )
    resolved =
      fieldType !== undefined && acceptedTypes.includes(fieldType)
        ? { scope, type: fieldType }
        : undefined
  }
  return resolved
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
  const { doc, existed, snapshot } = await loadOverlayDocument(root)
  if (!existed) return false

  const oldPath = fieldPath(scopeKey, oldKey)
  const node = doc.getIn(oldPath, true)
  if (node === undefined) return false

  doc.setIn(fieldPath(scopeKey, newKey), node)
  doc.deleteIn(oldPath)
  await writeOverlayDocument(root, doc, snapshot)
  return true
}
