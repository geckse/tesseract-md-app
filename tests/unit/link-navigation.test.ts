import { describe, it, expect, vi, beforeEach } from 'vitest'

// The helpers must run the FULL navigation sequence. Editors don't poll
// (file-sync router): workspace.openFile without syncFileStoresFromTab
// opens a tab with an empty editor.
//
// Popup windows render exactly one piece of content: opens that can't be
// displayed in place must route to a fresh popup window via
// window.api.openPopup instead of creating tabs no popup ever shows.
const { workspaceMock } = vi.hoisted(() => ({
  workspaceMock: {
    isPopup: false,
    focusedTab: undefined as { kind: string; isDirty?: boolean } | undefined,
    openFile: vi.fn(),
    openTab: vi.fn(),
    openTabFromGraph: vi.fn()
  }
}))

vi.mock('@renderer/stores/workspace.svelte', () => ({
  workspace: workspaceMock,
  detectAssetMime: (p: string) => (p.endsWith('.png') ? 'image' : null)
}))
vi.mock('@renderer/stores/files', async () => {
  const { writable } = await import('svelte/store')
  return {
    flatFileList: writable([]),
    selectedFilePath: writable(null),
    syncFileStoresFromTab: vi.fn()
  }
})
vi.mock('@renderer/stores/navigation', () => ({
  recordNavigation: vi.fn()
}))
vi.mock('@renderer/stores/collections', async () => {
  const { writable } = await import('svelte/store')
  return { activeCollection: writable(null) }
})

const mockApi = { openPopup: vi.fn() }
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import {
  openResolvedPath,
  openResolvedPathOtherPane,
  navigateLink
} from '@renderer/lib/link-navigation'
import { workspace } from '@renderer/stores/workspace.svelte'
import { syncFileStoresFromTab, flatFileList } from '@renderer/stores/files'
import { recordNavigation } from '@renderer/stores/navigation'
import { activeCollection } from '@renderer/stores/collections'
import type { Writable } from 'svelte/store'
import type { Collection } from '../../src/preload/api'
import type { FileTreeNode } from '../../src/renderer/types/cli'

const collection = { id: 'c1', name: 'Root', path: '/root', addedAt: 1, lastOpenedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  workspaceMock.isPopup = false
  workspaceMock.focusedTab = undefined
  ;(activeCollection as unknown as Writable<Collection | null>).set(collection)
})

describe('openResolvedPath (main window)', () => {
  it('records navigation, opens the file, and syncs file stores', () => {
    openResolvedPath('clients/acme.md')
    expect(recordNavigation).toHaveBeenCalledWith('clients/acme.md')
    expect(workspace.openFile).toHaveBeenCalledWith('clients/acme.md', undefined)
    expect(syncFileStoresFromTab).toHaveBeenCalled()
    expect(mockApi.openPopup).not.toHaveBeenCalled()
  })

  it('forwards forceNewTab to workspace.openFile', () => {
    openResolvedPath('clients/acme.md', { forceNewTab: true })
    expect(workspace.openFile).toHaveBeenCalledWith('clients/acme.md', { forceNewTab: true })
    expect(syncFileStoresFromTab).toHaveBeenCalled()
  })

  it('openResolvedPathOtherPane opens via openTabFromGraph and still syncs', () => {
    openResolvedPathOtherPane('clients/acme.md')
    expect(recordNavigation).toHaveBeenCalledWith('clients/acme.md')
    expect(workspace.openTabFromGraph).toHaveBeenCalledWith('clients/acme.md')
    expect(syncFileStoresFromTab).toHaveBeenCalled()
  })
})

describe('openResolvedPath (popup window)', () => {
  beforeEach(() => {
    workspaceMock.isPopup = true
  })

  it('routes to a new popup window when the popup shows a table', () => {
    workspaceMock.focusedTab = { kind: 'table' }
    openResolvedPath('clients/acme.md')
    expect(mockApi.openPopup).toHaveBeenCalledWith({
      kind: 'document',
      filePath: 'clients/acme.md',
      mimeCategory: undefined,
      collectionId: 'c1',
      collectionPath: '/root'
    })
    expect(workspace.openFile).not.toHaveBeenCalled()
    expect(syncFileStoresFromTab).not.toHaveBeenCalled()
  })

  it('navigates a clean document popup in place (replaceTab works there)', () => {
    workspaceMock.focusedTab = { kind: 'document', isDirty: false }
    openResolvedPath('clients/acme.md')
    expect(workspace.openFile).toHaveBeenCalledWith('clients/acme.md', undefined)
    expect(mockApi.openPopup).not.toHaveBeenCalled()
  })

  it('routes to a new popup window when the popup document is dirty', () => {
    workspaceMock.focusedTab = { kind: 'document', isDirty: true }
    openResolvedPath('clients/acme.md')
    expect(mockApi.openPopup).toHaveBeenCalled()
    expect(workspace.openFile).not.toHaveBeenCalled()
  })

  it('forceNewTab always routes to a new popup window (popups have no tabs)', () => {
    workspaceMock.focusedTab = { kind: 'document', isDirty: false }
    openResolvedPath('clients/acme.md', { forceNewTab: true })
    expect(mockApi.openPopup).toHaveBeenCalled()
    expect(workspace.openFile).not.toHaveBeenCalled()
  })

  it('routes asset targets to an asset popup even from a clean document popup', () => {
    workspaceMock.focusedTab = { kind: 'document', isDirty: false }
    openResolvedPath('assets/logo.png')
    expect(mockApi.openPopup).toHaveBeenCalledWith({
      kind: 'asset',
      filePath: 'assets/logo.png',
      mimeCategory: 'image',
      collectionId: 'c1',
      collectionPath: '/root'
    })
  })

  it('openResolvedPathOtherPane routes to a new popup window (popups have no panes)', () => {
    workspaceMock.focusedTab = { kind: 'graph' }
    openResolvedPathOtherPane('clients/acme.md')
    expect(mockApi.openPopup).toHaveBeenCalled()
    expect(workspace.openTabFromGraph).not.toHaveBeenCalled()
  })

  it('falls back to the in-window open when no collection is active', () => {
    ;(activeCollection as unknown as Writable<Collection | null>).set(null)
    workspaceMock.focusedTab = { kind: 'table' }
    openResolvedPath('clients/acme.md')
    expect(mockApi.openPopup).not.toHaveBeenCalled()
    expect(workspace.openFile).toHaveBeenCalledWith('clients/acme.md', undefined)
  })
})

describe('navigateLink (popup window)', () => {
  it('routes resolved wikilinks to a new popup window from a table popup', () => {
    workspaceMock.isPopup = true
    workspaceMock.focusedTab = { kind: 'table' }
    ;(flatFileList as unknown as Writable<Pick<FileTreeNode, 'path'>[]>).set([
      { path: 'notes/foo.md' }
    ])
    navigateLink('foo')
    expect(mockApi.openPopup).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document', filePath: 'notes/foo.md' })
    )
    expect(workspace.openFile).not.toHaveBeenCalled()
  })
})
