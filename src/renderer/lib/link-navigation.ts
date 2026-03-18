import { get } from 'svelte/store'
import { selectFile, flatFileList, selectedFilePath } from '../stores/files'

/**
 * Resolve a wikilink target (e.g. "my-note") to a file path in the collection.
 * Wikilinks match by filename (without extension), case-insensitive.
 */
function resolveWikilinkTarget(target: string): string | null {
  const files = get(flatFileList)
  const normalized = target.toLowerCase().replace(/\.md$/i, '')

  // Exact filename match (without extension)
  for (const file of files) {
    const name = file.path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase()
    if (name === normalized) return file.path
  }

  // Path suffix match (e.g. "folder/note" matches "deep/folder/note.md")
  for (const file of files) {
    const pathWithoutExt = file.path.replace(/\.[^.]+$/, '').toLowerCase()
    if (pathWithoutExt === normalized || pathWithoutExt.endsWith('/' + normalized)) {
      return file.path
    }
  }

  return null
}

/**
 * Resolve a relative link href (e.g. "./other.md", "../sibling.md", "sub/page.md")
 * to a file path in the collection, relative to the currently selected file.
 */
function resolveRelativeLink(href: string): string | null {
  const currentPath = get(selectedFilePath)
  if (!currentPath) return null

  // Strip fragment
  const withoutHash = href.split('#')[0]
  if (!withoutHash) return null

  // Resolve relative to current file's directory
  const currentDir = currentPath.includes('/') ? currentPath.replace(/\/[^/]+$/, '') : ''
  const parts = (currentDir ? currentDir + '/' + withoutHash : withoutHash).split('/')
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }

  const resolvedPath = resolved.join('/')

  // Check if this file exists in the collection
  const files = get(flatFileList)
  for (const file of files) {
    if (file.path === resolvedPath) return file.path
  }

  // Try adding .md extension
  if (!resolvedPath.endsWith('.md')) {
    const withMd = resolvedPath + '.md'
    for (const file of files) {
      if (file.path === withMd) return file.path
    }
  }

  return null
}

/**
 * Check if an href looks like an internal/relative link (not external).
 */
function isInternalHref(href: string): boolean {
  if (!href) return false
  // External links
  if (/^https?:\/\//i.test(href)) return false
  if (/^mailto:/i.test(href)) return false
  if (/^tel:/i.test(href)) return false
  // Data URIs, javascript:, etc.
  if (/^[a-z]+:/i.test(href)) return false
  return true
}

/**
 * Handle a click event on a link or wikilink element.
 * Navigates internally if the target is a known file, otherwise does nothing.
 * Returns true if navigation occurred (caller should preventDefault).
 */
export function handleLinkClick(event: MouseEvent): boolean {
  // Don't intercept modified clicks (new tab, etc.)
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const target = event.target as HTMLElement
  if (!target) return false

  // Check for wikilink click
  const wikilink = target.closest('.wikilink[data-wikilink-target]') as HTMLElement | null
  if (wikilink) {
    const wikilinkTarget = wikilink.getAttribute('data-wikilink-target')
    if (wikilinkTarget) {
      const resolved = resolveWikilinkTarget(wikilinkTarget)
      if (resolved) {
        event.preventDefault()
        event.stopPropagation()
        selectFile(resolved)
        return true
      }
    }
    return false
  }

  // Check for regular <a> link click
  const anchor = target.closest('a') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href')
    if (!href) return false

    if (isInternalHref(href)) {
      const resolved = resolveRelativeLink(href)
      if (resolved) {
        event.preventDefault()
        event.stopPropagation()
        selectFile(resolved)
        return true
      }
    } else {
      // External link: prevent Electron from navigating the main window away.
      // Open in system browser via window.open (Electron's setWindowOpenHandler
      // intercepts this and calls shell.openExternal).
      event.preventDefault()
      event.stopPropagation()
      window.open(href, '_blank')
      return true
    }
    return false
  }

  return false
}
