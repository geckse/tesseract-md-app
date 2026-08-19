import { lstat, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Collection } from './store'
import type { WindowManager } from './window-manager'

/** Turn OS launch arguments into normalized Markdown path candidates. */
export function markdownPathsFromArguments(args: string[], cwd: string): string[] {
  const paths = new Set<string>()

  for (const argument of args) {
    if (!argument || argument.startsWith('-')) continue

    let candidate: string
    if (argument.startsWith('file:')) {
      try {
        candidate = fileURLToPath(argument)
      } catch {
        continue
      }
    } else {
      candidate = isAbsolute(argument) ? argument : resolve(cwd, argument)
    }

    if (extname(candidate).toLowerCase() !== '.md') continue
    paths.add(resolve(candidate))
  }

  return [...paths]
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}

/** Pick the most specific registered collection containing a file. */
export function collectionContainingPath(
  filePath: string,
  collections: Collection[]
): Collection | null {
  const candidate = resolve(filePath)
  let match: Collection | null = null
  let matchLength = -1

  for (const collection of collections) {
    const root = resolve(collection.path)
    if (pathIsWithin(root, candidate) && root.length > matchLength) {
      match = collection
      matchLength = root.length
    }
  }

  return match
}

/**
 * Validate and open one Markdown file delivered by the operating system.
 * Regular files inside a known collection retain collection context; every
 * other file receives an exact, sender-bound standalone capability.
 */
export async function openMarkdownPath(
  candidate: string,
  windowManager: Pick<WindowManager, 'openCollectionDocument' | 'createStandaloneWindow'>,
  collections: Collection[]
): Promise<boolean> {
  const normalized = resolve(candidate)
  if (extname(normalized).toLowerCase() !== '.md') return false

  try {
    const metadata = await lstat(normalized)
    // Atomic editor saves deliberately refuse symbolic and hard-linked files.
    // Reject symlinks here instead of opening a document that cannot be saved.
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1) return false
  } catch {
    return false
  }

  const canonicalPath = await realpath(normalized).catch(() => normalized)
  // Collections may themselves have been registered through a symlinked
  // folder. Compare canonical roots so a file does not accidentally lose its
  // collection context merely because the two paths use different aliases.
  const canonicalCollections = await Promise.all(
    collections.map(async (collection) => ({
      ...collection,
      path: await realpath(resolve(collection.path)).catch(() => resolve(collection.path))
    }))
  )
  const collection = collectionContainingPath(canonicalPath, canonicalCollections)
  if (!collection) {
    windowManager.createStandaloneWindow(canonicalPath)
    return true
  }

  const collectionRoot = resolve(collection.path)
  const relativePath = relative(collectionRoot, canonicalPath).split(sep).join('/')
  windowManager.openCollectionDocument(collection.id, relativePath)
  return true
}
