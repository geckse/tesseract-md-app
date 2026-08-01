import { describe, expect, it } from 'vitest'
import { tokenizeJson } from '@renderer/lib/json-syntax'

describe('tokenizeJson', () => {
  it('classifies JSON keys and scalar values for syntax coloring', () => {
    const tokens = tokenizeJson(
      '{"name":"Tesseract","count":2,"enabled":true,"missing":null}'
    ).filter((token) => token.kind !== 'punctuation')

    expect(tokens).toEqual([
      { text: '"name"', kind: 'key' },
      { text: '"Tesseract"', kind: 'string' },
      { text: '"count"', kind: 'key' },
      { text: '2', kind: 'number' },
      { text: '"enabled"', kind: 'key' },
      { text: 'true', kind: 'boolean' },
      { text: '"missing"', kind: 'key' },
      { text: 'null', kind: 'null' }
    ])
  })

  it('keeps escaped strings intact and marks malformed input', () => {
    expect(tokenizeJson('{"quote":"a \\"value\\""}')).toContainEqual({
      text: '"a \\"value\\""',
      kind: 'string'
    })
    expect(tokenizeJson('{broken}')).toContainEqual({ text: 'broken', kind: 'invalid' })
  })
})
