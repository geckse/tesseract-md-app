import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CliExecutionError } from '../../src/main/errors'

const mockExecCommand = vi.fn()
vi.mock('../../src/main/cli', () => ({
  execCommand: (...args: unknown[]) => mockExecCommand(...args)
}))

import { getCollectionInfo } from '../../src/main/collection-info'
import type { FileTree, IndexStatus, IngestPreview, VaultInfo } from '../../src/renderer/types/cli'

const nativeInfo: VaultInfo = {
  scope: '.',
  is_whole_vault: true,
  file_count: 3,
  indexed_file_count: 2,
  chunk_count: 8,
  vector_count: 10,
  edge_count: 2,
  reindex_chunks: 9,
  reindex_estimated_tokens: 1200,
  reindex_estimated_api_calls: 1,
  index_file_size: 4096,
  embedding: { provider: 'OpenAI', model: 'small', dimensions: 1536 },
  sync: { new: 1, changed: 0, unchanged: 2, deleted: 0 },
  last_updated: 123
}

const status: IndexStatus = {
  document_count: 3,
  chunk_count: 12,
  vector_count: 15,
  last_updated: 456,
  file_size: 8192,
  embedding_config: { provider: 'OpenAI', model: 'small', dimensions: 1536 }
}

const wholeTree: FileTree = {
  root: { name: '.', path: '.', is_dir: true, state: null, children: [] },
  total_files: 5,
  indexed_count: 2,
  modified_count: 1,
  new_count: 1,
  deleted_count: 1
}

const wholePreview: IngestPreview = {
  files: [],
  total_files: 4,
  files_to_process: 4,
  files_unchanged: 0,
  total_chunks: 20,
  estimated_tokens: 5000,
  estimated_api_calls: 2
}

function unsupportedInfoError(): CliExecutionError {
  return new CliExecutionError(
    "CLI command 'info' failed: unrecognized subcommand 'info'",
    2,
    "error: unrecognized subcommand 'info'"
  )
}

describe('getCollectionInfo', () => {
  beforeEach(() => {
    mockExecCommand.mockReset()
  })

  it('uses the native info command when the CLI supports it', async () => {
    mockExecCommand.mockResolvedValue(nativeInfo)

    await expect(getCollectionInfo('/vault', 'notes')).resolves.toBe(nativeInfo)
    expect(mockExecCommand).toHaveBeenCalledTimes(1)
    expect(mockExecCommand).toHaveBeenCalledWith('info', ['notes'], '/vault')
  })

  it('does not mask real info command failures', async () => {
    const error = new CliExecutionError('Index is corrupt', 1, 'failed to read index')
    mockExecCommand.mockRejectedValue(error)

    await expect(getCollectionInfo('/vault')).rejects.toBe(error)
    expect(mockExecCommand).toHaveBeenCalledTimes(1)
  })

  it('assembles exact whole-collection stats for a CLI without info', async () => {
    mockExecCommand.mockImplementation((command: string, args: string[]) => {
      if (command === 'info') return Promise.reject(unsupportedInfoError())
      if (command === 'status') return Promise.resolve(status)
      if (command === 'tree') return Promise.resolve(wholeTree)
      if (command === 'ingest' && args.includes('--reindex')) return Promise.resolve(wholePreview)
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })

    await expect(getCollectionInfo('/vault')).resolves.toEqual({
      scope: '.',
      is_whole_vault: true,
      file_count: 4,
      indexed_file_count: 3,
      chunk_count: 12,
      vector_count: 15,
      edge_count: 3,
      reindex_chunks: 20,
      reindex_estimated_tokens: 5000,
      reindex_estimated_api_calls: 2,
      index_file_size: 8192,
      embedding: status.embedding_config,
      sync: { new: 1, changed: 1, unchanged: 2, deleted: 1 },
      last_updated: 456
    })
    expect(mockExecCommand).toHaveBeenCalledWith('tree', [], '/vault')
    expect(mockExecCommand).toHaveBeenCalledWith('ingest', ['--preview', '--reindex'], '/vault')
  })

  it('calculates scoped file, chunk, sync, and reindex counts without guessing vectors', async () => {
    const scopedTree: FileTree = {
      ...wholeTree,
      root: {
        name: 'notes',
        path: 'notes',
        is_dir: true,
        state: null,
        children: [
          { name: 'one.md', path: 'notes/one.md', is_dir: false, state: 'indexed', children: [] },
          { name: 'two.md', path: 'notes/two.md', is_dir: false, state: 'modified', children: [] },
          { name: 'new.md', path: 'notes/new.md', is_dir: false, state: 'new', children: [] },
          { name: 'gone.md', path: 'notes/gone.md', is_dir: false, state: 'deleted', children: [] }
        ]
      }
    }
    const scopedPreview: IngestPreview = {
      ...wholePreview,
      files: [
        { path: 'notes/one.md', status: 'Changed', chunks: 4, estimated_tokens: 400 },
        { path: 'notes/two.md', status: 'Changed', chunks: 7, estimated_tokens: 700 },
        { path: 'notes/new.md', status: 'Changed', chunks: 2, estimated_tokens: 200 },
        { path: 'other.md', status: 'Changed', chunks: 10, estimated_tokens: 1000 }
      ]
    }

    mockExecCommand.mockImplementation((command: string, args: string[]) => {
      if (command === 'info') return Promise.reject(unsupportedInfoError())
      if (command === 'status') return Promise.resolve(status)
      if (command === 'tree') return Promise.resolve(scopedTree)
      if (command === 'ingest') return Promise.resolve(scopedPreview)
      if (command === 'get' && args[0] === 'notes/two.md') {
        return Promise.resolve({ chunk_count: 5 })
      }
      if (command === 'get' && args[0] === 'notes/gone.md') {
        return Promise.resolve({ chunk_count: 3 })
      }
      return Promise.reject(new Error(`Unexpected command: ${command} ${args.join(' ')}`))
    })

    await expect(getCollectionInfo('/vault', './notes/')).resolves.toEqual({
      scope: 'notes/',
      is_whole_vault: false,
      file_count: 3,
      indexed_file_count: 3,
      chunk_count: 12,
      vector_count: null,
      edge_count: null,
      reindex_chunks: 13,
      reindex_estimated_tokens: 1300,
      reindex_estimated_api_calls: null,
      index_file_size: 8192,
      embedding: status.embedding_config,
      sync: { new: 1, changed: 1, unchanged: 1, deleted: 1 },
      last_updated: 456
    })
    expect(mockExecCommand).toHaveBeenCalledWith('tree', ['--path', 'notes'], '/vault')
    expect(mockExecCommand).toHaveBeenCalledWith('get', ['notes/two.md'], '/vault')
    expect(mockExecCommand).toHaveBeenCalledWith('get', ['notes/gone.md'], '/vault')
  })
})
