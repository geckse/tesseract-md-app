/**
 * Property add, type conversion & rename across a folder database (phase 41).
 *
 * Pure conversion rules + plan builder (unit-testable, no I/O) plus the
 * main-process batch executor. Hard rules (from the PRD):
 *  - Deterministic conversion matrix; unconvertible values are NEVER modified
 *    (skip + report). Empty/missing/null values are untouched ("no value").
 *  - Apply recomputes each file's conversion from the CURRENT on-disk value —
 *    the preview snapshot is never trusted at apply time.
 *  - Per-file failures (malformed YAML, EACCES, …) are collected and reported;
 *    the batch continues. No partial rollback.
 *  - All writes go through the shared phase-39b write tail (atomic temp+rename,
 *    registerOwnWrite, other-window broadcast).
 */

import { promises as fs } from 'node:fs'
import type { IpcMainInvokeEvent } from 'electron'
import { parseDocument } from 'yaml'
import type {
  PropertyOp,
  PropertyOpRequest,
  PropertyOpPlan,
  PropertyOpPlanEntry,
  PropertyOpResult,
  PropertyOpResultEntry,
  PropertyOpSchemaPin,
  PropertyTargetType,
  OverlayFieldPatch
} from '../preload/api'
import type { CollectionOutput } from '../renderer/types/cli'
import { getCollections } from './store'
import { execCommand } from './cli'
import {
  splitDocument,
  writePatchedFile,
  resolveWithinCollection,
  type FrontmatterPatch,
  type JsonValue
} from './frontmatter'
import {
  upsertOverlayField,
  renameOverlayField,
  removeOverlayFieldEverywhere
} from './schema-overlay'
import { removePropertyFromViews, renamePropertyInViews } from './table-views'
import type { WindowManager } from './window-manager'
import { parseFileReference } from '../shared/file-reference'
import { overlayFieldTypeForPropertyTarget } from '../shared/property-schema'

// ─── Pure conversion rules (the matrix) ─────────────────────────────────

/** Strict decimal (no exponent notation, no locale separators). */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const TRUE_TOKENS = new Set(['true', 'yes', 'on', '1'])
const FALSE_TOKENS = new Set(['false', 'no', 'off', '0'])

/** What YAML shape a picked UI type stores. */
type StorageKind = 'string' | 'number' | 'boolean' | 'list' | 'date' | 'datetime' | 'json'

/** Map a UI target type to its stored YAML shape. */
export function storageKindFor(target: PropertyTargetType): StorageKind {
  switch (target) {
    // A relation is stored as a plain string (or string[]) wiki-link value.
    case 'text':
    case 'url':
    case 'email':
    case 'select':
    case 'relation':
      return 'string'
    case 'file':
      return 'list'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'tags':
      return 'list'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'complex':
      return 'json'
  }
}

/** Overlay `field_type` string for a UI target type (datetime pins as date). */
export function overlayFieldTypeFor(target: PropertyTargetType): string {
  return overlayFieldTypeForPropertyTarget(target)
}

/**
 * Typed initial value for a newly-created property. Mirrors the document
 * header's Add property defaults so a column has the same on-disk shape no
 * matter which app surface created it.
 */
