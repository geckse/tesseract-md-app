/**
 * Path utilities for the renderer.
 *
 * Electron's webUtils.getPathForFile() returns OS-native paths — backslash
 * separated on Windows — while every path the app works with (CLI index
 * paths, collection roots, markdown links) uses forward slashes. These
 * helpers normalize at that boundary so path comparisons work on Windows.
 */

/** Convert a path to forward-slash (POSIX-style) separators. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Return the path of `absPath` relative to `collectionRoot`, joined with
 * forward slashes, or `null` when `absPath` is not inside the root.
 *
 * Both inputs are normalized with {@link toPosix} first, so Windows-native
 * paths (`C:\...`) from getPathForFile() match collection roots regardless
 * of separator style. Trailing slashes on the root are ignored.
 *
 * `absPath` equal to the root itself returns `null` — the collection root
 * is a directory, not a linkable file, so callers fall back the same way
 * they do for paths outside the collection.
 */
export function relativeToCollection(absPath: string, collectionRoot: string): string | null {
  const abs = toPosix(absPath)
  let root = toPosix(collectionRoot)
  while (root.endsWith('/')) root = root.slice(0, -1)
  if (root.length === 0) return null
  if (!abs.startsWith(root + '/')) return null
  const rel = abs.slice(root.length + 1)
  return rel.length > 0 ? rel : null
}
