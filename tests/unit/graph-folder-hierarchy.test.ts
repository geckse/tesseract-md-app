import { describe, expect, it } from 'vitest'

import {
  buildGraphFolderHierarchy,
  graphFolderNodeId,
  isGraphFolderNodeId,
  normalizeGraphFolderPath
} from '@renderer/lib/graph-folder-hierarchy'
import type { GraphNode } from '@renderer/types/cli'

function node(id: string, path: string, chunkIndex: number | null = null): GraphNode {
  return {
    id,
    path,
    label: null,
    cluster_id: null,
    custom_cluster_id: null,
    chunk_index: chunkIndex
  }
}

describe('folder graph hierarchy', () => {
  it('derives shared nested folders, root leaves, counts, and one parent edge per child', () => {
    const hierarchy = buildGraphFolderHierarchy(
      [
        node('root', 'readme.md'),
        node('guide', 'docs/guide.md'),
        node('deep', 'docs/guides/deep.md'),
        node('source', 'src/index.md')
      ],
      { rootLabel: 'Vault' }
    )

    expect(hierarchy.nodes.map((folder) => folder.path)).toEqual([
      '.',
      'docs',
      'src',
      'docs/guides'
    ])
    expect(hierarchy.nodes.map((folder) => [folder.path, folder.documentCount])).toEqual([
      ['.', 4],
      ['docs', 2],
      ['src', 1],
      ['docs/guides', 1]
    ])
    expect(hierarchy.contentParentById.get('root')).toBe(graphFolderNodeId(''))
    expect(hierarchy.contentParentById.get('deep')).toBe(graphFolderNodeId('docs/guides'))
    expect(hierarchy.contentBranchById.get('root')).toBe('(root)')
    expect(hierarchy.contentBranchById.get('deep')).toBe('docs')
    expect(hierarchy.edges).toHaveLength(hierarchy.nodes.length - 1 + 4)
    expect(new Set(hierarchy.edges.map((edge) => edge.target)).size).toBe(
      hierarchy.nodes.length - 1 + 4
    )
  })

  it('normalizes paths and stops ancestor construction at a Shard or folder boundary', () => {
    const hierarchy = buildGraphFolderHierarchy(
      [
        node('root', './projects\\alpha\\readme.md'),
        node('nested', 'projects/alpha/docs/nested.md'),
        node('outside', 'projects/beta/outside.md')
      ],
      { scopePath: '/projects/alpha/', rootLabel: 'Alpha' }
    )

    expect(normalizeGraphFolderPath('./projects\\alpha//docs/')).toBe('projects/alpha/docs')
    expect(hierarchy.rootPath).toBe('projects/alpha')
    expect(hierarchy.nodes.map((folder) => folder.path)).toEqual([
      'projects/alpha',
      'projects/alpha/docs'
    ])
    expect(hierarchy.nodes.some((folder) => folder.path === 'projects')).toBe(false)
    expect(hierarchy.nodes.some((folder) => folder.path === 'projects/beta')).toBe(false)
    expect(hierarchy.contentParentById.get('outside')).toBe(graphFolderNodeId('projects/alpha'))
  })

  it('counts unique documents rather than chunks', () => {
    const hierarchy = buildGraphFolderHierarchy(
      [node('a#0', 'docs/a.md', 0), node('a#1', 'docs/a.md', 1), node('b#0', 'docs/b.md', 0)],
      { rootLabel: 'Vault' }
    )

    expect(hierarchy.nodes.find((folder) => folder.path === '.')?.documentCount).toBe(2)
    expect(hierarchy.nodes.find((folder) => folder.path === 'docs')?.documentCount).toBe(2)
    expect(hierarchy.edges.filter((edge) => edge.childKind === 'content')).toHaveLength(3)
  })

  it('uses collision-safe stable IDs and deterministic node and edge order', () => {
    const nodes = [node('z', 'z/deep.md'), node('a', 'a.md'), node('m', 'z/mid.md')]
    const first = buildGraphFolderHierarchy(nodes, { rootLabel: 'Vault' })
    const second = buildGraphFolderHierarchy([...nodes].reverse(), { rootLabel: 'Vault' })

    expect(first.signature).toBe(second.signature)
    expect(first.nodes).toEqual(second.nodes)
    expect(first.edges).toEqual(second.edges)
    expect(first.nodes.every((folder) => isGraphFolderNodeId(folder.id))).toBe(true)
    expect(first.nodes.every((folder) => !nodes.some((item) => item.id === folder.id))).toBe(true)
  })

  it('does not invent a root for an empty visible graph', () => {
    const hierarchy = buildGraphFolderHierarchy([], {
      scopePath: 'projects/alpha',
      rootLabel: 'Alpha'
    })

    expect(hierarchy.nodes).toEqual([])
    expect(hierarchy.edges).toEqual([])
    expect(hierarchy.contentParentById.size).toBe(0)
    expect(hierarchy.signature).toContain('empty')
  })
})
