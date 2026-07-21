import { describe, expect, it } from 'vitest'

import { graphGroupIdForMode, graphTopLevelFolder } from '@renderer/lib/graph-grouping'

const node = {
  path: 'projects/alpha/note.md',
  cluster_id: 3,
  custom_cluster_id: 7
}

describe('mode-aware graph grouping', () => {
  it('resolves automatic clusters, primary topics, folders, and no grouping', () => {
    expect(graphGroupIdForMode(node, 'cluster')).toBe('cluster:3')
    expect(graphGroupIdForMode(node, 'custom-cluster')).toBe('topic:7')
    expect(graphGroupIdForMode(node, 'folder')).toBe('folder:projects')
    expect(graphGroupIdForMode(node, 'none')).toBeNull()
  })

  it('keeps unassigned topics ungrouped and places root files in a folder bucket', () => {
    const rootNode = { path: 'readme.md', cluster_id: null, custom_cluster_id: null }
    expect(graphGroupIdForMode(rootNode, 'cluster')).toBeNull()
    expect(graphGroupIdForMode(rootNode, 'custom-cluster')).toBeNull()
    expect(graphGroupIdForMode(rootNode, 'folder')).toBe('folder:(root)')
    expect(graphTopLevelFolder(rootNode.path)).toBe('(root)')
  })
})
