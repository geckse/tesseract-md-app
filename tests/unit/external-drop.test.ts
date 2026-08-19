import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncFileStoresFromTab = vi.hoisted(() => vi.fn())

vi.mock('@renderer/stores/files', () => ({ syncFileStoresFromTab }))

const mockApi = {
  openDroppedFile: vi.fn(),
  readExternalDocument: vi.fn(),
  releaseExternalFile: vi.fn(),
  showMessage: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import type { ExternalDroppedFileDescriptor } from '../../src/preload/api'
import { isExternalFileDrag, openExternalDroppedFiles } from '@renderer/lib/external-drop'
import { activeCollectionId } from '@renderer/stores/collections'
import { workspace, type AssetTab, type DocumentTab } from '@renderer/stores/workspace.svelte'

const createObjectURL = vi.fn(() => 'blob:external-file')
const revokeObjectURL = vi.fn()

function descriptor(
  overrides: Partial<ExternalDroppedFileDescriptor> = {}
): ExternalDroppedFileDescriptor {
  return {
    id: 'grant-1',
    path: '/outside/note.md',
    name: 'note.md',
    directory: '/outside',
    size: 12,
    kind: 'markdown',
    mimeCategory: 'other',
    content: '# Outside\n',
    collectionId: null,
    relativePath: null,
    ...overrides
  }
}

describe('external workspace file drops', () => {
  beforeEach(() => {
    workspace.reset()
    vi.clearAllMocks()
    activeCollectionId.set(null)
    mockApi.releaseExternalFile.mockResolvedValue(undefined)
    mockApi.showMessage.mockResolvedValue(undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      writable: true,
      configurable: true
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    workspace.reset()
  })

  it('recognizes OS file payloads but excludes internal file-tree drags', () => {
    expect(isExternalFileDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(
      isExternalFileDrag({
        types: ['Files', 'application/x-mdvdb-path']
      } as unknown as DataTransfer)
    ).toBe(false)
  })

  it('opens external Markdown non-destructively in an ephemeral editable tab', async () => {
    const collectionTabId = workspace.openTab('inside.md')
    mockApi.openDroppedFile.mockResolvedValue(descriptor())

    const [tabId] = await openExternalDroppedFiles(
      [new File(['# Outside\n'], 'note.md', { type: 'text/markdown' })],
      workspace.defaultEditorPaneId
    )

    const tab = workspace.tabs[tabId] as DocumentTab
    expect(workspace.tabs[collectionTabId]).toBeDefined()
    expect(tab).toMatchObject({
      origin: 'external',
      externalId: 'grant-1',
      externalPath: '/outside/note.md',
      filePath: 'note.md',
      content: '# Outside\n',
      savedContent: '# Outside\n',
      isDirty: false
    })
    expect(tab.navigation.current).toBeNull()
    expect(workspace.serializeTab(tabId)).toBeNull()
    expect(JSON.stringify(workspace.serializeSession())).not.toContain('/outside/note.md')
    expect(syncFileStoresFromTab).toHaveBeenCalled()
  })

  it('routes a file already in the active collection back to a collection tab', async () => {
    activeCollectionId.set('collection-1')
    mockApi.openDroppedFile.mockResolvedValue(
      descriptor({
        path: '/vault/notes/note.md',
        collectionId: 'collection-1',
        relativePath: 'notes/note.md'
      })
    )

    const [tabId] = await openExternalDroppedFiles(
      [new File(['# Inside\n'], 'note.md', { type: 'text/markdown' })],
      workspace.defaultEditorPaneId
    )

    expect(workspace.tabs[tabId]).toMatchObject({
      kind: 'document',
      origin: 'collection',
      filePath: 'notes/note.md'
    })
    expect(mockApi.releaseExternalFile).toHaveBeenCalledWith('grant-1')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:external-file')
  })

  it('opens external media by object URL and revokes its capabilities on close', async () => {
    mockApi.openDroppedFile.mockResolvedValue(
      descriptor({
        path: '/outside/photo.png',
        name: 'photo.png',
        kind: 'asset',
        mimeCategory: 'image',
        content: undefined
      })
    )

    const [tabId] = await openExternalDroppedFiles(
      [new File(['png'], 'photo.png', { type: 'image/png' })],
      workspace.defaultEditorPaneId
    )

    expect(workspace.tabs[tabId] as AssetTab).toMatchObject({
      kind: 'asset',
      origin: 'external',
      externalId: 'grant-1',
      externalPath: '/outside/photo.png',
      externalUrl: 'blob:external-file',
      mimeCategory: 'image'
    })

    workspace.closeTab(tabId)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:external-file')
    expect(mockApi.releaseExternalFile).toHaveBeenCalledWith('grant-1')
  })
})
