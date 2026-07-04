import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing the store — the constructor wires IPC
// listeners via window.api, so the bridge must exist at import time.
const mockApi = {
  terminalCreate: vi.fn().mockResolvedValue({ pid: 1234, shell: '/bin/zsh' }),
  terminalDispose: vi.fn().mockResolvedValue(undefined),
  terminalWrite: vi.fn().mockResolvedValue(undefined),
  terminalResize: vi.fn().mockResolvedValue(undefined),
  terminalList: vi.fn().mockResolvedValue([]),
  onTerminalData: vi.fn(() => (): void => {}),
  onTerminalExit: vi.fn(() => (): void => {}),
  onTerminalTitle: vi.fn(() => (): void => {}),
  removeTerminalDataListener: vi.fn(),
  removeTerminalExitListener: vi.fn(),
  removeTerminalTitleListener: vi.fn(),
  getActiveCollection: vi
    .fn()
    .mockResolvedValue({ id: '1', name: 'proj', path: '/proj', addedAt: 0, lastOpenedAt: 0 }),
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  openPath: vi.fn().mockResolvedValue(undefined),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null)
}

// Attach mock api to the existing jsdom window so innerHeight, etc. stay defined.
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import { terminalStore } from '@renderer/stores/terminal.svelte'
import { workspace, BOTTOM_PANE_ID } from '@renderer/stores/workspace.svelte'

function resetStores(): void {
  // Drain all terminals synchronously — we don't need to wait on disposes
  for (const id of Object.keys(terminalStore.terminals)) {
    void terminalStore.disposeTerminal(id)
  }
  terminalStore.terminals = {}
  // workspace.reset() keeps terminal tabs alive by design — drop them first
  for (const [id, tab] of Object.entries(workspace.tabs)) {
    if (tab.kind === 'terminal') workspace.removeTabSilently(id)
  }
  workspace.reset()
}

/** Tab order of the bottom pane. */
function bottomTabs(): string[] {
  return workspace.bottomPane?.tabOrder ?? []
}

