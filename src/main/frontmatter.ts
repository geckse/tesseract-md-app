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
import { resolve, sep, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { IpcMainInvokeEvent } from 'electron'
import { Document, Scalar, isMap, isScalar, parseDocument, type Pair } from 'yaml'
import { getCollections } from './store'
import { atomicWriteFile } from './atomic-write'
import { registerOwnWrite } from './own-writes'
import type { WindowManager } from './window-manager'
import { withSerializedFileWrite } from './file-write-queue'

/** JSON value patch from the renderer (typed scalars/sequences). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

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
  closingHasNewline: boolean
} {
  const lines = normalized.split('\n')
  if (lines[0] !== '---') {
    return {
      hasFrontmatter: false,
      closed: false,
      block: '',
      body: normalized,
      closingHasNewline: false
    }
  }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    // Leading '---' with no closing delimiter — malformed; never clobber.
    return {
      hasFrontmatter: true,
      closed: false,
      block: '',
      body: normalized,
      closingHasNewline: false
    }
  }
  const throughClosingDelimiter = lines.slice(0, endIdx + 1).join('\n')
  // `block` may legitimately be empty (an empty `---\n---` frontmatter).
  return {
    hasFrontmatter: true,
    closed: true,
    block: lines.slice(1, endIdx).join('\n'),
    body: lines.slice(endIdx + 1).join('\n'),
    closingHasNewline: normalized.length > throughClosingDelimiter.length
  }
}

/** Error thrown when the existing frontmatter is present but unparseable. */
export class MalformedFrontmatterError extends Error {
  constructor() {
    super('Existing frontmatter is not valid YAML; refusing to overwrite it.')
    this.name = 'MalformedFrontmatterError'
  }
}

/** Exact-baseline conflict raised by a read/modify/write frontmatter edit. */
export class FrontmatterSourceChangedError extends Error {
  constructor() {
    super('The file changed on disk before the frontmatter edit could be committed.')
    this.name = 'FrontmatterSourceChangedError'
  }
}

/** Fail-closed guard for a renderer that changes more than the requested patch. */
export class FrontmatterInvariantError extends Error {
  constructor() {
    super('Rendered frontmatter violated the lossless patch invariant; refusing to overwrite it.')
    this.name = 'FrontmatterInvariantError'
  }
}

interface PreservedPair {
  key: string
  placeholder: string
  raw: string
}

function pairKey(pair: Pair): string | null {
  if (isScalar(pair.key)) return String(pair.key.value ?? '')
  // `Document#set()` represents a newly inserted string key as the primitive
  // itself. Original parsed keys must still be Scalars with source ranges.
  return typeof pair.key === 'string' ? pair.key : null
}

function pairRange(pair: Pair): [number, number] | null {
  const start = pair.key?.range?.[0]
  const end = pair.value?.range?.[2] ?? pair.value?.range?.[1]
  return typeof start === 'number' && typeof end === 'number' ? [start, end] : null
}

function applyPatchToDocument(doc: Document, patch: FrontmatterPatch): void {
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
}

interface PairSnapshot {
  key: string
  raw: string
}

function mappingDocument(block: string): Document {
  const doc = parseDocument(block, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new MalformedFrontmatterError()
  if (doc.contents == null) {
    doc.contents = doc.createNode({}) as Document['contents']
  } else if (!isMap(doc.contents)) {
    throw new MalformedFrontmatterError()
  }
  return doc
}

function documentRecord(doc: Document): Record<string, JsonValue> {
  const value = doc.toJS() as unknown
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new MalformedFrontmatterError()
  return value as Record<string, JsonValue>
}

function pairSnapshots(doc: Document, block: string): PairSnapshot[] {
  if (!isMap(doc.contents)) throw new MalformedFrontmatterError()
  return doc.contents.items.map((pair) => {
    const key = pairKey(pair)
    const range = pairRange(pair)
    if (key === null || range === null) throw new MalformedFrontmatterError()
    return { key, raw: block.slice(range[0], range[1]) }
  })
}

function rawPairMatches(original: string, rendered: string): boolean {
  // A pair at EOF has no line terminator in `originalBlock`. Rendering another
  // pair after it (or the closing delimiter after it) makes that structural LF
  // part of the YAML node's source range; it is not a change to the pair.
  return rendered === original || (!original.endsWith('\n') && rendered === `${original}\n`)
}

/**
 * Assert the production postcondition for a rendered frontmatter patch.
 *
 * The rendered mapping must be semantically identical to applying only
 * `patch`, and every untouched top-level pair must retain both its original
 * semantic value and its exact source bytes (apart from a structural LF).
 * Returns the independently parsed rendered mapping for the caller.
 */
export function assertRenderedFrontmatterPatchInvariant(
  originalBlock: string,
  renderedBlock: string,
  patch: FrontmatterPatch
): Record<string, JsonValue> {
  const touchedKeys = new Set([...(patch.unset ?? []), ...Object.keys(patch.set ?? {})])
  const originalDoc = mappingDocument(originalBlock)
  const originalFrontmatter = documentRecord(originalDoc)
  const originalPairs = pairSnapshots(originalDoc, originalBlock)

  applyPatchToDocument(originalDoc, patch)
  const expectedFrontmatter = documentRecord(originalDoc)

  let renderedDoc: Document
  try {
    renderedDoc = mappingDocument(renderedBlock)
  } catch {
    throw new FrontmatterInvariantError()
  }
  const renderedFrontmatter = documentRecord(renderedDoc)
  if (!isDeepStrictEqual(renderedFrontmatter, expectedFrontmatter)) {
    throw new FrontmatterInvariantError()
  }

  const renderedPairs = pairSnapshots(renderedDoc, renderedBlock)
  const matchedRenderedPairs = new Set<number>()
  for (const original of originalPairs) {
    if (touchedKeys.has(original.key)) continue
    if (
      !Object.prototype.hasOwnProperty.call(originalFrontmatter, original.key) ||
      !Object.prototype.hasOwnProperty.call(renderedFrontmatter, original.key) ||
      !isDeepStrictEqual(originalFrontmatter[original.key], renderedFrontmatter[original.key])
    ) {
      throw new FrontmatterInvariantError()
    }

    const match = renderedPairs.findIndex(
      (candidate, index) =>
        !matchedRenderedPairs.has(index) &&
        candidate.key === original.key &&
        rawPairMatches(original.raw, candidate.raw)
    )
    if (match === -1) throw new FrontmatterInvariantError()
    matchedRenderedPairs.add(match)
  }

  return renderedFrontmatter
}

/**
 * Render a top-level mapping while restoring every untouched pair from the
 * original YAML byte-for-byte. The YAML package parses precise numeric
 * scalars through JavaScript Number, so serializing an untouched node directly
 * would round module-authored values during an unrelated app edit.
 */
function renderPreservingUntouchedPairs(
  doc: Document,
  originalBlock: string,
  touchedKeys: ReadonlySet<string>,
  trailingTrivia: string
): string {
  if (!isMap(doc.contents)) throw new MalformedFrontmatterError()

  const preserved: PreservedPair[] = []
  for (const pair of doc.contents.items) {
    const key = pairKey(pair)
    if (key === null) throw new MalformedFrontmatterError()
    if (touchedKeys.has(key)) continue
    const range = pairRange(pair)
    if (!range) throw new MalformedFrontmatterError()
    const placeholder = `__MDVDB_PRESERVED_FRONTMATTER_${preserved.length}__`
    preserved.push({ key, placeholder, raw: originalBlock.slice(range[0], range[1]) })
    pair.value = doc.createNode(placeholder)
  }

  let output = doc.toString()
  const rendered = parseDocument(output, { keepSourceTokens: true })
  if (rendered.errors.length > 0 || !isMap(rendered.contents)) {
    throw new MalformedFrontmatterError()
  }

  const replacements: Array<{ start: number; end: number; raw: string }> = []
  for (const entry of preserved) {
    const pair = rendered.contents.items.find(
      (candidate) =>
        pairKey(candidate) === entry.key &&
        isScalar(candidate.value) &&
        candidate.value.value === entry.placeholder
    )
    const range = pair ? pairRange(pair) : null
    if (!range) throw new MalformedFrontmatterError()
    const renderedPair = output.slice(range[0], range[1])
    const raw =
      renderedPair.endsWith('\n') && !entry.raw.endsWith('\n') ? `${entry.raw}\n` : entry.raw
    replacements.push({ start: range[0], end: range[1], raw })
  }
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.raw + output.slice(replacement.end)
  }

  // `yaml` intentionally normalizes blank lines around a document-level
  // footer comment. Those bytes are outside every top-level pair, so preserve
  // the original trailing trivia separately as part of the lossless contract.
  const reparsed = parseDocument(output, { keepSourceTokens: true })
  if (reparsed.errors.length > 0 || !isMap(reparsed.contents)) {
    throw new MalformedFrontmatterError()
  }
  const lastPair = reparsed.contents.items.at(-1)
  const lastRange = lastPair ? pairRange(lastPair) : null
  if (lastPair && !lastRange) throw new MalformedFrontmatterError()
  if (lastRange) {
    output = output.slice(0, lastRange[1]) + trailingTrivia
  } else {
    const emptyMap = output.indexOf('{}')
    if (emptyMap === -1) throw new MalformedFrontmatterError()
    const mapping = output.slice(0, emptyMap + 2)
    const separator =
      trailingTrivia && !mapping.endsWith('\n') && !trailingTrivia.startsWith('\n') ? '\n' : ''
    output = mapping + separator + trailingTrivia
  }
  // `originalBlock` excludes the structural newline immediately before the
  // closing delimiter. When trailing trivia exists, its final newline is part
  // of that trivia, so append the structural separator even if it already ends
  // in `\n`. With no trivia, the serializer's final newline is that separator.
  if (trailingTrivia) return `${output}\n`
  return output.endsWith('\n') ? output : `${output}\n`
}

/**
 * Apply a frontmatter patch to a markdown string. Pure (no I/O) so it is easy to
 * unit-test. Returns the new full content plus the resulting frontmatter object.
 */
export function applyFrontmatterPatch(
  content: string,
  patch: FrontmatterPatch
): { content: string; frontmatter: Record<string, JsonValue> } {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = bom ? content.slice(1) : content
  const withoutCrLf = source.replace(/\r\n/g, '')
  if (withoutCrLf.includes('\r') || (source.includes('\r\n') && withoutCrLf.includes('\n'))) {
    throw new MalformedFrontmatterError()
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/\r\n/g, '\n')
  const { hasFrontmatter, closed, block, body, closingHasNewline } = splitDocument(normalized)

  let doc: Document
  let effectiveBody: string
  if (hasFrontmatter) {
    // A leading '---' with no closing delimiter is malformed — never clobber.
    if (!closed) {
      throw new MalformedFrontmatterError()
    }
    // An empty block ('---\n---') is valid (empty frontmatter); parseDocument('')
    // yields an empty doc with no errors.
    doc = parseDocument(block, { keepSourceTokens: true })
    if (doc.errors.length > 0) {
      throw new MalformedFrontmatterError()
    }
    effectiveBody = body
  } else {
    // No leading '---' at all — synthesize a new block; the whole file is body.
    doc = new Document({})
    effectiveBody = normalized
  }

  // Empty frontmatter is a writable empty map. Any other scalar/sequence root
  // is valid YAML but not a frontmatter mapping and must fail closed.
  if (doc.contents == null) {
    doc.contents = doc.createNode({}) as Document['contents']
  } else if (!isMap(doc.contents)) {
    throw new MalformedFrontmatterError()
  }

  const touchedKeys = new Set([...(patch.unset ?? []), ...Object.keys(patch.set ?? {})])

  // Replace untouched values with placeholders before mutating touched keys;
  // they are spliced back from `block` after the YAML AST is rendered.
  const originalBlock = block
  let trailingTrivia = ''
  if (hasFrontmatter && isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const key = pairKey(pair)
      if (key === null || pairRange(pair) === null) throw new MalformedFrontmatterError()
    }
    const lastPair = doc.contents.items.at(-1)
    const lastRange = lastPair ? pairRange(lastPair) : null
    trailingTrivia = lastRange ? originalBlock.slice(lastRange[1]) : originalBlock
  }

  applyPatchToDocument(doc, patch)

  // Re-serialize only the frontmatter; doc.toString() ends with a newline.
  // Untouched top-level pairs are restored exactly, including precise numeric
  // tokens, nested flow/block layout, comments, quoting, and spacing.
  const yamlOut = hasFrontmatter
    ? renderPreservingUntouchedPairs(doc, originalBlock, touchedKeys, trailingTrivia)
    : doc.toString()
  const frontmatter = assertRenderedFrontmatterPatchInvariant(originalBlock, yamlOut, patch)
  const closingSuffix = hasFrontmatter
    ? closingHasNewline
      ? `\n${effectiveBody}`
      : ''
    : `\n${effectiveBody}`
  const newNormalized = `---\n${yamlOut}---${closingSuffix}`
  const rendered = eol === '\n' ? newNormalized : newNormalized.replace(/\n/g, eol)
  const newContent = bom + rendered
  return { content: newContent, frontmatter }
}

