export type JsonTokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punctuation'
  | 'whitespace'
  | 'invalid'

export interface JsonSyntaxToken {
  text: string
  kind: JsonTokenKind
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
const LITERAL: ReadonlyArray<[string, JsonTokenKind]> = [
  ['true', 'boolean'],
  ['false', 'boolean'],
  ['null', 'null']
]

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s,[\]{}:]/.test(char)
}

/**
 * Tokenize JSON for safe syntax-colored rendering.
 *
 * The renderer consumes token text directly instead of injecting highlighted
 * HTML, so user-authored keys and strings are always escaped by Svelte.
 */
export function tokenizeJson(text: string): JsonSyntaxToken[] {
  const tokens: JsonSyntaxToken[] = []
  let index = 0

  while (index < text.length) {
    const rest = text.slice(index)
    const whitespace = rest.match(/^\s+/)?.[0]
    if (whitespace) {
      tokens.push({ text: whitespace, kind: 'whitespace' })
      index += whitespace.length
      continue
    }

    const char = text[index]
    if ('{}[],:'.includes(char)) {
      tokens.push({ text: char, kind: 'punctuation' })
      index += 1
      continue
    }

    if (char === '"') {
      let end = index + 1
      let escaped = false
      while (end < text.length) {
        const candidate = text[end]
        if (!escaped && candidate === '"') {
          end += 1
          break
        }
        if (!escaped && candidate === '\\') escaped = true
        else escaped = false
        end += 1
      }

      const tokenText = text.slice(index, end)
      let lookahead = end
      while (/\s/.test(text[lookahead] ?? '')) lookahead += 1
      tokens.push({
        text: tokenText,
        kind:
          text[lookahead] === ':'
            ? 'key'
            : end <= text.length && tokenText.endsWith('"')
              ? 'string'
              : 'invalid'
      })
      index = end
      continue
    }

    const number = rest.match(NUMBER)?.[0]
    if (number && isBoundary(text[index + number.length])) {
      tokens.push({ text: number, kind: 'number' })
      index += number.length
      continue
    }

    const literal = LITERAL.find(
      ([candidate]) => rest.startsWith(candidate) && isBoundary(text[index + candidate.length])
    )
    if (literal) {
      tokens.push({ text: literal[0], kind: literal[1] })
      index += literal[0].length
      continue
    }

    let end = index + 1
    while (end < text.length && !/[\s,[\]{}:"]/.test(text[end])) end += 1
    tokens.push({ text: text.slice(index, end), kind: 'invalid' })
    index = end
  }

  return tokens
}
