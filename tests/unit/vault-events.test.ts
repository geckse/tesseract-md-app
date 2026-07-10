import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the stores this dispatcher fans out to so we can assert routing
const routeVaultEventToTree = vi.fn()
const loadFileTree = vi.fn().mockResolvedValue(undefined)
const loadAssetTree = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/renderer/stores/files', () => ({
  routeVaultEventToTree: (...a: unknown[]) => routeVaultEventToTree(...a),
  loadFileTree: (...a: unknown[]) => loadFileTree(...a),
  loadAssetTree: (...a: unknown[]) => loadAssetTree(...a)
}))

const refreshCollectionStatus = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/renderer/stores/watcher', () => ({
  refreshCollectionStatus: (...a: unknown[]) => refreshCollectionStatus(...a)
}))

const refreshGraphData = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/renderer/stores/graph', () => ({
  refreshGraphData: (...a: unknown[]) => refreshGraphData(...a)
}))

import { get } from 'svelte/store'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import {
  handleVaultEventBatch,
  onExternalFileEvent
} from '../../src/renderer/stores/vault-events'
import type { VaultEventBatch, VaultFileEvent } from '../../src/preload/api'

function ev(over: Partial<VaultFileEvent> = {}): VaultFileEvent {
  return {
    kind: 'modified',
    path: 'a.md',
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

function batch(events: VaultFileEvent[], over: Partial<VaultEventBatch> = {}): VaultEventBatch {
  return { root: '/vault', events, overflow: false, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  collections.set([{ id: 'c1', name: 'vault', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
  activeCollectionId.set('c1')
})

describe('handleVaultEventBatch', () => {
  it('drops batches for a different collection root', () => {
    const seen: VaultFileEvent[] = []
    const off = onExternalFileEvent((e) => seen.push(e))
    handleVaultEventBatch(batch([ev()], { root: '/other' }))
    expect(routeVaultEventToTree).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
    off()
  })

  it('routes every event to the tree, external file events to editor subscribers', () => {
    const seen: VaultFileEvent[] = []
    const off = onExternalFileEvent((e) => seen.push(e))
    handleVaultEventBatch(batch([ev(), ev({ path: 'b.md', origin: 'app' })]))
    expect(routeVaultEventToTree).toHaveBeenCalledTimes(2)
    // Only the external one reaches editor subscribers
    expect(seen.map((e) => e.path)).toEqual(['a.md'])
    off()
  })

  it('skips per-event routing and resyncs on overflow', () => {
    handleVaultEventBatch(batch([ev()], { overflow: true }))
    expect(routeVaultEventToTree).not.toHaveBeenCalled()
    expect(loadFileTree).toHaveBeenCalledTimes(1)
    expect(loadAssetTree).toHaveBeenCalledTimes(1)
    expect(refreshCollectionStatus).toHaveBeenCalledTimes(1)
    expect(refreshGraphData).toHaveBeenCalledTimes(1)
  })

  it('stops delivering to unsubscribed editor handlers', () => {
    const seen: VaultFileEvent[] = []
    const off = onExternalFileEvent((e) => seen.push(e))
    off()
    handleVaultEventBatch(batch([ev()]))
    expect(seen).toHaveLength(0)
    // Tree routing still happens
    expect(routeVaultEventToTree).toHaveBeenCalledTimes(1)
  })
})
