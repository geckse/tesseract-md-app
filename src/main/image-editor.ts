import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { promises as fs } from 'node:fs'
import sharp, { type Metadata, type Sharp } from 'sharp'
import { decode as decodeBmp, encode as encodeBmp } from '@nktkas/bmp'
import decodeIco from 'decode-ico'
import { atomicWriteFile } from './atomic-write'
import { registerOwnWrite } from './own-writes'
import {
  IMAGE_MIME_TYPES,
  cropPixelDimensions,
  imageExtension,
  outputDimensions,
  orientedDimensions,
  type ImageEditRecipe,
  type ImageEditRequest,
  type ImageEditResult,
  type ImageExtension,
  type ImageReadResult,
  type NormalizedCropRect
} from '../shared/image-edit'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_DIMENSION = 32_768
const MAX_OUTPUT_PIXELS = 100_000_000
const ICO_MAX_DIMENSION = 256
const ICO_STANDARD_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

interface EditTask {
  cancelled: boolean
  pipelines: Set<Sharp>
}

interface ProcessedImage {
  buffer: Buffer
  width: number
  height: number
}

interface PixelCrop {
  left: number
  top: number
  width: number
  height: number
}

const activeTasks = new Map<string, EditTask>()

export class ImageChangedError extends Error {
  constructor() {
    super('IMAGE_CHANGED: The image changed on disk. Reload it before saving.')
    this.name = 'ImageChangedError'
  }
}

