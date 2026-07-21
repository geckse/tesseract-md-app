/**
 * TipTap extension that resolves relative media `src` attributes to base64 data URLs.
 *
 * In WYSIWYG mode, images referenced via relative paths (e.g., `![](photo.png)`)
 * won't render because the browser can't resolve them. This extension intercepts
 * media nodes and loads them via the IPC bridge, converting to base64 data URLs.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { localMediaUrl } from '../media-embed'

/** Cache of resolved image URLs to avoid redundant IPC calls. */
const resolvedImageCache = new Map<string, string>()

/** Clear the image cache (e.g., on collection switch). */
export function clearImageCache(): void {
  resolvedImageCache.clear()
}

function isRelativePath(src: string): boolean {
  if (!src) return false
  if (src.startsWith('data:')) return false
  if (src.startsWith('blob:')) return false
  if (src.startsWith('http://')) return false
  if (src.startsWith('https://')) return false
  if (src.startsWith('file://')) return false
  if (src.startsWith('/')) return false
  return true
}

export interface ImageResolverOptions {
  /** Absolute path to the collection root. */
  collectionPath: string
  /** Relative path of the currently edited file (e.g., "docs/readme.md"). */
  currentFilePath: string
}

export const ImageResolverExtension = Extension.create<ImageResolverOptions>({
  name: 'imageResolver',

  addOptions() {
    return {
      collectionPath: '',
      currentFilePath: ''
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    function resolveMediaElements(view: import('@tiptap/pm/view').EditorView): void {
      if (!options.collectionPath || !options.currentFilePath) return

      const mediaElements = view.dom.querySelectorAll<HTMLImageElement | HTMLMediaElement>(
        'img[src], video[src], audio[src]'
      )
      for (const mediaElement of mediaElements) {
        const src = mediaElement.getAttribute('src')
        if (!src || !isRelativePath(src)) continue

        if (mediaElement.getAttribute('data-resolved') === 'true') continue

        const cacheKey = `${options.currentFilePath}:${src}`
        const cached = resolvedImageCache.get(cacheKey)
        if (cached) {
          setResolvedSource(mediaElement, src, cached)
          continue
        }

        const currentDir = options.currentFilePath.split('/').slice(0, -1).join('/')
        const resolvedRelPath = resolvePath(currentDir, src)
        const absolutePath = `${options.collectionPath}/${resolvedRelPath}`

        // Native media elements use a streaming protocol so large files do not
        // need to be copied through IPC and held as base64 in renderer memory.
        if (mediaElement instanceof HTMLMediaElement) {
          setResolvedSource(mediaElement, src, localMediaUrl(absolutePath))
          continue
        }

        // Images are small enough to keep using the existing base64 bridge.
        mediaElement.setAttribute('data-resolved', 'loading')
        loadMedia(absolutePath, src, cacheKey, mediaElement)
      }
    }

    return [
      new Plugin({
        key: new PluginKey('imageResolver'),
        props: {
          // After the DOM is rendered, find <img> elements with relative src and resolve them
          handleDOMEvents: {
            // Use a small delay to let images render first
          }
        },
        view(editorView) {
          // Plugin views are created after the initial document DOM. Resolve once
          // immediately so media already present when a file opens is displayed.
          queueMicrotask(() => {
            if (editorView.dom.isConnected) resolveMediaElements(editorView)
          })
          return {
            update: resolveMediaElements
          }
        }
      })
    ]
  }
})

/** Resolve a relative path against a base directory. */
function resolvePath(baseDir: string, relativePath: string): string {
  const parts = baseDir ? baseDir.split('/') : []
  const relParts = relativePath.split('/')

  for (const part of relParts) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }

  return parts.join('/')
}

function setResolvedSource(
  element: HTMLImageElement | HTMLMediaElement,
  originalSrc: string,
  dataUrl: string
): void {
  element.setAttribute('src', dataUrl)
  element.setAttribute('data-original-src', originalSrc)
  element.setAttribute('data-resolved', 'true')
  if (element instanceof HTMLMediaElement) element.load()
}

/** Load media via IPC and update the DOM element. */
async function loadMedia(
  absolutePath: string,
  originalSrc: string,
  cacheKey: string,
  mediaElement: HTMLImageElement | HTMLMediaElement
): Promise<void> {
  try {
    const base64 = await window.api.readBinary(absolutePath)
    const ext = originalSrc.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      avif: 'image/avif',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      ogv: 'video/ogg',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      aac: 'audio/aac'
    }
    const mime = mimeMap[ext] ?? 'application/octet-stream'
    const dataUrl = `data:${mime};base64,${base64}`

    // Cache it
    resolvedImageCache.set(cacheKey, dataUrl)

    // Update DOM if still in the document
    if (mediaElement.isConnected) {
      setResolvedSource(mediaElement, originalSrc, dataUrl)
    }
  } catch {
    // Media not found or unreadable — leave as-is
    if (mediaElement.isConnected) {
      mediaElement.setAttribute('data-resolved', 'error')
    }
  }
}
