import { describe, it, expect, beforeEach } from 'vitest'
import {
  workspace,
  BOTTOM_PANE_ID,
  MIN_BOTTOM_PANE_HEIGHT
} from '@renderer/stores/workspace.svelte'

/** Get the first (default) editor pane ID. */
function editorPaneId(): string {
  return workspace.paneOrder[0]
}

describe('Bottom pane', () => {
  beforeEach(() => {
    // reset() deliberately keeps terminal tabs alive (collection-switch
    // semantics), so drop them first for a clean slate per test.
    for (const [id, tab] of Object.entries(workspace.tabs)) {
      if (tab.kind === 'terminal') workspace.removeTabSilently(id)
    }
    workspace.reset()
  })

  describe('initial state', () => {
    it('exists alongside the editor pane but not in paneOrder', () => {
      expect(workspace.bottomPane).toBeDefined()
      expect(workspace.bottomPane!.tabOrder).toEqual([])
      expect(workspace.paneOrder).not.toContain(BOTTOM_PANE_ID)
    })

    it('starts hidden with the default height', () => {
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(workspace.bottomPaneHeight).toBe(300)
    })

    it('has no graph tab', () => {
      expect(workspace.bottomPane!.graphTabId).toBeNull()
    })
  })

  describe('terminal targeting', () => {
    it('opens terminal tabs in the bottom pane by default and reveals it', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      expect(workspace.bottomPane!.tabOrder).toContain(tabId)
      expect(workspace.bottomPane!.activeTabId).toBe(tabId)
      expect(workspace.bottomPaneOpen).toBe(true)
    })

    it('honors an explicit editor paneId for terminal tabs', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh', editorPaneId())
      expect(workspace.panes[editorPaneId()].tabOrder).toContain(tabId)
      expect(workspace.bottomPane!.tabOrder).not.toContain(tabId)
      expect(workspace.bottomPaneOpen).toBe(false)
    })
  })

  describe('file-open targeting while the bottom pane is focused', () => {
    it('routes openFile to the last-active editor pane, not the bottom pane', () => {
      const editor = editorPaneId()
      workspace.openTerminalTab('term-1', 'zsh')
      // Focus follows the terminal into the bottom pane
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)

      const tabId = workspace.openFile('notes/a.md')
      expect(workspace.panes[editor].tabOrder).toContain(tabId)
      expect(workspace.bottomPane!.tabOrder).not.toContain(tabId)
    })

    it('routes openTab, openTableTab and createUntitledTab to the editor pane', () => {
      const editor = editorPaneId()
      workspace.openTerminalTab('term-1', 'zsh')
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)

      const doc = workspace.openTab('b.md')
      const table = workspace.openTableTab('folder')
      const untitled = workspace.createUntitledTab()
      for (const id of [doc, table, untitled]) {
        expect(workspace.panes[editor].tabOrder).toContain(id)
      }
    })

    it('defaultEditorPaneId returns the active pane when it is an editor pane', () => {
      expect(workspace.defaultEditorPaneId).toBe(editorPaneId())
    })
  })

  describe('moveTab / moveTabToBottomPane', () => {
    it('moving a tab into the hidden bottom pane reveals it', () => {
      const tabId = workspace.openTab('a.md')
      expect(workspace.bottomPaneOpen).toBe(false)

      const moved = workspace.moveTab(tabId, editorPaneId(), BOTTOM_PANE_ID)
      expect(moved).toBe(true)
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(workspace.bottomPane!.activeTabId).toBe(tabId)
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)
    })

    it('moveTabToBottomPane works for document, asset and table tabs', () => {
      const doc = workspace.openTab('a.md')
      const asset = workspace.openAssetTab('img.png', 'image')
      const table = workspace.openTableTab('folder')

      for (const id of [doc, asset, table]) {
        expect(workspace.moveTabToBottomPane(id)).toBe(true)
        expect(workspace.bottomPane!.tabOrder).toContain(id)
      }
    })

    it('moveTabToBottomPane is a no-op for tabs already in the bottom pane', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      expect(workspace.moveTabToBottomPane(tabId)).toBe(false)
    })
  })

  describe('graph tab in the bottom pane', () => {
    it('moveTab transfers graphTabId into the bottom pane', () => {
      const editor = editorPaneId()
      const graphTabId = workspace.panes[editor].graphTabId!

      const moved = workspace.moveTab(graphTabId, editor, BOTTOM_PANE_ID)
      expect(moved).toBe(true)
      expect(workspace.panes[editor].graphTabId).toBeNull()
      expect(workspace.bottomPane!.graphTabId).toBe(graphTabId)
    })

    it('switchToGraphTab finds the graph in the bottom pane and reveals it', () => {
      const editor = editorPaneId()
      const graphTabId = workspace.panes[editor].graphTabId!
      workspace.moveTab(graphTabId, editor, BOTTOM_PANE_ID)
      workspace.setBottomPaneOpen(false)
      workspace.setActivePane(editor)

      workspace.switchToGraphTab()
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)
      expect(workspace.bottomPane!.activeTabId).toBe(graphTabId)
      expect(workspace.bottomPaneOpen).toBe(true)
    })

    it('openTabFromGraph opens into an editor pane without splitting when graph is in bottom', () => {
      const editor = editorPaneId()
      const graphTabId = workspace.panes[editor].graphTabId!
      workspace.moveTab(graphTabId, editor, BOTTOM_PANE_ID)

      const tabId = workspace.openTabFromGraph('a.md')
      expect(workspace.splitEnabled).toBe(false)
      expect(workspace.panes[editor].tabOrder).toContain(tabId)
    })
  })

  describe('emptying the bottom pane', () => {
    it('auto-hides when the last tab is closed and refocuses the editor pane', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      expect(workspace.bottomPaneOpen).toBe(true)

      workspace.closeTab(tabId)
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(workspace.activePaneId).toBe(editorPaneId())
    })

    it('does not collapse the editor split when the bottom pane empties', () => {
      workspace.toggleSplit()
      expect(workspace.splitEnabled).toBe(true)

      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      workspace.closeTab(tabId)

      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.paneOrder).toHaveLength(2)
      expect(workspace.bottomPaneOpen).toBe(false)
    })

    it('auto-hides when the last tab is moved out', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      workspace.moveTab(tabId, BOTTOM_PANE_ID, editorPaneId())
      expect(workspace.bottomPaneOpen).toBe(false)
    })

    it('auto-hides when the last tab is silently removed (detach to popup)', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      workspace.removeTabSilently(tabId)
      expect(workspace.bottomPaneOpen).toBe(false)
    })
  })

  describe('visibility', () => {
    it('hiding keeps the tabs alive', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      workspace.setBottomPaneOpen(false)
      expect(workspace.bottomPane!.tabOrder).toContain(tabId)
      expect(workspace.tabs[tabId]).toBeDefined()
    })

    it('hiding while focused moves focus to an editor pane', () => {
      workspace.openTerminalTab('term-1', 'zsh')
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)
      workspace.setBottomPaneOpen(false)
      expect(workspace.activePaneId).toBe(editorPaneId())
    })

    it('switchTab to a bottom tab reveals the pane', () => {
      const tabId = workspace.openTerminalTab('term-1', 'zsh')
      workspace.setBottomPaneOpen(false)
      workspace.switchTab(tabId)
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(workspace.activePaneId).toBe(BOTTOM_PANE_ID)
    })

    it('clamps the height to the minimum', () => {
      workspace.setBottomPaneHeight(10)
      expect(workspace.bottomPaneHeight).toBe(MIN_BOTTOM_PANE_HEIGHT)
    })
  })

  describe('reset (collection switch)', () => {
    it('keeps terminal tabs, regrouped in the bottom pane', () => {
      const bottomTerm = workspace.openTerminalTab('term-1', 'zsh')
      const editorTerm = workspace.openTerminalTab('term-2', 'zsh', editorPaneId())
      workspace.openTab('a.md')

      workspace.reset()

      expect(workspace.bottomPane!.tabOrder).toHaveLength(2)
      expect(workspace.bottomPane!.tabOrder).toEqual(
        expect.arrayContaining([bottomTerm, editorTerm])
      )
      expect(workspace.tabs[bottomTerm]).toBeDefined()
      expect(workspace.tabs[editorTerm]).toBeDefined()
      // Non-terminal tabs are gone
      const kinds = Object.values(workspace.tabs).map((t) => t.kind)
      expect(kinds.filter((k) => k === 'document')).toHaveLength(0)
    })

    it('closes the bottom pane when no terminals survive', () => {
      workspace.openTerminalTab('term-1', 'zsh')
      workspace.closeTab(workspace.bottomPane!.tabOrder[0])
      workspace.openTerminalTab('term-2', 'zsh')
      workspace.closeTab(workspace.bottomPane!.tabOrder[0])
      workspace.openTab('a.md')

      workspace.reset()
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(workspace.bottomPane!.tabOrder).toEqual([])
    })
  })
})
