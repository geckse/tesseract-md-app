/**
 * Parse collection-local file references used by File frontmatter fields.
 *
 * The stored form is a whole-value wiki or Markdown link. `allowBare` keeps
 * explicitly pinned legacy File fields readable without weakening inference.
 */
export function parseFileReference(value: string, allowBare = false): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const wiki = /^\[\[([^\]]+)\]\]$/.exec(trimmed)
  const markdown = /^\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed)
  let target: string | null = null

  if (wiki) target = wiki[1].split('|', 1)[0]
  else if (markdown) target = markdown[1]
  else if (allowBare) target = trimmed
  else return null

  target = target
    .trim()
    .split('#', 1)[0]
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
  if (!target || target.startsWith('/') || /^[A-Za-z]:\//.test(target)) return null
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(target)) return null

  const parts = target.split('/')
  if (parts.some((part) => part === '' || part === '..')) return null
  if (/\.(?:md|markdown)$/i.test(target)) return null
  return target
}

/** Canonical on-disk representation for a selected collection file. */
export function formatFileReference(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\/+/, '')
  return `[[${normalized}]]`
}

/** True when inference may safely treat the entire value as a File link. */
export function isFileReference(value: string): boolean {
  const path = parseFileReference(value)
  if (!path) return false
  const name = path.split('/').pop() ?? ''
  return /\.[^./]+$/.test(name)
}

/**
 * True when a scalar or homogeneous, non-empty list unambiguously contains
 * File references. Kept here so editor and read-only property surfaces cannot
 * drift into different File/Relation classifications.
 */
export function isFileReferenceValue(value: unknown): boolean {
  if (typeof value === 'string') return isFileReference(value)
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && isFileReference(item))
  )
}

export function fileNameFromReference(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath
}
