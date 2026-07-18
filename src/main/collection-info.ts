import { execCommand } from './cli'
import { CliExecutionError } from './errors'
import type {
  DocumentInfo,
  FileState,
  FileTree,
  FileTreeNode,
  IndexStatus,
  IngestPreview,
  VaultInfo
} from '../renderer/types/cli'

function isUnsupportedInfoCommand(error: unknown): boolean {
  if (!(error instanceof CliExecutionError)) return false

  const detail = `${error.message}\n${error.stderr}`.toLowerCase()
  const namesInfo = /(?:command|subcommand)[^\n]*[\s'"`]info[\s'"`]/.test(detail)
  const isUnsupported =
    detail.includes('unrecognized subcommand') ||
    detail.includes('unknown subcommand') ||
    detail.includes('unknown command') ||
    detail.includes('not a recognized command')

  return namesInfo && isUnsupported
}

function normalizeScope(path?: string): {
  scope: string
  isWholeVault: boolean
  treePath?: string
} {
  const normalized = (path ?? '.')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')

  if (!normalized || normalized === '.') {
    return { scope: '.', isWholeVault: true }
  }

  return { scope: `${normalized}/`, isWholeVault: false, treePath: normalized }
}

function collectFiles(node: FileTreeNode, files: FileTreeNode[] = []): FileTreeNode[] {
  if (!node.is_dir) {
    files.push(node)
    return files
  }

  for (const child of node.children) collectFiles(child, files)
  return files
}

function countStates(files: FileTreeNode[]): Record<FileState, number> {
  const counts: Record<FileState, number> = {
    indexed: 0,
    modified: 0,
    new: 0,
    deleted: 0
  }

  for (const file of files) {
    if (file.state) counts[file.state] += 1
  }

  return counts
}

async function getScopedChunkCount(
  root: string,
  files: FileTreeNode[],
  reindexPreview: IngestPreview
): Promise<number | null> {
  const previewByPath = new Map(reindexPreview.files.map((file) => [file.path, file]))
  const indexedFiles = files.filter((file) => file.state === 'indexed')
  const staleFiles = files.filter((file) => file.state === 'modified' || file.state === 'deleted')

  let chunkCount = 0
  for (const file of indexedFiles) {
    const preview = previewByPath.get(file.path)
    if (!preview) return null
    chunkCount += preview.chunks
  }

  if (staleFiles.length === 0) return chunkCount

  const staleResults = await Promise.allSettled(
    staleFiles.map((file) => execCommand<DocumentInfo>('get', [file.path], root))
  )
  for (const result of staleResults) {
    if (result.status === 'rejected') return null
    chunkCount += result.value.chunk_count
  }

  return chunkCount
}

async function getLegacyCollectionInfo(root: string, path?: string): Promise<VaultInfo> {
  const { scope, isWholeVault, treePath } = normalizeScope(path)
  const [status, tree, reindexPreview] = await Promise.all([
    execCommand<IndexStatus>('status', [], root),
    execCommand<FileTree>('tree', treePath ? ['--path', treePath] : [], root),
    execCommand<IngestPreview>('ingest', ['--preview', '--reindex'], root)
  ])

  if (isWholeVault) {
    return {
      scope,
      is_whole_vault: true,
      file_count: reindexPreview.total_files,
      indexed_file_count: status.document_count,
      chunk_count: status.chunk_count,
      vector_count: status.vector_count,
      edge_count: status.edge_count ?? Math.max(0, status.vector_count - status.chunk_count),
      reindex_chunks: reindexPreview.total_chunks,
      reindex_estimated_tokens: reindexPreview.estimated_tokens,
      reindex_estimated_api_calls: reindexPreview.estimated_api_calls,
      index_file_size: status.file_size,
      embedding: status.embedding_config,
      sync: {
        new: tree.new_count,
        changed: tree.modified_count,
        unchanged: tree.indexed_count,
        deleted: tree.deleted_count
      },
      last_updated: status.last_updated
    }
  }

  const scopedTreeFiles = collectFiles(tree.root)
  const states = countStates(scopedTreeFiles)
  const scopedPreviewFiles = reindexPreview.files.filter((file) => file.path.startsWith(scope))
  const scopedChunkCount = await getScopedChunkCount(root, scopedTreeFiles, reindexPreview)
  const reindexChunks = scopedPreviewFiles.reduce((sum, file) => sum + file.chunks, 0)
  const reindexTokens = scopedPreviewFiles.reduce((sum, file) => sum + file.estimated_tokens, 0)

  return {
    scope,
    is_whole_vault: false,
    file_count: states.indexed + states.modified + states.new,
    indexed_file_count: states.indexed + states.modified + states.deleted,
    chunk_count: scopedChunkCount,
    // Older CLIs expose only whole-index vector totals. A scoped value would be misleading.
    vector_count: null,
    edge_count: null,
    reindex_chunks: reindexChunks,
    reindex_estimated_tokens: reindexTokens,
    // The preview response does not expose the batch size needed for a scoped estimate.
    reindex_estimated_api_calls: reindexChunks === 0 ? 0 : null,
    index_file_size: status.file_size,
    embedding: status.embedding_config,
    sync: {
      new: states.new,
      changed: states.modified,
      unchanged: states.indexed,
      deleted: states.deleted
    },
    last_updated: status.last_updated
  }
}

/**
 * Load collection statistics from the native `info` command when available.
 * Some 0.2.0 CLI builds predate that command despite sharing the same version,
 * so capability detection must be based on the command response, not semver.
 */
export async function getCollectionInfo(root: string, path?: string): Promise<VaultInfo> {
  try {
    return await execCommand<VaultInfo>('info', path ? [path] : [], root)
  } catch (error) {
    if (!isUnsupportedInfoCommand(error)) throw error
    return getLegacyCollectionInfo(root, path)
  }
}
