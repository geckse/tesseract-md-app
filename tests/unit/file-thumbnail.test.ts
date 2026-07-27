import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronMocks = vi.hoisted(() => ({
  createThumbnailFromPath: vi.fn(),
  createFromPath: vi.fn()
}))

vi.mock('electron', () => ({
  nativeImage: electronMocks
}))

import { clearThumbnailCache, fileThumbnail } from '../../src/main/file-thumbnail'

function image(
  dataUrl: string,
  empty = false,
  size: { width: number; height: number } = { width: 200, height: 100 }
) {
  const resize = vi.fn().mockReturnThis()
  return {
    isEmpty: () => empty,
    getSize: () => size,
    resize,
    toDataURL: () => dataUrl,
    resizeSpy: resize
  }
}

let parent: string
let collection: string
let outside: string

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'file-thumbnail-'))
  collection = join(parent, 'collection')
  outside = join(parent, 'outside')
  await mkdir(collection)
  await mkdir(outside)
  clearThumbnailCache()
  electronMocks.createThumbnailFromPath.mockReset()
  electronMocks.createFromPath.mockReset()
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

describe('fileThumbnail', () => {
  it('returns and caches a bounded data URL for collection files', async () => {
    const path = join(collection, 'mockup.png')
    await writeFile(path, 'png')
    const fallback = image('data:image/png;base64,fallback')
    const os = image('data:image/png;base64,os')
    electronMocks.createFromPath.mockReturnValue(fallback)
    electronMocks.createThumbnailFromPath.mockResolvedValue(os)

    const first = await fileThumbnail(path, [collection], 1000, 1)
    const second = await fileThumbnail(path, [collection], 1000, 1)

    expect(first).toMatch(/^data:image\/png;base64,/)
    expect(second).toBe(first)
    const generator =
      process.platform === 'darwin' || process.platform === 'win32'
        ? electronMocks.createThumbnailFromPath
        : electronMocks.createFromPath
    expect(generator).toHaveBeenCalledTimes(1)
    const generatedImage =
      process.platform === 'darwin' || process.platform === 'win32' ? os : fallback
    expect(generatedImage.resizeSpy).toHaveBeenCalledWith({
      width: 32,
      height: 16,
      quality: 'good'
    })
  })

  it('returns null when neither the OS nor raster decoder can make an image', async () => {
    const path = join(collection, 'archive.bin')
    await writeFile(path, 'opaque')
    electronMocks.createFromPath.mockReturnValue(image('', true))
    electronMocks.createThumbnailFromPath.mockResolvedValue(image('', true))

    await expect(fileThumbnail(path, [collection])).resolves.toBeNull()
  })

  it('rejects lexical traversal and symlinks that leave their collection', async () => {
    const outsideFile = join(outside, 'secret.png')
    await writeFile(outsideFile, 'secret')
    await expect(fileThumbnail(outsideFile, [collection])).rejects.toThrow('Access denied')

    const link = join(collection, 'escaped.png')
    await symlink(outsideFile, link)
    await expect(fileThumbnail(link, [collection])).rejects.toThrow('Access denied')
  })
})
