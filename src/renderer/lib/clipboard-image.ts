import { slugify } from './markdown-structure'
import { computeRelativeMediaPath, serializeMediaEmbed } from './media-embed'

export interface ClipboardImageData {
  base64Data: string
  extension: string
  mimeType: string
  size: number
}

export interface ClipboardImageDestination {
  directory: string
  filename: string
  relativePath: string
  stem: string
}

const CLIPBOARD_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif'
}

const INTERNAL_DIRECTORY_NAMES = new Set([
  '.git',
  '.markdownvdb',
  '.obsidian',
  'node_modules',
  'dist',
  'build',
  'out',
  'target'
])

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
// eslint-disable-next-line no-control-regex
const INVALID_PATH_CHARS = /[<>:"|?*\x00-\x1f]/

export function clipboardImageExtension(mimeType: string): string | null {
  return CLIPBOARD_IMAGE_EXTENSIONS[mimeType.toLowerCase()] ?? null
}

export function firstClipboardImageItem(
  items: Iterable<DataTransferItem> | ArrayLike<DataTransferItem>
): { item: DataTransferItem; extension: string } | null {
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const extension = clipboardImageExtension(item.type)
    if (extension) return { item, extension }
  }
  return null
}

export async function clipboardImageData(
  item: DataTransferItem,
  extension: string
): Promise<ClipboardImageData | null> {
  const blob = item.getAsFile()
  if (!blob) return null
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Clipboard image could not be read.'))
    reader.onerror = () => reject(reader.error ?? new Error('Clipboard image could not be read.'))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Clipboard image returned invalid data.')
  return {
    base64Data: dataUrl.slice(comma + 1),
    extension,
    mimeType: blob.type,
    size: blob.size
  }
}

export function markdownFileDirectory(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  return slash < 0 ? '' : filePath.slice(0, slash)
}

export function markdownFileStem(filePath: string): string {
  const filename = filePath.split('/').pop() ?? ''
  return filename.replace(/\.(?:md|markdown)$/i, '')
}

export function suggestImageStem(filePath: string, heading?: string | null): string {
  const documentStem = slugify(markdownFileStem(filePath)) || 'image'
  const headingStem = heading ? slugify(heading) : ''
  if (!headingStem || headingStem === documentStem) return documentStem
  if (headingStem.startsWith(`${documentStem}-`)) return headingStem
  if (documentStem.startsWith(`${headingStem}-`)) return documentStem
  return `${documentStem}-${headingStem}`
}

export function nearestHeadingBeforeOffset(content: string, offset: number): string | null {
  const beforeCursor = content.slice(0, Math.max(0, Math.min(offset, content.length)))
  const lines = beforeCursor.split('\n')
  let inFrontmatter = lines[0]?.trimEnd() === '---'
  let inCodeBlock = false
  let nearest: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inFrontmatter) {
      if (i > 0 && line.trimEnd() === '---') inFrontmatter = false
      continue
    }
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    const match = line.match(/^#{1,6}\s+(.+)$/)
    if (match) nearest = match[1].trim()
  }
  return nearest
}

export function normalizeImageDirectory(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

export function validateImageDirectory(value: string): string | null {
  const directory = normalizeImageDirectory(value)
  if (!directory) return null
  if (directory.startsWith('/') || /^[A-Za-z]:\//.test(directory)) {
    return 'Choose a folder inside the collection.'
  }

  for (const segment of directory.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      return 'Folder paths cannot contain empty, current, or parent segments.'
    }
    if (segment.startsWith('.') || INTERNAL_DIRECTORY_NAMES.has(segment.toLowerCase())) {
      return 'Choose a regular collection folder, not an internal folder.'
    }
    if (
      INVALID_PATH_CHARS.test(segment) ||
      WINDOWS_RESERVED_NAMES.test(segment) ||
      /[. ]$/.test(segment)
    ) {
      return 'Folder name contains characters unsupported by this platform.'
    }
  }
  return null
}

export function validateImageStem(value: string, extension: string): string | null {
  const stem = value.trim()
  if (!stem) return 'Enter a filename.'
  if (stem.length > 180) return 'Filename must be 180 characters or fewer.'
  if (stem.includes('/') || stem.includes('\\')) return 'Filename cannot contain path separators.'
  if (stem.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
    return `The .${extension} extension is added automatically.`
  }
  if (
    stem === '.' ||
    stem === '..' ||
    stem.startsWith('.') ||
    INVALID_PATH_CHARS.test(stem) ||
    WINDOWS_RESERVED_NAMES.test(stem) ||
    /[. ]$/.test(stem)
  ) {
    return 'Filename contains characters unsupported by this platform.'
  }
  return null
}

export function imageRelativePath(directory: string, stem: string, extension: string): string {
  const filename = `${stem.trim()}.${extension}`
  const normalizedDirectory = normalizeImageDirectory(directory)
  return normalizedDirectory ? `${normalizedDirectory}/${filename}` : filename
}

export function nextAvailableImageStem(
  baseStem: string,
  extension: string,
  directory: string,
  existingPaths: Iterable<string>
): string {
  const existing = new Set(Array.from(existingPaths, (path) => path.toLowerCase()))
  for (let suffix = 0; ; suffix++) {
    const candidate = suffix === 0 ? baseStem : `${baseStem}-${suffix}`
    if (!existing.has(imageRelativePath(directory, candidate, extension).toLowerCase())) {
      return candidate
    }
  }
}

export function imageMarkdownReference(
  markdownFilePath: string,
  imagePath: string,
  filename: string
): string {
  return serializeMediaEmbed({
    kind: 'image',
    src: computeRelativeMediaPath(markdownFilePath, imagePath),
    alt: filename
  })
}
