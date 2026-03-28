import { describe, it, expect, beforeEach } from 'vitest'
import { workspace } from '@renderer/stores/workspace.svelte'
import type { DocumentTab, TabState } from '@renderer/stores/workspace.svelte'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Get the first (default) pane ID from the workspace. */
function getDefaultPaneId(): string {
  return workspace.paneOrder[0]
}

/** Get the pane state for a given pane ID. */
function getPane(paneId: string) {
  return workspace.panes[paneId]
}

/** Get the graph tab ID for a given pane. */
function getGraphTabId(paneId: string): string {
  const pane = getPane(paneId)
  return pane?.graphTabId ?? ''
}

/** Assert a tab is a DocumentTab and return it typed. */
function asDocTab(tab: TabState | undefined): DocumentTab {
  expect(tab).toBeDefined()
  expect(tab!.kind).toBe('document')
  return tab as DocumentTab
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('WorkspaceStore', () => {
  beforeEach(() => {
    workspace.reset()
  })

  describe('initial state', () => {
    it('starts with one pane', () => {
      expect(workspace.paneOrder).toHaveLength(1)
      expect(Object.keys(workspace.panes)).toHaveLength(1)
    })

    it('starts with activePaneId set to the default pane', () => {
      expect(workspace.activePaneId).toBe(getDefaultPaneId())
    })

    it('starts with a pinned graph tab in the default pane', () => {
      const paneId = getDefaultPaneId()
      const pane = getPane(paneId)
      expect(pane.tabOrder).toHaveLength(1)
      expect(pane.graphTabId).toBe(pane.tabOrder[0])

      const graphTab = workspace.tabs[pane.graphTabId]
      expect(graphTab).toBeDefined()
      expect(graphTab.kind).toBe('graph')
      expect(graphTab.title).toBe('Graph')
    })

    it('starts with no active tab (activeTabId is null)', () => {
      const paneId = getDefaultPaneId()
      const pane = getPane(paneId)
      expect(pane.activeTabId).toBeNull()
    })

    it('starts with splitEnabled false', () => {
      expect(workspace.splitEnabled).toBe(false)
    })

    it('starts with splitRatio 0.5', () => {
      expect(workspace.splitRatio).toBe(0.5)
    })
  })

  describe('openTab', () => {
    it('creates a new document tab for a file path', () => {
      const tabId = workspace.openTab('notes/readme.md')
      expect(tabId).toBeTruthy()

      const tab = workspace.tabs[tabId]
      expect(tab).toBeDefined()
      expect(tab.kind).toBe('document')

      const docTab = asDocTab(tab)
      expect(docTab.filePath).toBe('notes/readme.md')
      expect(docTab.title).toBe('readme.md')
      expect(docTab.isDirty).toBe(false)
      expect(docTab.editorMode).toBe('wysiwyg')
      expect(docTab.content).toBeNull()
      expect(docTab.contentLoading).toBe(false)
      expect(docTab.contentError).toBeNull()
      expect(docTab.scrollPosition).toBe(0)
      expect(docTab.cursorPosition).toBe(0)
      expect(docTab.wordCount).toBe(0)
      expect(docTab.tokenCount).toBe(0)
    })

    it('sets the new tab as the active tab', () => {
      const tabId = workspace.openTab('notes/readme.md')
      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBe(tabId)
    })

    it('inserts the tab before the pinned graph tab', () => {
      const paneId = getDefaultPaneId()
      const graphTabId = getGraphTabId(paneId)

      workspace.openTab('file-a.md')
      workspace.openTab('file-b.md')

      const pane = getPane(paneId)
      const lastTabId = pane.tabOrder[pane.tabOrder.length - 1]
      expect(lastTabId).toBe(graphTabId)
    })

    it('maintains tab insertion order before graph tab', () => {
      const paneId = getDefaultPaneId()
      const graphTabId = getGraphTabId(paneId)

      const tabA = workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      const tabC = workspace.openTab('c.md')

      const pane = getPane(paneId)
      expect(pane.tabOrder).toEqual([tabA, tabB, tabC, graphTabId])
    })

    it('reuses an existing tab when opening the same file', () => {
      const tabId1 = workspace.openTab('notes/readme.md')
      const tabId2 = workspace.openTab('notes/readme.md')
      expect(tabId2).toBe(tabId1)
    })

    it('does not create a duplicate tab for the same file', () => {
      workspace.openTab('notes/readme.md')
      workspace.openTab('notes/readme.md')

      const paneId = getDefaultPaneId()
      const docTabs = workspace.getDocumentTabs(paneId)
      expect(docTabs).toHaveLength(1)
    })

    it('switches to the existing tab when opening the same file', () => {
      const tabId1 = workspace.openTab('a.md')
      workspace.openTab('b.md')

      // Now 'b.md' is active; opening 'a.md' should switch back
      workspace.openTab('a.md')
      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBe(tabId1)
    })

    it('creates separate tabs for different files', () => {
      const tabId1 = workspace.openTab('file-a.md')
      const tabId2 = workspace.openTab('file-b.md')
      expect(tabId1).not.toBe(tabId2)

      const paneId = getDefaultPaneId()
      const docTabs = workspace.getDocumentTabs(paneId)
      expect(docTabs).toHaveLength(2)
    })

    it('opens a tab in a specific pane when paneId is provided', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]

      const tabId = workspace.openTab('test.md', pane2Id)
      const pane2 = getPane(pane2Id)
      expect(pane2.tabOrder).toContain(tabId)
      expect(pane2.activeTabId).toBe(tabId)
    })

    it('returns empty string for an invalid pane ID', () => {
      const tabId = workspace.openTab('test.md', 'nonexistent-pane')
      expect(tabId).toBe('')
    })

    it('initializes per-tab navigation with the file path as current', () => {
      const tabId = workspace.openTab('docs/guide.md')
      const tab = asDocTab(workspace.tabs[tabId])
      expect(tab.navigation.current).toBe('docs/guide.md')
      expect(tab.navigation.backStack).toEqual([])
      expect(tab.navigation.forwardStack).toEqual([])
    })

    it('extracts filename from nested path for title', () => {
      const tabId = workspace.openTab('docs/guides/getting-started.md')
      const tab = asDocTab(workspace.tabs[tabId])
      expect(tab.title).toBe('getting-started.md')
    })
  })

  describe('closeTab', () => {
    it('removes the tab from the pane', () => {
      const tabId = workspace.openTab('file.md')
      workspace.closeTab(tabId)

      const pane = getPane(getDefaultPaneId())
      expect(pane.tabOrder).not.toContain(tabId)
    })

    it('removes the tab from the tabs record', () => {
      const tabId = workspace.openTab('file.md')
      workspace.closeTab(tabId)

      expect(workspace.tabs[tabId]).toBeUndefined()
    })

    it('returns the closed tab state', () => {
      const tabId = workspace.openTab('file.md')
      const closedTab = workspace.closeTab(tabId)

      expect(closedTab).not.toBeNull()
      expect(closedTab!.kind).toBe('document')
      expect((closedTab as DocumentTab).filePath).toBe('file.md')
    })

    it('activates the nearest tab when closing the active tab', () => {
      workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      const tabC = workspace.openTab('c.md')

      // c.md is the active tab
      expect(getPane(getDefaultPaneId()).activeTabId).toBe(tabC)

      // Close c.md — b.md should become active (nearest document tab)
      workspace.closeTab(tabC)
      expect(getPane(getDefaultPaneId()).activeTabId).toBe(tabB)
    })

    it('sets activeTabId to null when closing the last document tab', () => {
      const tabId = workspace.openTab('only-file.md')
      workspace.closeTab(tabId)

      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBeNull()
    })

    it('cannot close the pinned graph tab', () => {
      const paneId = getDefaultPaneId()
      const graphTabId = getGraphTabId(paneId)

      const result = workspace.closeTab(graphTabId)
      expect(result).toBeNull()

      const pane = getPane(paneId)
      expect(pane.tabOrder).toContain(graphTabId)
    })

    it('returns null for a nonexistent tab ID', () => {
      const result = workspace.closeTab('nonexistent-tab-id')
      expect(result).toBeNull()
    })

    it('handles closing a non-active tab without changing the active tab', () => {
      const tabA = workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      // b.md is now active
      expect(getPane(getDefaultPaneId()).activeTabId).toBe(tabB)

      workspace.closeTab(tabA)
      // b.md should still be active
      expect(getPane(getDefaultPaneId()).activeTabId).toBe(tabB)
    })

    it('closes tab in specified pane', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      const tabId = workspace.openTab('test.md', pane2Id)

      workspace.closeTab(tabId, pane2Id)
      const pane2 = getPane(pane2Id)
      expect(pane2.tabOrder).not.toContain(tabId)
    })
  })

  describe('switchTab', () => {
    it('updates activeTabId to the specified tab', () => {
      const tabA = workspace.openTab('a.md')
      workspace.openTab('b.md')

      workspace.switchTab(tabA)
      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBe(tabA)
    })

    it('can switch to the graph tab', () => {
      workspace.openTab('file.md')
      const paneId = getDefaultPaneId()
      const graphTabId = getGraphTabId(paneId)

      workspace.switchTab(graphTabId)
      const pane = getPane(paneId)
      expect(pane.activeTabId).toBe(graphTabId)
    })

    it('does nothing for a tab not in the pane', () => {
      const tabA = workspace.openTab('a.md')
      workspace.switchTab('nonexistent-tab-id')

      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBe(tabA)
    })

    it('updates activePaneId to the tab pane', () => {
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      const tabInPane2 = workspace.openTab('file.md', pane2Id)
      workspace.setActivePane(pane1Id)
      expect(workspace.activePaneId).toBe(pane1Id)

      workspace.switchTab(tabInPane2)
      expect(workspace.activePaneId).toBe(pane2Id)
    })

    it('can switch to a tab in a specific pane', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      const tabId = workspace.openTab('test.md', pane2Id)

      workspace.switchTab(tabId, pane2Id)
      expect(getPane(pane2Id).activeTabId).toBe(tabId)
    })
  })

  describe('setActivePane', () => {
    it('updates the activePaneId', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]

      workspace.setActivePane(pane2Id)
      expect(workspace.activePaneId).toBe(pane2Id)
    })

    it('does nothing for an invalid pane ID', () => {
      const originalPaneId = workspace.activePaneId
      workspace.setActivePane('nonexistent-pane')
      expect(workspace.activePaneId).toBe(originalPaneId)
    })

    it('can switch focus back to the first pane', () => {
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      workspace.setActivePane(pane2Id)
      expect(workspace.activePaneId).toBe(pane2Id)

      workspace.setActivePane(pane1Id)
      expect(workspace.activePaneId).toBe(pane1Id)
    })
  })

  describe('toggleSplit', () => {
    it('creates a second pane when enabling split', () => {
      expect(workspace.paneOrder).toHaveLength(1)

      workspace.toggleSplit()

      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.paneOrder).toHaveLength(2)
      expect(Object.keys(workspace.panes)).toHaveLength(2)
    })

    it('second pane has its own graph tab', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      const pane2 = getPane(pane2Id)

      expect(pane2.graphTabId).toBeTruthy()
      const graphTab = workspace.tabs[pane2.graphTabId]
      expect(graphTab).toBeDefined()
      expect(graphTab.kind).toBe('graph')
    })

    it('merges tabs from second pane into first when disabling split', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]

      // Open a tab in the second pane
      workspace.openTab('pane2-file.md', pane2Id)

      workspace.toggleSplit()

      expect(workspace.splitEnabled).toBe(false)
      expect(workspace.paneOrder).toHaveLength(1)

      // The file from pane 2 should now be in pane 1
      const pane1Id = workspace.paneOrder[0]
      const docTabs = workspace.getDocumentTabs(pane1Id)
      const filePaths = docTabs.map((t) => t.filePath)
      expect(filePaths).toContain('pane2-file.md')
    })

    it('removes the second pane graph tab on collapse', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      const pane2GraphId = getGraphTabId(pane2Id)

      workspace.toggleSplit()

      expect(workspace.tabs[pane2GraphId]).toBeUndefined()
    })

    it('toggles back to split after collapsing', () => {
      workspace.toggleSplit()
      expect(workspace.splitEnabled).toBe(true)

      workspace.toggleSplit()
      expect(workspace.splitEnabled).toBe(false)

      workspace.toggleSplit()
      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.paneOrder).toHaveLength(2)
    })

    it('keeps focus on primary pane when secondary was not focused', () => {
      const pane1Id = getDefaultPaneId()
      workspace.toggleSplit()
      expect(workspace.activePaneId).toBe(pane1Id)

      workspace.toggleSplit()
      expect(workspace.activePaneId).toBe(pane1Id)
    })

    it('moves focus to primary pane when collapsing while secondary is focused', () => {
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]
      workspace.setActivePane(pane2Id)

      workspace.toggleSplit()
      expect(workspace.activePaneId).toBe(pane1Id)
    })
  })

  describe('moveTab', () => {
    it('moves a document tab between panes', () => {
      const tabId = workspace.openTab('moveable.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      const result = workspace.moveTab(tabId, pane1Id, pane2Id)
      expect(result).toBe(true)

      expect(getPane(pane1Id).tabOrder).not.toContain(tabId)
      expect(getPane(pane2Id).tabOrder).toContain(tabId)
    })

    it('makes the moved tab active in the destination pane', () => {
      workspace.openTab('stay.md')
      const tabId = workspace.openTab('moveable.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      workspace.moveTab(tabId, pane1Id, pane2Id)
      expect(getPane(pane2Id).activeTabId).toBe(tabId)
    })

    it('sets focus to the destination pane', () => {
      const tabId = workspace.openTab('moveable.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      workspace.moveTab(tabId, pane1Id, pane2Id)
      expect(workspace.activePaneId).toBe(pane2Id)
    })

    it('activates another tab in the source pane after move', () => {
      const tabStay = workspace.openTab('stay.md')
      const tabMove = workspace.openTab('moveable.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      // tabMove is active; move it away
      workspace.moveTab(tabMove, pane1Id, pane2Id)
      expect(getPane(pane1Id).activeTabId).toBe(tabStay)
    })

    it('sets source pane activeTabId to null when last doc tab is moved', () => {
      const tabId = workspace.openTab('only.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      workspace.moveTab(tabId, pane1Id, pane2Id)
      expect(getPane(pane1Id).activeTabId).toBeNull()
    })

    it('cannot move the pinned graph tab', () => {
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]
      const graphTabId = getGraphTabId(pane1Id)

      const result = workspace.moveTab(graphTabId, pane1Id, pane2Id)
      expect(result).toBe(false)
    })

    it('returns false when moving to the same pane', () => {
      const tabId = workspace.openTab('file.md')
      const paneId = getDefaultPaneId()

      const result = workspace.moveTab(tabId, paneId, paneId)
      expect(result).toBe(false)
    })

    it('returns false for invalid pane IDs', () => {
      const tabId = workspace.openTab('file.md')
      const paneId = getDefaultPaneId()

      expect(workspace.moveTab(tabId, paneId, 'bad-id')).toBe(false)
      expect(workspace.moveTab(tabId, 'bad-id', paneId)).toBe(false)
    })

    it('returns false for invalid tab ID', () => {
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      const result = workspace.moveTab('bad-tab-id', pane1Id, pane2Id)
      expect(result).toBe(false)
    })

    it('inserts moved tab before graph tab in destination pane', () => {
      const tabId = workspace.openTab('moveable.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]
      const graphTabId2 = getGraphTabId(pane2Id)

      workspace.moveTab(tabId, pane1Id, pane2Id)
      const pane2 = getPane(pane2Id)
      const lastTabId = pane2.tabOrder[pane2.tabOrder.length - 1]
      expect(lastTabId).toBe(graphTabId2)
    })
  })

  describe('derived getters', () => {
    describe('focusedPane', () => {
      it('returns the currently active pane', () => {
        const paneId = getDefaultPaneId()
        expect(workspace.focusedPane).toBeDefined()
        expect(workspace.focusedPane?.id).toBe(paneId)
      })

      it('updates when activePaneId changes', () => {
        workspace.toggleSplit()
        const pane2Id = workspace.paneOrder[1]
        workspace.setActivePane(pane2Id)
        expect(workspace.focusedPane?.id).toBe(pane2Id)
      })
    })

    describe('focusedTab', () => {
      it('returns undefined when no tab is active', () => {
        expect(workspace.focusedTab).toBeUndefined()
      })

      it('returns the active document tab', () => {
        const tabId = workspace.openTab('test.md')
        expect(workspace.focusedTab).toBeDefined()
        expect(workspace.focusedTab!.id).toBe(tabId)
      })

      it('returns the graph tab when graph is active', () => {
        workspace.openTab('test.md')
        workspace.switchToGraphTab()
        expect(workspace.focusedTab).toBeDefined()
        expect(workspace.focusedTab!.kind).toBe('graph')
      })
    })

    describe('focusedDocumentTab', () => {
      it('returns undefined when no tab is active', () => {
        expect(workspace.focusedDocumentTab).toBeUndefined()
      })

      it('returns the active document tab', () => {
        workspace.openTab('test.md')
        const docTab = workspace.focusedDocumentTab
        expect(docTab).toBeDefined()
        expect(docTab!.filePath).toBe('test.md')
      })

      it('returns undefined when the graph tab is active', () => {
        workspace.openTab('test.md')
        workspace.switchToGraphTab()
        expect(workspace.focusedDocumentTab).toBeUndefined()
      })
    })

    describe('selectedFilePath', () => {
      it('returns null when no document tab is active', () => {
        expect(workspace.selectedFilePath).toBeNull()
      })

      it('returns the focused document tab file path', () => {
        workspace.openTab('notes/readme.md')
        expect(workspace.selectedFilePath).toBe('notes/readme.md')
      })

      it('updates when switching tabs', () => {
        workspace.openTab('a.md')
        workspace.openTab('b.md')
        expect(workspace.selectedFilePath).toBe('b.md')

        workspace.switchTab(workspace.getDocumentTabs(getDefaultPaneId())[0].id)
        expect(workspace.selectedFilePath).toBe('a.md')
      })

      it('returns null when the graph tab is active', () => {
        workspace.openTab('file.md')
        workspace.switchToGraphTab()
        expect(workspace.selectedFilePath).toBeNull()
      })

      it('follows pane focus changes', () => {
        workspace.openTab('pane1-file.md')
        workspace.toggleSplit()
        const pane2Id = workspace.paneOrder[1]
        workspace.openTab('pane2-file.md', pane2Id)

        workspace.setActivePane(pane2Id)
        expect(workspace.selectedFilePath).toBe('pane2-file.md')

        workspace.setActivePane(workspace.paneOrder[0])
        expect(workspace.selectedFilePath).toBe('pane1-file.md')
      })
    })
  })

  describe('switchToGraphTab', () => {
    it('switches to the graph tab in the active pane', () => {
      workspace.openTab('file.md')
      workspace.switchToGraphTab()

      const pane = getPane(getDefaultPaneId())
      expect(pane.activeTabId).toBe(pane.graphTabId)
    })

    it('can switch to graph tab in a specific pane', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      workspace.openTab('file.md', pane2Id)

      workspace.switchToGraphTab(pane2Id)
      expect(getPane(pane2Id).activeTabId).toBe(getGraphTabId(pane2Id))
    })
  })

  describe('getDocumentTabs', () => {
    it('returns empty array for a pane with no document tabs', () => {
      const docTabs = workspace.getDocumentTabs(getDefaultPaneId())
      expect(docTabs).toEqual([])
    })

    it('returns only document tabs (excludes graph tab)', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')

      const docTabs = workspace.getDocumentTabs(getDefaultPaneId())
      expect(docTabs).toHaveLength(2)
      expect(docTabs.every((t) => t.kind === 'document')).toBe(true)
    })

    it('returns empty array for invalid pane ID', () => {
      expect(workspace.getDocumentTabs('bad-id')).toEqual([])
    })
  })

  describe('getTabsInOrder', () => {
    it('returns all tabs including the graph tab', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')

      const tabs = workspace.getTabsInOrder(getDefaultPaneId())
      expect(tabs).toHaveLength(3) // 2 doc + 1 graph
    })

    it('returns tabs in pane order with graph tab last', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')

      const tabs = workspace.getTabsInOrder(getDefaultPaneId())
      expect(tabs[0].kind).toBe('document')
      expect(tabs[1].kind).toBe('document')
      expect(tabs[2].kind).toBe('graph')
    })

    it('returns empty array for invalid pane ID', () => {
      expect(workspace.getTabsInOrder('bad-id')).toEqual([])
    })
  })

  describe('findTabByFilePath', () => {
    it('returns tab ID when file is open', () => {
      const tabId = workspace.openTab('target.md')
      const found = workspace.findTabByFilePath('target.md')
      expect(found).toBe(tabId)
    })

    it('returns null when file is not open', () => {
      const found = workspace.findTabByFilePath('not-open.md')
      expect(found).toBeNull()
    })

    it('finds tabs across panes', () => {
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      const tabId = workspace.openTab('in-pane2.md', pane2Id)

      const found = workspace.findTabByFilePath('in-pane2.md')
      expect(found).toBe(tabId)
    })
  })

  describe('reorderTab', () => {
    it('moves a tab to a new index', () => {
      const tabA = workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      const tabC = workspace.openTab('c.md')
      const graphTabId = getGraphTabId(getDefaultPaneId())

      workspace.reorderTab(tabA, 2) // Move a.md after c.md
      const pane = getPane(getDefaultPaneId())
      expect(pane.tabOrder).toEqual([tabB, tabC, tabA, graphTabId])
    })

    it('cannot reorder the graph tab', () => {
      workspace.openTab('a.md')
      const graphTabId = getGraphTabId(getDefaultPaneId())

      workspace.reorderTab(graphTabId, 0)
      const pane = getPane(getDefaultPaneId())
      const lastTabId = pane.tabOrder[pane.tabOrder.length - 1]
      expect(lastTabId).toBe(graphTabId)
    })

    it('clamps index to before the graph tab', () => {
      const tabA = workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      const graphTabId = getGraphTabId(getDefaultPaneId())

      workspace.reorderTab(tabA, 999) // Should clamp to max before graph
      const pane = getPane(getDefaultPaneId())
      expect(pane.tabOrder).toEqual([tabB, tabA, graphTabId])
    })
  })

  describe('reset', () => {
    it('restores to initial state', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')
      workspace.toggleSplit()

      workspace.reset()

      expect(workspace.paneOrder).toHaveLength(1)
      expect(workspace.splitEnabled).toBe(false)
      expect(workspace.splitRatio).toBe(0.5)

      const pane = getPane(getDefaultPaneId())
      expect(pane.tabOrder).toHaveLength(1) // Only graph tab
      expect(pane.activeTabId).toBeNull()
    })
  })

  describe('setSplitRatio', () => {
    it('updates the split ratio', () => {
      workspace.setSplitRatio(0.3)
      expect(workspace.splitRatio).toBe(0.3)
    })

    it('clamps to 0-1 range', () => {
      workspace.setSplitRatio(-0.5)
      expect(workspace.splitRatio).toBe(0)

      workspace.setSplitRatio(1.5)
      expect(workspace.splitRatio).toBe(1)
    })
  })

  describe('serializeSession', () => {
    it('serializes an empty workspace', () => {
      const session = workspace.serializeSession()
      expect(session.panes).toHaveLength(1)
      expect(session.splitEnabled).toBe(false)
      expect(session.splitRatio).toBe(0.5)
    })

    it('serializes document tabs with file paths', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')

      const session = workspace.serializeSession()
      const pane = session.panes[0]
      const docTabs = pane.tabs.filter((t) => t.kind === 'document')
      expect(docTabs).toHaveLength(2)
      expect(docTabs[0].filePath).toBe('a.md')
      expect(docTabs[1].filePath).toBe('b.md')
    })

    it('includes graph tab in serialized pane', () => {
      const session = workspace.serializeSession()
      const graphTabs = session.panes[0].tabs.filter((t) => t.kind === 'graph')
      expect(graphTabs).toHaveLength(1)
    })

    it('records the active tab index', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')
      // b.md is active, which is at index 1 among all tabs (a.md=0, b.md=1, graph=2)
      const session = workspace.serializeSession()
      expect(session.panes[0].activeTabIndex).toBe(1) // b.md
    })

    it('serializes split state', () => {
      workspace.toggleSplit()
      workspace.setSplitRatio(0.7)

      const session = workspace.serializeSession()
      expect(session.splitEnabled).toBe(true)
      expect(session.splitRatio).toBe(0.7)
      expect(session.panes).toHaveLength(2)
    })
  })

  describe('serializeTab', () => {
    it('serializes a document tab for transfer', () => {
      const tabId = workspace.openTab('file.md')
      const data = workspace.serializeTab(tabId)

      expect(data).not.toBeNull()
      expect(data!.kind).toBe('document')
      expect(data!.filePath).toBe('file.md')
      expect(data!.editorMode).toBe('wysiwyg')
      expect(data!.isDirty).toBe(false)
      expect(data!.content).toBeNull()
    })

    it('returns null for the graph tab', () => {
      const graphTabId = getGraphTabId(getDefaultPaneId())
      const data = workspace.serializeTab(graphTabId)
      expect(data).toBeNull()
    })

    it('returns null for nonexistent tab', () => {
      const data = workspace.serializeTab('bad-id')
      expect(data).toBeNull()
    })
  })

  describe('attachTab', () => {
    it('creates a new document tab from transfer data', () => {
      const tabId = workspace.attachTab({
        kind: 'document',
        filePath: 'transferred.md',
        editorMode: 'editor',
        isDirty: true,
        content: '# Hello',
      })

      expect(tabId).toBeTruthy()
      const tab = asDocTab(workspace.tabs[tabId])
      expect(tab.filePath).toBe('transferred.md')
      expect(tab.editorMode).toBe('editor')
      expect(tab.isDirty).toBe(true)
      expect(tab.content).toBe('# Hello')
    })

    it('reuses existing tab if file is already open', () => {
      const originalId = workspace.openTab('existing.md')
      const attachedId = workspace.attachTab({
        kind: 'document',
        filePath: 'existing.md',
      })

      expect(attachedId).toBe(originalId)
    })

    it('returns empty string for invalid data', () => {
      const result = workspace.attachTab({
        kind: 'document',
        filePath: '',
      })
      expect(result).toBe('')
    })
  })

  describe('splitAndMoveTab', () => {
    it('creates split and moves tab to the right pane', () => {
      const tabId = workspace.openTab('moveable.md')
      workspace.openTab('stay.md') // Keep at least one tab in source

      expect(workspace.splitEnabled).toBe(false)

      const result = workspace.splitAndMoveTab(tabId, 'right')
      expect(result).toBe(true)
      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.paneOrder).toHaveLength(2)

      const pane2Id = workspace.paneOrder[1]
      expect(getPane(pane2Id).tabOrder).toContain(tabId)
      expect(getPane(pane2Id).activeTabId).toBe(tabId)
    })

    it('moves tab between panes when already split', () => {
      const tabId = workspace.openTab('moveable.md')
      workspace.openTab('stay.md')
      workspace.toggleSplit()
      const pane1Id = workspace.paneOrder[0]
      const pane2Id = workspace.paneOrder[1]

      const result = workspace.splitAndMoveTab(tabId, 'right')
      expect(result).toBe(true)
      expect(getPane(pane1Id).tabOrder).not.toContain(tabId)
      expect(getPane(pane2Id).tabOrder).toContain(tabId)
    })

    it('moves tab to the left pane', () => {
      workspace.openTab('stay-left.md')
      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      workspace.openTab('stay-right.md', pane2Id)
      const tabId = workspace.openTab('moveable.md', pane2Id)

      const result = workspace.splitAndMoveTab(tabId, 'left')
      expect(result).toBe(true)

      const pane1Id = workspace.paneOrder[0]
      expect(getPane(pane1Id).tabOrder).toContain(tabId)
      expect(getPane(pane2Id).tabOrder).not.toContain(tabId)
    })

    it('returns false for graph tabs', () => {
      const paneId = getDefaultPaneId()
      const graphTabId = getGraphTabId(paneId)

      const result = workspace.splitAndMoveTab(graphTabId, 'right')
      expect(result).toBe(false)
    })

    it('returns false for nonexistent tab ID', () => {
      const result = workspace.splitAndMoveTab('bad-id', 'right')
      expect(result).toBe(false)
    })

    it('returns false when tab is already in the target pane', () => {
      const tabId = workspace.openTab('file.md')
      workspace.openTab('other.md')
      workspace.toggleSplit()

      // Tab is in pane 0 (left), try to move to left — should be no-op
      const result = workspace.splitAndMoveTab(tabId, 'left')
      expect(result).toBe(false)
    })

    it('collapses split when last document tab is moved out of a pane', () => {
      const tabId = workspace.openTab('only.md')
      expect(workspace.splitEnabled).toBe(false)

      // This will enable split, then move the only doc tab to the right pane.
      // The left pane now has 0 doc tabs, so split should auto-collapse.
      const result = workspace.splitAndMoveTab(tabId, 'right')
      expect(result).toBe(true)
      expect(workspace.splitEnabled).toBe(false)
      expect(workspace.paneOrder).toHaveLength(1)

      // The tab should still exist in the remaining pane
      const paneId = workspace.paneOrder[0]
      expect(getPane(paneId).tabOrder).toContain(tabId)
    })
  })
})
