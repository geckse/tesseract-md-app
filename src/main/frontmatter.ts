/**
 * Safe, lossless single-key frontmatter editing in the MAIN process (phase-39b).
 *
 * Uses the eemeli `yaml` Document API to mutate one node at a time, preserving
 * the formatting of untouched nodes as much as YAML round-tripping allows. The
 * Markdown body is kept byte-identical; original EOL (`\r\n` vs `\n`) and a
 * trailing newline are detected and restored. Writes are atomic (temp + rename).
 *
 * Hard rules (from the PRD):
 *  - If a leading `---` block exists but won't parse, ABORT — never clobber.
 *  - Only synthesize a new frontmatter block when there is NO leading `---`.
 *  - Date-like string values are written as explicitly quoted scalars so they
 *    are not re-resolved as YAML timestamps (matching mdvdb's `FieldType::Date`).
 *  - The renderer never constructs absolute paths; the collection boundary is
 *    enforced here from `(collectionId, relativePath)`.
 */

import { promises as fs } from 'node:fs'
import { resolve, sep, dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { Document, Scalar, parseDocument } from 'yaml'
import { getCollections } from './store'
import type { WindowManager } from './window-manager'

/** JSON value patch from the renderer (typed scalars/sequences). */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface FrontmatterPatch {
  set?: Record<string, JsonValue>
  unset?: string[]
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/

/** Detect a value that should be force-quoted to stay a string (not a timestamp). */
function isDateLike(value: JsonValue): value is string {
  return typeof value === 'string' && DATE_LIKE.test(value)
}

/**
 * Split a document into its leading `---` frontmatter block and the body.
 * Works on `\n`-normalized text; the `\r` of CRLF files is handled by the caller
 * (normalize on the way in, restore on the way out). Returns `hasFrontmatter:
 * false` when there is no leading `---` delimiter.
 */
export function splitDocument(normalized: string): {
  hasFrontmatter: boolean
  closed: boolean
  block: string
  body: string
} {
  const lines = normalized.split('\n')
  if (lines[0]?.trimEnd() !== '---') {
    return { hasFrontmatter: false, closed: false, block: '', body: normalized }
  }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    // Leading '---' with no closing delimiter — malformed; never clobber.
    return { hasFrontmatter: true, closed: false, block: '', body: normalized }
  }
  // `block` may legitimately be empty (an empty `---\n---` frontmatter).
  return {
    hasFrontmatter: true,
    closed: true,
    block: lines.slice(1, endIdx).join('\n'),
    body: lines.slice(endIdx + 1).join('\n')
  }
}

/** Error thrown when the existing frontmatter is present but unparseable. */
export class MalformedFrontmatterError extends Error {
  constructor() {
    super('Existing frontmatter is not valid YAML; refusing to overwrite it.')
    this.name = 'MalformedFrontmatterError'
  }
}

/**
 * Apply a frontmatter patch to a markdown string. Pure (no I/O) so it is easy to
 * unit-test. Returns the new full content plus the resulting frontmatter object.
 */
export function applyFrontmatterPatch(
  content: string,
  patch: FrontmatterPatch
): { content: string; frontmatter: Record<string, JsonValue> } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const normalized = content.replace(/\r\n/g, '\n')
  const { hasFrontmatter, closed, block, body } = splitDocument(normalized)

  let doc: Document
  let effectiveBody: string
  if (hasFrontmatter) {
    // A leading '---' with no closing delimiter is malformed — never clobber.
    if (!closed) {
      throw new MalformedFrontmatterError()
    }
    // An empty block ('---\n---') is valid (empty frontmatter); parseDocument('')
    // yields an empty doc with no errors.
    doc = parseDocument(block)
    if (doc.errors.length > 0) {
      throw new MalformedFrontmatterError()
    }
    effectiveBody = body
  } else {
    // No leading '---' at all — synthesize a new block; the whole file is body.
    doc = new Document({})
    effectiveBody = normalized
  }

  // Ensure the root is a map we can set keys on.
  if (doc.contents == null || (doc.contents as { items?: unknown }).items === undefined) {
    doc.contents = doc.createNode({}) as Document['contents']
  }

  // Apply unsets first, then sets.
  for (const key of patch.unset ?? []) {
    doc.delete(key)
  }
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    if (isDateLike(value)) {
      const node = doc.createNode(value)
      ;(node as Scalar).type = Scalar.QUOTE_DOUBLE
      doc.set(key, node)
    } else {
      doc.set(key, value)
    }
  }

  // Re-serialize only the frontmatter; doc.toString() ends with a newline.
  const yamlOut = doc.toString()
  const newNormalized = `---\n${yamlOut}---\n${effectiveBody}`
  const newContent = eol === '\n' ? newNormalized : newNormalized.replace(/\n/g, eol)

  const frontmatter = (doc.toJS() ?? {}) as Record<string, JsonValue>
  return { content: newContent, frontmatter }
}

/** Resolve + validate an absolute path from a collection id and relative path. */
function resolveWithinCollection(collectionId: string, relativePath: string): string {
  const collection = getCollections().find((c) => c.id === collectionId)
  if (!collection) {
    throw new Error('Unknown collection')
  }
  const absolutePath = resolve(join(collection.path, relativePath))
  if (absolutePath !== collection.path && !absolutePath.startsWith(collection.path + sep)) {
    throw new Error('Access denied: path is not within the collection')
  }
  return absolutePath
}

/**
 * Read-modify-write a single file's frontmatter atomically, then broadcast the
 * change to other windows. Returns the updated frontmatter object.
 */
export async function updateFrontmatter(
  event: IpcMainInvokeEvent,
  windowManager: WindowManager,
  collectionId: string,
  relativePath: string,
  patch: FrontmatterPatch
): Promise<Record<string, JsonValue>> {
  const absolutePath = resolveWithinCollection(collectionId, relativePath)

  const original = await fs.readFile(absolutePath, 'utf-8')
  const { content, frontmatter } = applyFrontmatterPatch(original, patch)

  // Atomic write: temp file in the same directory, then rename over the original.
  const tmpPath = join(dirname(absolutePath), `.${Date.now()}.${process.pid}.mdvdb.tmp`)
  await fs.writeFile(tmpPath, content, 'utf-8')
  try {
    await fs.rename(tmpPath, absolutePath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }

  // Notify OTHER windows so they reload silently (no conflict prompt).
  const senderId = event.sender.id
  for (const win of windowManager.getAllWindows()) {
    if (win.webContents.id !== senderId && !win.isDestroyed()) {
      win.webContents.send('file:saved-externally', { path: absolutePath, content })
    }
  }

  return frontmatter
}
