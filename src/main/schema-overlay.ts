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
import { join, dirname } from 'node:path'
import { Document, parseDocument } from 'yaml'
import { registerOwnWrite } from './own-writes'
import type { OverlayFieldPatch } from '../preload/api'

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
  'relation'
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
  // An empty file parses to null contents — ensure a map root for setIn.
  if (doc.contents == null || (doc.contents as { items?: unknown }).items === undefined) {
    doc.contents = doc.createNode({}) as Document['contents']
  }
  return { doc, existed: true }
}

/** Atomic write of the overlay document (dotfile temp + rename + own-write). */
async function writeOverlayDocument(root: string, doc: Document): Promise<void> {
  const path = join(root, OVERLAY_FILENAME)
  const content = doc.toString()
  registerOwnWrite(path, 'write', content)
  const tmpPath = join(dirname(path), `.${Date.now()}.${process.pid}.schema-overlay.tmp`)
  await fs.writeFile(tmpPath, content, 'utf-8')
  try {
    await fs.rename(tmpPath, path)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

/** The YAML path to a field's map for a scope (`null` = global `fields:`). */
function fieldPath(scopeKey: string | null, key: string): (string | number)[] {
  return scopeKey === null ? ['fields', key] : ['scopes', scopeKey, 'fields', key]
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
  if (patch.fieldType !== undefined && !VALID_FIELD_TYPES.has(patch.fieldType)) {
    throw new Error(`Invalid overlay field_type: "${patch.fieldType}"`)
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

  if (patch.fieldType !== undefined) doc.setIn([...base, 'field_type'], patch.fieldType)
  if (patch.description !== undefined) {
    if (patch.description === null) doc.deleteIn([...base, 'description'])
    else doc.setIn([...base, 'description'], patch.description)
  }
  if (patch.required !== undefined) {
    if (patch.required === null) doc.deleteIn([...base, 'required'])
    else doc.setIn([...base, 'required'], patch.required)
  }
  if (patch.allowedValues !== undefined) {
    if (patch.allowedValues === null || patch.allowedValues.length === 0) {
      doc.deleteIn([...base, 'allowed_values'])
    } else {
      doc.setIn([...base, 'allowed_values'], patch.allowedValues)
    }
  }
  if (patch.target !== undefined) {
    if (patch.target === null) doc.deleteIn([...base, 'target'])
    else doc.setIn([...base, 'target'], patch.target)
  }

  await writeOverlayDocument(root, doc)
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
