/**
 * Serializable image-edit contract shared by main, preload and renderer.
 *
 * Crop coordinates are normalized against the auto-oriented image after the
 * recipe's rotation has been applied. Processing is always:
 * auto-orient -> rotate -> crop -> resize.
 */

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'ico',
  'avif'
] as const

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number]
export type ImageRotation = 0 | 90 | 180 | 270
export type CropAspectPreset = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9'

export interface NormalizedCropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageEditRecipe {
  rotation: ImageRotation
  crop: NormalizedCropRect | null
  width: number | null
  height: number | null
}

export interface ImageEditDraft {
  recipe: ImageEditRecipe
  undoStack: ImageEditRecipe[]
  redoStack: ImageEditRecipe[]
  aspectPreset: CropAspectPreset
  resizeAspectLocked: boolean
}

export interface ImageReadResult {
  base64: string
  mimeType: string
  width: number
  height: number
  size: number
  sha256: string
  mtimeMs: number
}

export interface ImageEditRequest {
  requestId: string
  expectedSha256: string
  recipe: ImageEditRecipe
}

export interface ImageEditResult {
  width: number
  height: number
  size: number
  sha256: string
  mtimeMs: number
  mimeType: string
}

export interface ImageSavedExternallyEvent {
  path: string
  result: ImageEditResult
}

export const IDENTITY_IMAGE_RECIPE: ImageEditRecipe = {
  rotation: 0,
  crop: null,
  width: null,
  height: null
}

export const IMAGE_MIME_TYPES: Readonly<Record<ImageExtension, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

const EPSILON = 1e-6

export function imageExtension(filePath: string): ImageExtension | null {
  const extension = filePath.split('.').pop()?.toLowerCase()
  return IMAGE_EXTENSIONS.includes(extension as ImageExtension)
    ? (extension as ImageExtension)
    : null
}

export function imageMimeType(filePath: string): string | null {
  const extension = imageExtension(filePath)
  return extension ? IMAGE_MIME_TYPES[extension] : null
}

export function cloneImageRecipe(recipe: ImageEditRecipe): ImageEditRecipe {
  return {
    rotation: recipe.rotation,
    crop: recipe.crop ? { ...recipe.crop } : null,
    width: recipe.width,
    height: recipe.height
  }
}

export function createImageEditDraft(): ImageEditDraft {
  return {
    recipe: cloneImageRecipe(IDENTITY_IMAGE_RECIPE),
    undoStack: [],
    redoStack: [],
    aspectPreset: 'free',
    resizeAspectLocked: true
  }
}

export function isIdentityImageRecipe(recipe: ImageEditRecipe): boolean {
  return (
    recipe.rotation === 0 && recipe.crop === null && recipe.width === null && recipe.height === null
  )
}

export function orientedDimensions(
  width: number,
  height: number,
  rotation: ImageRotation
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

export function clampCropRect(rect: NormalizedCropRect): NormalizedCropRect {
  const width = Math.max(EPSILON, Math.min(1, rect.width))
  const height = Math.max(EPSILON, Math.min(1, rect.height))
  const x = Math.max(0, Math.min(1 - width, rect.x))
  const y = Math.max(0, Math.min(1 - height, rect.y))
  return { x, y, width, height }
}

/**
 * Remap a crop when the image rotates, preserving the same selected pixels.
 */
export function rotateCropRect(
  crop: NormalizedCropRect | null,
  direction: 'left' | 'right'
): NormalizedCropRect | null {
  if (!crop) return null
  const rect = clampCropRect(crop)
  return direction === 'right'
    ? clampCropRect({
        x: 1 - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width
      })
    : clampCropRect({
        x: rect.y,
        y: 1 - rect.x - rect.width,
        width: rect.height,
        height: rect.width
      })
}

export function rotateRecipe(
  recipe: ImageEditRecipe,
  direction: 'left' | 'right'
): ImageEditRecipe {
  const delta = direction === 'right' ? 90 : 270
  return {
    ...cloneImageRecipe(recipe),
    rotation: ((recipe.rotation + delta) % 360) as ImageRotation,
    crop: rotateCropRect(recipe.crop, direction),
    // A quarter turn swaps the requested output axes.
    width: recipe.height,
    height: recipe.width
  }
}

export function cropPixelDimensions(
  sourceWidth: number,
  sourceHeight: number,
  recipe: ImageEditRecipe
): { width: number; height: number } {
  const oriented = orientedDimensions(sourceWidth, sourceHeight, recipe.rotation)
  const crop = recipe.crop ? clampCropRect(recipe.crop) : null
  return {
    width: Math.max(1, Math.round(oriented.width * (crop?.width ?? 1))),
    height: Math.max(1, Math.round(oriented.height * (crop?.height ?? 1)))
  }
}

export function outputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  recipe: ImageEditRecipe
): { width: number; height: number } {
  const cropped = cropPixelDimensions(sourceWidth, sourceHeight, recipe)
  return {
    width: recipe.width ?? cropped.width,
    height: recipe.height ?? cropped.height
  }
}

export function aspectRatioForPreset(
  preset: CropAspectPreset,
  sourceWidth: number,
  sourceHeight: number,
  rotation: ImageRotation
): number | null {
  if (preset === 'free') return null
  if (preset === 'original') {
    const oriented = orientedDimensions(sourceWidth, sourceHeight, rotation)
    return oriented.width / oriented.height
  }
  const [width, height] = preset.split(':').map(Number)
  return width / height
}

/**
 * Center a largest-possible crop of the requested pixel aspect ratio.
 */
export function centeredCropForAspect(
  aspect: number,
  sourceWidth: number,
  sourceHeight: number
): NormalizedCropRect {
  const sourceAspect = sourceWidth / sourceHeight
  if (aspect >= sourceAspect) {
    const height = sourceAspect / aspect
    return { x: 0, y: (1 - height) / 2, width: 1, height }
  }
  const width = aspect / sourceAspect
  return { x: (1 - width) / 2, y: 0, width, height: 1 }
}

export function resizeWithAspect(
  changed: 'width' | 'height',
  value: number,
  aspect: number
): { width: number; height: number } {
  if (changed === 'width') {
    return { width: Math.round(value), height: Math.max(1, Math.round(value / aspect)) }
  }
  return { width: Math.max(1, Math.round(value * aspect)), height: Math.round(value) }
}

export function recipesEqual(a: ImageEditRecipe, b: ImageEditRecipe): boolean {
  if (
    a.rotation !== b.rotation ||
    a.width !== b.width ||
    a.height !== b.height ||
    Boolean(a.crop) !== Boolean(b.crop)
  ) {
    return false
  }
  if (!a.crop || !b.crop) return true
  return (
    Math.abs(a.crop.x - b.crop.x) < EPSILON &&
    Math.abs(a.crop.y - b.crop.y) < EPSILON &&
    Math.abs(a.crop.width - b.crop.width) < EPSILON &&
    Math.abs(a.crop.height - b.crop.height) < EPSILON
  )
}
