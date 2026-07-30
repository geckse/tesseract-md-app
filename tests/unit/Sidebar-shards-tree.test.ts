import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import type { ShardInfo } from '../../src/renderer/types/cli'

const stub = vi.hoisted(() => async (): Promise<{ default: unknown }> => {
  const mod = await import('./stubs/StubComponent.svelte')
  return { default: mod.default }
})

const shardActions = vi.hoisted(() => ({
  refreshAll: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue(undefined)
}))
const openTopicsSettings = vi.hoisted(() => vi.fn())

vi.mock('../../src/renderer/components/FileTree.svelte', stub)
vi.mock('../../src/renderer/components/Favorites.svelte', stub)
vi.mock('../../src/renderer/components/ResizeHandle.svelte', stub)

vi.mock('../../src/renderer/stores/files', async () => {
  const { writable } = await import('svelte/store')
  return {
    loadFileTree: vi.fn().mockResolvedValue(undefined),
    loadAssetTree: vi.fn().mockResolvedValue(undefined),
    scopedFileCount: writable(0),
    collectionDirectories: writable<string[]>([]),
    syncFileStoresFromTab: vi.fn()
  }
})

vi.mock('../../src/renderer/stores/shards', async (importOriginal) => {
  const { writable } = await import('svelte/store')
  const actual = await importOriginal<typeof import('../../src/renderer/stores/shards')>()
  return {
    ...actual,
    activeShard: writable<ShardInfo | null>(null),
    activeShardId: writable<string | null>(null),
    shardsByCollection: writable<Record<string, ShardInfo[]>>({}),
    shardErrorsByCollection: writable<Record<string, string | null>>({}),
    refreshAllShards: shardActions.refreshAll,
    refreshShards: shardActions.refresh,
    removeShardDefinition: shardActions.remove,
    setActiveShard: shardActions.select
  }
})

vi.mock('../../src/renderer/stores/graph', () => ({
  openGraphViewForPath: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: { openTableTab: vi.fn() }
}))

vi.mock('../../src/renderer/stores/ingest', () => ({ runIngest: vi.fn() }))

vi.mock('../../src/renderer/stores/ui', async () => {
  const { writable } = await import('svelte/store')
  return { settingsOpen: writable(false) }
})

vi.mock('../../src/renderer/stores/settings', async () => {
  const { writable } = await import('svelte/store')
  return {
    settingsTarget: writable<string | null>(null),
    activeSection: writable('cli'),
    openTopicsSettings
  }
})

