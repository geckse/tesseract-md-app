import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockApi = {
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null)
}
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import { workspace, BOTTOM_PANE_ID } from '@renderer/stores/workspace.svelte'
import { openDroppedPath } from '@renderer/lib/drop-payload'

function hardReset(): void {
  for (const [id, tab] of Object.entries(workspace.tabs)) {
    if (tab.kind === 'terminal') workspace.removeTabSilently(id)
  }
  workspace.reset()
}

/** Minimal DataTransfer stand-in for drop-payload routing tests. */
function fakeDataTransfer(data: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? ''
  } as unknown as DataTransfer
}

describe('DnD kind broadening', () => {
  beforeEach(() => {
    hardReset()
  })

  describe('splitAndMoveTab accepts every kind except graph', () => {
    it('splits with an asset tab', () => {
      const id = workspace.openAssetTab('img.png', 'image')
      expect(workspace.splitAndMoveTab(id, 'right')).toBe(true)
      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.panes[workspace.paneOrder[1]].tabOrder).toContain(id)
    })

    it('splits with a table tab', () => {
      const id = workspace.openTableTab('folder')
      expect(workspace.splitAndMoveTab(id, 'right')).toBe(true)
      expect(workspace.panes[workspace.paneOrder[1]].tabOrder).toContain(id)
    })

    it('splits with a terminal tab without disposing its PTY', () => {
      const closed: string[] = []
      workspace.onTabClosed((tab) => closed.push(tab.id))

      const id = workspace.openTerminalTab('pty-1', 'zsh', workspace.paneOrder[0])
      expect(workspace.splitAndMoveTab(id, 'right')).toBe(true)
      expect(workspace.panes[workspace.paneOrder[1]].tabOrder).toContain(id)
      // moveTab fires no close notification — the PTY survives the move
      expect(closed).toEqual([])
    })

    it('refuses the graph tab', () => {
      const graphTabId = workspace.panes[workspace.paneOrder[0]].graphTabId!
      expect(workspace.splitAndMoveTab(graphTabId, 'right')).toBe(false)
      expect(workspace.splitEnabled).toBe(false)
    })
  })

  describe('moveTabToBottomPane accepts every kind', () => {
    it('moves document, asset, table, terminal and graph tabs', () => {
      const editor = workspace.paneOrder[0]
      const ids = [
        workspace.openTab('a.md'),
        workspace.openAssetTab('img.png', 'image'),
        workspace.openTableTab('folder'),
        workspace.openTerminalTab('pty-1', 'zsh', editor),
        workspace.panes[editor].graphTabId!
      ]

      for (const id of ids) {
        expect(workspace.moveTabToBottomPane(id)).toBe(true)
        expect(workspace.bottomPane!.tabOrder).toContain(id)
      }
      // Graph ownership moved along
      expect(workspace.bottomPane!.graphTabId).toBe(ids[4])
      expect(workspace.panes[editor].graphTabId).toBeNull()
    })

    it('does not fire close notifications when moving a terminal', () => {
      const closed: string[] = []
      workspace.onTabClosed((tab) => closed.push(tab.id))

      const id = workspace.openTerminalTab('pty-1', 'zsh', workspace.paneOrder[0])
      workspace.moveTabToBottomPane(id)
      expect(closed).toEqual([])
    })
  })

  describe('openDroppedPath routing', () => {
    it('uses the explicit asset payload when present', () => {
      const dt = fakeDataTransfer({
        'application/x-mdvdb-path': 'media/photo.png',
        'application/x-mdvdb-asset': JSON.stringify({ mimeCategory: 'image', fileSize: 1234 })
      })
      const tabId = openDroppedPath(dt, workspace.paneOrder[0])
      const tab = workspace.tabs[tabId]
      expect(tab.kind).toBe('asset')
      if (tab.kind === 'asset') {
        expect(tab.mimeCategory).toBe('image')
        expect(tab.fileSize).toBe(1234)
      }
    })

    it('detects asset extensions without an explicit payload', () => {
      const dt = fakeDataTransfer({ 'application/x-mdvdb-path': 'docs/report.pdf' })
      const tabId = openDroppedPath(dt, workspace.paneOrder[0])
      expect(workspace.tabs[tabId].kind).toBe('asset')
    })

    it('opens markdown files as document tabs', () => {
      const dt = fakeDataTransfer({ 'application/x-mdvdb-path': 'notes/a.md' })
      const tabId = openDroppedPath(dt, workspace.paneOrder[0])
      expect(workspace.tabs[tabId].kind).toBe('document')
    })

    it('opens into the bottom pane when targeted there', () => {
      const dt = fakeDataTransfer({ 'application/x-mdvdb-path': 'notes/a.md' })
      const tabId = openDroppedPath(dt, BOTTOM_PANE_ID)
      expect(workspace.bottomPane!.tabOrder).toContain(tabId)
    })

    it('returns empty string when the drag has no path', () => {
      const dt = fakeDataTransfer({ 'text/plain': 'some-tab-id' })
      expect(openDroppedPath(dt, workspace.paneOrder[0])).toBe('')
    })
  })
})
