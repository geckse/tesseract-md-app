import { describe, it, expect } from 'vitest'
import { toPosix, relativeToCollection } from '@renderer/lib/path'

describe('toPosix', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(toPosix('C:\\Users\\x\\vault\\notes\\img.png')).toBe('C:/Users/x/vault/notes/img.png')
  })

  it('leaves unix paths unchanged', () => {
    expect(toPosix('/Users/x/vault/notes/img.png')).toBe('/Users/x/vault/notes/img.png')
  })

  it('handles mixed separators', () => {
    expect(toPosix('C:\\Users\\x/vault\\img.png')).toBe('C:/Users/x/vault/img.png')
  })

  it('handles empty string', () => {
    expect(toPosix('')).toBe('')
  })
})

describe('relativeToCollection', () => {
  it('relativizes Windows-native paths against a Windows root', () => {
    expect(relativeToCollection('C:\\Users\\x\\vault\\notes\\img.png', 'C:\\Users\\x\\vault')).toBe(
      'notes/img.png'
    )
  })

  it('relativizes when the root uses forward slashes but the path is Windows-native', () => {
    // getPathForFile() returns native paths; stored collection roots may be posix-style
    expect(relativeToCollection('C:\\Users\\x\\vault\\notes\\img.png', 'C:/Users/x/vault')).toBe(
      'notes/img.png'
    )
  })

  it('relativizes unix paths', () => {
    expect(relativeToCollection('/Users/x/vault/notes/img.png', '/Users/x/vault')).toBe(
      'notes/img.png'
    )
  })

  it('returns a top-level file without a leading slash', () => {
    expect(relativeToCollection('/Users/x/vault/img.png', '/Users/x/vault')).toBe('img.png')
  })

  it('returns null for paths outside the root', () => {
    expect(relativeToCollection('/Users/x/elsewhere/img.png', '/Users/x/vault')).toBeNull()
    expect(relativeToCollection('C:\\Other\\img.png', 'C:\\Users\\x\\vault')).toBeNull()
  })

  it('does not match sibling directories sharing the root as a name prefix', () => {
    expect(relativeToCollection('/Users/x/vault-backup/img.png', '/Users/x/vault')).toBeNull()
  })

  it('ignores a trailing slash on the root', () => {
    expect(relativeToCollection('/Users/x/vault/notes/img.png', '/Users/x/vault/')).toBe(
      'notes/img.png'
    )
    expect(
      relativeToCollection('C:\\Users\\x\\vault\\notes\\img.png', 'C:\\Users\\x\\vault\\')
    ).toBe('notes/img.png')
  })

  it('returns null when the path is exactly the root', () => {
    expect(relativeToCollection('/Users/x/vault', '/Users/x/vault')).toBeNull()
    expect(relativeToCollection('/Users/x/vault/', '/Users/x/vault')).toBeNull()
  })

  it('returns null for an empty root', () => {
    expect(relativeToCollection('/Users/x/vault/img.png', '')).toBeNull()
    expect(relativeToCollection('/Users/x/vault/img.png', '/')).toBeNull()
  })
})