export function defaultValueForTarget(
  target: PropertyTargetType,
  now: Date = new Date()
): JsonValue {
  switch (target) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'date':
      return now.toISOString().slice(0, 10)
    case 'datetime':
      return `${now.toISOString().slice(0, 10)}T${now
        .getHours()
        .toString()
        .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    case 'url':
      return 'https://'
    case 'tags':
    case 'file':
      return []
    case 'complex':
      return {}
    case 'text':
    case 'email':
    case 'select':
    case 'relation':
      return ''
  }
}

export type ConvertOutcome =
  | { ok: true; value: JsonValue; changed: boolean }
  | { ok: false; reason: string }

function isScalar(v: JsonValue): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/**
 * Convert one value to a target UI type per the PRD's conversion matrix.
 * Callers handle null/missing/empty-string ("no value") before calling.
 */
export function convertValue(value: JsonValue, target: PropertyTargetType): ConvertOutcome {
  // Converting to relation is a SCHEMA PIN, never a value rewrite: existing
  // strings and string arrays pass through untouched; everything else skips.
  // (The CLI resolves whatever link syntax the value already uses.)
  if (target === 'relation') {
    if (typeof value === 'string') return { ok: true, value, changed: false }
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return { ok: true, value, changed: false }
    }
    return { ok: false, reason: 'only text values can become relations' }
  }

  // Files have a canonical list shape even when there is only one value.
  // Accept legacy scalar values, but normalize them on the first edit/convert.
  if (target === 'file') {
    if (typeof value === 'string' && parseFileReference(value, true)) {
      return { ok: true, value: [value], changed: true }
    }
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string' && !!parseFileReference(item, true))
    ) {
      return { ok: true, value, changed: false }
    }
    return { ok: false, reason: 'only file-link text values can become files' }
  }

  const kind = storageKindFor(target)

  // Nested mappings never convert to scalar/list presentation types.
  if (kind !== 'json' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ok: false, reason: 'nested mapping cannot be converted' }
  }

  switch (kind) {
    case 'string': {
      if (typeof value === 'string') return { ok: true, value, changed: false }
      if (typeof value === 'number' || typeof value === 'boolean')
        return { ok: true, value: String(value), changed: true }
      if (Array.isArray(value)) {
        if (!value.every(isScalar)) return { ok: false, reason: 'list contains nested values' }
        return { ok: true, value: value.map(String).join(', '), changed: true }
      }
      return { ok: false, reason: 'cannot convert to text' }
    }
    case 'number': {
      if (typeof value === 'number') return { ok: true, value, changed: false }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (STRICT_NUMBER.test(trimmed)) return { ok: true, value: Number(trimmed), changed: true }
        return { ok: false, reason: 'not a number' }
      }
      if (typeof value === 'boolean') return { ok: true, value: value ? 1 : 0, changed: true }
      return { ok: false, reason: 'cannot convert to number' }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value, changed: false }
      if (typeof value === 'string') {
        const t = value.trim().toLowerCase()
        if (TRUE_TOKENS.has(t)) return { ok: true, value: true, changed: true }
        if (FALSE_TOKENS.has(t)) return { ok: true, value: false, changed: true }
        return { ok: false, reason: 'not a boolean value' }
      }
      if (typeof value === 'number') {
        if (value === 1) return { ok: true, value: true, changed: true }
        if (value === 0) return { ok: true, value: false, changed: true }
        return { ok: false, reason: 'only 0/1 convert to boolean' }
      }
      return { ok: false, reason: 'cannot convert to boolean' }
    }
    case 'list': {
      if (Array.isArray(value)) {
        if (!value.every(isScalar)) return { ok: false, reason: 'list contains nested values' }
        const stringified = value.map(String)
        const changed = value.some((v) => typeof v !== 'string')
        return { ok: true, value: stringified, changed }
      }
      if (typeof value === 'string') {
        const items = value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
        return { ok: true, value: items, changed: true }
      }
      if (typeof value === 'number' || typeof value === 'boolean')
        return { ok: true, value: [String(value)], changed: true }
      return { ok: false, reason: 'cannot convert to tags' }
    }
    case 'date': {
      if (typeof value !== 'string') return { ok: false, reason: 'cannot convert to date' }
      const trimmed = value.trim()
      if (DATE_ONLY.test(trimmed)) return { ok: true, value: trimmed, changed: trimmed !== value }
      if (ISO_DATETIME.test(trimmed))
        return { ok: true, value: trimmed.slice(0, 10), changed: true }
      return { ok: false, reason: 'not a date' }
    }
    case 'datetime': {
      if (typeof value !== 'string') return { ok: false, reason: 'cannot convert to date & time' }
      const trimmed = value.trim()
      if (ISO_DATETIME.test(trimmed) || DATE_ONLY.test(trimmed))
        return { ok: true, value: trimmed, changed: trimmed !== value }
      return { ok: false, reason: 'not a date/time' }
    }
    case 'json': {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        try {
          return { ok: true, value: JSON.parse(trimmed) as JsonValue, changed: true }
        } catch {
          return { ok: false, reason: 'not valid JSON' }
        }
      }
      return { ok: true, value, changed: false }
    }
  }
}

// ─── Plan builder (pure) ────────────────────────────────────────────────

/** Max characters of a value shown in the preview list. */
const DISPLAY_TRUNCATE = 200

/** Human display string for a frontmatter value, truncated for the preview. */
export function displayValue(v: JsonValue | undefined): string | null {
  if (v === undefined || v === null) return null
  let s: string
  if (typeof v === 'string') s = v
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
  else s = JSON.stringify(v)
  return s.length > DISPLAY_TRUNCATE ? `${s.slice(0, DISPLAY_TRUNCATE)}…` : s
}

/** Whether a value counts as "no value" (untouched, not an error). */
function isNoValue(v: JsonValue | undefined): boolean {
  return v === undefined || v === null || v === ''
}

export interface PlanFileInput {
  path: string
  /** null = the file's frontmatter could not be parsed (malformed YAML). */
  frontmatter: Record<string, JsonValue> | null
}

/** Compute one file's plan entry for an op. Pure. */
export function planEntryFor(
  file: PlanFileInput,
  key: string,
  op: PropertyOp
): PropertyOpPlanEntry {
  if (file.frontmatter === null) {
    return {
      path: file.path,
      action: 'skip',
      before: null,
      after: null,
      reason: 'invalid YAML frontmatter'
    }
  }
  const value = file.frontmatter[key]

  if (op.kind === 'drop') {
    if (!Object.prototype.hasOwnProperty.call(file.frontmatter, key)) {
      return { path: file.path, action: 'no-value', before: null, after: null }
    }
    return {
      path: file.path,
      action: 'drop',
      before: displayValue(value),
      after: null
    }
  }

  if (op.kind === 'add') {
    if (Object.prototype.hasOwnProperty.call(file.frontmatter, key)) {
      return {
        path: file.path,
        action: 'unchanged',
        before: displayValue(value),
        after: displayValue(value),
        reason: 'property already exists'
      }
    }
    return {
      path: file.path,
      action: 'add',
      before: null,
      after: displayValue(defaultValueForTarget(op.target))
    }
  }

  if (op.kind === 'rename') {
    if (value === undefined) {
      return { path: file.path, action: 'no-value', before: null, after: null }
    }
    if (Object.prototype.hasOwnProperty.call(file.frontmatter, op.newKey)) {
      return {
        path: file.path,
        action: 'skip',
        before: displayValue(value),
        after: null,
        reason: 'target key exists'
      }
    }
    return {
      path: file.path,
      action: 'rename',
      before: displayValue(value),
      after: displayValue(value)
    }
  }

  if (isNoValue(value)) {
    return { path: file.path, action: 'no-value', before: displayValue(value), after: null }
  }
  const outcome = convertValue(value as JsonValue, op.target)
  if (!outcome.ok) {
    return {
      path: file.path,
      action: 'skip',
      before: displayValue(value),
      after: null,
      reason: outcome.reason
    }
  }
  return {
    path: file.path,
    action: outcome.changed ? 'convert' : 'unchanged',
    before: displayValue(value),
    after: displayValue(outcome.value)
  }
}

/** Normalize a request scope to the overlay scope key (null = global section). */
export function overlayScopeKey(scope: string): string | null {
  const trimmed = scope.replace(/\/+$/, '')
  return trimmed === '' || trimmed === '.' ? null : trimmed
}

/** Build the full plan over parsed file inputs. Pure. */
export function planPropertyOp(files: PlanFileInput[], req: PropertyOpRequest): PropertyOpPlan {
  const entries = files.map((f) => planEntryFor(f, req.key, req.op))
  const totals = { add: 0, convert: 0, drop: 0, unchanged: 0, noValue: 0, skip: 0 }
  for (const e of entries) {
    if (e.action === 'add') totals.add++
    else if (e.action === 'convert' || e.action === 'rename') totals.convert++
    else if (e.action === 'drop') totals.drop++
    else if (e.action === 'unchanged') totals.unchanged++
    else if (e.action === 'no-value') totals.noValue++
    else totals.skip++
  }

  let schemaPin: PropertyOpSchemaPin | null = null
  if (req.scope !== null && (req.op.kind === 'add' || req.op.kind === 'convert')) {
    schemaPin = {
      scopeKey: overlayScopeKey(req.scope),
      fieldType: overlayFieldTypeFor(req.op.target)
    }
    if (req.op.target === 'select' && req.op.allowedValues?.length) {
      schemaPin.allowedValues = req.op.allowedValues
    }
  }

  return {
    scope: req.op.kind === 'drop' ? '.' : req.scope,
    files: entries,
    totals,
    schemaPin
  }
}

// ─── File enumeration + frontmatter reading (I/O) ───────────────────────

function getCollection(collectionId: string): { id: string; path: string } {
  const collection = getCollections().find((c) => c.id === collectionId)
  if (!collection) throw new Error('Unknown collection')
  return collection
}

/**
 * Enumerate the relative paths a request touches. Scoped requests use the
 * CLI's ignore-rule-aware `collection` view; `deleted` rows are excluded
 * (nothing on disk to write). Single-file requests return just that file.
 */
async function enumerateFiles(root: string, req: PropertyOpRequest): Promise<string[]> {
  if (req.op.kind === 'drop') {
    const output = await execCommand<CollectionOutput>('collection', ['.', '--recursive'], root)
    return output.rows.filter((r) => r.state !== 'deleted').map((r) => r.path)
  }
  if (req.scope === null) {
    if (!req.filePath) throw new Error('filePath is required when scope is null')
    return [req.filePath]
  }
  const scopeArg = overlayScopeKey(req.scope) ?? '.'
  const output = await execCommand<CollectionOutput>('collection', [scopeArg, '--recursive'], root)
  return output.rows.filter((r) => r.state !== 'deleted').map((r) => r.path)
}

/**
 * Read a file's frontmatter object from disk. Returns `null` frontmatter when
 * the YAML is malformed (never clobbered — surfaces as skip/failed), and `{}`
 * when the file has no frontmatter block.
 */
async function readFrontmatter(absolutePath: string): Promise<Record<string, JsonValue> | null> {
  const content = await fs.readFile(absolutePath, 'utf-8')
  return parseFrontmatter(content)
}

/** Parse one exact source generation without performing another filesystem read. */
function parseFrontmatter(content: string): Record<string, JsonValue> | null {
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content
  const withoutCrLf = source.replace(/\r\n/g, '')
  if (withoutCrLf.includes('\r') || (source.includes('\r\n') && withoutCrLf.includes('\n'))) {
    return null
  }
  const normalized = source.replace(/\r\n/g, '\n')
  const { hasFrontmatter, closed, block } = splitDocument(normalized)
  if (!hasFrontmatter) return {}
  if (!closed) return null
  const doc = parseDocument(block)
  if (doc.errors.length > 0) return null
  const obj = doc.toJS() as unknown
  if (obj === null) return {}
  return typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, JsonValue>) : null
}

/** Re-read disk and return the exact set of parseable files that contain a Drop key. */
async function currentDropPaths(
  collectionId: string,
  paths: string[],
  key: string
): Promise<string[]> {
  const affected = new Set<string>()
  for (const path of paths) {
    let absolutePath: string
    try {
      absolutePath = resolveWithinCollection(collectionId, path)
    } catch {
      continue
    }
    try {
      const frontmatter = await readFrontmatter(absolutePath)
      if (frontmatter !== null && Object.prototype.hasOwnProperty.call(frontmatter, key)) {
        affected.add(path)
      }
    } catch {
      // An unreadable/deleted file is not currently a confirmed writable
      // target. If it was confirmed previously, the set comparison will fail.
    }
  }
  return [...affected].sort()
}

// ─── Preview ────────────────────────────────────────────────────────────

/** Compute the per-file plan for a property op. Reads disk, writes nothing. */
export async function previewPropertyOp(req: PropertyOpRequest): Promise<PropertyOpPlan> {
  validateRequest(req)
  const collection = getCollection(req.collectionId)
  const paths = await enumerateFiles(collection.path, req)

  const files: PlanFileInput[] = []
  for (const path of paths) {
    const absolutePath = resolveWithinCollection(req.collectionId, path)
    try {
      files.push({ path, frontmatter: await readFrontmatter(absolutePath) })
    } catch {
      // Unreadable file (deleted between enumeration and read, permissions…):
      // surface as skip so the plan still accounts for it.
      files.push({ path, frontmatter: null })
    }
  }
  return planPropertyOp(files, req)
}

// ─── Apply ──────────────────────────────────────────────────────────────

/** One running op per collection — a second concurrent apply is rejected. */
const runningOps = new Set<string>()

/** Internal deterministic seam for mutation-race regression tests. */
export interface PropertyOpExecutionHooks {
  beforeQueuedWrite?: (absolutePath: string) => void | Promise<void>
}

/**
 * Characters we refuse in a newly-added or renamed key so it stays a plain YAML scalar.
 * Interior hyphens ("created-at") are fine; leading `-`/`?` and indicator
 * characters are not.
 */
const INVALID_KEY = /[:#[\]{}&*!|>'"%@`,\n\t]|^[\s?-]|\s$/

