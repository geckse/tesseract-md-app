/**
 * TipTap extension that resolves relative image `src` attributes to base64 data URLs.
 *
 * In WYSIWYG mode, images referenced via relative paths (e.g., `![](photo.png)`)
 * won't render because the browser can't resolve them. This extension intercepts
 * image nodes and loads them via the IPC bridge, converting to base64 data URLs.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Cache of resolved image URLs to avoid redundant IPC calls. */
const resolvedImageCache = new Map<string, string>()

/** Clear the image cache (e.g., on collection switch). */
export function clearImageCache(): void {
  resolvedImageCache.clear()
}

function isRelativePath(src: string): boolean {
  if (!src) return false
  if (src.startsWith('data:')) return false
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
      currentFilePath: '',
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        key: new PluginKey('imageResolver'),
        props: {
          // After the DOM is rendered, find <img> elements with relative src and resolve them
          handleDOMEvents: {
            // Use a small delay to let images render first
          },
        },
        view() {
          return {
            update(view) {
              if (!options.collectionPath || !options.currentFilePath) return

              // Find all images in the editor DOM
              const images = view.dom.querySelectorAll('img[src]')
              for (const img of images) {
                const src = img.getAttribute('src')
                if (!src || !isRelativePath(src)) continue

                // Already resolved
                if (img.getAttribute('data-resolved') === 'true') continue

                // Check cache first
                const cacheKey = `${options.currentFilePath}:${src}`
                const cached = resolvedImageCache.get(cacheKey)
                if (cached) {
                  img.setAttribute('src', cached)
                  img.setAttribute('data-original-src', src)
                  img.setAttribute('data-resolved', 'true')
                  continue
                }

                // Resolve relative path to absolute
                const currentDir = options.currentFilePath.split('/').slice(0, -1).join('/')
                const resolvedRelPath = resolvePath(currentDir, src)
                const absolutePath = `${options.collectionPath}/${resolvedRelPath}`

                // Load async and set when ready
                img.setAttribute('data-resolved', 'loading')
                loadImage(absolutePath, src, cacheKey, img as HTMLImageElement)
              }
            },
          }
        },
      }),
    ]
  },
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

/** Load an image via IPC and update the DOM element. */
async function loadImage(
  absolutePath: string,
  originalSrc: string,
  cacheKey: string,
  imgElement: HTMLImageElement
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
    }
    const mime = mimeMap[ext] ?? 'image/png'
    const dataUrl = `data:${mime};base64,${base64}`

    // Cache it
    resolvedImageCache.set(cacheKey, dataUrl)

    // Update DOM if still in the document
    if (imgElement.isConnected) {
      imgElement.setAttribute('src', dataUrl)
      imgElement.setAttribute('data-original-src', originalSrc)
      imgElement.setAttribute('data-resolved', 'true')
    }
  } catch {
    // Image not found or unreadable — leave as-is
    if (imgElement.isConnected) {
      imgElement.setAttribute('data-resolved', 'error')
    }
  }
}
