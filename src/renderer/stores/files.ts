import { writable, derived, get } from 'svelte/store'
import type { FileTree, FileTreeNode, FileState } from '../types/cli'
import { activeCollection } from './collections'
import { loadProperties, clearProperties, propertiesFileContent } from './properties'
import { trackRecent } from './favorites'

/** The current file tree for the active collection. */
export const fileTree = writable<FileTree | null>(null)

/** Whether the file tree is currently loading. */
export const fileTreeLoading = writable<boolean>(false)

/** Error message if file tree loading failed. */
export const fileTreeError = writable<string | null>(null)

/** Currently selected file path in the tree. */
export const selectedFilePath = writable<string | null>(null)

/** Content of the currently selected file. */
export const fileContent = writable<string | null>(null)

/** Whether file content is currently loading. */
export const fileContentLoading = writable<boolean>(false)

/** Error message if file content loading failed. */
export const fileContentError = writable<string | null>(null)

/** Set of expanded directory paths in the tree UI. */
export const expandedPaths = writable<Set<string>>(new Set())

/** Flat list of all file nodes (non-directory) from the tree. */
export const flatFileList = derived(fileTree, ($fileTree) => {
  if (!$fileTree) return []
  const files: FileTreeNode[] = []
  function walk(node: FileTreeNode): void {
    if (!node.is_dir) {
      files.push(node)
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const child of $fileTree.root.children) {
    walk(child)
  }
  return files
})

/** Load the file tree for the active collection. */
export async function loadFileTree(subPath?: string): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) {
    fileTree.set(null)
    return
  }

  fileTreeLoading.set(true)
  fileTreeError.set(null)
  try {
    const tree = await window.api.tree(collection.path, subPath)
    fileTree.set(tree)
  } catch (err) {
    fileTreeError.set(err instanceof Error ? err.message : String(err))
    fileTree.set(null)
  } finally {
    fileTreeLoading.set(false)
  }
}

/** Select a file path in the tree and load its content. */
export async function selectFile(path: string | null): Promise<void> {
  selectedFilePath.set(path)
  fileContent.set(null)
  fileContentError.set(null)

  if (!path) {
    clearProperties()
    return
  }

  const collection = get(activeCollection)
  if (!collection) return

  // Track this file as recently opened
  trackRecent(collection.id, path)

  const fullPath = `${collection.path}/${path}`
  fileContentLoading.set(true)
  try {
    const content = await window.api.readFile(fullPath)
    fileContent.set(content)
    propertiesFileContent.set(content)
  } catch (err) {
    fileContentError.set(err instanceof Error ? err.message : String(err))
  } finally {
    fileContentLoading.set(false)
  }

  // Load properties panel data (document info + backlinks) in parallel
  loadProperties(path)
}

/** Toggle a directory's expanded state. */
export function toggleExpanded(path: string): void {
  expandedPaths.update((set) => {
    const next = new Set(set)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    return next
  })
}

/** Expand all directories in the tree. */
export function expandAll(): void {
  const tree = get(fileTree)
  if (!tree) return
  const paths = new Set<string>()
  function walk(node: FileTreeNode): void {
    if (node.is_dir) {
      paths.add(node.path)
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk(tree.root)
  expandedPaths.set(paths)
}

/** Collapse all directories in the tree. */
export function collapseAll(): void {
  expandedPaths.set(new Set())
}

/** Count files by state in the current tree. */
export const fileStateCounts = derived(fileTree, ($fileTree) => {
  const counts: Record<FileState, number> = {
    indexed: 0,
    modified: 0,
    new: 0,
    deleted: 0,
  }
  if (!$fileTree) return counts
  function walk(node: FileTreeNode): void {
    if (!node.is_dir && node.state) {
      counts[node.state]++
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk($fileTree.root)
  return counts
})
