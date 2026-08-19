import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'

const mockApi = {
  createBinary: vi.fn().mockResolvedValue({ size: 4 }),
  importDroppedFiles: vi.fn().mockResolvedValue([]),
  readBinary: vi.fn().mockResolvedValue('AQIDBA=='),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  schema: vi.fn().mockResolvedValue({ fields: [], scopes: [] }),
  showMessage: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined)
}

Object.defineProperty(globalThis.window, 'api', {
  configurable: true,
  value: mockApi,
  writable: true
})

Object.defineProperty(globalThis.window, 'scrollBy', {
  configurable: true,
  value: vi.fn()
})

Object.defineProperty(globalThis.Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList
})

const stub = vi.hoisted(() => async (): Promise<{ default: unknown }> => {
  const mod = await import('./stubs/StubComponent.svelte')
  return { default: mod.default }
})
vi.mock('../../src/renderer/components/ConflictNotification.svelte', stub)
vi.mock('../../src/renderer/components/wysiwyg/DocumentHeader.svelte', stub)
vi.mock('../../src/renderer/components/wysiwyg/BubbleMenu.svelte', stub)
vi.mock('../../src/renderer/components/wysiwyg/MediaBubbleMenu.svelte', stub)
vi.mock('../../src/renderer/components/wysiwyg/EditorContextMenu.svelte', stub)
vi.mock('../../src/renderer/components/wysiwyg/LinkModal.svelte', stub)
vi.mock('../../src/renderer/components/InsertAssetDialog.svelte', stub)
vi.mock('../../src/renderer/components/LinkHoverPreview.svelte', stub)

import WysiwygEditor from '@renderer/components/WysiwygEditor.svelte'
import { collections, activeCollectionId } from '@renderer/stores/collections'
import { assetTree, fileTree } from '@renderer/stores/files'
import { workspace } from '@renderer/stores/workspace.svelte'
import { schema } from '@renderer/stores/schema'
import { saveAsTabId } from '@renderer/stores/save-as'

