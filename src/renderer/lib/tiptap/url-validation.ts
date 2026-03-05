/**
 * Validate a user-input URL to prevent XSS via dangerous protocols.
 * Only allows http://, https://, mailto:, relative paths, and # anchors.
 */
export function isValidUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false

  // Allow relative paths and anchors
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return true
  }

  // Allow http, https, mailto
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^mailto:/i.test(trimmed)) return true

  // Reject anything with a protocol/colon that isn't the above
  // This catches javascript:, data:, vbscript:, etc.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) return false

  // Allow bare strings (e.g. "image.png", "example.com/path")
  return true
}
