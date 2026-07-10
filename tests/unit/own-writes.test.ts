import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  registerOwnWrite,
  matchAndConsumeOwnWrite,
  clearOwnWrites
} from '../../src/main/own-writes'

beforeEach(() => {
  vi.useFakeTimers()
  clearOwnWrites()
})

afterEach(() => {
  clearOwnWrites()
  vi.useRealTimers()
})

describe('own-writes registry', () => {
  it('matches a registered write against a modified event of equal size', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(true)
  })

  it('consumes entries — a second identical event is external', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(true)
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(false)
  })

  it('does not match a different path', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    expect(matchAndConsumeOwnWrite('/vault/b.md', 'modified', { size: 5 })).toBe(false)
  })

  it('does not match when sizes differ', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 99 })).toBe(false)
    // Entry is NOT consumed by the failed match
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(true)
  })

  it('matches when size is unknown on either side', () => {
    registerOwnWrite('/vault/a.md', 'copy')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'created', { size: 123 })).toBe(true)

    registerOwnWrite('/vault/b.md', 'write', 'hello')
    expect(matchAndConsumeOwnWrite('/vault/b.md', 'modified', { size: null })).toBe(true)
  })

  it('enforces op/kind compatibility', () => {
    registerOwnWrite('/vault/a.md', 'delete')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', null)).toBe(false)
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'deleted', null)).toBe(true)

    registerOwnWrite('/vault/b.md', 'rename-from')
    expect(matchAndConsumeOwnWrite('/vault/b.md', 'created', { size: 1 })).toBe(false)
    expect(matchAndConsumeOwnWrite('/vault/b.md', 'deleted', null)).toBe(true)

    registerOwnWrite('/vault/c.md', 'rename-to')
    expect(matchAndConsumeOwnWrite('/vault/c.md', 'created', { size: null })).toBe(true)
  })

  it('consumes per-path FIFO so later agent writes stay external', () => {
    registerOwnWrite('/vault/a.md', 'write', 'aa')
    registerOwnWrite('/vault/a.md', 'write', 'bbb')
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 2 })).toBe(true)
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 2 })).toBe(false)
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 3 })).toBe(true)
  })

  it('expires entries after the TTL', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    vi.advanceTimersByTime(3_500)
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(false)
  })

  it('computes byte size for multi-byte strings and Buffers', () => {
    registerOwnWrite('/vault/a.md', 'write', 'héllo') // 6 bytes utf-8
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 6 })).toBe(true)

    registerOwnWrite('/vault/b.png', 'write', Buffer.from([1, 2, 3]))
    expect(matchAndConsumeOwnWrite('/vault/b.png', 'modified', { size: 3 })).toBe(true)
  })

  it('clearOwnWrites drops everything', () => {
    registerOwnWrite('/vault/a.md', 'write', 'hello')
    clearOwnWrites()
    expect(matchAndConsumeOwnWrite('/vault/a.md', 'modified', { size: 5 })).toBe(false)
  })
})
