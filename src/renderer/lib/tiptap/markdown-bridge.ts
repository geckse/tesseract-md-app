import { isMap, isScalar, isSeq, parseDocument, type Document, type Pair, type Scalar } from 'yaml'
import type { JsonValue } from '../../types/cli'
import { parseExactNumberToken } from '../../../shared/exact-number'

/**
 * Split raw markdown content into frontmatter YAML block and body.
 */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const lines = content.split('\n')
  if (lines[0]?.trimEnd() !== '---') return { frontmatter: null, body: content }

  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return { frontmatter: null, body: content }

  const frontmatter = lines.slice(1, endIdx).join('\n')
  const body = lines.slice(endIdx + 1).join('\n')
  return { frontmatter: frontmatter || null, body }
}

/**
 * Recombine frontmatter YAML and body into a full markdown string.
 */
export function joinFrontmatter(frontmatterYaml: string | null, body: string): string {
  if (!frontmatterYaml) return body
  return `---\n${frontmatterYaml}\n---\n${body}`
}

function scalarSource(node: Scalar): string {
  return typeof node.source === 'string' ? node.source : ''
}

function yamlNodeToJson(node: unknown): JsonValue {
  if (isScalar(node)) {
    const value = node.value
    const source = scalarSource(node)
    if (typeof value === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source)) {
      return parseExactNumberToken(source)
    }
    if (value === null) return source.trim() === '' ? '' : null
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    return String(value ?? '')
  }
  if (isSeq(node)) {
    return node.items.map((item) => yamlNodeToJson(item))
  }
  if (isMap(node)) {
    const result: Record<string, JsonValue> = {}
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value ?? '') : String(pair.key ?? '')
      result[key] = yamlNodeToJson(pair.value)
    }
    return result
  }
  return null
}

/**
 * Parse frontmatter through the YAML AST. Unsafe decimal tokens are transported
 * as exact-number markers instead of being rounded through JavaScript Number.
 */
export function parseFrontmatterData(yamlString: string): Record<string, JsonValue> {
  const doc = parseDocument(yamlString, { keepSourceTokens: true })
  if (doc.errors.length > 0 || !isMap(doc.contents)) return {}
  return yamlNodeToJson(doc.contents) as Record<string, JsonValue>
}

/**
 * Serialize a record of key-value pairs back to YAML frontmatter string.
 */
export function serializeFrontmatter(data: Record<string, JsonValue>): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}:`)
      } else {
        lines.push(`${key}:`)
        for (const item of value) {
          lines.push(`  - ${formatYamlValue(item)}`)
        }
      }
    } else {
      lines.push(`${key}: ${formatYamlValue(value)}`)
    }
  }

  return lines.join('\n')
}

interface PreservedPair {
  key: string
  placeholder: string
  raw: string
}

function pairKey(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value ?? '') : String(pair.key ?? '')
}

function pairRange(pair: Pair): [number, number] | null {
  const start = pair.key?.range?.[0]
  const end = pair.value?.range?.[2] ?? pair.value?.range?.[1]
  return typeof start === 'number' && typeof end === 'number' ? [start, end] : null
}

function documentMap(doc: Document): ReturnType<typeof parseDocument>['contents'] {
  return doc.contents
}

/**
 * Update ordinary frontmatter fields while keeping selected top-level YAML
 * pairs byte-for-byte intact.
 *
 * Computed values may contain 28-digit decimals or nested JSON. The yaml
 * package correctly exposes their source ranges, but serializing an untouched
 * numeric Scalar would still route it through JavaScript Number. We therefore
 * use the AST for safe key mutation and splice the original computed pairs back
 * into the serialized document by their parsed ranges.
 */
export function serializeFrontmatterPreservingFields(
  originalYaml: string | null,
  data: Record<string, JsonValue>,
  preservedKeys: Iterable<string>
): string {
  const requested = new Set(preservedKeys)
  if (!originalYaml || requested.size === 0) return serializeFrontmatter(data)

  const doc = parseDocument(originalYaml, { keepSourceTokens: true })
  const contents = documentMap(doc)
  if (doc.errors.length > 0 || !isMap(contents)) return serializeFrontmatter(data)

  const preserved: PreservedPair[] = []
  for (const pair of contents.items) {
    const key = pairKey(pair)
    if (!requested.has(key)) continue
    const range = pairRange(pair)
    if (!range) continue
    const placeholder = `__MDVDB_PRESERVED_COMPUTED_${preserved.length}__`
    preserved.push({ key, placeholder, raw: originalYaml.slice(range[0], range[1]) })
    pair.value = doc.createNode(placeholder)
  }

  const captured = new Set(preserved.map((entry) => entry.key))
  for (const pair of [...contents.items]) {
    const key = pairKey(pair)
    if (!captured.has(key) && !Object.prototype.hasOwnProperty.call(data, key)) {
      doc.delete(key)
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (!captured.has(key)) doc.set(key, value)
  }

  let output = doc.toString()
  const rendered = parseDocument(output, { keepSourceTokens: true })
  if (rendered.errors.length > 0 || !isMap(rendered.contents)) {
    return serializeFrontmatter(data)
  }

  const replacements: { start: number; end: number; raw: string }[] = []
  for (const entry of preserved) {
    const pair = rendered.contents.items.find(
      (candidate) =>
        pairKey(candidate) === entry.key &&
        isScalar(candidate.value) &&
        candidate.value.value === entry.placeholder
    )
    if (!pair) continue
    const range = pairRange(pair)
    if (range) replacements.push({ start: range[0], end: range[1], raw: entry.raw })
  }
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.raw + output.slice(replacement.end)
  }
  return output.replace(/\n$/, '')
}

function formatYamlValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    // Quote strings that could be misinterpreted
    if (
      /^(true|false|null|-?\d+(\.\d+)?)$/.test(value) ||
      value.includes(':') ||
      value.includes('#')
    ) {
      return `"${value}"`
    }
    return value
  }
  return String(value)
}
