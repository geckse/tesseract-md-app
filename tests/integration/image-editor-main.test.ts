import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { encode as encodeBmp } from '@nktkas/bmp'
import decodeIco from 'decode-ico'
import {
  ImageChangedError,
  editImageFile,
  processImageBuffer,
  readImageFile
} from '../../src/main/image-editor'
import type { ImageEditRecipe, ImageExtension } from '../../src/shared/image-edit'

const recipe: ImageEditRecipe = {
  rotation: 90,
  crop: { x: 0, y: 0, width: 0.5, height: 1 },
  width: 8,
  height: 6
}

async function png(width = 12, height = 8, color = '#00e5ff'): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color }
  })
    .png()
    .toBuffer()
}

function ico(images: Array<{ buffer: Buffer; width: number; height: number }>): Buffer {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.byteLength
  images.forEach(({ buffer, width, height }, index) => {
    const entry = 6 + index * 16
    directory.writeUInt8(width === 256 ? 0 : width, entry)
    directory.writeUInt8(height === 256 ? 0 : height, entry + 1)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(buffer.byteLength, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += buffer.byteLength
  })
  return Buffer.concat([directory, ...images.map(({ buffer }) => buffer)])
}

describe('main image processor', () => {
  it.each([
    ['png', () => png()],
    [
      'jpg',
      async () =>
        sharp(await png())
          .jpeg()
          .toBuffer()
    ],
    [
      'webp',
      async () =>
        sharp(await png())
          .webp()
          .toBuffer()
    ],
    [
      'avif',
      async () =>
        sharp(await png())
          .avif()
          .toBuffer()
    ]
  ] satisfies Array<[ImageExtension, () => Promise<Buffer>]>)(
    'preserves the %s format while rotating, cropping and resizing',
    async (extension, input) => {
      const result = await processImageBuffer(await input(), extension, recipe)
      const metadata = await sharp(result.buffer).metadata()
      expect(metadata.format).toBe(
        extension === 'jpg' ? 'jpeg' : extension === 'avif' ? 'heif' : extension
      )
      expect([metadata.width, metadata.height]).toEqual([8, 6])
    }
  )

  it('keeps SVG content vector-based', async () => {
    const input = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect id="shape" width="12" height="8"/></svg>'
    )
    const result = await processImageBuffer(input, 'svg', recipe)
    const text = result.buffer.toString('utf-8')
    expect(text).toContain('<rect id="shape"')
    expect(text).toContain('matrix(0 1 -1 0 8 0)')
    expect(text).not.toContain('data:image/')
    expect(await sharp(result.buffer).metadata()).toMatchObject({
      format: 'svg',
      width: 8,
      height: 6
    })
  })

  it('decodes and re-encodes BMP with alpha-capable output', async () => {
    const raw = {
      width: 12,
      height: 8,
      channels: 4 as const,
      data: new Uint8Array(12 * 8 * 4).fill(180)
    }
    const input = Buffer.from(encodeBmp(raw))
    const result = await processImageBuffer(input, 'bmp', recipe)
    expect(result.buffer.subarray(0, 2).toString('ascii')).toBe('BM')
    expect([result.width, result.height]).toEqual([8, 6])
  })

  it('preserves ICO as a multi-representation icon', async () => {
    const icon = ico([
      { buffer: await png(16, 16), width: 16, height: 16 },
      { buffer: await png(32, 32), width: 32, height: 32 }
    ])
    const result = await processImageBuffer(icon, 'ico', {
      rotation: 90,
      crop: null,
      width: 24,
      height: 24
    })
    const decoded = decodeIco(result.buffer)
    expect(decoded.length).toBeGreaterThanOrEqual(2)
    expect(decoded.some((entry) => entry.width === 16 && entry.height === 16)).toBe(true)
    expect(decoded.some((entry) => entry.width === 24 && entry.height === 24)).toBe(true)
  })

  it.each(['gif', 'webp'] as const)(
    'preserves animation pages and timing for %s',
    async (format) => {
      const first = Buffer.alloc(4 * 4 * 4, 0)
      const second = Buffer.alloc(4 * 4 * 4, 255)
      const animation = sharp(Buffer.concat([first, second]), {
        raw: { width: 4, height: 8, channels: 4, pageHeight: 4 }
      })
      const input = await (
        format === 'gif'
          ? animation.gif({ delay: [40, 90], loop: 2 })
          : animation.webp({ delay: [40, 90], loop: 2 })
      ).toBuffer()

      const result = await processImageBuffer(input, format, {
        rotation: 90,
        crop: null,
        width: 6,
        height: 5
      })
      const metadata = await sharp(result.buffer, { animated: true }).metadata()
      expect(metadata.pages).toBe(2)
      expect(metadata.delay).toEqual([40, 90])
      expect(metadata.loop).toBe(2)
      expect([metadata.width, metadata.pageHeight]).toEqual([6, 5])
    }
  )

  it('normalizes EXIF orientation before applying the recipe', async () => {
    const input = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#ff0066' }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const result = await processImageBuffer(input, 'jpg', {
      rotation: 0,
      crop: null,
      width: null,
      height: null
    })
    const metadata = await sharp(result.buffer).metadata()
    expect([result.width, result.height]).toEqual([8, 12])
    expect(metadata.orientation).toBe(1)
  })

  it('rejects invalid recipes before processing', async () => {
    await expect(
      processImageBuffer(await png(), 'png', {
        rotation: 0,
        crop: { x: 0.8, y: 0, width: 0.5, height: 1 },
        width: null,
        height: null
      })
    ).rejects.toThrow('Crop rectangle must stay within the image')
  })
})

describe('atomic image edit', () => {
  const directories: string[] = []

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  it('writes atomically only when the source hash still matches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tesseract-image-edit-'))
    directories.push(directory)
    const path = join(directory, 'image.png')
    const input = await png()
    await writeFile(path, input)
    const expectedSha256 = createHash('sha256').update(input).digest('hex')

    const result = await editImageFile(path, {
      requestId: crypto.randomUUID(),
      expectedSha256,
      recipe
    })
    expect(result.width).toBe(8)
    expect((await stat(path)).size).toBe(result.size)
    expect((await sharp(await readFile(path)).metadata()).height).toBe(6)
  })

  it('refuses to overwrite a changed source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tesseract-image-conflict-'))
    directories.push(directory)
    const path = join(directory, 'image.png')
    await writeFile(path, await png())

    await expect(
      editImageFile(path, {
        requestId: crypto.randomUUID(),
        expectedSha256: 'stale',
        recipe
      })
    ).rejects.toBeInstanceOf(ImageChangedError)
  })

  it('reads dimensions, MIME, size and a SHA-256 baseline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tesseract-image-read-'))
    directories.push(directory)
    const path = join(directory, 'image.png')
    const input = await png(7, 5)
    await writeFile(path, input)

    const result = await readImageFile(path)
    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 7,
      height: 5,
      size: input.byteLength,
      sha256: createHash('sha256').update(input).digest('hex')
    })
    expect(result.base64).toBe(input.toString('base64'))
  })
})
