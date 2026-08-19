import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'

const harness = vi.hoisted(() => ({
  snapshots: vi.fn(),
  markSaved: vi.fn(),
  menuHandler: null as ((command: { id: string; payload?: unknown }) => void) | null,
  closeHandler: null as (() => void) | null
}))

const stub = vi.hoisted(() => async (): Promise<{ default: unknown }> => {
  const mod = await import('./stubs/StubComponent.svelte')
  return { default: mod.default }
})

vi.mock('../../src/renderer/components/Editor.svelte', stub)
vi.mock('../../src/renderer/components/WysiwygEditor.svelte', stub)
vi.mock('../../src/renderer/stores/files', () => ({ syncFileStoresFromTab: vi.fn() }))
vi.mock('../../src/renderer/stores/computed-editor-flush', () => ({
  getEditorSnapshots: harness.snapshots,
  markEditorSaved: harness.markSaved
}))
vi.mock('../../src/renderer/lib/menu-commands', () => ({ handleMenuCommand: vi.fn() }))
vi.mock('../../src/renderer/stores/ui', async () => {
  const { writable } = await import('svelte/store')
  return { editorFontSize: writable(17), loadEditorFontSize: vi.fn() }
})
vi.mock('../../src/renderer/stores/accent-color', async () => {
  const { writable } = await import('svelte/store')
  return { primaryVariants: writable({}), loadAccentColors: vi.fn() }
})
vi.mock('../../src/renderer/stores/theme', async () => {
  const { writable } = await import('svelte/store')
  return {
    resolvedTheme: writable('dark'),
    themeTokens: writable({}),
    loadTheme: vi.fn(),
    initSystemPreference: vi.fn(() => vi.fn())
  }
})
vi.mock('../../src/renderer/lib/apply-accent-color', () => ({ applyAccentColor: vi.fn() }))
vi.mock('../../src/renderer/lib/apply-theme', () => ({ applyTheme: vi.fn() }))
vi.mock('../../src/renderer/lib/mermaid-renderer', () => ({ reinitMermaid: vi.fn() }))

const initialDocument = {
  path: '/outside/notes/today.md',
  name: 'today.md',
  directory: '/outside/notes',
  content: '# Today\n\nOriginal text.'
}

const mockApi = {
  getStandaloneDocument: vi.fn().mockResolvedValue(initialDocument),
  saveStandaloneDocument: vi.fn().mockResolvedValue(undefined),
  revealStandaloneDocument: vi.fn().mockResolvedValue(undefined),
  updatePopupTitle: vi.fn().mockResolvedValue(undefined),
  onMenuCommand: vi.fn((callback: (command: { id: string; payload?: unknown }) => void) => {
    harness.menuHandler = callback
  }),
  removeMenuCommandListener: vi.fn(),
  onCloseRequest: vi.fn((callback: () => void) => {
    harness.closeHandler = callback
  }),
  removeCloseRequestListener: vi.fn(),
  showConfirmation: vi.fn().mockResolvedValue(true),
  confirmClose: vi.fn().mockResolvedValue(undefined),
  cancelClose: vi.fn().mockResolvedValue(undefined),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null),
  onTabAttach: vi.fn(),
  removeTabAttachListener: vi.fn()
}

;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import StandaloneShell from '@renderer/components/StandaloneShell.svelte'
import { workspace } from '@renderer/stores/workspace.svelte'

describe('StandaloneShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspace.reset()
    harness.snapshots.mockReturnValue([])
    harness.menuHandler = null
    harness.closeHandler = null
    mockApi.getStandaloneDocument.mockResolvedValue(initialDocument)
    mockApi.saveStandaloneDocument.mockResolvedValue(undefined)
  })

  it('opens an external Markdown file in the No Collection editor shell', async () => {
    const { getByText, getByRole, container } = render(StandaloneShell)

    await waitFor(() => expect(getByText('today.md')).toBeTruthy())

    expect(getByText('No Collection')).toBeTruthy()
    expect(getByText('/outside/notes')).toBeTruthy()
    expect(getByRole('button', { name: 'Editor' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="stub-component"]')).not.toBeNull()
    expect(workspace.focusedDocumentTab?.origin).toBe('standalone')
    expect(workspace.focusedDocumentTab?.standalonePath).toBe(initialDocument.path)
    expect(workspace.focusedDocumentTab?.savedContent).toBe(initialDocument.content)
  })

  it('saves the live editor snapshot against the verified disk baseline', async () => {
    const { getByText, getByRole } = render(StandaloneShell)
    await waitFor(() => expect(getByText('today.md')).toBeTruthy())

    const activeTab = workspace.focusedDocumentTab!
    activeTab.content = '# Today\n\nEdited text.'
    activeTab.isDirty = true
    harness.snapshots.mockReturnValue([{ content: activeTab.content, isDirty: true }])
    await tick()

    await fireEvent.click(getByRole('button', { name: /Save/ }))

    await waitFor(() =>
      expect(mockApi.saveStandaloneDocument).toHaveBeenCalledWith(
        initialDocument.content,
        '# Today\n\nEdited text.'
      )
    )
    expect(harness.markSaved).toHaveBeenCalledWith(activeTab.id, '# Today\n\nEdited text.', true)
    expect(activeTab.savedContent).toBe('# Today\n\nEdited text.')
    expect(activeTab.isDirty).toBe(false)
  })

  it('blocks a stale save and offers to reload the external disk version', async () => {
    const externalDocument = {
      ...initialDocument,
      content: '# Today\n\nChanged by another editor.'
    }
    mockApi.getStandaloneDocument
      .mockResolvedValueOnce(initialDocument)
      .mockResolvedValueOnce(externalDocument)
    mockApi.saveStandaloneDocument.mockRejectedValueOnce(
      new Error('The file changed on disk after this editor opened it')
    )

    const { getByText, getByRole } = render(StandaloneShell)
    await waitFor(() => expect(getByText('today.md')).toBeTruthy())

    const activeTab = workspace.focusedDocumentTab!
    activeTab.content = '# Today\n\nMy unsaved edit.'
    activeTab.isDirty = true
    harness.snapshots.mockReturnValue([{ content: activeTab.content, isDirty: true }])
    await tick()

    await fireEvent.click(getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(getByText('This file changed on disk.')).toBeTruthy())
    expect(getByRole('button', { name: 'Reload from disk' })).toBeTruthy()
    expect(activeTab.savedContent).toBe(initialDocument.content)
    expect(activeTab.isDirty).toBe(true)
    expect(harness.markSaved).not.toHaveBeenCalled()
  })

  it('guards native close requests when the live standalone editor is dirty', async () => {
    const { getByText } = render(StandaloneShell)
    await waitFor(() => expect(getByText('today.md')).toBeTruthy())

    const activeTab = workspace.focusedDocumentTab!
    activeTab.isDirty = true
    harness.snapshots.mockReturnValue([{ content: 'unsaved', isDirty: true }])
    harness.closeHandler?.()

    await waitFor(() => expect(mockApi.showConfirmation).toHaveBeenCalledTimes(1))
    expect(mockApi.showConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Discard and Close', tone: 'danger' })
    )
    await waitFor(() => expect(mockApi.confirmClose).toHaveBeenCalledTimes(1))
  })
})
