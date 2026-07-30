import type { GraphNode } from '../types/cli'

/**
 * NUL cannot occur in a filesystem path, so this namespace cannot collide
 * with document or chunk IDs produced by the CLI.
 */
export const GRAPH_FOLDER_NODE_PREFIX = '\u0000mdvdb-folder:'

export interface GraphFolderHierarchyNode {
  id: string
  path: string
  label: string
  depth: number
  documentCount: number
  parentId: string | null
  branch: string | null
  isRoot: boolean
}

export interface GraphFolderHierarchyEdge {
  source: string
  target: string
  branch: string | null
  childKind: 'folder' | 'content'
}

export interface GraphFolderHierarchy {
  rootPath: string
  nodes: GraphFolderHierarchyNode[]
  edges: GraphFolderHierarchyEdge[]
  contentParentById: Map<string, string>
  contentBranchById: Map<string, string>
  signature: string
}

/** Normalize graph paths without interpreting `..` outside the visible scope. */
export function normalizeGraphFolderPath(path: string | null | undefined): string {
  return (path ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

export function graphFolderNodeId(path: string): string {
  return `${GRAPH_FOLDER_NODE_PREFIX}${path || '.'}`
}

export function isGraphFolderNodeId(id: string): boolean {
  return id.startsWith(GRAPH_FOLDER_NODE_PREFIX)
}

function graphDirectoryPath(path: string): string {
  const normalized = normalizeGraphFolderPath(path)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? '' : normalized.slice(0, separator)
}

function graphPathBasename(path: string): string {
  const normalized = normalizeGraphFolderPath(path)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? normalized : normalized.slice(separator + 1)
}

function pathInsideRoot(path: string, rootPath: string): string | null {
  if (!rootPath) return path
  if (path === rootPath) return ''
  return path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : null
}

function folderPathAtDepth(rootPath: string, relativeSegments: readonly string[], depth: number) {
  const suffix = relativeSegments.slice(0, depth).join('/')
  return rootPath ? `${rootPath}/${suffix}` : suffix
}

function branchForRelativeDirectory(rootPath: string, relativeDirectory: string): string {
  if (!relativeDirectory) return '(root)'
  const firstSegment = relativeDirectory.split('/')[0]
  return rootPath ? `${rootPath}/${firstSegment}` : firstSegment
}

/**
 * Build a renderer-only hierarchy over the visible content nodes.
 *
 * Every non-root folder and every content node has exactly one hierarchy
 * parent edge. Folder document counts use unique source paths, so chunk mode
 * does not inflate folder sizes.
 */
export function buildGraphFolderHierarchy(
  contentNodes: readonly GraphNode[],
  options: { scopePath?: string | null; rootLabel: string }
): GraphFolderHierarchy {
  const rootPath = normalizeGraphFolderPath(options.scopePath)
  if (contentNodes.length === 0) {
    return {
      rootPath,
      nodes: [],
      edges: [],
      contentParentById: new Map(),
      contentBranchById: new Map(),
      signature: `${rootPath}\u0000empty`
    }
  }

  interface MutableFolderNode {
    id: string
    path: string
    label: string
    depth: number
    documents: Set<string>
    parentId: string | null
    branch: string | null
    isRoot: boolean
  }

  const rootId = graphFolderNodeId(rootPath)
  const folders = new Map<string, MutableFolderNode>()
  folders.set(rootPath, {
    id: rootId,
    path: rootPath || '.',
    label: options.rootLabel,
    depth: 0,
    documents: new Set(),
    parentId: null,
    branch: null,
    isRoot: true
  })

  const contentParentById = new Map<string, string>()
  const contentBranchById = new Map<string, string>()
  const membershipByContentId = new Map<
    string,
    { parentId: string; branch: string; sourcePath: string }
  >()
  const orderedContentNodes = [...contentNodes].sort(
    (left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path)
  )

  for (const node of orderedContentNodes) {
    const sourcePath = normalizeGraphFolderPath(node.path)
    const directoryPath = graphDirectoryPath(sourcePath)
    const relativeDirectory = pathInsideRoot(directoryPath, rootPath)
    // Scoped graph responses should already satisfy the boundary. If an
    // ad-hoc/incompatible payload does not, keep its content attached to the
    // visible root rather than synthesizing ancestors outside that boundary.
    const safeRelativeDirectory = relativeDirectory ?? ''
    const relativeSegments = safeRelativeDirectory
      ? safeRelativeDirectory.split('/').filter(Boolean)
      : []
    const branch = branchForRelativeDirectory(rootPath, safeRelativeDirectory)
    let parentPath = rootPath

    for (let depth = 1; depth <= relativeSegments.length; depth++) {
      const folderPath = folderPathAtDepth(rootPath, relativeSegments, depth)
      if (!folders.has(folderPath)) {
        const parent = folders.get(parentPath)!
        folders.set(folderPath, {
          id: graphFolderNodeId(folderPath),
          path: folderPath,
          label: graphPathBasename(folderPath),
          depth,
          documents: new Set(),
          parentId: parent.id,
          branch,
          isRoot: false
        })
      }
      parentPath = folderPath
    }

    const parent = folders.get(parentPath)!
    contentParentById.set(node.id, parent.id)
    contentBranchById.set(node.id, branch)
    membershipByContentId.set(node.id, {
      parentId: parent.id,
      branch,
      sourcePath
    })
  }

  // Count each document once per ancestor, even when it contributes many
  // chunk nodes.
  const uniqueDocuments = new Set(
    [...membershipByContentId.values()].map((membership) => membership.sourcePath)
  )
  for (const sourcePath of uniqueDocuments) {
    const directoryPath = graphDirectoryPath(sourcePath)
    const relativeDirectory = pathInsideRoot(directoryPath, rootPath) ?? ''
    const segments = relativeDirectory ? relativeDirectory.split('/').filter(Boolean) : []
    folders.get(rootPath)!.documents.add(sourcePath)
    for (let depth = 1; depth <= segments.length; depth++) {
      folders.get(folderPathAtDepth(rootPath, segments, depth))?.documents.add(sourcePath)
    }
  }

  const nodes = [...folders.values()]
    .sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path))
    .map<GraphFolderHierarchyNode>((folder) => ({
      id: folder.id,
      path: folder.path,
      label: folder.label,
      depth: folder.depth,
      documentCount: folder.documents.size,
      parentId: folder.parentId,
      branch: folder.branch,
      isRoot: folder.isRoot
    }))

  const edges: GraphFolderHierarchyEdge[] = []
  for (const folder of nodes) {
    if (folder.parentId) {
      edges.push({
        source: folder.parentId,
        target: folder.id,
        branch: folder.branch,
        childKind: 'folder'
      })
    }
  }
  for (const node of orderedContentNodes) {
    const membership = membershipByContentId.get(node.id)!
    edges.push({
      source: membership.parentId,
      target: node.id,
      branch: membership.branch,
      childKind: 'content'
    })
  }

  const signature = JSON.stringify({
    rootPath,
    folders: nodes.map((folder) => [folder.id, folder.parentId, folder.documentCount]),
    memberships: [...membershipByContentId]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, membership]) => [id, membership.parentId])
  })

  return {
    rootPath,
    nodes,
    edges,
    contentParentById,
    contentBranchById,
    signature
  }
}
