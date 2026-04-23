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
  getActiveCollection: vi.fn().mockResolvedValue({ id: '1', name: 'proj', path: '/proj', addedAt: 0, lastOpenedAt: 0 }),
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  openPath: vi.fn().mockResolvedValue(undefined),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null),
}

// Attach mock api to the existing jsdom window so innerHeight, etc. stay defined.
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import { terminalStore } from '@renderer/stores/terminal.svelte'
import { workspace } from '@renderer/stores/workspace.svelte'

function resetTerminalStore(): void {
  // Drain all terminals synchronously — we don't need to wait on disposes
  for (const id of Object.keys(terminalStore.terminals)) {
    void terminalStore.disposeTerminal(id)
  }
  terminalStore.terminals = {}
  terminalStore.panel.open = false
  terminalStore.panel.height = 300
  terminalStore.panel.tabOrder = []
  terminalStore.panel.activeId = null
}

describe('TerminalStore', () => {
  beforeEach(() => {
    workspace.reset()
    resetTerminalStore()
    vi.clearAllMocks()
    mockApi.terminalCreate.mockResolvedValue({ pid: 1234, shell: '/bin/zsh' })
  })

  describe('createTerminal', () => {
    it('adds a running terminal to state after spawn succeeds', async () => {
      const id = await terminalStore.createTerminal({ location: 'panel' })
      expect(id).toBeTruthy()
      const meta = terminalStore.terminals[id as string]
      expect(meta).toBeDefined()
      expect(meta.status).toBe('running')
      expect(meta.pid).toBe(1234)
      expect(meta.location).toBe('panel')
    })

    it('defaults cwd to the active collection path', async () => {
      await terminalStore.createTerminal({ location: 'panel' })
      const call = mockApi.terminalCreate.mock.calls[0][0]
      expect(call.cwd).toBe('/proj')
    })

    it('falls back to the home directory when no collection is active', async () => {
      mockApi.getActiveCollection.mockResolvedValueOnce(null)
      await terminalStore.createTerminal({ location: 'panel' })
      const call = mockApi.terminalCreate.mock.calls[0][0]
      expect(call.cwd).toBe('/home/user')
    })

    it('records an error state when spawn fails', async () => {
      mockApi.terminalCreate.mockRejectedValueOnce(new Error('shell not found'))
      const id = await terminalStore.createTerminal({ location: 'panel' })
      const meta = terminalStore.terminals[id as string]
      expect(meta.status).toBe('error')
      expect(meta.errorMessage).toBe('shell not found')
    })

    it('tracks panel-located terminals in tabOrder and marks them active', async () => {
      const first = await terminalStore.createTerminal({ location: 'panel' })
      const second = await terminalStore.createTerminal({ location: 'panel' })
      expect(terminalStore.panel.tabOrder).toEqual([first, second])
      expect(terminalStore.panel.activeId).toBe(second)
    })
  })

  describe('disposeTerminal', () => {
    it('removes the terminal from state and tabOrder', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      await terminalStore.disposeTerminal(id)
      expect(terminalStore.terminals[id]).toBeUndefined()
      expect(terminalStore.panel.tabOrder).not.toContain(id)
    })

    it('calls the preload API to dispose the PTY', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      await terminalStore.disposeTerminal(id)
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(id)
    })

    it('updates panel.activeId to another terminal when disposing the active one', async () => {
      const a = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const b = (await terminalStore.createTerminal({ location: 'panel' })) as string
      expect(terminalStore.panel.activeId).toBe(b)
      await terminalStore.disposeTerminal(b)
      expect(terminalStore.panel.activeId).toBe(a)
    })
  })

  describe('togglePanel', () => {
    it('flips open state', async () => {
      expect(terminalStore.panel.open).toBe(false)
      await terminalStore.togglePanel()
      expect(terminalStore.panel.open).toBe(true)
      await terminalStore.togglePanel()
      expect(terminalStore.panel.open).toBe(false)
    })

    it('creates a terminal automatically on first open', async () => {
      expect(terminalStore.panel.tabOrder).toHaveLength(0)
      await terminalStore.togglePanel()
      expect(terminalStore.panel.tabOrder.length).toBe(1)
      expect(mockApi.terminalCreate).toHaveBeenCalledTimes(1)
    })

    it('does not create additional terminals on subsequent opens', async () => {
      await terminalStore.togglePanel() // opens, creates 1
      await terminalStore.togglePanel() // closes
      await terminalStore.togglePanel() // reopens, should NOT create again
      expect(mockApi.terminalCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('moveToTab / moveToPanel', () => {
    it('moveToTab flips location and opens a TerminalTab in the active pane', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const tabId = terminalStore.moveToTab(id)
      expect(tabId).toBeTruthy()
      expect(terminalStore.terminals[id].location).toBe('tab')
      expect(terminalStore.panel.tabOrder).not.toContain(id)
      const tab = workspace.tabs[tabId as string]
      expect(tab.kind).toBe('terminal')
    })

    it('moveToPanel flips location back and adds to panel tabOrder', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      terminalStore.moveToTab(id)
      terminalStore.moveToPanel(id)
      expect(terminalStore.terminals[id].location).toBe('panel')
      expect(terminalStore.panel.tabOrder).toContain(id)
      expect(terminalStore.panel.activeId).toBe(id)
    })
  })

  describe('handleExit', () => {
    it('marks the terminal as exited with the exit code', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      terminalStore.handleExit(id, 42)
      const meta = terminalStore.terminals[id]
      expect(meta.status).toBe('exited')
      expect(meta.exitCode).toBe(42)
    })
  })

  describe('setActivePanelTerminal', () => {
    it('updates panel.activeId for a known terminal', async () => {
      const a = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const b = (await terminalStore.createTerminal({ location: 'panel' })) as string
      terminalStore.setActivePanelTerminal(a)
      expect(terminalStore.panel.activeId).toBe(a)
      terminalStore.setActivePanelTerminal(b)
      expect(terminalStore.panel.activeId).toBe(b)
    })

    it('does nothing for an unknown terminal id', async () => {
      const a = (await terminalStore.createTerminal({ location: 'panel' })) as string
      terminalStore.setActivePanelTerminal('unknown-id')
      expect(terminalStore.panel.activeId).toBe(a)
    })
  })

  describe('panelTerminals', () => {
    it('returns only panel-located terminals in tabOrder', async () => {
      const a = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const b = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const list = terminalStore.panelTerminals
      expect(list.map((t) => t.id)).toEqual([a, b])
    })
  })

  describe('setPanelHeight', () => {
    it('clamps to a minimum height of 120px', () => {
      terminalStore.setPanelHeight(50)
      expect(terminalStore.panel.height).toBe(120)
    })

    it('accepts reasonable heights', () => {
      terminalStore.setPanelHeight(400)
      expect(terminalStore.panel.height).toBe(400)
    })
  })

  describe('auto-dispose on terminal tab close', () => {
    it('disposes the PTY when its hosting tab is closed from the workspace', async () => {
      const id = (await terminalStore.createTerminal({ location: 'panel' })) as string
      const tabId = terminalStore.moveToTab(id) as string
      // Sanity: the TerminalTab was actually inserted
      expect(workspace.tabs[tabId]?.kind).toBe('terminal')
      // closeTab triggers workspace.onTabClosed which the terminal store listens on
      const closed = workspace.closeTab(tabId)
      expect(closed?.kind).toBe('terminal')
      // Allow the async dispose (promise chain) to flush
      await new Promise((r) => setTimeout(r, 10))
      expect(mockApi.terminalDispose).toHaveBeenCalledWith(id)
    })
  })
})
