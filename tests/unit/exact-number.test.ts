import { describe, expect, it } from 'vitest'
import {
  compareDecimalText,
  exactNumberText,
  preserveExactJsonNumbers,
  stringifyExactJson
} from '../../src/shared/exact-number'

describe('lossless CLI JSON numbers', () => {
  it('preserves decimal tokens that JavaScript cannot represent', () => {
    const parsed = JSON.parse(
      preserveExactJsonNumbers(
        '{"small":0.3,"large":12345678901234567890.12345678,"unsafe":9007199254740993}'
      )
    ) as Record<string, unknown>

    expect(parsed.small).toBe(0.3)
    expect(exactNumberText(parsed.large)).toBe('12345678901234567890.12345678')
    expect(exactNumberText(parsed.unsafe)).toBe('9007199254740993')
    expect(stringifyExactJson(parsed)).toBe(
      '{"small":0.3,"large":12345678901234567890.12345678,"unsafe":9007199254740993}'
    )
  })

  it('never rewrites number-looking content inside JSON strings', () => {
    const source = '{"value":"12345678901234567890.12345678"}'
    expect(preserveExactJsonNumbers(source)).toBe(source)
  })

  it('compares signed and exponent decimals exactly', () => {
    expect(compareDecimalText('0.10000000000000000001', '0.1')).toBe(1)
    expect(compareDecimalText('-12.5', '-12.49')).toBe(-1)
    expect(compareDecimalText('1e3', '1000.0')).toBe(0)
    expect(compareDecimalText('9007199254740993', '9007199254740992')).toBe(1)
    expect(compareDecimalText('-0', '0.000')).toBe(0)
    expect(compareDecimalText('not-a-number', '1')).toBeNull()
  })

  it('preserves and displays precision-sensitive numbers inside nested values', () => {
    const parsed = JSON.parse(
      preserveExactJsonNumbers(
        '{"amounts":[0.1,0.10000000000000000001],"nested":{"value":-9.007199254740993e15}}'
      )
    ) as Record<string, unknown>

    const amounts = parsed.amounts as unknown[]
    const nested = parsed.nested as Record<string, unknown>
    expect(amounts[0]).toBe(0.1)
    expect(exactNumberText(amounts[1])).toBe('0.10000000000000000001')
    expect(exactNumberText(nested.value)).toBe('-9.007199254740993e15')
    expect(stringifyExactJson(parsed)).toBe(
      '{"amounts":[0.1,0.10000000000000000001],"nested":{"value":-9.007199254740993e15}}'
    )
  })

  it('pretty-prints nested JSON without exposing exact-number markers', () => {
    const parsed = JSON.parse(
      preserveExactJsonNumbers('{"sequence":9007199254740993,"values":[0.10000000000000001]}')
    )

    expect(stringifyExactJson(parsed, 2)).toBe(
      '{\n  "sequence": 9007199254740993,\n  "values": [\n    0.10000000000000001\n  ]\n}'
    )
  })
})