vi.mock('../../src/renderer/stores/watcher', async () => {
  const { writable } = await import('svelte/store')
  return {
    watcherState: writable('stopped'),
    toggleWatcher: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('../../src/renderer/stores/terminal.svelte', () => ({
  terminalStore: { createTerminal: vi.fn().mockResolvedValue(null) }
}))

const api = {
  newWindow: vi.fn().mockResolvedValue(undefined),
  showItemInFolder: vi.fn().mockResolvedValue(undefined),
  writeToClipboard: vi.fn().mockResolvedValue(undefined),
  showConfirmation: vi.fn().mockResolvedValue(false)
}
;(globalThis as unknown as { window: Window & { api: typeof api } }).window.api = api

import Sidebar from '@renderer/components/Sidebar.svelte'
import {
  activeCollectionId,
  collections,
  collectionsLoading,
  collectionStatus
} from '@renderer/stores/collections'
import {
  activeShard,
  activeShardId,
  shardErrorsByCollection,
  shardsByCollection
} from '@renderer/stores/shards'

const parentShard: ShardInfo = {
  id: 'research',
  name: 'Research',
  path: 'docs',
  parent_id: null,
  exists: true
}

const childShard: ShardInfo = {
  id: 'notes',
  name: 'Notes',
  path: 'docs/notes',
  parent_id: 'research',
  exists: true
}

const missingShard: ShardInfo = {
  id: 'retired',
  name: 'Retired',
  path: 'docs/retired',
  parent_id: 'research',
  exists: false
}

async function renderOpenTree() {
  render(Sidebar)
  await fireEvent.click(screen.getByRole('button', { name: /Vault/ }))
  const tree = await screen.findByRole('tree', { name: 'Collections and Shards' })
  await waitFor(() => expect(within(tree).getAllByRole('treeitem')).toHaveLength(4))
  return {
    tree,
    collection: within(tree).getByRole('treeitem', { name: /Vault/ }),
    parent: within(tree).getByRole('treeitem', { name: /Research/ }),
    child: within(tree).getByRole('treeitem', { name: /Notes/ }),
    missing: within(tree).getByRole('treeitem', { name: /Retired/ })
  }
}

describe('Sidebar Shard tree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shardActions.refreshAll.mockResolvedValue(undefined)
    shardActions.refresh.mockResolvedValue([])
    shardActions.remove.mockResolvedValue(undefined)
    shardActions.select.mockResolvedValue(undefined)
    localStorage.clear()

    collections.set([{ id: 'vault', name: 'Vault', path: '/vault', addedAt: 1, lastOpenedAt: 1 }])
    activeCollectionId.set('vault')
    collectionStatus.set(null)
    collectionsLoading.set(false)
    activeShard.set(null)
    activeShardId.set(null)
    shardErrorsByCollection.set({})
    shardsByCollection.set({
      vault: [missingShard, childShard, parentShard]
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nested ARIA levels and keeps missing Shards visible and manageable', async () => {
    const { collection, parent, child, missing } = await renderOpenTree()

    expect(collection.getAttribute('aria-level')).toBe('1')
    expect(collection.getAttribute('aria-expanded')).toBe('true')
    expect(parent.getAttribute('aria-level')).toBe('2')
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    expect(child.getAttribute('aria-level')).toBe('3')
    expect(missing.getAttribute('aria-level')).toBe('3')
    expect(missing.getAttribute('aria-disabled')).toBe('true')
    expect(missing.getAttribute('title')).toBe('Missing folder: docs/retired')
    expect(within(missing).getByText('warning')).toBeTruthy()

    await fireEvent.contextMenu(missing)
    expect(screen.getByRole('button', { name: /Edit Shard/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Remove Shard/ })).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /Show in Graph/ }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('uses tree arrow keys to enter, leave, collapse, and restore nested branches', async () => {
    const rendered = await renderOpenTree()
    const { tree, collection } = rendered
    let { parent, child } = rendered

    collection.focus()
    await fireEvent.keyDown(collection, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(parent))

    await fireEvent.keyDown(parent, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(child))

    await fireEvent.keyDown(child, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(parent))

    await fireEvent.keyDown(parent, { key: 'ArrowLeft' })
    await waitFor(() => {
      parent = within(tree).getByRole('treeitem', { name: /Research/ })
      expect(parent.getAttribute('aria-expanded')).toBe('false')
      expect(within(tree).queryByRole('treeitem', { name: /Notes/ })).toBeNull()
      expect(within(tree).queryByRole('treeitem', { name: /Retired/ })).toBeNull()
    })

    parent.focus()
    await fireEvent.keyDown(parent, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(collection))

    await fireEvent.keyDown(collection, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(parent))
    await fireEvent.keyDown(parent, { key: 'ArrowRight' })
    await waitFor(() => {
      child = within(tree).getByRole('treeitem', { name: /Notes/ })
      expect(parent.getAttribute('aria-expanded')).toBe('true')
    })
    await fireEvent.keyDown(parent, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(child))
  })

  it('selects an existing Shard with Enter but ignores a missing Shard', async () => {
    const { tree, child } = await renderOpenTree()

    child.focus()
    await fireEvent.keyDown(child, { key: 'Enter' })
    await waitFor(() => expect(shardActions.select).toHaveBeenCalledWith('notes'))

    shardActions.select.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: /Vault/ }))
    const reopenedTree = await screen.findByRole('tree', {
      name: 'Collections and Shards'
    })
    const missing = within(reopenedTree).getByRole('treeitem', { name: /Retired/ })

    missing.focus()
    await fireEvent.keyDown(missing, { key: 'Enter' })

    expect(shardActions.select).not.toHaveBeenCalled()
    expect(within(reopenedTree).getByRole('treeitem', { name: /Retired/ })).toBeTruthy()
    expect(document.body.contains(tree)).toBe(false)
  })

  it('omits collection expansion affordances when no Shards are configured', async () => {
    shardsByCollection.set({ vault: [] })

    render(Sidebar)
    await fireEvent.click(screen.getByRole('button', { name: /Vault/ }))
    const tree = await screen.findByRole('tree', { name: 'Collections and Shards' })
    const collection = within(tree).getByRole('treeitem', { name: /Vault/ })

    expect(collection.getAttribute('aria-expanded')).toBeNull()
    expect(within(tree).queryByRole('button', { name: /Expand Vault|Collapse Vault/ })).toBeNull()

    collection.focus()
    await fireEvent.keyDown(collection, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(collection)
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(1)
  })

  it('opens scoped Topic management for existing and missing Shards', async () => {
    const rendered = await renderOpenTree()
    await fireEvent.contextMenu(rendered.child)
    await fireEvent.click(screen.getByRole('button', { name: /Manage Topics/ }))
    expect(openTopicsSettings).toHaveBeenLastCalledWith('vault', 'notes')

    const tree = screen.getByRole('tree', { name: 'Collections and Shards' })
    await fireEvent.contextMenu(within(tree).getByRole('treeitem', { name: /Retired/ }))
    const manageMissing = screen.getByRole('button', { name: /Manage Topics/ })
    expect((manageMissing as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(manageMissing)
    expect(openTopicsSettings).toHaveBeenLastCalledWith('vault', 'retired')
  })

  it('warns that removing a Shard also removes local Topics but not shared content', async () => {
    const { parent } = await renderOpenTree()
    await fireEvent.contextMenu(parent)
    await fireEvent.click(screen.getByRole('button', { name: /Remove Shard/ }))

    expect(api.showConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('local Topic definitions')
      })
    )
    const confirmation = api.showConfirmation.mock.calls[0][0]
    expect(confirmation.message).toContain('folder, files, and the shared collection index')
  })
})