function validateRequest(req: PropertyOpRequest): void {
  if (!req.key || !req.key.trim()) throw new Error('Property key is required')
  if (req.op.kind === 'add') {
    if (req.key === 'title' || req.key === 'path') {
      throw new Error(`"${req.key}" is reserved`)
    }
    if (INVALID_KEY.test(req.key)) {
      throw new Error('Property names cannot contain YAML special characters')
    }
    if (req.op.target === 'select' && !req.op.allowedValues?.length) {
      throw new Error('Select properties require at least one allowed value')
    }
  }
  if (req.op.kind === 'rename') {
    const newKey = req.op.newKey
    if (!newKey || !newKey.trim()) throw new Error('New property name is required')
    if (newKey === req.key) throw new Error('New property name must differ')
    if (INVALID_KEY.test(newKey))
      throw new Error('Property names cannot contain YAML special characters')
  }
  if (req.op.kind === 'convert' && storageKindFor(req.op.target) === null) {
    throw new Error(`"${req.op.target}" is not a convertible target type`)
  }
}

/** Drop apply-only confirmation payload. Preview is intentionally allowed to omit it. */
function requireConfirmedDropPaths(req: PropertyOpRequest): string[] | null {
  if (req.op.kind !== 'drop') return null
  const paths = req.op.confirmedPaths
  if (!Array.isArray(paths)) {
    throw new Error(
      'Drop requires a fresh confirmed preview. Refresh the preview and confirm again.'
    )
  }
  if (paths.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new Error('Drop confirmation contains an invalid document path. Refresh the preview.')
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error('Drop confirmation contains duplicate document paths. Refresh the preview.')
  }
  return [...paths].sort()
}

