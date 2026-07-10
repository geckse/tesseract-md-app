import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

const mockApi = {
  readFile: vi.fn(),
  getAutoShowDiff: vi.fn().mockResolvedValue(false)
}
Object.defineProperty(globalThis, 'window', { value: { api: mockApi }, writable: true })

import { workspace, type DocumentTab } from '../../src/renderer/stores/workspace.svelte'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { syncFileStoresFromTab } from '../../src/renderer/stores/files'
import { conflicts, getConflict } from '../../src/renderer/stores/conflict'
import {
  handleVaultFileEvent,
  applyDiskContentToTab,
  resolveConflictKeepMine,
  resolveConflictMerge,
  externalUpdateNotice,
  resetFileSyncState
} from '../../src/renderer/stores/file-sync'
import type { VaultFileEvent } from '../../src/preload/api'

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

/** Open a document tab and prime its content baselines. */
function openTab(path: string, content: string, dirty = false): DocumentTab {
  const id = workspace.openTab(path)
  const tab = workspace.tabs[id] as DocumentTab
  tab.content = content
  tab.savedContent = dirty ? `${content}-saved` : content
  tab.isDirty = dirty
  tab.contentLoading = false
  syncFileStoresFromTab()
  return tab
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockApi.getAutoShowDiff.mockResolvedValue(false)
  workspace.reset()
  collections.set([{ id: 'c1', name: 'vault', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
  activeCollectionId.set('c1')
  resetFileSyncState()
})

describe('file-sync routing', () => {
  it('live-applies disk content to a clean tab', async () => {
    const tab = openTab('a.md', 'original')
    mockApi.readFile.mockResolvedValue('from disk')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(tab.content).toBe('from disk')
    expect(tab.savedContent).toBe('from disk')
    expect(tab.isDirty).toBe(false)
    expect(get(externalUpdateNotice)?.filePath).toBe('a.md')
  })

  it('is a no-op when disk equals the saved baseline (echo)', async () => {
    const tab = openTab('a.md', 'same')
    mockApi.readFile.mockResolvedValue('same')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(get(externalUpdateNotice)).toBeNull()
    expect(getConflict('a.md')).toBeUndefined()
    expect(tab.content).toBe('same')
  })

  it('raises a conflict for a dirty tab whose disk diverged', async () => {
    openTab('a.md', 'my edits', true)
    mockApi.readFile.mockResolvedValue('agent version')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    const c = getConflict('a.md')
    expect(c?.kind).toBe('modified')
    expect(c?.diskContent).toBe('agent version')
  })

  it('marks a conflict mergeable when the edits do not overlap', async () => {
    // base has 3 lines; ours edits line 1, disk edits line 3 → clean merge
    const id = workspace.openTab('a.md')
    const tab = workspace.tabs[id] as DocumentTab
    tab.savedContent = 'one\ntwo\nthree'
    tab.content = 'ONE\ntwo\nthree'
    tab.isDirty = true
    tab.contentLoading = false
    syncFileStoresFromTab()
    mockApi.readFile.mockResolvedValue('one\ntwo\nTHREE')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(getConflict('a.md')?.mergeClean).toBe(true)
  })

  it('marks a conflict non-mergeable when both sides edit the same line', async () => {
    const id = workspace.openTab('a.md')
    const tab = workspace.tabs[id] as DocumentTab
    tab.savedContent = 'one\ntwo\nthree'
    tab.content = 'one\nOURS\nthree'
    tab.isDirty = true
    tab.contentLoading = false
    syncFileStoresFromTab()
    mockApi.readFile.mockResolvedValue('one\nTHEIRS\nthree')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(getConflict('a.md')?.mergeClean).toBe(false)
  })

  it('resolveConflictMerge composes both changes into the tab and clears the conflict', async () => {
    const id = workspace.openTab('a.md')
    const tab = workspace.tabs[id] as DocumentTab
    tab.savedContent = 'one\ntwo\nthree'
    tab.content = 'ONE\ntwo\nthree'
    tab.isDirty = true
    tab.contentLoading = false
    syncFileStoresFromTab()
    mockApi.readFile.mockResolvedValue('one\ntwo\nTHREE')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    const ok = await resolveConflictMerge('a.md')
    expect(ok).toBe(true)
    expect(tab.content).toBe('ONE\ntwo\nTHREE')
    expect(tab.savedContent).toBe('one\ntwo\nTHREE') // disk becomes the baseline
    expect(tab.isDirty).toBe(true) // merged still differs from disk
    expect(getConflict('a.md')).toBeUndefined()
  })

  it('resolveConflictMerge declines and keeps the conflict when edits overlap', async () => {
    const id = workspace.openTab('a.md')
    const tab = workspace.tabs[id] as DocumentTab
    tab.savedContent = 'one\ntwo\nthree'
    tab.content = 'one\nOURS\nthree'
    tab.isDirty = true
    tab.contentLoading = false
    syncFileStoresFromTab()
    mockApi.readFile.mockResolvedValue('one\nTHEIRS\nthree')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    const ok = await resolveConflictMerge('a.md')
    expect(ok).toBe(false)
    expect(getConflict('a.md')).toBeDefined()
    expect(tab.content).toBe('one\nOURS\nthree') // unchanged
  })

  it('silently marks a dirty tab clean when disk matches its content', async () => {
    const tab = openTab('a.md', 'converged', true)
    mockApi.readFile.mockResolvedValue('converged')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(tab.isDirty).toBe(false)
    expect(tab.savedContent).toBe('converged')
    expect(getConflict('a.md')).toBeUndefined()
  })

  it('mutes an identical disk version after Keep Mine, re-raises a different one', async () => {
    openTab('a.md', 'my edits', true)
    mockApi.readFile.mockResolvedValue('agent v1')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)
    expect(getConflict('a.md')).toBeDefined()

    resolveConflictKeepMine('a.md')

    // Same disk content → muted (no active conflict)
    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)
    expect(getConflict('a.md')?.dismissedDiskContent).toBe('agent v1')

    // A genuinely new disk version re-raises
    mockApi.readFile.mockResolvedValue('agent v2')
    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)
    expect(getConflict('a.md')?.dismissedDiskContent).toBeUndefined()
  })

  it('marks a tab disk-missing on delete without closing it', async () => {
    const tab = openTab('a.md', 'content')
    handleVaultFileEvent(ev({ kind: 'deleted' }))
    // deletes route synchronously (no debounce)
    expect(tab.diskMissing).toBe(true)
    expect(getConflict('a.md')?.kind).toBe('deleted')
  })

  it('ignores untitled tabs', async () => {
    const id = workspace.openTab('a.md')
    const tab = workspace.tabs[id] as DocumentTab
    tab.isUntitled = true
    tab.content = 'draft'
    tab.savedContent = 'draft'
    syncFileStoresFromTab()
    mockApi.readFile.mockResolvedValue('disk')

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(mockApi.readFile).not.toHaveBeenCalled()
    expect(tab.content).toBe('draft')
  })

  it('coalesces a burst of events into a single disk read', async () => {
    openTab('a.md', 'x')
    mockApi.readFile.mockResolvedValue('final')

    for (let i = 0; i < 5; i++) handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(mockApi.readFile).toHaveBeenCalledTimes(1)
  })

  it('retargets an open tab on rename', async () => {
    const tab = openTab('old.md', 'content')
    handleVaultFileEvent(ev({ kind: 'renamed', path: 'new.md', oldPath: 'old.md' }))
    expect(tab.filePath).toBe('new.md')
    expect(tab.title).toBe('new.md')
  })

  it('treats a vanished file (read failure) as a delete', async () => {
    const tab = openTab('a.md', 'content')
    mockApi.readFile.mockRejectedValue(new Error('ENOENT'))

    handleVaultFileEvent(ev())
    await vi.advanceTimersByTimeAsync(250)

    expect(tab.diskMissing).toBe(true)
  })
})

describe('applyDiskContentToTab', () => {
  it('updates content, baseline, dirty flag, and notice', () => {
    const tab = openTab('a.md', 'before')
    applyDiskContentToTab(tab, 'after')
    expect(tab.content).toBe('after')
    expect(tab.savedContent).toBe('after')
    expect(tab.isDirty).toBe(false)
    expect(get(externalUpdateNotice)).toEqual(
      expect.objectContaining({ filePath: 'a.md', previous: 'before' })
    )
  })
})

describe('resetFileSyncState', () => {
  it('clears conflicts and the update notice', () => {
    conflicts.set({ 'a.md': { filePath: 'a.md', kind: 'modified', diskContent: null, diskMtimeMs: null, detectedAt: 0 } })
    externalUpdateNotice.set({ filePath: 'a.md', previous: '', at: 0 })
    resetFileSyncState()
    expect(get(conflicts)).toEqual({})
    expect(get(externalUpdateNotice)).toBeNull()
  })
})