function openDocument(filePath: string, content: string): string {
  const tabId = workspace.openTab(filePath)
  const tab = workspace.tabs[tabId]
  if (tab?.kind === 'document') {
    tab.content = content
    tab.savedContent = content
    tab.contentLoading = false
    tab.editorMode = 'wysiwyg'
  }
  return tabId
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('WysiwygEditor clipboard images', () => {
  beforeEach(() => {
    workspace.reset()
    collections.set([
      {
        addedAt: 0,
        id: '1',
        lastOpenedAt: 0,
        name: 'Vault',
        path: '/vault'
      }
    ])
    activeCollectionId.set('1')
    fileTree.set(null)
    assetTree.set(null)
    schema.set(null)
    saveAsTabId.set(null)
    vi.clearAllMocks()
    mockApi.createBinary.mockResolvedValue({ size: 4 })
    mockApi.importDroppedFiles.mockResolvedValue([])
    mockApi.readBinary.mockResolvedValue('AQIDBA==')
    mockApi.schema.mockResolvedValue({ fields: [], scopes: [] })
    mockApi.showMessage.mockResolvedValue(undefined)
  })

  it('writes the pasted image before inserting it into the originating rich editor', async () => {
    const tabId = openDocument('notes/test.md', '# Test\n\nBody')
    const tab = workspace.tabs[tabId]
    mockApi.createBinary.mockImplementation(async () => {
      if (tab?.kind === 'document') expect(tab.content).not.toContain('![test.png]')
      return { size: 4 }
    })

    const { container } = render(WysiwygEditor, { props: { tabId } })
    const image = new File([new Uint8Array([1, 2, 3, 4])], 'clipboard.png', {
      type: 'image/png'
    })
    await fireEvent.paste(container.querySelector('.ProseMirror')!, {
      clipboardData: {
        getData: () => '',
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }]
      }
    })

    expect(await screen.findByRole('dialog', { name: 'Save pasted image' })).toBeTruthy()
    expect((screen.getByLabelText('Filename') as HTMLInputElement).value).toBe('test')

    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))
    await flushAsync()

    expect(mockApi.createBinary).toHaveBeenCalledWith('/vault/notes/test.png', expect.any(String))
    expect(tab?.kind === 'document' ? tab.content : '').toContain('![test.png](test.png)')
    expect(container.querySelector('img')?.getAttribute('data-original-src')).toBe('test.png')
  })

  it('does not open the image modal for ordinary text paste', async () => {
    const tabId = openDocument('test.md', 'Body')
    const { container } = render(WysiwygEditor, { props: { tabId } })

    await fireEvent.paste(container.querySelector('.ProseMirror')!, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? 'text' : ''),
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]
      }
    })

    expect(screen.queryByRole('dialog', { name: 'Save pasted image' })).toBeNull()
    expect(mockApi.createBinary).not.toHaveBeenCalled()
  })

  it('does not invoke collection schema or asset capture in standalone mode', async () => {
    const tabId = workspace.initAsStandalone({
      standalonePath: '/outside/test.md',
      content: 'Body'
    })
    const { container } = render(WysiwygEditor, { props: { tabId, standalone: true } })
    const image = new File([new Uint8Array([1, 2, 3, 4])], 'clipboard.png', {
      type: 'image/png'
    })

    await fireEvent.paste(container.querySelector('.ProseMirror')!, {
      clipboardData: {
        getData: () => '',
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }]
      }
    })

    expect(mockApi.schema).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Save pasted image' })).toBeNull()
    expect(mockApi.createBinary).not.toHaveBeenCalled()
  })

  it('imports external images as media and non-embeddable files as wikilinks', async () => {
    const tabId = openDocument('notes/test.md', '# Test\n\nDrop here')
    const tab = workspace.tabs[tabId]
    const image = new File(['image'], 'photo.png', { type: 'image/png' })
    const pdf = new File(['pdf'], 'spec.pdf', { type: 'application/pdf' })
    const transfer = {
      types: ['Files'],
      files: [image, pdf],
      dropEffect: 'none',
      getData: () => ''
    } as unknown as DataTransfer
    mockApi.importDroppedFiles.mockResolvedValue([
      {
        sourceName: 'photo.png',
        relativePath: 'notes/photo.png',
        size: 5,
        kind: 'asset',
        mimeCategory: 'image'
      },
      {
        sourceName: 'spec.pdf',
        relativePath: 'notes/spec.pdf',
        size: 3,
        kind: 'asset',
        mimeCategory: 'pdf'
      }
    ])

    const { container } = render(WysiwygEditor, { props: { tabId } })
    const dropTarget = container.querySelector('.ProseMirror')!

    await fireEvent.dragOver(container.querySelector('.wysiwyg-scroll')!, {
      dataTransfer: transfer
    })
    expect(transfer.dropEffect).toBe('copy')
    await fireEvent.drop(dropTarget, { dataTransfer: transfer })

    await vi.waitFor(() => {
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([image, pdf], '1', 'notes')
      const content = tab?.kind === 'document' ? tab.content : ''
      expect(content).toContain('![photo.png](photo.png)')
      expect(content).toContain('[[notes/spec.pdf]]')
    })
    await flushAsync()
    expect(container.querySelector('img')?.getAttribute('data-original-src')).toBe('photo.png')
    expect(mockApi.createBinary).not.toHaveBeenCalled()
  })

  it('maps internal File Tree drops to media and wikilink nodes without copying', async () => {
    const tabId = openDocument('notes/test.md', 'Drop here')
    const tab = workspace.tabs[tabId]
    const { container } = render(WysiwygEditor, { props: { tabId } })
    const dropTarget = container.querySelector('.ProseMirror')!
    const internalTransfer = (path: string) =>
      ({
        types: ['text/plain', 'application/x-mdvdb-path'],
        files: [],
        dropEffect: 'none',
        getData: (type: string) => (type === 'application/x-mdvdb-path' ? path : `[[${path}]]`)
      }) as unknown as DataTransfer

    await fireEvent.drop(dropTarget, {
      dataTransfer: internalTransfer('assets/photo.png')
    })
    await fireEvent.drop(dropTarget, {
      dataTransfer: internalTransfer('assets/spec.pdf')
    })

    await vi.waitFor(() => {
      const content = tab?.kind === 'document' ? tab.content : ''
      expect(content).toContain('![photo.png](../assets/photo.png)')
      expect(content).toContain('[[assets/spec.pdf]]')
    })
    await flushAsync()
    expect(mockApi.importDroppedFiles).not.toHaveBeenCalled()
  })

  it('defers an external file drop until an untitled document is saved', async () => {
    const tabId = workspace.createUntitledTab()
    const tab = workspace.tabs[tabId]
    if (tab?.kind === 'document') {
      tab.content = 'Draft'
      tab.savedContent = 'Draft'
      tab.editorMode = 'wysiwyg'
    }
    const image = new File(['image'], 'photo.png', { type: 'image/png' })
    mockApi.importDroppedFiles.mockResolvedValue([
      {
        sourceName: 'photo.png',
        relativePath: 'drafts/photo.png',
        size: 5,
        kind: 'asset',
        mimeCategory: 'image'
      }
    ])

    const { container } = render(WysiwygEditor, { props: { tabId } })
    await fireEvent.drop(container.querySelector('.ProseMirror')!, {
      dataTransfer: {
        types: ['Files'],
        files: [image],
        dropEffect: 'none',
        getData: () => ''
      }
    })

    await vi.waitFor(() => expect(get(saveAsTabId)).toBe(tabId))
    expect(mockApi.importDroppedFiles).not.toHaveBeenCalled()

    workspace.finalizeUntitledTab(tabId, 'drafts/note.md')
    saveAsTabId.set(null)

    await vi.waitFor(() => {
      expect(mockApi.importDroppedFiles).toHaveBeenCalledWith([image], '1', 'drafts')
      const savedTab = workspace.tabs[tabId]
      expect(savedTab?.kind === 'document' ? savedTab.content : '').toContain(
        '![photo.png](photo.png)'
      )
    })
    await flushAsync()
  })

  it('surfaces external editor import failures without inserting a link', async () => {
    const tabId = openDocument('notes/test.md', 'Drop here')
    const tab = workspace.tabs[tabId]
    const archive = new File(['zip'], 'bundle.zip', { type: 'application/zip' })
    mockApi.importDroppedFiles.mockRejectedValue(new Error('Destination is unavailable'))

    const { container } = render(WysiwygEditor, { props: { tabId } })
    await fireEvent.drop(container.querySelector('.ProseMirror')!, {
      dataTransfer: {
        types: ['Files'],
        files: [archive],
        dropEffect: 'none',
        getData: () => ''
      }
    })

    await vi.waitFor(() => {
      expect(mockApi.showMessage).toHaveBeenCalledWith({
        title: 'File Drop Failed',
        message: 'Destination is unavailable',
        type: 'error'
      })
    })
    await flushAsync()
    expect(tab?.kind === 'document' ? tab.content : '').not.toContain('bundle.zip')
  })
})
