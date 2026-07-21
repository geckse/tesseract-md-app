import { describe, expect, it } from 'vitest'
import vm from 'node:vm'

import { toMessagePortBinaryPayload } from '../../src/preload/binary-export'

describe('binary export transport', () => {
  it('returns Uint8Array payloads backed by exact buffers', () => {
    const direct = Uint8Array.from([1, 2, 3, 4]).buffer
    const directPayload = toMessagePortBinaryPayload(direct)
    expect(directPayload).toBeInstanceOf(Uint8Array)
    expect(directPayload.buffer).toBe(direct)
    expect([...directPayload]).toEqual([1, 2, 3, 4])

    const fullView = new Uint8Array([1, 2, 3, 4])
    const viewPayload = toMessagePortBinaryPayload(fullView)
    expect(viewPayload).toBeInstanceOf(Uint8Array)
    expect(viewPayload.buffer).toBe(fullView.buffer)
  })

  it('copies only the visible bytes of sliced views', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 8])
    const result = toMessagePortBinaryPayload(backing.subarray(1, 4))

    expect(result.buffer).not.toBe(backing.buffer)
    expect(result.byteOffset).toBe(0)
    expect(result.buffer.byteLength).toBe(3)
    expect([...result]).toEqual([1, 2, 3])
  })

  it('preserves ArrayBuffers and views created in a different V8 realm', () => {
    const foreignBuffer = vm.runInNewContext(
      'Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer'
    ) as ArrayBuffer
    const foreignView = vm.runInNewContext(
      'Uint8Array.from([9, 1, 2, 3, 8]).subarray(1, 4)'
    ) as Uint8Array

    expect(foreignBuffer instanceof ArrayBuffer).toBe(false)
    expect([...toMessagePortBinaryPayload(foreignBuffer)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect([...toMessagePortBinaryPayload(foreignView)]).toEqual([1, 2, 3])
  })
})