export class ImageEditCancelledError extends Error {
  constructor() {
    super('IMAGE_EDIT_CANCELLED: Image editing was cancelled.')
    this.name = 'ImageEditCancelledError'
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function extensionForPath(absolutePath: string): ImageExtension {
  const extension = imageExtension(absolutePath)
  if (!extension) {
    throw new Error(`Unsupported image extension: ${extname(absolutePath) || '(none)'}`)
  }
  return extension
}

function assertFileSize(size: number): void {
  if (size > MAX_FILE_BYTES) {
    throw new Error('Image is too large for editing (max 50MB)')
  }
}

function checkCancelled(task: EditTask): void {
  if (task.cancelled) throw new ImageEditCancelledError()
}

async function runSharp<T>(
  task: EditTask,
  pipeline: Sharp,
  operation: (pipeline: Sharp) => Promise<T>
): Promise<T> {
  checkCancelled(task)
  task.pipelines.add(pipeline)
  try {
    const result = await operation(pipeline)
    checkCancelled(task)
    return result
  } finally {
    task.pipelines.delete(pipeline)
  }
}

function orientedMetadataDimensions(metadata: Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0
  const height = metadata.pageHeight ?? metadata.height ?? 0
  if (width < 1 || height < 1) {
    throw new Error('The image has no readable dimensions')
  }
  return metadata.orientation && metadata.orientation >= 5
    ? { width: height, height: width }
    : { width, height }
}

async function imageDimensions(
  input: Buffer,
  extension: ImageExtension
): Promise<{ width: number; height: number }> {
  if (extension === 'bmp') {
    const decoded = decodeBmp(input)
    return { width: decoded.width, height: decoded.height }
  }
  if (extension === 'ico') {
    const decoded = decodeIco(input)
    const largest = decoded.sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!largest) throw new Error('The icon contains no readable images')
    return { width: largest.width, height: largest.height }
  }
  const metadata = await sharp(input, {
    animated: extension === 'gif' || extension === 'webp'
  }).metadata()
  return orientedMetadataDimensions(metadata)
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`)
}

function assertRecipe(
  recipe: ImageEditRecipe,
  sourceWidth: number,
  sourceHeight: number,
  extension: ImageExtension
): void {
  if (![0, 90, 180, 270].includes(recipe.rotation)) {
    throw new Error('Rotation must be 0, 90, 180 or 270 degrees')
  }

  if (recipe.crop) {
    const { x, y, width, height } = recipe.crop
    for (const [name, value] of Object.entries({ x, y, width, height })) {
      assertFinite(`Crop ${name}`, value)
    }
    if (
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000001 ||
      y + height > 1.000001
    ) {
      throw new Error('Crop rectangle must stay within the image')
    }
  }

  for (const [name, value] of Object.entries({ width: recipe.width, height: recipe.height })) {
    if (value === null) continue
    assertFinite(`Resize ${name}`, value)
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
      throw new Error(`Resize ${name} must be an integer between 1 and ${MAX_DIMENSION}`)
    }
  }
  if ((recipe.width === null) !== (recipe.height === null)) {
    throw new Error('Resize width and height must be supplied together')
  }

  const cropSize = cropPixelDimensions(sourceWidth, sourceHeight, recipe)
  if (cropSize.width < 1 || cropSize.height < 1) {
    throw new Error('Crop area must contain at least one pixel')
  }
  const output = outputDimensions(sourceWidth, sourceHeight, recipe)
  if (output.width * output.height > MAX_OUTPUT_PIXELS) {
    throw new Error('Edited image would exceed the 100 megapixel limit')
  }
  if (
    extension === 'ico' &&
    (output.width > ICO_MAX_DIMENSION || output.height > ICO_MAX_DIMENSION)
  ) {
    throw new Error('ICO images cannot be resized beyond 256×256')
  }
}

function pixelCrop(
  crop: NormalizedCropRect | null,
  width: number,
  height: number
): PixelCrop | null {
  if (!crop) return null
  const left = Math.max(0, Math.min(width - 1, Math.floor(crop.x * width)))
  const top = Math.max(0, Math.min(height - 1, Math.floor(crop.y * height)))
  const right = Math.max(left + 1, Math.min(width, Math.round((crop.x + crop.width) * width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round((crop.y + crop.height) * height)))
  return { left, top, width: right - left, height: bottom - top }
}

function transformPipeline(
  pipeline: Sharp,
  sourceWidth: number,
  sourceHeight: number,
  recipe: ImageEditRecipe,
  autoOrient: boolean
): Sharp {
  let result = pipeline
  if (autoOrient) result = result.autoOrient()
  if (recipe.rotation !== 0) result = result.rotate(recipe.rotation)

  const oriented = orientedDimensions(sourceWidth, sourceHeight, recipe.rotation)
  const crop = pixelCrop(recipe.crop, oriented.width, oriented.height)
  if (crop) result = result.extract(crop)
  if (recipe.width !== null && recipe.height !== null) {
    result = result.resize({ width: recipe.width, height: recipe.height, fit: 'fill' })
  }
  return result
}

function encodeRaster(
  pipeline: Sharp,
  extension: Exclude<ImageExtension, 'svg' | 'bmp' | 'ico'>,
  metadata?: Metadata
): Sharp {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return pipeline.keepMetadata().jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    case 'png':
      return pipeline.keepMetadata().png()
    case 'webp':
      return pipeline.keepMetadata().webp({
        quality: 90,
        alphaQuality: 100,
        loop: metadata?.loop,
        delay: metadata?.delay
      })
    case 'avif':
      return pipeline.keepMetadata().avif({ quality: 82, effort: 5 })
    case 'gif':
      return pipeline.gif({
        reuse: true,
        effort: 7,
        loop: metadata?.loop,
        delay: metadata?.delay
      })
  }
}

async function processStaticRaster(
  input: Buffer,
  extension: Exclude<ImageExtension, 'svg' | 'bmp' | 'ico'>,
  recipe: ImageEditRecipe,
  task: EditTask
): Promise<ProcessedImage> {
  const metadata = await sharp(input).metadata()
  const source = orientedMetadataDimensions(metadata)
  let pipeline = sharp(input)
  pipeline = transformPipeline(pipeline, source.width, source.height, recipe, true)
  pipeline = encodeRaster(pipeline, extension, metadata)
  const { data, info } = await runSharp(task, pipeline, (active) =>
    active.toBuffer({ resolveWithObject: true })
  )
  return { buffer: data, width: info.width, height: info.height }
}

async function processAnimatedRaster(
  input: Buffer,
  extension: 'gif' | 'webp',
  recipe: ImageEditRecipe,
  task: EditTask
): Promise<ProcessedImage> {
  const metadata = await sharp(input, { animated: true }).metadata()
  const pages = metadata.pages ?? 1
  if (pages <= 1) return processStaticRaster(input, extension, recipe, task)

  const rawPipeline = sharp(input, { animated: true }).ensureAlpha().raw()
  const { data: raw, info } = await runSharp(task, rawPipeline, (active) =>
    active.toBuffer({ resolveWithObject: true })
  )
  const pageHeight = info.pageHeight ?? Math.floor(info.height / pages)
  const frameBytes = info.width * pageHeight * info.channels
  const frames: Buffer[] = []
  let outputWidth = 0
  let outputHeight = 0

  for (let page = 0; page < pages; page += 1) {
    checkCancelled(task)
    const frame = raw.subarray(page * frameBytes, (page + 1) * frameBytes)
    let pipeline = sharp(frame, {
      raw: {
        width: info.width,
        height: pageHeight,
        channels: info.channels
      }
    })
    pipeline = transformPipeline(pipeline, info.width, pageHeight, recipe, false)
    pipeline = pipeline.ensureAlpha().raw()
    const transformed = await runSharp(task, pipeline, (active) =>
      active.toBuffer({ resolveWithObject: true })
    )
    outputWidth = transformed.info.width
    outputHeight = transformed.info.height
    frames.push(transformed.data)
  }

  let output = sharp(Buffer.concat(frames), {
    raw: {
      width: outputWidth,
      height: outputHeight * pages,
      channels: 4,
      pageHeight: outputHeight
    }
  })
  output = encodeRaster(output, extension, metadata)
  const encoded = await runSharp(task, output, (active) =>
    active.toBuffer({ resolveWithObject: true })
  )
  return { buffer: encoded.data, width: outputWidth, height: outputHeight }
}

async function processBmp(
  input: Buffer,
  recipe: ImageEditRecipe,
  task: EditTask
): Promise<ProcessedImage> {
  const decoded = decodeBmp(input)
  let pipeline = sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels
    }
  })
  pipeline = transformPipeline(pipeline, decoded.width, decoded.height, recipe, false)
  pipeline = pipeline.ensureAlpha().raw()
  const { data, info } = await runSharp(task, pipeline, (active) =>
    active.toBuffer({ resolveWithObject: true })
  )
  const encoded = encodeBmp(
    {
      width: info.width,
      height: info.height,
      channels: 4,
      data
    },
    { bitsPerPixel: 32, compression: 6, headerType: 'BITMAPV5HEADER' }
  )
  return { buffer: Buffer.from(encoded), width: info.width, height: info.height }
}

async function processIco(
  input: Buffer,
  recipe: ImageEditRecipe,
  task: EditTask
): Promise<ProcessedImage> {
  const decoded = decodeIco(input)
  const sorted = decoded.sort((a, b) => b.width * b.height - a.width * a.height)
  const largest = sorted[0]
  if (!largest) throw new Error('The icon contains no readable images')

  const masterOutput = outputDimensions(largest.width, largest.height, recipe)
  const seen = new Set<string>()
  const iconBuffers: Array<{ buffer: Buffer; width: number; height: number }> = []

  async function addRepresentation(
    image: (typeof sorted)[number],
    width: number,
    height: number
  ): Promise<void> {
    checkCancelled(task)
    const key = `${width}x${height}`
    if (seen.has(key)) return
    seen.add(key)

    let pipeline =
      image.type === 'png'
        ? sharp(Buffer.from(image.data))
        : sharp(Buffer.from(image.data), {
            raw: { width: image.width, height: image.height, channels: 4 }
          })
    pipeline = transformPipeline(
      pipeline,
      image.width,
      image.height,
      { ...recipe, width, height },
      false
    )
    pipeline = pipeline.png()
    const png = await runSharp(task, pipeline, (active) => active.toBuffer())
    iconBuffers.push({ buffer: png, width, height })
  }

  // Retain a transformed version of every source representation.
  for (const image of sorted) {
    const scale =
      recipe.width !== null && recipe.height !== null
        ? Math.min(image.width / largest.width, image.height / largest.height)
        : 1
    const nativeOutput = outputDimensions(image.width, image.height, {
      ...recipe,
      width: recipe.width === null ? null : Math.max(1, Math.round(masterOutput.width * scale)),
      height: recipe.height === null ? null : Math.max(1, Math.round(masterOutput.height * scale))
    })
    await addRepresentation(image, nativeOutput.width, nativeOutput.height)
  }

  // ICO consumers commonly choose from a fixed ladder. Regenerate every
  // standard representation up to the requested maximum from the best source,
  // while retaining the exact (possibly non-square) requested dimensions.
  const masterMax = Math.max(masterOutput.width, masterOutput.height)
  for (const size of ICO_STANDARD_SIZES) {
    if (size >= masterMax) break
    const scale = size / masterMax
    await addRepresentation(
      largest,
      Math.max(1, Math.round(masterOutput.width * scale)),
      Math.max(1, Math.round(masterOutput.height * scale))
    )
  }
  await addRepresentation(largest, masterOutput.width, masterOutput.height)

  return {
    buffer: encodePngIco(iconBuffers),
    width: masterOutput.width,
    height: masterOutput.height
  }
}

/** Encode PNG-backed ICO representations without flattening them to one bitmap. */
function encodePngIco(images: Array<{ buffer: Buffer; width: number; height: number }>): Buffer {
  if (images.length < 1 || images.length > 65_535) {
    throw new Error('ICO output must contain between 1 and 65535 representations')
  }
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)

  let offset = directory.byteLength
  images.forEach(({ buffer, width, height }, index) => {
    const entry = 6 + index * 16
    directory.writeUInt8(width === 256 ? 0 : width, entry)
    directory.writeUInt8(height === 256 ? 0 : height, entry + 1)
    directory.writeUInt8(0, entry + 2)
    directory.writeUInt8(0, entry + 3)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(buffer.byteLength, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += buffer.byteLength
  })
  return Buffer.concat([directory, ...images.map(({ buffer }) => buffer)])
}

function svgRotationTransform(
  rotation: ImageEditRecipe['rotation'],
  width: number,
  height: number
) {
  switch (rotation) {
    case 90:
      return `matrix(0 1 -1 0 ${height} 0)`
    case 180:
      return `matrix(-1 0 0 -1 ${width} ${height})`
    case 270:
      return `matrix(0 -1 1 0 0 ${width})`
    default:
      return ''
  }
}

async function processSvg(
  input: Buffer,
  recipe: ImageEditRecipe,
  sourceWidth: number,
  sourceHeight: number
): Promise<ProcessedImage> {
  const oriented = orientedDimensions(sourceWidth, sourceHeight, recipe.rotation)
  const crop =
    pixelCrop(recipe.crop, oriented.width, oriented.height) ??
    ({ left: 0, top: 0, width: oriented.width, height: oriented.height } satisfies PixelCrop)
  const output = outputDimensions(sourceWidth, sourceHeight, recipe)
  const scaleX = output.width / crop.width
  const scaleY = output.height / crop.height
  const rotation = svgRotationTransform(recipe.rotation, sourceWidth, sourceHeight)
  const original = input
    .toString('utf-8')
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/<!DOCTYPE(?:[^>"']|"[^"]*"|'[^']*')*(?:\[[\s\S]*?\]\s*)?>/i, '')

  if (!/<svg(?:\s|>)/i.test(original)) {
    throw new Error('Invalid SVG document')
  }

  const transformed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}" viewBox="0 0 ${output.width} ${output.height}">`,
    `<g transform="scale(${scaleX} ${scaleY}) translate(${-crop.left} ${-crop.top})${rotation ? ` ${rotation}` : ''}">`,
    `<svg x="0" y="0" width="${sourceWidth}" height="${sourceHeight}">`,
    original,
    '</svg>',
    '</g>',
    '</svg>'
  ].join('\n')