function assertDropPreviewFresh(confirmedPaths: string[], currentPaths: string[]): void {
  const matches =
    confirmedPaths.length === currentPaths.length &&
    confirmedPaths.every((path, index) => path === currentPaths[index])
  if (!matches) {
    throw new Error(
      'Drop preview is stale because the affected documents changed. Refresh the preview and confirm again.'
    )
  }
}

/**
 * Apply a property op with the vault watcher paused. Add/convert/rename use the
 * requested scope; drop is always vault-wide and removes every overlay
 * definition before touching Markdown. Progress is streamed to the invoking
 * window as `schema:property-op-progress` events keyed by `opId`.
 *
 * The caller (renderer) owns the follow-up sequence (incremental ingest →
 * schema/table refresh → file-sync routing) so the UI stays honest — this
 * handler never blocks on the ingest.
 */
export async function applyPropertyOp(
  event: IpcMainInvokeEvent,
  windowManager: WindowManager,
  opId: string,
  req: PropertyOpRequest,
  hooks: PropertyOpExecutionHooks = {}
): Promise<PropertyOpResult> {
  validateRequest(req)
  const confirmedDropPaths = requireConfirmedDropPaths(req)
  const collection = getCollection(req.collectionId)
  if (runningOps.has(req.collectionId)) {
    throw new Error('A property operation is already running for this collection')
  }
  runningOps.add(req.collectionId)
  try {
    if (req.op.kind === 'drop') {
      const { assertNoDirtyDocumentsAcrossWindows } = await import('./computed-editor-flush')
      await assertNoDirtyDocumentsAcrossWindows(windowManager, collection.id, collection.path)
    }
    let paths = req.op.kind === 'drop' ? [] : await enumerateFiles(collection.path, req)
    const entries: PropertyOpResultEntry[] = []
    const broadcast = { windowManager, senderId: event.sender.id }
    const scopeKey = req.scope === null ? null : overlayScopeKey(req.scope)
    let overlayWritten = false

    // Pause the mdvdb watcher for the whole batch so it never re-ingests
    // mid-operation. Schema changes happen first: a malformed overlay therefore
    // aborts before any Markdown is changed. Drop removes global plus every
    // scoped definition so the column cannot reappear from an inherited pin.
    // Chokidar Tier-1 events are already tagged via registerOwnWrite.
    const { withWatcherPaused } = await import('./ipc-handlers')
    await withWatcherPaused(collection.path, async () => {
      let confirmedDropSet: Set<string> | null = null
      if (req.op.kind === 'drop') {
        const { verifyCleanDocumentsAcrossWindows } = await import('./computed-editor-flush')
        await verifyCleanDocumentsAcrossWindows(windowManager, collection.id, collection.path)
        paths = await enumerateFiles(collection.path, req)
        const latestDropPaths = await currentDropPaths(req.collectionId, paths, req.key)
        assertDropPreviewFresh(confirmedDropPaths ?? [], latestDropPaths)
        confirmedDropSet = new Set(confirmedDropPaths ?? [])
        overlayWritten = await removeOverlayFieldEverywhere(collection.path, req.key)
      } else if (req.scope !== null && (req.op.kind === 'add' || req.op.kind === 'convert')) {
        const patch: OverlayFieldPatch = { fieldType: overlayFieldTypeFor(req.op.target) }
        if (req.op.target === 'select') patch.allowedValues = req.op.allowedValues ?? []
        await upsertOverlayField(collection.path, scopeKey, req.key, patch)
        overlayWritten = true
      } else if (req.scope !== null && req.op.kind === 'rename') {
        // Validate and publish the overlay move before touching any Markdown.
        // A malformed, stale, symlinked, or otherwise unwritable overlay must
        // never leave records renamed under a schema that still uses oldKey.
        overlayWritten = await renameOverlayField(collection.path, scopeKey, req.key, req.op.newKey)
      }

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]
        entries.push(
          req.op.kind === 'drop' && !confirmedDropSet?.has(path)
            ? await inspectUnconfirmedDropFile(req, path)
            : await applyToFile(req, path, broadcast, confirmedDropSet, collection.path, hooks)
        )
        if (!event.sender.isDestroyed()) {
          event.sender.send('schema:property-op-progress', {
            opId,
            done: i + 1,
            total: paths.length,
            path
          })
        }
      }

      if (req.op.kind === 'drop') {
        // Saved-view cleanup is auxiliary. A locked/corrupt views file must not
        // hide the Markdown outcomes or prevent the renderer's required ingest;
        // stale references already degrade safely against the live columns.
        try {
          await removePropertyFromViews(req.collectionId, req.key)
        } catch (error) {
          console.warn(`property-ops: could not clean saved views for "${req.key}":`, error)
        }
      } else if (req.scope !== null && req.op.kind === 'rename') {
        // Saved views are auxiliary and must not turn a successfully guarded
        // Markdown/schema rename into a misleading top-level failure.
        try {
          await renamePropertyInViews(req.collectionId, scopeKey ?? '', req.key, req.op.newKey)
        } catch (error) {
          console.warn(`property-ops: could not rename saved-view property "${req.key}":`, error)
        }
      }
    })

    const totals = { ok: 0, skipped: 0, failed: 0 }
    for (const e of entries) totals[e.status]++
    return { entries, totals, overlayWritten }
  } finally {
    runningOps.delete(req.collectionId)
  }
}

