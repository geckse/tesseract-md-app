/**
 * App-level asset scanner for discovering non-markdown files in a collection.
 *
 * The CLI (mdvdb) only knows about .md files. This scanner runs in the Electron
 * main process and discovers images, PDFs, and other embeddable assets via
 * recursive directory traversal. Respects .gitignore patterns.
 */

import { promises as fs } from 'node:fs'
import { join, relative, extname } from 'node:path'

/** Mime category for display purposes. */
export type MimeCategory = 'image' | 'pdf' | 'video' | 'audio' | 'other'

/** A non-markdown asset file discovered by the app scanner. */
export interface AssetFileNode {
  name: string
  path: string // relative to collection root
  is_dir: boolean
  children: AssetFileNode[]
  fileSize?: number
  mimeCategory?: MimeCategory
}

/** Result of app-level asset scanning. */
export interface AssetScanResult {
  root: AssetFileNode
  totalAssets: number
  scanDurationMs: number
}

/** Extensions mapped to mime categories. */
const EXTENSION_MAP: Record<string, MimeCategory> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
}

/** Directories that are always skipped. */
const ALWAYS_SKIP_DIRS = new Set([
  '.markdownvdb',
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'target',
  '.svelte-kit',
  '__pycache__',
  '.venv',
  'venv',
])

/** Maximum directory depth to scan. */
const MAX_DEPTH = 10

/** Maximum total asset files to discover. */
const MAX_FILES = 10_000

/** Get the MimeCategory for a file extension, or null if not a recognized asset. */
export function getMimeCategory(filename: string): MimeCategory | null {
  const ext = extname(filename).toLowerCase()
  return EXTENSION_MAP[ext] ?? null
}

/** Check if a filename is a markdown file. */
function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Parse a .gitignore file and return a predicate function.
 * Uses the `ignore` npm package for correct gitignore semantics.
 */
async function loadGitignore(collectionPath: string): Promise<((path: string) => boolean) | null> {
  try {
    const content = await fs.readFile(join(collectionPath, '.gitignore'), 'utf-8')
    const { default: ignore } = await import('ignore')
    const ig = ignore().add(content)
    return (relativePath: string) => ig.ignores(relativePath)
  } catch {
    // No .gitignore or unreadable — don't filter
    return null
  }
}

/**
 * Recursively scan a directory for non-markdown asset files.
 */
async function scanDirectory(
  dirPath: string,
  collectionRoot: string,
  isIgnored: ((path: string) => boolean) | null,
  depth: number,
  fileCount: { value: number }
): Promise<AssetFileNode[]> {
  if (depth > MAX_DEPTH || fileCount.value >= MAX_FILES) return []

  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    // Permission denied or deleted directory — skip silently
    return []
  }

  const children: AssetFileNode[] = []

  for (const entry of entries) {
    if (fileCount.value >= MAX_FILES) break

    const name = entry.name

    // Skip hidden files/dirs (except .gitignore which we already read)
    if (name.startsWith('.') && name !== '.gitignore') {
      if (ALWAYS_SKIP_DIRS.has(name)) continue
      // Skip other hidden files
      continue
    }

    // Skip always-skipped directories
    if (ALWAYS_SKIP_DIRS.has(name)) continue

    const fullPath = join(dirPath, name)
    const relPath = relative(collectionRoot, fullPath)

    // Check gitignore
    if (isIgnored) {
      const checkPath = entry.isDirectory() ? relPath + '/' : relPath
      if (isIgnored(checkPath)) continue
    }

    if (entry.isDirectory()) {
      const subChildren = await scanDirectory(fullPath, collectionRoot, isIgnored, depth + 1, fileCount)
      if (subChildren.length > 0) {
        children.push({
          name,
          path: relPath,
          is_dir: true,
          children: subChildren,
        })
      }
    } else if (entry.isFile()) {
      // Skip markdown files (those come from the CLI tree)
      if (isMarkdown(name)) continue

      const mimeCategory = getMimeCategory(name)
      if (!mimeCategory) continue

      let fileSize: number | undefined
      try {
        const stat = await fs.stat(fullPath)
        fileSize = stat.size
      } catch {
        // Can't stat — skip size
      }

      fileCount.value++
      children.push({
        name,
        path: relPath,
        is_dir: false,
        children: [],
        fileSize,
        mimeCategory,
      })
    }
  }

  // Sort: directories first (alphabetical), then files (alphabetical)
  children.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return children
}

/**
 * Scan a collection for non-markdown asset files.
 *
 * @param collectionPath - Absolute path to the collection root.
 * @returns AssetScanResult with a tree of discovered assets.
 */
export async function scanAssets(collectionPath: string): Promise<AssetScanResult> {
  const start = performance.now()

  const isIgnored = await loadGitignore(collectionPath)
  const fileCount = { value: 0 }

  const children = await scanDirectory(collectionPath, collectionPath, isIgnored, 0, fileCount)

  const root: AssetFileNode = {
    name: '',
    path: '',
    is_dir: true,
    children,
  }

  return {
    root,
    totalAssets: fileCount.value,
    scanDurationMs: Math.round(performance.now() - start),
  }
}
