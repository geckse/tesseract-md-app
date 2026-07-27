import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const mockApi = {
  createBinary: vi.fn().mockResolvedValue({ size: 4 }),
  readBinary: vi.fn().mockResolvedValue('AQIDBA=='),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  schema: vi.fn().mockResolvedValue({ fields: [], scopes: [] }),
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
    mockApi.readBinary.mockResolvedValue('AQIDBA==')
    mockApi.schema.mockResolvedValue({ fields: [], scopes: [] })
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
})
