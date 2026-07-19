import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// ── Mock every store module the dispatcher touches ────────────────────
// Factories are self-contained (vi.mock is hoisted); tests grab handles by
// importing the mocked modules below.

vi.mock('@renderer/stores/workspace.svelte', () => ({
  workspace: {
    focusedDocumentTab: { id: 'tab-1' } as { id: string } | undefined,
    focusedTab: { id: 'tab-1', kind: 'document' } as { id: string; kind: string } | undefined,
    createUntitledTab: vi.fn(),
    toggleSplit: vi.fn()
  }
}))

vi.mock('@renderer/stores/files', async () => {
  const { writable } = await import('svelte/store')
  return {
    syncFileStoresFromTab: vi.fn(),
    selectedFilePath: writable<string | null>('notes/a.md'),
    loadFileTree: vi.fn().mockResolvedValue(undefined),
    loadAssetTree: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('@renderer/stores/workspace-actions', () => ({
  closeFocusedTabWithConfirm: vi.fn(),
  reopenLastClosedTab: vi.fn(),
  cycleTab: vi.fn()
}))

vi.mock('@renderer/stores/ui', async () => {
  const { writable } = await import('svelte/store')
  return {
    settingsOpen: writable(false),
    shortcutsModalOpen: writable(false),
    togglePropertiesPanel: vi.fn(),
    toggleSidebar: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn()
  }
})

vi.mock('@renderer/stores/editor', () => ({
  dispatchEditorCommand: vi.fn(),
  requestSave: vi.fn(),
  toggleEditorMode: vi.fn()
}))

vi.mock('@renderer/stores/quickopen', () => ({ openQuickOpen: vi.fn() }))

vi.mock('@renderer/stores/search', async () => {
  const { writable } = await import('svelte/store')
  return { searchOpen: writable(false) }
})

vi.mock('@renderer/stores/graph', async () => {
  const { writable } = await import('svelte/store')
  return {
    graphViewActive: writable(false),
    graphLevel: writable('document'),
    graphColoringMode: writable('cluster'),
    toggleGraphView: vi.fn(),
    openGraphView: vi.fn(),
    setGraphLevel: vi.fn(),
    toggleGraphUnconnectedHighlight: vi.fn(),
    dispatchGraphMenuAction: vi.fn()
  }
})

vi.mock('@renderer/stores/terminal.svelte', () => ({
  terminalStore: {
    createTerminal: vi.fn().mockResolvedValue(null),
    toggleBottomPanel: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@renderer/stores/collections', async () => {
  const { writable } = await import('svelte/store')
  return {
    activeCollection: writable<{ id: string; name: string; path: string } | null>({
      id: 'col-1',
      name: 'Notes',
      path: '/vault'
    }),
    activeCollectionId: writable<string | null>('col-1'),
    setActiveCollection: vi.fn().mockResolvedValue(undefined),
    addAndActivateCollection: vi.fn().mockResolvedValue(null),
    openDoctorModal: vi.fn()
  }
})

vi.mock('@renderer/stores/ingest', () => ({
  runIngest: vi.fn(),
  runPreview: vi.fn(),
  rebuildIndex: vi.fn()
}))

vi.mock('@renderer/stores/watcher', () => ({
  toggleWatcher: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/stores/settings', () => ({ openSettingsSection: vi.fn() }))

vi.mock('@renderer/stores/confirmation', () => ({
  requestConfirmation: vi.fn().mockResolvedValue(true)
}))

vi.mock('@renderer/lib/new-note', () => ({ openNewNotePopup: vi.fn() }))

vi.mock('@renderer/lib/export', () => ({
  exportActiveDocument: vi.fn().mockResolvedValue(undefined)
}))

// window.api surface used by the dispatcher
const mockShowItemInFolder = vi.fn().mockResolvedValue(undefined)
const mockWriteToClipboard = vi.fn().mockResolvedValue(undefined)
const mockOpenPopup = vi.fn().mockResolvedValue(undefined)
vi.stubGlobal('window', {
  api: {
    showItemInFolder: mockShowItemInFolder,
    writeToClipboard: mockWriteToClipboard,
    openPopup: mockOpenPopup
  },
  alert: vi.fn()
})

// ── Import the dispatcher + mocked handles ────────────────────────────

import { handleMenuCommand, menuCommandHandlers } from '@renderer/lib/menu-commands'
import { workspace } from '@renderer/stores/workspace.svelte'
import { syncFileStoresFromTab } from '@renderer/stores/files'
import {
  closeFocusedTabWithConfirm,
  reopenLastClosedTab,
  cycleTab
} from '@renderer/stores/workspace-actions'
import {
  settingsOpen,
  shortcutsModalOpen,
  togglePropertiesPanel,
  toggleSidebar,
  zoomIn
} from '@renderer/stores/ui'
import { dispatchEditorCommand, requestSave, toggleEditorMode } from '@renderer/stores/editor'
import { openQuickOpen } from '@renderer/stores/quickopen'
import { searchOpen } from '@renderer/stores/search'
import {
  dispatchGraphMenuAction,
  graphColoringMode,
  graphLevel,
  graphViewActive,
  openGraphView,
  setGraphLevel,
  toggleGraphUnconnectedHighlight,
  toggleGraphView
} from '@renderer/stores/graph'
import { terminalStore } from '@renderer/stores/terminal.svelte'
import {
  activeCollection,
  setActiveCollection,
  openDoctorModal
} from '@renderer/stores/collections'
import { runIngest, rebuildIndex } from '@renderer/stores/ingest'
import { toggleWatcher } from '@renderer/stores/watcher'
import { openSettingsSection } from '@renderer/stores/settings'
import { openNewNotePopup } from '@renderer/lib/new-note'
import { exportActiveDocument } from '@renderer/lib/export'
import { requestConfirmation } from '@renderer/stores/confirmation'

const workspaceMock = workspace as unknown as {
  focusedDocumentTab: { id: string } | undefined
  focusedTab: { id: string; kind: string } | undefined
  createUntitledTab: ReturnType<typeof vi.fn>
  toggleSplit: ReturnType<typeof vi.fn>
}

describe('handleMenuCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsOpen.set(false)
    searchOpen.set(false)
    shortcutsModalOpen.set(false)
    graphViewActive.set(false)
    graphLevel.set('document')
    graphColoringMode.set('cluster')
    workspaceMock.focusedDocumentTab = { id: 'tab-1' }
    workspaceMock.focusedTab = { id: 'tab-1', kind: 'document' }
    activeCollection.set({ id: 'col-1', name: 'Notes', path: '/vault' })
    vi.mocked(requestConfirmation).mockResolvedValue(true)
  })

  it('routes file commands to the right actions', () => {
    handleMenuCommand({ id: 'file.new-note' })
    expect(openNewNotePopup).toHaveBeenCalled()

    handleMenuCommand({ id: 'file.quick-open' })
    expect(openQuickOpen).toHaveBeenCalled()

    handleMenuCommand({ id: 'file.save' })
    expect(requestSave).toHaveBeenCalled()

    handleMenuCommand({ id: 'file.close-tab' })
    expect(closeFocusedTabWithConfirm).toHaveBeenCalled()

    handleMenuCommand({ id: 'file.reopen-tab' })
    expect(reopenLastClosedTab).toHaveBeenCalled()
  })

  it('syncs file stores after tab-mutating commands', () => {
    handleMenuCommand({ id: 'file.new-untitled' })
    expect(workspaceMock.createUntitledTab).toHaveBeenCalled()
    expect(syncFileStoresFromTab).toHaveBeenCalled()

    vi.mocked(syncFileStoresFromTab).mockClear()
    handleMenuCommand({ id: 'view.split-editor' })
    expect(workspaceMock.toggleSplit).toHaveBeenCalled()
    expect(syncFileStoresFromTab).toHaveBeenCalled()

    vi.mocked(syncFileStoresFromTab).mockClear()
    handleMenuCommand({ id: 'view.toggle-graph' })
    expect(toggleGraphView).toHaveBeenCalled()
    expect(syncFileStoresFromTab).toHaveBeenCalled()
  })

  it('opens the graph idempotently and can pop it into a new window', () => {
    handleMenuCommand({ id: 'graph.open' })
    expect(openGraphView).toHaveBeenCalledOnce()
    expect(syncFileStoresFromTab).toHaveBeenCalled()

    handleMenuCommand({ id: 'graph.open-popup' })
    expect(mockOpenPopup).toHaveBeenCalledWith({
      kind: 'graph',
      collectionId: 'col-1',
      collectionPath: '/vault',
      graphLevel: 'document',
      graphColoringMode: 'cluster'
    })
  })

  it('routes native graph actions only to the focused graph pane', () => {
    handleMenuCommand({ id: 'graph.search' })
    expect(dispatchGraphMenuAction).not.toHaveBeenCalled()

    workspaceMock.focusedTab = { id: 'graph-1', kind: 'graph' }
    for (const [id, action] of [
      ['graph.search', 'search'],
      ['graph.recenter', 'recenter'],
      ['graph.presentation-toggle', 'presentation-toggle'],
      ['graph.presentation-reset', 'presentation-reset'],
      ['graph.toggle-labels', 'toggle-labels'],
      ['graph.toggle-lines', 'toggle-lines'],
      ['graph.toggle-shapes', 'toggle-shapes'],
      ['graph.screenshot', 'screenshot'],
      ['graph.screenshot-transparent', 'screenshot-transparent']
    ] as const) {
      handleMenuCommand({ id })
      expect(dispatchGraphMenuAction).toHaveBeenLastCalledWith(action)
    }

    handleMenuCommand({ id: 'graph.toggle-unconnected' })
    expect(toggleGraphUnconnectedHighlight).toHaveBeenCalledOnce()
  })

  it('validates graph level and coloring payloads', () => {
    workspaceMock.focusedTab = { id: 'graph-1', kind: 'graph' }
    handleMenuCommand({ id: 'graph.set-level', payload: { level: 'chunk' } })
    handleMenuCommand({ id: 'graph.set-coloring', payload: { mode: 'folder' } })
    expect(setGraphLevel).toHaveBeenCalledWith('chunk')
    expect(get(graphColoringMode)).toBe('folder')

    handleMenuCommand({ id: 'graph.set-level', payload: { level: 'invalid' } })
    handleMenuCommand({ id: 'graph.set-coloring', payload: { mode: 'invalid' } })
    expect(setGraphLevel).toHaveBeenCalledOnce()
    expect(get(graphColoringMode)).toBe('folder')
  })

  it('exports with a validated format payload', () => {
    for (const format of ['rtf', 'docx', 'odt', 'epub']) {
      handleMenuCommand({ id: 'file.export', payload: { format } })
      expect(exportActiveDocument).toHaveBeenCalledWith(format)
    }

    vi.mocked(exportActiveDocument).mockClear()
    handleMenuCommand({ id: 'file.export', payload: { format: 'exe' } })
    expect(exportActiveDocument).not.toHaveBeenCalled()

    handleMenuCommand({ id: 'file.save-copy' })
    expect(exportActiveDocument).toHaveBeenCalledWith('markdown')
  })

  it('reveals the current file inside the active collection', () => {
    handleMenuCommand({ id: 'file.reveal-current' })
    expect(mockShowItemInFolder).toHaveBeenCalledWith('/vault/notes/a.md')
  })

  it('dispatches editor commands only with a focused document tab and no settings modal', () => {
    handleMenuCommand({ id: 'format.bold' })
    expect(dispatchEditorCommand).toHaveBeenCalledWith('format.bold', undefined)

    vi.mocked(dispatchEditorCommand).mockClear()
    settingsOpen.set(true)
    handleMenuCommand({ id: 'format.bold' })
    expect(dispatchEditorCommand).not.toHaveBeenCalled()

    settingsOpen.set(false)
    workspaceMock.focusedDocumentTab = undefined
    handleMenuCommand({ id: 'structure.fix-hierarchy' })
    expect(dispatchEditorCommand).not.toHaveBeenCalled()
  })

  it('passes the heading level payload through to the editor', () => {
    handleMenuCommand({ id: 'format.heading', payload: { level: 3 } })
    expect(dispatchEditorCommand).toHaveBeenCalledWith('format.heading', { level: 3 })
  })

  it('routes view toggles', () => {
    handleMenuCommand({ id: 'view.toggle-sidebar' })
    expect(toggleSidebar).toHaveBeenCalled()

    handleMenuCommand({ id: 'view.toggle-properties' })
    expect(togglePropertiesPanel).toHaveBeenCalled()

    handleMenuCommand({ id: 'view.zoom-in' })
    expect(zoomIn).toHaveBeenCalled()

    handleMenuCommand({ id: 'view.next-tab' })
    expect(cycleTab).toHaveBeenCalledWith(1)

    handleMenuCommand({ id: 'view.previous-tab' })
    expect(cycleTab).toHaveBeenCalledWith(-1)
  })

  it('suppresses editor-mode toggle while the graph is active', () => {
    graphViewActive.set(true)
    handleMenuCommand({ id: 'view.toggle-editor-mode' })
    expect(toggleEditorMode).not.toHaveBeenCalled()

    graphViewActive.set(false)
    handleMenuCommand({ id: 'view.toggle-editor-mode' })
    expect(toggleEditorMode).toHaveBeenCalled()
  })

  it('routes collection commands', () => {
    handleMenuCommand({ id: 'collection.switch', payload: { collectionId: 'col-2' } })
    expect(setActiveCollection).toHaveBeenCalledWith('col-2')

    handleMenuCommand({ id: 'collection.sync' })
    expect(runIngest).toHaveBeenCalledWith(false)

    handleMenuCommand({ id: 'collection.reindex' })
    expect(runIngest).toHaveBeenCalledWith(true)

    handleMenuCommand({ id: 'collection.toggle-watcher' })
    expect(toggleWatcher).toHaveBeenCalled()

    handleMenuCommand({ id: 'collection.doctor' })
    expect(openDoctorModal).toHaveBeenCalled()

    handleMenuCommand({ id: 'collection.reveal' })
    expect(mockShowItemInFolder).toHaveBeenCalledWith('/vault')

    handleMenuCommand({ id: 'collection.copy-path' })
    expect(mockWriteToClipboard).toHaveBeenCalledWith('/vault')

    handleMenuCommand({ id: 'collection.open-terminal' })
    expect(terminalStore.createTerminal).toHaveBeenCalledWith({ cwd: '/vault', title: 'Notes' })
  })

  it('gates rebuild behind the shared confirmation dialog', async () => {
    vi.mocked(requestConfirmation).mockResolvedValue(false)
    handleMenuCommand({ id: 'collection.rebuild' })
    await Promise.resolve()
    expect(rebuildIndex).not.toHaveBeenCalled()

    vi.mocked(requestConfirmation).mockResolvedValue(true)
    handleMenuCommand({ id: 'collection.rebuild' })
    await Promise.resolve()
    expect(rebuildIndex).toHaveBeenCalled()
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirmLabel: 'Rebuild Index', tone: 'danger' })
    )
  })

  it('no-ops collection commands without an active collection', () => {
    activeCollection.set(null)
    handleMenuCommand({ id: 'collection.reveal' })
    handleMenuCommand({ id: 'collection.copy-path' })
    handleMenuCommand({ id: 'collection.open-terminal' })
    expect(mockShowItemInFolder).not.toHaveBeenCalled()
    expect(mockWriteToClipboard).not.toHaveBeenCalled()
    expect(terminalStore.createTerminal).not.toHaveBeenCalled()
  })

  it('opens settings sections with resolved targets', () => {
    handleMenuCommand({
      id: 'settings.open',
      payload: { target: 'collection', section: 'clusters' }
    })
    expect(openSettingsSection).toHaveBeenCalledWith('collection', 'clusters')

    handleMenuCommand({ id: 'settings.open', payload: { target: 'global', section: 'cli' } })
    expect(openSettingsSection).toHaveBeenCalledWith('global', 'cli')
  })

  it('opens search and the shortcuts modal', () => {
    handleMenuCommand({ id: 'edit.search' })
    expect(get(searchOpen)).toBe(true)

    handleMenuCommand({ id: 'help.shortcuts' })
    expect(get(shortcutsModalOpen)).toBe(true)
  })

  it('ignores unknown command ids without throwing', () => {
    expect(() => handleMenuCommand({ id: 'nope.not-a-command' })).not.toThrow()
  })

  it('covers every handler id with a function', () => {
    for (const [id, handler] of Object.entries(menuCommandHandlers)) {
      expect(typeof handler, id).toBe('function')
    }
  })
})
