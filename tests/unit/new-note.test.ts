import { describe, it, expect, vi, beforeEach } from 'vitest'

// Attach a mock api to jsdom's window before importing the module under test
const mockApi = {
  openPopup: vi.fn().mockResolvedValue(undefined),
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import { openNewNotePopup } from '@renderer/lib/new-note'
import { collections, activeCollectionId } from '@renderer/stores/collections'
import { workspace } from '@renderer/stores/workspace.svelte'
import { setEditorMode, syncEditorStoresFromTab } from '../../src/renderer/stores/editor'

const collection = {
  id: 'col-1',
  name: 'Vault',
  path: '/vaults/main',
  addedAt: 1,
  lastOpenedAt: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  workspace.reset()
  syncEditorStoresFromTab()
  collections.set([collection])
  activeCollectionId.set(collection.id)
})

describe('openNewNotePopup', () => {
  it('does nothing and returns false when no collection is active', () => {
    activeCollectionId.set(null)

    expect(openNewNotePopup()).toBe(false)
    expect(mockApi.openPopup).not.toHaveBeenCalled()
  })

  it('opens an untitled document popup for the active collection', () => {
    expect(openNewNotePopup()).toBe(true)

    expect(mockApi.openPopup).toHaveBeenCalledOnce()
    expect(mockApi.openPopup).toHaveBeenCalledWith({
      kind: 'document',
      filePath: 'Untitled.md',
      isUntitled: true,
      editorMode: 'wysiwyg',
      collectionId: 'col-1',
      collectionPath: '/vaults/main',
    })
  })

  it('defaults to wysiwyg mode when no document tab is focused', () => {
    openNewNotePopup()

    expect(mockApi.openPopup).toHaveBeenCalledWith(
      expect.objectContaining({ editorMode: 'wysiwyg' })
    )
  })

  it('inherits the focused tab editor mode', () => {
    workspace.openTab('notes/existing.md')
    setEditorMode('editor')
    syncEditorStoresFromTab()

    openNewNotePopup()

    expect(mockApi.openPopup).toHaveBeenCalledWith(
      expect.objectContaining({ editorMode: 'editor' })
    )
  })
})
