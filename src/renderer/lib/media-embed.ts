import type { MimeCategory } from '../types/cli'

export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaEmbed {
  kind: MediaKind
  src: string
  alt: string
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac'])

function extensionOf(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0]
  return withoutQuery.split('.').pop()?.toLowerCase() ?? ''
}

export function mediaKindFromMimeCategory(category: MimeCategory): MediaKind | null {
  if (category === 'image' || category === 'video' || category === 'audio') return category
  return null
}

export function inferMediaKind(value: string): MediaKind | null {
  const extension = extensionOf(value)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return null
}

export function isPublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function localMediaUrl(absolutePath: string): string {
  return `tesseract-media://asset?path=${encodeURIComponent(absolutePath)}`
}

export function computeRelativeMediaPath(fromFile: string, toFile: string): string {
  const fromParts = fromFile.replaceAll('\\', '/').split('/')
  fromParts.pop()
  const toParts = toFile.replaceAll('\\', '/').split('/')
  let common = 0

  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++
  }

  const parentSegments = Array(fromParts.length - common).fill('..')
  return [...parentSegments, ...toParts.slice(common)].join('/')
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function markdownDestination(value: string): string {
  if (/\s|[()]/.test(value)) return `<${value.replaceAll('>', '%3E')}>`
  return value
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function serializeMediaEmbed(media: MediaEmbed): string {
  const src = media.src.trim()
  const alt = media.alt.trim()

  if (media.kind === 'image') {
    return `![${escapeMarkdownLabel(alt)}](${markdownDestination(src)})`
  }

  const title = alt ? ` title="${escapeHtmlAttribute(alt)}"` : ''
  return `<${media.kind} controls src="${escapeHtmlAttribute(src)}"${title}></${media.kind}>`
}
