/**
 * Property type conversion & rename across a folder database (phase 41).
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
import { upsertOverlayField, renameOverlayField } from './schema-overlay'
import { renamePropertyInViews } from './table-views'
import type { WindowManager } from './window-manager'

// ─── Pure conversion rules (the matrix) ─────────────────────────────────

/** Strict decimal (no exponent notation, no locale separators). */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const TRUE_TOKENS = new Set(['true', 'yes', 'on', '1'])
const FALSE_TOKENS = new Set(['false', 'no', 'off', '0'])

/** What YAML shape a picked UI type stores. */
type StorageKind = 'string' | 'number' | 'boolean' | 'list' | 'date' | 'datetime'

/** Map a UI target type to its stored YAML shape (null = not a valid target). */
export function storageKindFor(target: PropertyTargetType): StorageKind | null {
  switch (target) {
    // A relation is stored as a plain string (or string[]) wiki-link value.
    case 'text':
    case 'url':
    case 'email':
    case 'select':
    case 'relation':
      return 'string'
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
      return null
  }
}

/** Overlay `field_type` string for a UI target type (datetime pins as date). */
export function overlayFieldTypeFor(target: PropertyTargetType): string {
  if (target === 'relation') return 'relation'
  const kind = storageKindFor(target)
  return kind === 'datetime' ? 'date' : (kind ?? 'mixed')
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

  const kind = storageKindFor(target)
  if (kind === null) return { ok: false, reason: 'not a convertible target type' }

  // Nested mappings never convert to anything.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
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
  const totals = { convert: 0, unchanged: 0, noValue: 0, skip: 0 }
  for (const e of entries) {
    if (e.action === 'convert' || e.action === 'rename') totals.convert++
    else if (e.action === 'unchanged') totals.unchanged++
    else if (e.action === 'no-value') totals.noValue++
    else totals.skip++
  }

  let schemaPin: PropertyOpSchemaPin | null = null
  if (req.scope !== null && req.op.kind === 'convert') {
    schemaPin = {
      scopeKey: overlayScopeKey(req.scope),
      fieldType: overlayFieldTypeFor(req.op.target)
    }
    if (req.op.target === 'select' && req.op.allowedValues?.length) {
      schemaPin.allowedValues = req.op.allowedValues
    }
  }

  return { scope: req.scope, files: entries, totals, schemaPin }
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
  const normalized = content.replace(/\r\n/g, '\n')
  const { hasFrontmatter, closed, block } = splitDocument(normalized)
  if (!hasFrontmatter) return {}
  if (!closed) return null
  const doc = parseDocument(block)
  if (doc.errors.length > 0) return null
  const obj = doc.toJS() as unknown
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj)
    ? (obj as Record<string, JsonValue>)
    : {}
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

/**
 * Characters we refuse in a renamed key so it stays a plain YAML scalar.
 * Interior hyphens ("created-at") are fine; leading `-`/`?` and indicator
 * characters are not.
 */
const INVALID_KEY = /[:#[\]{}&*!|>'"%@`,\n\t]|^[\s?-]|\s$/

function validateRequest(req: PropertyOpRequest): void {
  if (!req.key || !req.key.trim()) throw new Error('Property key is required')
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

/**
 * Apply a property op: batch-convert/rename across the scope with the vault
 * watcher paused, then pin the schema overlay. Progress is streamed to the
 * invoking window as `schema:property-op-progress` events keyed by `opId`.
 *
 * The caller (renderer) owns the follow-up sequence (incremental ingest →
 * schema/table refresh → file-sync routing) so the UI stays honest — this
 * handler never blocks on the ingest.
 */
export async function applyPropertyOp(
  event: IpcMainInvokeEvent,
  windowManager: WindowManager,
  opId: string,
  req: PropertyOpRequest
): Promise<PropertyOpResult> {
  validateRequest(req)
  const collection = getCollection(req.collectionId)
  if (runningOps.has(req.collectionId)) {
    throw new Error('A property operation is already running for this collection')
  }
  runningOps.add(req.collectionId)
  try {
    const paths = await enumerateFiles(collection.path, req)
    const entries: PropertyOpResultEntry[] = []
    const broadcast = { windowManager, senderId: event.sender.id }

    // Pause the mdvdb watcher for the whole batch so it never re-ingests
    // mid-conversion; chokidar Tier-1 events are already tagged via
    // registerOwnWrite inside the shared write tail.
    const { withWatcherPaused } = await import('./ipc-handlers')
    await withWatcherPaused(collection.path, async () => {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]
        entries.push(await applyToFile(req, path, broadcast))
        if (!event.sender.isDestroyed()) {
          event.sender.send('schema:property-op-progress', {
            opId,
            done: i + 1,
            total: paths.length,
            path
          })
        }
      }
    })

    // Pin the chosen type in the schema overlay (skip for single-file ops).
    let overlayWritten = false
    if (req.scope !== null) {
      const scopeKey = overlayScopeKey(req.scope)
      if (req.op.kind === 'convert') {
        const patch: OverlayFieldPatch = { fieldType: overlayFieldTypeFor(req.op.target) }
        if (req.op.target === 'select') patch.allowedValues = req.op.allowedValues ?? []
        await upsertOverlayField(collection.path, scopeKey, req.key, patch)
        overlayWritten = true
      } else {
        overlayWritten = await renameOverlayField(collection.path, scopeKey, req.key, req.op.newKey)
        // Best-effort: keep saved table views pointing at the renamed column.
        await renamePropertyInViews(req.collectionId, scopeKey ?? '', req.key, req.op.newKey)
      }
    }

    const totals = { ok: 0, skipped: 0, failed: 0 }
    for (const e of entries) totals[e.status]++
    return { entries, totals, overlayWritten }
  } finally {
    runningOps.delete(req.collectionId)
  }
}

/**
 * Apply the op to a single file, recomputing the conversion from the current
 * on-disk value. Never modifies a file whose value is missing, unchanged,
 * unconvertible, or whose YAML is malformed.
 */
async function applyToFile(
  req: PropertyOpRequest,
  path: string,
  broadcast: { windowManager: WindowManager; senderId: number | null }
): Promise<PropertyOpResultEntry> {
  let absolutePath: string
  try {
    absolutePath = resolveWithinCollection(req.collectionId, path)
  } catch (err) {
    return { path, status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }

  try {
    const frontmatter = await readFrontmatter(absolutePath)
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
        reason: entry.action === 'no-value' ? 'no value' : 'already the target type'
      }
    }
    if (entry.action === 'skip') {
      return { path, status: 'skipped', reason: entry.reason }
    }

    let patch: FrontmatterPatch
    if (req.op.kind === 'rename') {
      const value = frontmatter![req.key]
      patch = { set: { [req.op.newKey]: value as JsonValue }, unset: [req.key] }
    } else {
      const outcome = convertValue(frontmatter![req.key] as JsonValue, req.op.target)
      if (!outcome.ok) return { path, status: 'skipped', reason: outcome.reason }
      patch = { set: { [req.key]: outcome.value } }
    }

    await writePatchedFile(absolutePath, patch, broadcast)
    return { path, status: 'ok' }
  } catch (err) {
    return { path, status: 'failed', reason: err instanceof Error ? err.message : String(err) }
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