  return {
    buffer: Buffer.from(transformed, 'utf-8'),
    width: output.width,
    height: output.height
  }
}

export async function processImageBuffer(
  input: Buffer,
  extension: ImageExtension,
  recipe: ImageEditRecipe,
  task: EditTask = { cancelled: false, pipelines: new Set() }
): Promise<ProcessedImage> {
  const source = await imageDimensions(input, extension)
  assertRecipe(recipe, source.width, source.height, extension)
  checkCancelled(task)

  switch (extension) {
    case 'svg':
      return processSvg(input, recipe, source.width, source.height)
    case 'bmp':
      return processBmp(input, recipe, task)
    case 'ico':
      return processIco(input, recipe, task)
    case 'gif':
    case 'webp':
      return processAnimatedRaster(input, extension, recipe, task)
    default:
      return processStaticRaster(input, extension, recipe, task)
  }
}

export async function readImageFile(absolutePath: string): Promise<ImageReadResult> {
  const extension = extensionForPath(absolutePath)
  const stat = await fs.stat(absolutePath)
  assertFileSize(stat.size)
  const input = await fs.readFile(absolutePath)
  const dimensions = await imageDimensions(input, extension)
  return {
    base64: input.toString('base64'),
    mimeType: IMAGE_MIME_TYPES[extension],
    width: dimensions.width,
    height: dimensions.height,
    size: input.byteLength,
    sha256: sha256(input),
    mtimeMs: stat.mtimeMs
  }
}

