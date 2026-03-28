/**
 * Merge CLI file tree (markdown files) with app asset scan (non-markdown files)
 * into a unified tree for the file tree UI.
 */

import type {
  FileTree,
  FileTreeNode,
  AssetFileNode,
  AssetScanResult,
  UnifiedTreeNode,
} from '../types/cli'

/** Convert a CLI FileTreeNode to a UnifiedTreeNode. */
function fromCliNode(node: FileTreeNode): UnifiedTreeNode {
  return {
    name: node.name,
    path: node.path,
    is_dir: node.is_dir,
    children: node.children.map(fromCliNode),
    state: node.state,
    isAsset: false,
  }
}

/** Convert an AssetFileNode to a UnifiedTreeNode. */
function fromAssetNode(node: AssetFileNode): UnifiedTreeNode {
  return {
    name: node.name,
    path: node.path,
    is_dir: node.is_dir,
    children: node.children.map(fromAssetNode),
    state: null,
    isAsset: !node.is_dir,
    mimeCategory: node.mimeCategory,
    fileSize: node.fileSize,
  }
}

/** Sort unified nodes: directories first, then markdown files, then assets, all alphabetical. */
function sortNodes(nodes: UnifiedTreeNode[]): UnifiedTreeNode[] {
  return nodes.sort((a, b) => {
    // Directories first
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    // Within files: markdown first, then assets
    if (!a.is_dir && !b.is_dir) {
      if (a.isAsset !== b.isAsset) return a.isAsset ? 1 : -1
    }
    // Alphabetical within each group
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/**
 * Merge two sets of children from the same directory level.
 * If both trees have a directory with the same name, their children are merged recursively.
 */
function mergeChildren(
  cliChildren: UnifiedTreeNode[],
  assetChildren: UnifiedTreeNode[]
): UnifiedTreeNode[] {
  // Build a map of CLI directories by name for merging
  const cliDirMap = new Map<string, UnifiedTreeNode>()
  const result: UnifiedTreeNode[] = []

  for (const node of cliChildren) {
    if (node.is_dir) {
      cliDirMap.set(node.name, node)
    }
    result.push(node)
  }

  for (const assetNode of assetChildren) {
    if (assetNode.is_dir) {
      const existingDir = cliDirMap.get(assetNode.name)
      if (existingDir) {
        // Merge children of the matching directory
        existingDir.children = mergeChildren(existingDir.children, assetNode.children)
      } else {
        result.push(assetNode)
      }
    } else {
      result.push(assetNode)
    }
  }

  return sortNodes(result)
}

/**
 * Merge a CLI FileTree with an AssetScanResult into a single UnifiedTreeNode root.
 *
 * - CLI nodes get `isAsset: false` and retain their `state` indicators.
 * - Asset nodes get `isAsset: true` and `state: null`.
 * - Directories that exist in both trees are merged (their children combine).
 * - Sort order: directories first, then markdown files, then assets (all alphabetical).
 */
export function mergeTreeNodes(
  cliTree: FileTree | null,
  assetScan: AssetScanResult | null
): UnifiedTreeNode | null {
  if (!cliTree && !assetScan) return null

  const cliChildren = cliTree ? cliTree.root.children.map(fromCliNode) : []
  const assetChildren = assetScan ? assetScan.root.children.map(fromAssetNode) : []

  const merged = mergeChildren(cliChildren, assetChildren)

  return {
    name: '',
    path: '',
    is_dir: true,
    children: merged,
    state: null,
    isAsset: false,
  }
}
