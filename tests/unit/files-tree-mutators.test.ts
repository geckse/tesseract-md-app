import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

// Minimal window.api stub (tree routing may schedule a resync loadFileTree)
const mockApi = {
  tree: vi.fn().mockResolvedValue(null),
  scanAssets: vi.fn().mockResolvedValue(null)
}
Object.defineProperty(globalThis, 'window', { value: { api: mockApi }, writable: true })

import {
  fileTree,
  assetTree,
  setFileNodeState,
  insertAssetNode,
  insertFileNode,
  routeVaultEventToTree,
  applyWatchReportToTree,
  resetVaultTreeRouting
} from '../../src/renderer/stores/files'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import type { FileTree, AssetScanResult, WatchEventReport } from '../../src/renderer/types/cli'
import type { VaultFileEvent } from '../../src/preload/api'

function makeTree(): FileTree {
  return {
    root: {
      name: '',
      path: '',
      is_dir: true,
      state: null,
      children: [
        { name: 'a.md', path: 'a.md', is_dir: false, state: 'indexed', children: [] },
        { name: 'b.md', path: 'b.md', is_dir: false, state: 'new', children: [] }
      ]
    },
    total_files: 2,
    indexed_count: 1,
    modified_count: 0,
    new_count: 1,
    deleted_count: 0
  }
}

function makeAssetTree(): AssetScanResult {
  return {
    root: { name: '', path: '', is_dir: true, children: [] },
    totalAssets: 0,
    scanDurationMs: 0
  }
}

function ev(kind: VaultFileEvent['kind'], path: string, over: Partial<VaultFileEvent> = {}): VaultFileEvent {
  return {
    kind,
    path,
    isDirectory: false,
    fileKind: 'markdown',
    mimeCategory: null,
    mtimeMs: null,
    size: null,
    origin: 'external',
    ts: 0,
    ...over
  }
}

function report(over: Partial<WatchEventReport>): WatchEventReport {
  return {
    event_type: 'Modified',
    path: 'a.md',
    success: true,
    chunks_processed: 1,
    duration_ms: 1,
    error: null,
    ...over
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetVaultTreeRouting()
  collections.set([{ id: 'c1', name: 'vault', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
  activeCollectionId.set('c1')
  fileTree.set(makeTree())
  assetTree.set(makeAssetTree())
})

describe('setFileNodeState', () => {
  it('flips state and rebalances the count buckets', () => {
    expect(setFileNodeState('a.md', 'modified')).toBe(true)
    const t = get(fileTree)!
    expect(t.indexed_count).toBe(0)
    expect(t.modified_count).toBe(1)
  })

  it('never downgrades a new file to modified', () => {
    setFileNodeState('b.md', 'modified')
    const t = get(fileTree)!
    const b = t.root.children.find((c) => c.path === 'b.md')!
    expect(b.state).toBe('new')
    expect(t.new_count).toBe(1)
    expect(t.modified_count).toBe(0)
  })

  it('returns false for a missing node', () => {
    expect(setFileNodeState('nope.md', 'indexed')).toBe(false)
  })
})

describe('insertAssetNode', () => {
  it('adds an asset and bumps the total', () => {
    insertAssetNode('img/pic.png', 'image', 1234)
    const t = get(assetTree)!
    expect(t.totalAssets).toBe(1)
    const dir = t.root.children.find((c) => c.name === 'img')!
    expect(dir.children[0].path).toBe('img/pic.png')
  })
})

describe('routeVaultEventToTree', () => {
  it('batches multiple events into a single flush', () => {
    routeVaultEventToTree(ev('created', 'c.md'))
    routeVaultEventToTree(ev('modified', 'a.md'))
    vi.advanceTimersByTime(120)
    const t = get(fileTree)!
    expect(t.root.children.find((c) => c.path === 'c.md')?.state).toBe('new')
    expect(t.root.children.find((c) => c.path === 'a.md')?.state).toBe('modified')
  })

  it('badges an indexed file deleted (row kept until reindex)', () => {
    routeVaultEventToTree(ev('deleted', 'a.md'))
    vi.advanceTimersByTime(120)
    const a = get(fileTree)!.root.children.find((c) => c.path === 'a.md')
    expect(a?.state).toBe('deleted')
  })

  it('removes a never-indexed (new) file outright on delete', () => {
    routeVaultEventToTree(ev('deleted', 'b.md'))
    vi.advanceTimersByTime(120)
    expect(get(fileTree)!.root.children.find((c) => c.path === 'b.md')).toBeUndefined()
  })

  it('falls back to a full reload beyond the burst threshold', () => {
    for (let i = 0; i < 160; i++) {
      routeVaultEventToTree(ev('modified', `f${i}.md`))
    }
    vi.advanceTimersByTime(120)
    // Debounced resync fires after 1s
    vi.advanceTimersByTime(1100)
    expect(mockApi.tree).toHaveBeenCalledTimes(1)
  })

  it('routes assets to the asset tree', () => {
    routeVaultEventToTree(ev('created', 'pic.png', { fileKind: 'asset', mimeCategory: 'image', size: 9 }))
    vi.advanceTimersByTime(120)
    expect(get(assetTree)!.totalAssets).toBe(1)
  })
})

describe('applyWatchReportToTree', () => {
  it('flips a modified file to indexed on a successful reindex', () => {
    setFileNodeState('a.md', 'modified')
    applyWatchReportToTree(report({ event_type: 'Modified', path: 'a.md', success: true }))
    expect(get(fileTree)!.root.children.find((c) => c.path === 'a.md')?.state).toBe('indexed')
  })

  it('inserts an indexed node when it is not in the tree yet', () => {
    applyWatchReportToTree(report({ event_type: 'Created', path: 'fresh.md', success: true }))
    expect(get(fileTree)!.root.children.find((c) => c.path === 'fresh.md')?.state).toBe('indexed')
  })

  it('removes the row on a successful delete', () => {
    applyWatchReportToTree(report({ event_type: 'Deleted', path: 'a.md', success: true }))
    expect(get(fileTree)!.root.children.find((c) => c.path === 'a.md')).toBeUndefined()
  })

  it('ignores failed reindex reports', () => {
    insertFileNode('c.md', 'new')
    applyWatchReportToTree(report({ event_type: 'Modified', path: 'c.md', success: false }))
    expect(get(fileTree)!.root.children.find((c) => c.path === 'c.md')?.state).toBe('new')
  })
})