export async function editImageFile(
  absolutePath: string,
  request: ImageEditRequest
): Promise<ImageEditResult> {
  if (!request.requestId || activeTasks.has(request.requestId)) {
    throw new Error('Invalid or duplicate image edit request')
  }
  const task: EditTask = { cancelled: false, pipelines: new Set() }
  activeTasks.set(request.requestId, task)

  try {
    const extension = extensionForPath(absolutePath)
    const initialStat = await fs.stat(absolutePath)
    assertFileSize(initialStat.size)
    const input = await fs.readFile(absolutePath)
    if (sha256(input) !== request.expectedSha256) throw new ImageChangedError()

    const processed = await processImageBuffer(input, extension, request.recipe, task)
    checkCancelled(task)

    // Re-check immediately before the atomic rename so a long GIF/AVIF edit
    // cannot overwrite a newer version that arrived during processing.
    const latest = await fs.readFile(absolutePath)
    if (sha256(latest) !== request.expectedSha256) throw new ImageChangedError()
    checkCancelled(task)

    registerOwnWrite(absolutePath, 'write', processed.buffer)
    await atomicWriteFile(absolutePath, processed.buffer)
    const stat = await fs.stat(absolutePath)
    return {
      width: processed.width,
      height: processed.height,
      size: processed.buffer.byteLength,
      sha256: sha256(processed.buffer),
      mtimeMs: stat.mtimeMs,
      mimeType: IMAGE_MIME_TYPES[extension]
    }
  } finally {
    activeTasks.delete(request.requestId)
  }
}

export function cancelImageEdit(requestId: string): void {
  const task = activeTasks.get(requestId)
  if (!task) return
  task.cancelled = true
  for (const pipeline of task.pipelines) {
    pipeline.destroy(new ImageEditCancelledError())
  }
}