describe('TerminalStore', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
    mockApi.terminalCreate.mockResolvedValue({ pid: 1234, shell: '/bin/zsh' })
  })

  describe('createTerminal', () => {
    it('adds a running terminal and hosts it in a bottom-pane tab', async () => {
      const result = await terminalStore.createTerminal()
      expect(result).not.toBeNull()
      const { terminalId, tabId } = result!

      const meta = terminalStore.terminals[terminalId]
      expect(meta.status).toBe('running')
      expect(meta.pid).toBe(1234)

      expect(bottomTabs()).toContain(tabId)
      expect(workspace.tabs[tabId]?.kind).toBe('terminal')
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)
    })

    it('honors an explicit paneId', async () => {
      const editorPane = workspace.paneOrder[0]
      const result = await terminalStore.createTerminal({ paneId: editorPane })
      expect(workspace.panes[editorPane].tabOrder).toContain(result!.tabId)
      expect(bottomTabs()).not.toContain(result!.tabId)
    })

    it('defaults cwd to the active collection path', async () => {
      await terminalStore.createTerminal()
      const call = mockApi.terminalCreate.mock.calls[0][0]
      expect(call.cwd).toBe('/proj')
    })

    it('falls back to the home directory when no collection is active', async () => {
      mockApi.getActiveCollection.mockResolvedValueOnce(null)
      await terminalStore.createTerminal()
      const call = mockApi.terminalCreate.mock.calls[0][0]
      expect(call.cwd).toBe('/home/user')
    })

    it('records an error state when spawn fails but keeps the tab', async () => {
      mockApi.terminalCreate.mockRejectedValueOnce(new Error('shell not found'))
      const result = await terminalStore.createTerminal()
      const meta = terminalStore.terminals[result!.terminalId]
      expect(meta.status).toBe('error')
      expect(meta.errorMessage).toBe('shell not found')
      expect(workspace.tabs[result!.tabId]).toBeDefined()
    })

    it('mirrors the spawned shell title onto the workspace tab', async () => {
      const result = await terminalStore.createTerminal()
      const tab = workspace.tabs[result!.tabId]
      expect(tab.kind).toBe('terminal')
      expect(tab.title).toMatch(/^zsh — \d+$/)
    })
  })

  describe('disposeTerminal', () => {
    it('removes the terminal from state', async () => {
      const { terminalId } = (await terminalStore.createTerminal())!
      await terminalStore.disposeTerminal(terminalId)
      expect(terminalStore.terminals[terminalId]).toBeUndefined()
    })

    it('calls the preload API to dispose the PTY', async () => {
      const { terminalId } = (await terminalStore.createTerminal())!
      await terminalStore.disposeTerminal(terminalId)
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(terminalId)
    })
  })

  describe('toggleBottomPanel', () => {
    it('creates a terminal automatically on first open', async () => {
      expect(workspace.bottomPaneOpen).toBe(false)
      await terminalStore.toggleBottomPanel()
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(bottomTabs()).toHaveLength(1)
      expect(mockApi.terminalCreate).toHaveBeenCalledTimes(1)
    })

    it('closes on second toggle, keeping the tab alive', async () => {
      await terminalStore.toggleBottomPanel()
      await terminalStore.toggleBottomPanel()
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(bottomTabs()).toHaveLength(1)
    })

    it('does not create additional terminals on subsequent opens', async () => {
      await terminalStore.toggleBottomPanel() // opens, creates 1
      await terminalStore.toggleBottomPanel() // closes
      await terminalStore.toggleBottomPanel() // reopens, should NOT create again
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(mockApi.terminalCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('newBottomTerminal', () => {
    it('always spawns a fresh terminal in the bottom pane', async () => {
      await terminalStore.newBottomTerminal()
      await terminalStore.newBottomTerminal()
      expect(bottomTabs()).toHaveLength(2)
      expect(mockApi.terminalCreate).toHaveBeenCalledTimes(2)
    })
  })

  describe('killAllInBottomPane', () => {
    it('closes all bottom terminal tabs and disposes their PTYs', async () => {
      const a = (await terminalStore.createTerminal())!
      const b = (await terminalStore.createTerminal())!
      mockApi.terminalDispose.mockClear()

      terminalStore.killAllInBottomPane()
      await new Promise((r) => setTimeout(r, 10))

      expect(bottomTabs()).toHaveLength(0)
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(a.terminalId)
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(b.terminalId)
      expect(workspace.bottomPaneOpen).toBe(false)
    })

    it('leaves non-terminal tabs in the bottom pane alone', async () => {
      await terminalStore.createTerminal()
      const docId = workspace.openTab('a.md')
      workspace.moveTabToBottomPane(docId)

      terminalStore.killAllInBottomPane()

      expect(bottomTabs()).toEqual([docId])
    })
  })

  describe('handleExit', () => {
    it('marks the terminal as exited with the exit code', async () => {
      const { terminalId } = (await terminalStore.createTerminal())!
      terminalStore.handleExit(terminalId, 42)
      const meta = terminalStore.terminals[terminalId]
      expect(meta.status).toBe('exited')
      expect(meta.exitCode).toBe(42)
    })
  })

  describe('auto-dispose on terminal tab close', () => {
    it('disposes the PTY when its hosting tab is closed from the workspace', async () => {
      const { terminalId, tabId } = (await terminalStore.createTerminal())!
      mockApi.terminalDispose.mockClear()

      const closed = workspace.closeTab(tabId)
      expect(closed?.kind).toBe('terminal')
      // Allow the async dispose (promise chain) to flush
      await new Promise((r) => setTimeout(r, 10))
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(terminalId)
    })
  })

  describe('cross-window transfer (adopt / release)', () => {
    it('adoptTerminal rebinds the live PTY and stages its scrollback', async () => {
      mockApi.terminalRebind = vi
        .fn()
        .mockResolvedValue({ scrollback: 'previous output', shell: '/bin/zsh', cwd: '/proj' })

      await terminalStore.adoptTerminal({
        terminalId: 'moved-1',
        title: 'zsh',
        shell: '/bin/zsh',
        cwd: '/proj'
      })

      expect(mockApi.terminalRebind).toHaveBeenCalledWith('moved-1')
      expect(terminalStore.terminals['moved-1']?.status).toBe('running')
      expect(terminalStore.pendingScrollback('moved-1')).toBe('previous output')

      // xterm consumes the staged scrollback exactly once
      expect(terminalStore.takePendingScrollback('moved-1')).toBe('previous output')
      expect(terminalStore.takePendingScrollback('moved-1')).toBeNull()
    })

    it('adoptTerminal respawns from shell+cwd when the PTY is gone', async () => {
      mockApi.terminalRebind = vi.fn().mockRejectedValue(new Error('Terminal not found'))
      mockApi.terminalCreate.mockClear()

      await terminalStore.adoptTerminal({
        terminalId: 'dead-1',
        title: 'zsh',
        shell: '/bin/zsh',
        cwd: '/proj'
      })

      expect(mockApi.terminalCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dead-1', cwd: '/proj', shell: '/bin/zsh' })
      )
      expect(terminalStore.terminals['dead-1']?.status).toBe('running')
    })

    it('releaseTerminal drops local state WITHOUT disposing the PTY', async () => {
      const { terminalId } = (await terminalStore.createTerminal())!
      mockApi.terminalDispose.mockClear()

      terminalStore.releaseTerminal(terminalId)

      expect(terminalStore.terminals[terminalId]).toBeUndefined()
      expect(mockApi.terminalDispose).not.toHaveBeenCalled()
    })
  })

  describe('detachTab hands the terminal off without killing it', () => {
    it('removes the tab + meta, calls the detach IPC, and never disposes', async () => {
      mockApi.detachTab = vi.fn().mockResolvedValue(undefined)
      const { terminalId, tabId } = (await terminalStore.createTerminal())!
      mockApi.terminalDispose.mockClear()

      const data = await workspace.detachTab(tabId)

      expect(data).toEqual(expect.objectContaining({ kind: 'terminal', terminalId, cwd: '/proj' }))
      expect(mockApi.detachTab).toHaveBeenCalledWith(data)
      expect(workspace.tabs[tabId]).toBeUndefined()
      expect(terminalStore.terminals[terminalId]).toBeUndefined() // released, not disposed
      expect(mockApi.terminalDispose).not.toHaveBeenCalled()
      // Detaching the last bottom tab hides the (now empty) pane
      expect(workspace.bottomPaneOpen).toBe(false)
    })
  })
})