/** Resolve + validate an absolute path from a collection id and relative path. */
export function resolveWithinCollection(collectionId: string, relativePath: string): string {
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

/** How to notify other windows after a write (null = no broadcast). */
export interface WriteBroadcast {
  windowManager: WindowManager
  /** webContents id of the initiating window (excluded from the broadcast). */
  senderId: number | null
}

export interface WritePatchedFileOptions {
  /** Exact source bytes used to derive `patch`; mismatch aborts before write. */
  expectedContent?: string
  /** Collection boundary used for canonical ancestor validation. */
  collectionRoot?: string
}

/**
 * The shared write tail: read → patch → atomic write → broadcast. Used by the
 * single-cell `fs:update-frontmatter` handler and the phase-41 batch converter
 * so there is exactly one owner of the mutation sequence.
 */
export async function writePatchedFile(
  absolutePath: string,
  patch: FrontmatterPatch,
  broadcast: WriteBroadcast | null,
  options: WritePatchedFileOptions = {}
): Promise<{ content: string; frontmatter: Record<string, JsonValue> }> {
  return withSerializedFileWrite(absolutePath, async () => {
    const original = await fs.readFile(absolutePath, 'utf-8')
    if (options.expectedContent !== undefined && original !== options.expectedContent) {
      throw new FrontmatterSourceChangedError()
    }
    const { content, frontmatter } = applyFrontmatterPatch(original, patch)

    // Atomic write: temp file in the same directory, then rename over the original.
    // The temp file is a dotfile, so the vault watcher never sees it; the final
    // rename surfaces as a 'change' on absolutePath (chokidar atomic handling).
    let cancelOwnWrite: (() => void) | null = null
    let published = false
    try {
      await atomicWriteFile(absolutePath, content, {
        allowedRoot: options.collectionRoot,
        beforeCommit: async () => {
          let current: string
          try {
            current = await fs.readFile(absolutePath, 'utf-8')
          } catch {
            throw new FrontmatterSourceChangedError()
          }
          if (current !== original) throw new FrontmatterSourceChangedError()
          // Register only after every content guard has passed. If the final
          // identity check or rename fails, the exact entry is revoked below.
          cancelOwnWrite = registerOwnWrite(absolutePath, 'write', content)
        },
        onPublished: () => {
          published = true
        }
      })
    } catch (error) {
      if (!published) cancelOwnWrite?.()
      throw error
    }

    // Notify OTHER windows so they reload silently (no conflict prompt).
    if (broadcast) {
      for (const win of broadcast.windowManager.getAllWindows()) {
        if (win.webContents.id !== broadcast.senderId && !win.isDestroyed()) {
          win.webContents.send('file:saved-externally', { path: absolutePath, content })
        }
      }
    }

    return { content, frontmatter }
  })
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
  const collection = getCollections().find((item) => item.id === collectionId)
  if (!collection) throw new Error('Unknown collection')
  const { frontmatter } = await writePatchedFile(
    absolutePath,
    patch,
    {
      windowManager,
      senderId: event.sender.id
    },
    { collectionRoot: collection.path }
  )
  return frontmatter
}
