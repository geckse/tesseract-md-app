/**
 * Lossless JSON-number transport for CLI payloads.
 *
 * JavaScript cannot represent every `rust_decimal` JSON token. Before
 * `JSON.parse`, risky tokens are replaced with this plain marker object so
 * Electron structured-clone preserves their exact spelling.
 */

export const EXACT_NUMBER_KEY = '__mdvdb_exact_number'

export interface ExactJsonNumber {
  [EXACT_NUMBER_KEY]: string
}

export function isExactJsonNumber(value: unknown): value is ExactJsonNumber {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length === 1 && entries[0][0] === EXACT_NUMBER_KEY && typeof entries[0][1] === 'string'
  )
}

export function exactNumberText(value: unknown): string | null {
  return isExactJsonNumber(value) ? value[EXACT_NUMBER_KEY] : null
}

function shouldPreserveNumber(token: string): boolean {
  if (!token.includes('.') && !/[eE]/.test(token)) {
    try {
      const integer = BigInt(token)
      return integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)
    } catch {
      return true
    }
  }

  const numeric = Number(token)
  if (!Number.isFinite(numeric)) return true
  const mantissa = token.split(/[eE]/, 1)[0].replace(/^[+-]/, '').replace('.', '')
  const significantDigits = mantissa.replace(/^0+/, '').replace(/0+$/, '').length
  return significantDigits > 15
}

/**
 * Parse one plain JSON-style number token without losing precision.
 *
 * Safe values stay ordinary JavaScript numbers. Precision-sensitive values use
 * the same structured-clone-safe marker as CLI JSON parsing.
 */
export function parseExactNumberToken(token: string): number | ExactJsonNumber {
  return shouldPreserveNumber(token) ? { [EXACT_NUMBER_KEY]: token } : Number(token)
}

/**
 * Rewrite only JSON number tokens, never text inside strings. Safe-size
 * numbers stay native numbers; precision-sensitive tokens become markers.
 */
export function preserveExactJsonNumbers(source: string): string {
  let output = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '"') {
      const start = index++
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index++] === '"') break
      }
      output += source.slice(start, index)
      continue
    }

    if (char === '-' || (char >= '0' && char <= '9')) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index))
      if (match) {
        const token = match[0]
        output += shouldPreserveNumber(token)
          ? `{${JSON.stringify(EXACT_NUMBER_KEY)}:${JSON.stringify(token)}}`
          : token
        index += token.length
        continue
      }
    }

    output += char
    index++
  }
  return output
}

interface DecimalParts {
  sign: -1 | 0 | 1
  digits: string
  magnitude: number
}

function decimalParts(source: string): DecimalParts | null {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(source.trim())
  if (!match) return null

  let digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, '')
  if (digits === '') return { sign: 0, digits: '0', magnitude: 0 }
  let scale = Number(match[4] ?? 0) - (match[3]?.length ?? 0)
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    scale++
  }
  return {
    sign: match[1] === '-' ? -1 : 1,
    magnitude: digits.length + scale,
    digits
  }
}

/** Compare finite decimal strings without converting through IEEE-754. */
export function compareDecimalText(left: string, right: string): number | null {
  const a = decimalParts(left)
  const b = decimalParts(right)
  if (!a || !b) return null
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  if (a.sign === 0) return 0

  let order = 0
  if (a.magnitude !== b.magnitude) {
    order = a.magnitude < b.magnitude ? -1 : 1
  } else {
    const width = Math.max(a.digits.length, b.digits.length)
    const aDigits = a.digits.padEnd(width, '0')
    const bDigits = b.digits.padEnd(width, '0')
    order = aDigits === bDigits ? 0 : aDigits < bDigits ? -1 : 1
  }
  return a.sign < 0 ? -order : order
}

function stringifyExactJsonAt(value: unknown, indent: number, depth: number): string {
  const exact = exactNumberText(value)
  if (exact !== null) return exact
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (indent === 0) {
      return `[${value.map((item) => stringifyExactJsonAt(item, indent, depth + 1)).join(',')}]`
    }
    const childPadding = ' '.repeat(indent * (depth + 1))
    const padding = ' '.repeat(indent * depth)
    return `[\n${childPadding}${value
      .map((item) => stringifyExactJsonAt(item, indent, depth + 1))
      .join(`,\n${childPadding}`)}\n${padding}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    if (indent === 0) {
      return `{${entries
        .map(
          ([key, item]) => `${JSON.stringify(key)}:${stringifyExactJsonAt(item, indent, depth + 1)}`
        )
        .join(',')}}`
    }
    const childPadding = ' '.repeat(indent * (depth + 1))
    const padding = ' '.repeat(indent * depth)
    return `{\n${childPadding}${entries
      .map(
        ([key, item]) => `${JSON.stringify(key)}: ${stringifyExactJsonAt(item, indent, depth + 1)}`
      )
      .join(`,\n${childPadding}`)}\n${padding}}`
  }
  return ''
}

/** JSON display that emits exact-number markers as number tokens. */
export function stringifyExactJson(value: unknown, space = 0): string {
  return stringifyExactJsonAt(value, Math.max(0, Math.floor(space)), 0)
}
