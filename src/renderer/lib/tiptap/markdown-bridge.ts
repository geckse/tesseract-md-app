import type { JsonValue } from '../../types/cli'

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

/**
 * Parse a YAML frontmatter string into key-value pairs.
 * Handles scalars, inline arrays, block arrays, booleans, and numbers.
 */
export function parseFrontmatterData(yamlString: string): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  const lines = yamlString.split('\n')
  let currentKey: string | null = null

  for (const line of lines) {
    // Array continuation item (e.g. "  - value")
    if (/^\s+-\s+/.test(line) && currentKey) {
      const item = line.replace(/^\s+-\s+/, '').trim()
      const existing = result[currentKey]
      if (Array.isArray(existing)) {
        existing.push(unquote(item))
      }
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 1).trim()
    currentKey = key

    if (rawValue === '') {
      result[key] = []
    } else if (/^\[.*\]$/.test(rawValue)) {
      const inner = rawValue.slice(1, -1)
      result[key] = inner.split(',').map((s) => unquote(s.trim()))
    } else if (rawValue === 'true') {
      result[key] = true
    } else if (rawValue === 'false') {
      result[key] = false
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      result[key] = Number(rawValue)
    } else {
      result[key] = unquote(rawValue)
    }
  }

  // Convert empty arrays to empty string (matches existing behavior)
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v) && v.length === 0) {
      result[k] = ''
    }
  }

  return result
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

function formatYamlValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    // Quote strings that could be misinterpreted
    if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(value) || value.includes(':') || value.includes('#')) {
      return `"${value}"`
    }
    return value
  }
  return String(value)
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}
