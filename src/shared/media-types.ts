export type AssetMimeCategory = 'image' | 'pdf' | 'video' | 'audio' | 'other'

const ASSET_EXTENSION_CATEGORIES: Readonly<Record<string, Exclude<AssetMimeCategory, 'other'>>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  pdf: 'pdf',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
  ogv: 'video',
  avi: 'video',
  mkv: 'video',
  mpeg: 'video',
  mpg: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio'
}

/** Return the known media category for a path or URL, or null for an unknown extension. */
export function assetMimeCategory(value: string): Exclude<AssetMimeCategory, 'other'> | null {
  const path = value.trim().split(/[?#]/, 1)[0]
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return ASSET_EXTENSION_CATEGORIES[extension] ?? null
}
