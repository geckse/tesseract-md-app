import { nativeImage, type NativeImage } from 'electron'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_CACHE_ENTRIES = 512
const MIN_SIZE = 16
const MAX_SIZE = 256

const thumbnailCache = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()

function isWithinRoot(path: string, root: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function cacheSet(key: string, value: string | null): void {
  thumbnailCache.delete(key)
  thumbnailCache.set(key, value)
  if (thumbnailCache.size > MAX_CACHE_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value
    if (oldest !== undefined) thumbnailCache.delete(oldest)
  }
}

async function generateThumbnail(
  path: string,
  width: number,
  height: number
): Promise<string | null> {
  let image: NativeImage | null = null
  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      const osThumbnail = await nativeImage.createThumbnailFromPath(path, { width, height })
      if (!osThumbnail.isEmpty()) image = osThumbnail
    } catch {
      // Raster images can still be decoded directly on every platform.
    }
  }
  if (!image) image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return null

  const sourceSize = image.getSize()
  if (sourceSize.width <= 0 || sourceSize.height <= 0) return null
  const scale = Math.min(width / sourceSize.width, height / sourceSize.height, 1)
  const fittedWidth = Math.max(1, Math.round(sourceSize.width * scale))
  const fittedHeight = Math.max(1, Math.round(sourceSize.height * scale))
  return image.resize({ width: fittedWidth, height: fittedHeight, quality: 'good' }).toDataURL()
}

/**
 * Return a bounded thumbnail for a file inside a known collection.
 *
 * Both the requested file and collection roots are realpathed so a symlink
 * inside a collection cannot expose a file outside it.
 */
export async function fileThumbnail(
  absolutePath: string,
  collectionPaths: string[],
  requestedWidth = 96,
  requestedHeight = 64
): Promise<string | null> {
  const width = Number.isFinite(requestedWidth)
    ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(requestedWidth)))
    : 96
  const height = Number.isFinite(requestedHeight)
    ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(requestedHeight)))
    : 64
  const candidate = resolve(absolutePath)
  const roots = collectionPaths.map((root) => resolve(root))
  const matchingRoots = roots.filter((root) => isWithinRoot(candidate, root))
  if (matchingRoots.length === 0) {
    throw new Error('Access denied: path is not within a known collection')
  }

  const [realCandidate, ...realRoots] = await Promise.all([
    realpath(candidate),
    ...matchingRoots.map((root) => realpath(root))
  ])
  if (!realRoots.some((root) => isWithinRoot(realCandidate, root))) {
    throw new Error('Access denied: resolved path leaves its collection')
  }

  const metadata = await stat(realCandidate)
  if (!metadata.isFile()) return null
  const key = `${realCandidate}\0${metadata.mtimeMs}\0${metadata.size}\0${width}x${height}`
  if (thumbnailCache.has(key)) return thumbnailCache.get(key) ?? null
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = generateThumbnail(realCandidate, width, height)
    .then((result) => {
      cacheSet(key, result)
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

/** Test/session hook. */
export function clearThumbnailCache(): void {
  thumbnailCache.clear()
  inFlight.clear()
}