/**
 * Apply the op to a single file, recomputing it from the current on-disk
 * value. Add never overwrites an existing key. No operation modifies
 * unchanged, unconvertible, or malformed YAML.
 */
async function applyToFile(
  req: PropertyOpRequest,
  path: string,
  broadcast: { windowManager: WindowManager; senderId: number | null },
  confirmedDropPaths: ReadonlySet<string> | null,
  collectionRoot: string,
  hooks: PropertyOpExecutionHooks
): Promise<PropertyOpResultEntry> {
  // Defense in depth: even if a future caller bypasses the outer batch-loop
  // gate, an unconfirmed path can never reach the destructive write tail.
  if (req.op.kind === 'drop' && !confirmedDropPaths?.has(path)) {
    return {
      path,
      status: 'failed',
      reason: 'document was not part of the confirmed Drop preview — file not modified'
    }
  }

  let absolutePath: string
  try {
    absolutePath = resolveWithinCollection(req.collectionId, path)
  } catch (err) {
    return { path, status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }

  try {
    // The plan and patch are derived from one exact source generation. The
    // shared write tail verifies these bytes again under its per-path queue and
    // immediately before atomic rename, so a concurrent edit is never fed a
    // stale conversion/rename/add/drop patch.
    const baselineContent = await fs.readFile(absolutePath, 'utf-8')
    const frontmatter = parseFrontmatter(baselineContent)
    if (frontmatter === null) {
      // Present-but-unparseable YAML is a failure, not a skip — the user must
      // fix the file; it is never modified (PRD: never clobber).
      return { path, status: 'failed', reason: 'invalid YAML frontmatter — file not modified' }
    }
    const entry = planEntryFor({ path, frontmatter }, req.key, req.op)
    if (entry.action === 'no-value' || entry.action === 'unchanged') {
      return {
        path,
        status: 'skipped',
        reason:
          req.op.kind === 'add'
            ? 'property already exists'
            : entry.action === 'no-value'
              ? 'no value'
              : req.scope !== null
                ? 'value already compatible; schema change only'
                : 'already the target type'
      }
    }
    if (entry.action === 'skip') {
      return { path, status: 'skipped', reason: entry.reason }
    }

    let patch: FrontmatterPatch
    if (req.op.kind === 'drop') {
      patch = { unset: [req.key] }
    } else if (req.op.kind === 'add') {
      patch = { set: { [req.key]: defaultValueForTarget(req.op.target) } }
    } else if (req.op.kind === 'rename') {
      const value = frontmatter![req.key]
      patch = { set: { [req.op.newKey]: value as JsonValue }, unset: [req.key] }
    } else {
      const outcome = convertValue(frontmatter![req.key] as JsonValue, req.op.target)
      if (!outcome.ok) return { path, status: 'skipped', reason: outcome.reason }
      patch = { set: { [req.key]: outcome.value } }
    }

    await hooks.beforeQueuedWrite?.(absolutePath)
    await writePatchedFile(absolutePath, patch, broadcast, {
      expectedContent: baselineContent,
      collectionRoot
    })
    return { path, status: 'ok' }
  } catch (err) {
    return { path, status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Account for a vault file that was not in the confirmed affected set without
 * ever writing it. This preserves malformed-file reporting while guaranteeing
 * that only confirmed paths can reach the shared write tail.
 */
async function inspectUnconfirmedDropFile(
  req: PropertyOpRequest,
  path: string
): Promise<PropertyOpResultEntry> {
  let absolutePath: string
  try {
    absolutePath = resolveWithinCollection(req.collectionId, path)
  } catch (error) {
    return {
      path,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    }
  }

  try {
    const frontmatter = await readFrontmatter(absolutePath)
    if (frontmatter === null) {
      return { path, status: 'failed', reason: 'invalid YAML frontmatter — file not modified' }
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, req.key)) {
      return {
        path,
        status: 'failed',
        reason: 'document changed after Drop confirmation — file not modified'
      }
    }
    return { path, status: 'skipped', reason: 'no value' }
  } catch (error) {
    return {
      path,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

// ─── Overlay-only annotation edits ──────────────────────────────────────

/** Write schema-overlay annotations (description/required/allowed values). */
export async function updateOverlayField(
  collectionId: string,
  scope: string | null,
  key: string,
  patch: OverlayFieldPatch
): Promise<void> {
  if (!key || !key.trim()) throw new Error('Property key is required')
  const collection = getCollection(collectionId)
  const scopeKey = scope === null ? null : overlayScopeKey(scope)
  await upsertOverlayField(collection.path, scopeKey, key, patch)
}
