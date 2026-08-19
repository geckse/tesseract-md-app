import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = {
  saveExternalDocument: vi.fn(),
  releaseExternalFile: vi.fn(),
  showMessage: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import { saveExternalDocumentTab } from '@renderer/lib/external-document-save'
import { workspace, type DocumentTab } from '@renderer/stores/workspace.svelte'

function openExternal(content = 'on disk'): DocumentTab {
  const tabId = workspace.openExternalDocumentTab({
    id: 'grant-1',
    path: '/outside/note.md',
    name: 'note.md',
    content
  })
  return workspace.tabs[tabId] as DocumentTab
}

describe('external document save', () => {
  beforeEach(() => {
    workspace.reset()
    vi.clearAllMocks()
    mockApi.releaseExternalFile.mockResolvedValue(undefined)
    mockApi.showMessage.mockResolvedValue(undefined)
  })

  it('advances the verified baseline while preserving edits made during the write', async () => {
    let finishWrite!: () => void
    mockApi.saveExternalDocument.mockImplementation(
      () => new Promise<void>((resolve) => (finishWrite = resolve))
    )
    const tab = openExternal()
    tab.content = 'first edit'
    tab.isDirty = true

    const save = saveExternalDocumentTab(tab.id, 'first edit')
    tab.content = 'second edit'
    tab.isDirty = true
    finishWrite()

    await expect(save).resolves.toBe(true)
    expect(mockApi.saveExternalDocument).toHaveBeenCalledWith('grant-1', 'on disk', 'first edit')
    expect(tab.savedContent).toBe('first edit')
    expect(tab.content).toBe('second edit')
    expect(tab.isDirty).toBe(true)
  })

  it('keeps the old baseline and reports a native error when the CAS write fails', async () => {
    mockApi.saveExternalDocument.mockRejectedValue(new Error('file changed on disk'))
    const tab = openExternal()
    tab.content = 'my edit'
    tab.isDirty = true

    await expect(saveExternalDocumentTab(tab.id, 'my edit')).resolves.toBe(false)

    expect(tab.savedContent).toBe('on disk')
    expect(tab.content).toBe('my edit')
    expect(tab.isDirty).toBe(true)
    expect(mockApi.showMessage).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could Not Save note.md',
      message: 'file changed on disk'
    })
  })
})
