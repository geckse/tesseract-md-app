import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn()
  }
}))

vi.mock('../../src/main/store', () => ({ getCollections: vi.fn().mockReturnValue([]) }))

import { resolveLocalMediaPath } from '../../src/main/media-protocol'

describe('local media protocol', () => {
  it('only resolves media paths within a known collection', () => {
    const collection = resolve('/vault')
    const mediaPath = resolve(collection, 'media/demo.mp4')
    const escapedPath = resolve(collection, '../private/demo.mp4')
    const allowed = `tesseract-media://asset?path=${encodeURIComponent(mediaPath)}`
    const escaped = `tesseract-media://asset?path=${encodeURIComponent(escapedPath)}`

    expect(resolveLocalMediaPath(allowed, [collection])).toBe(mediaPath)
    expect(resolveLocalMediaPath(escaped, [collection])).toBeNull()
  })

  it('rejects malformed and unrelated URLs', () => {
    expect(resolveLocalMediaPath('https://example.test/demo.mp4', ['/vault'])).toBeNull()
    expect(resolveLocalMediaPath('tesseract-media://asset', ['/vault'])).toBeNull()
  })
})
