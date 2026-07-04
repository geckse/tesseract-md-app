import { describe, it, expect, beforeEach, vi } from 'vitest'
import { workspace, BOTTOM_PANE_ID } from '@renderer/stores/workspace.svelte'
import type { DocumentTab } from '@renderer/stores/workspace.svelte'
import type { PersistedWindowState } from '../../src/preload/api'

// ── Helpers ──────────────────────────────────────────────────────────────

/** Get the first (default) pane ID from the workspace. */
function getDefaultPaneId(): string {
  return workspace.paneOrder[0]
}

/** Get the pane state for a given pane ID. */
function getPane(paneId: string) {
  return workspace.panes[paneId]
}

/** Assert a tab is a DocumentTab and return it typed. */
function _asDocTab(tab: unknown): DocumentTab {
  expect(tab).toBeDefined()
  expect((tab as DocumentTab).kind).toBe('document')
  return tab as DocumentTab
}

// ── Mock window.api ─────────────────────────────────────────────────────

const mockGetActiveCollection = vi.fn()
const mockReadFile = vi.fn()
const mockSaveWindowSession = vi.fn()
const mockSaveWindowSessionSync = vi.fn()

beforeEach(() => {
  // Set up window.api mock before each test
  Object.defineProperty(globalThis, 'window', {
    value: {
      api: {
        getActiveCollection: mockGetActiveCollection,
        readFile: mockReadFile,
        saveWindowSession: mockSaveWindowSession,
        saveWindowSessionSync: mockSaveWindowSessionSync,
        detachTab: vi.fn()
      }
    },
    writable: true,
    configurable: true
  })

  mockGetActiveCollection.mockReset()
  mockReadFile.mockReset()
  mockSaveWindowSession.mockReset()
  mockSaveWindowSessionSync.mockReset()
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('Tab Persistence', () => {
  beforeEach(() => {
    // reset() deliberately keeps terminal tabs (collection-switch semantics);
    // drop them for per-test isolation.
    for (const [id, tab] of Object.entries(workspace.tabs)) {
      if (tab.kind === 'terminal') workspace.removeTabSilently(id)
    }
    workspace.reset()
  })

  describe('serializeSession', () => {
    it('serializes an empty workspace with one pane', () => {
      const session = workspace.serializeSession()

      expect(session.panes).toHaveLength(1)
      expect(session.splitEnabled).toBe(false)
      expect(session.splitRatio).toBe(0.5)

      // The pane should contain only the graph tab
      const pane = session.panes[0]
      expect(pane.tabs).toHaveLength(1)
      expect(pane.tabs[0].kind).toBe('graph')
      expect(pane.activeTabIndex).toBe(-1) // No active tab
    })

    it('serializes document tabs with file paths only (no content)', () => {
      workspace.openTab('notes/readme.md')
      workspace.openTab('docs/guide.md')

      const session = workspace.serializeSession()
      const docTabs = session.panes[0].tabs.filter((t) => t.kind === 'document')

      expect(docTabs).toHaveLength(2)
      expect(docTabs[0].filePath).toBe('notes/readme.md')
      expect(docTabs[1].filePath).toBe('docs/guide.md')

      // Ensure no content is serialized
      for (const tab of docTabs) {
        expect(tab).not.toHaveProperty('content')
        expect(tab).not.toHaveProperty('isDirty')
        expect(tab).not.toHaveProperty('scrollPosition')
      }
    })

    it('includes graph tab with default level', () => {
      const session = workspace.serializeSession()
      const graphTab = session.panes[0].tabs.find((t) => t.kind === 'graph')

      expect(graphTab).toBeDefined()
      expect(graphTab!.kind).toBe('graph')
      expect(graphTab!.graphLevel).toBe('document')
    })

    it('preserves graph tab level setting', () => {
      // Manually modify the graph tab level for testing
      const paneId = getDefaultPaneId()
      const pane = getPane(paneId)
      const graphTab = workspace.tabs[pane.graphTabId]
      if (graphTab.kind === 'graph') {
        graphTab.graphLevel = 'chunk'
      }

      const session = workspace.serializeSession()
      const serializedGraph = session.panes[0].tabs.find((t) => t.kind === 'graph')
      expect(serializedGraph!.graphLevel).toBe('chunk')
    })

    it('records the correct active tab index', () => {
      workspace.openTab('a.md')
      workspace.openTab('b.md')
      workspace.openTab('c.md')

      // c.md is active (index 2: a=0, b=1, c=2, graph=3)
      const session = workspace.serializeSession()
      expect(session.panes[0].activeTabIndex).toBe(2)
    })

    it('records active tab index for first tab', () => {
      const tabA = workspace.openTab('a.md')
      workspace.openTab('b.md')

      // Switch back to a.md
      workspace.switchTab(tabA)

      const session = workspace.serializeSession()
      expect(session.panes[0].activeTabIndex).toBe(0)
    })

    it('records -1 activeTabIndex when no document tab is active', () => {
      // Only graph tab exists, but no active tab
      const session = workspace.serializeSession()
      expect(session.panes[0].activeTabIndex).toBe(-1)
    })

    it('serializes split pane state', () => {
      workspace.toggleSplit()
      workspace.setSplitRatio(0.65)

      const pane2Id = workspace.paneOrder[1]
      workspace.openTab('left-file.md')
      workspace.openTab('right-file.md', pane2Id)

      const session = workspace.serializeSession()

      expect(session.splitEnabled).toBe(true)
      expect(session.splitRatio).toBe(0.65)
      expect(session.panes).toHaveLength(2)

      // First pane has left-file.md + graph
      const pane1Docs = session.panes[0].tabs.filter((t) => t.kind === 'document')
      expect(pane1Docs).toHaveLength(1)
      expect(pane1Docs[0].filePath).toBe('left-file.md')

      // Second pane has right-file.md + graph
      const pane2Docs = session.panes[1].tabs.filter((t) => t.kind === 'document')
      expect(pane2Docs).toHaveLength(1)
      expect(pane2Docs[0].filePath).toBe('right-file.md')
    })

    it('preserves tab order in serialization', () => {
      workspace.openTab('first.md')
      workspace.openTab('second.md')
      workspace.openTab('third.md')

      const session = workspace.serializeSession()
      const docTabs = session.panes[0].tabs.filter((t) => t.kind === 'document')

      expect(docTabs[0].filePath).toBe('first.md')
      expect(docTabs[1].filePath).toBe('second.md')
      expect(docTabs[2].filePath).toBe('third.md')
    })

    it('serializes multiple tabs in each pane of a split workspace', () => {
      workspace.openTab('p1-a.md')
      workspace.openTab('p1-b.md')

      workspace.toggleSplit()
      const pane2Id = workspace.paneOrder[1]
      workspace.openTab('p2-a.md', pane2Id)
      workspace.openTab('p2-b.md', pane2Id)
      workspace.openTab('p2-c.md', pane2Id)

      const session = workspace.serializeSession()

      const pane1Docs = session.panes[0].tabs.filter((t) => t.kind === 'document')
      const pane2Docs = session.panes[1].tabs.filter((t) => t.kind === 'document')

      expect(pane1Docs).toHaveLength(2)
      expect(pane2Docs).toHaveLength(3)
    })
  })

  describe('restoreSession', () => {
    it('restores document tabs from persisted state', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('file content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [
              { kind: 'document', filePath: 'readme.md' },
              { kind: 'document', filePath: 'guide.md' },
              { kind: 'graph', graphLevel: 'document' }
            ],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      expect(workspace.paneOrder).toHaveLength(1)
      const paneId = workspace.paneOrder[0]
      const docTabs = workspace.getDocumentTabs(paneId)

      expect(docTabs).toHaveLength(2)
      expect(docTabs[0].filePath).toBe('readme.md')
      expect(docTabs[1].filePath).toBe('guide.md')
    })

    it('sets the correct active tab from persisted index', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [
              { kind: 'document', filePath: 'a.md' },
              { kind: 'document', filePath: 'b.md' },
              { kind: 'document', filePath: 'c.md' },
              { kind: 'graph' }
            ],
            activeTabIndex: 1 // b.md should be active
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      const activeTab = workspace.tabs[pane.activeTabId!]
      expect(activeTab).toBeDefined()
      expect(activeTab.kind).toBe('document')
      expect((activeTab as DocumentTab).filePath).toBe('b.md')
    })

    it('skips deleted files on restore', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      // First file exists, second doesn't, third exists
      mockReadFile
        .mockResolvedValueOnce('content') // exists.md
        .mockRejectedValueOnce(new Error('File not found')) // deleted.md
        .mockResolvedValueOnce('content') // also-exists.md

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [
              { kind: 'document', filePath: 'exists.md' },
              { kind: 'document', filePath: 'deleted.md' },
              { kind: 'document', filePath: 'also-exists.md' },
              { kind: 'graph' }
            ],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const docTabs = workspace.getDocumentTabs(paneId)

      expect(docTabs).toHaveLength(2)
      expect(docTabs[0].filePath).toBe('exists.md')
      expect(docTabs[1].filePath).toBe('also-exists.md')
      // deleted.md should not be present
      const deletedTab = workspace.findTabByFilePath('deleted.md')
      expect(deletedTab).toBeNull()
    })

    it('skips all document tabs when no active collection', async () => {
      mockGetActiveCollection.mockResolvedValue(null)

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'file.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const docTabs = workspace.getDocumentTabs(paneId)
      expect(docTabs).toHaveLength(0)
    })

    it('restores split pane state', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'left.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          },
          {
            tabs: [{ kind: 'document', filePath: 'right.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: true,
        splitRatio: 0.7
      }

      await workspace.restoreSession(session)

      expect(workspace.paneOrder).toHaveLength(2)
      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.splitRatio).toBe(0.7)

      // Check each pane has its own tab
      const pane1Docs = workspace.getDocumentTabs(workspace.paneOrder[0])
      const pane2Docs = workspace.getDocumentTabs(workspace.paneOrder[1])
      expect(pane1Docs).toHaveLength(1)
      expect(pane1Docs[0].filePath).toBe('left.md')
      expect(pane2Docs).toHaveLength(1)
      expect(pane2Docs[0].filePath).toBe('right.md')
    })

    it('restores graph tab level setting', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'graph', graphLevel: 'chunk' }],
            activeTabIndex: -1
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      const graphTab = workspace.tabs[pane.graphTabId]
      expect(graphTab.kind).toBe('graph')
      if (graphTab.kind === 'graph') {
        expect(graphTab.graphLevel).toBe('chunk')
      }
    })

    it('creates a default pane when session has no panes', async () => {
      const session: PersistedWindowState = {
        panes: [],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      expect(workspace.paneOrder).toHaveLength(1)
      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      expect(pane).toBeDefined()
      expect(pane.graphTabId).toBeTruthy()
    })

    it('sets active pane to the first pane after restore', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'a.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          },
          {
            tabs: [{ kind: 'document', filePath: 'b.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: true,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      expect(workspace.activePaneId).toBe(workspace.paneOrder[0])
    })

    it('does not enable splitEnabled when only one pane is restored', async () => {
      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'graph' }],
            activeTabIndex: -1
          }
        ],
        splitEnabled: true, // Was true in the session, but only 1 pane
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      // splitEnabled should be false because we only have 1 pane
      expect(workspace.splitEnabled).toBe(false)
    })

    it('enables persistence after restoring', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')
      mockSaveWindowSession.mockResolvedValue(undefined)

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'test.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      // After restore, persistence should be enabled.
      // Opening a new tab should trigger a debounced save.
      workspace.openTab('new-file.md')

      // Advance timers to trigger the debounced save
      await vi.waitFor(
        () => {
          expect(mockSaveWindowSession).toHaveBeenCalled()
        },
        { timeout: 1000 }
      )
    })

    it('falls back to last doc tab when persisted activeTabIndex has no match', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      // The file at index 1 is deleted, so the active tab index won't match
      mockReadFile
        .mockResolvedValueOnce('content') // a.md
        .mockRejectedValueOnce(new Error('not found')) // was-active-deleted.md

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [
              { kind: 'document', filePath: 'a.md' },
              { kind: 'document', filePath: 'was-active-deleted.md' },
              { kind: 'graph' }
            ],
            activeTabIndex: 1 // Points to deleted file
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      // Should fall back to the last restored document tab (a.md)
      expect(pane.activeTabId).not.toBeNull()
      const activeTab = workspace.tabs[pane.activeTabId!]
      expect(activeTab.kind).toBe('document')
      expect((activeTab as DocumentTab).filePath).toBe('a.md')
    })

    it('sets activeTabId to null when all document tabs are deleted', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockRejectedValue(new Error('File not found'))

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [
              { kind: 'document', filePath: 'deleted-a.md' },
              { kind: 'document', filePath: 'deleted-b.md' },
              { kind: 'graph' }
            ],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      expect(pane.activeTabId).toBeNull()
      expect(workspace.getDocumentTabs(paneId)).toHaveLength(0)
    })

    it('ensures each restored pane has a graph tab', async () => {
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'file.md' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      expect(pane.graphTabId).toBeTruthy()
      const graphTab = workspace.tabs[pane.graphTabId]
      expect(graphTab).toBeDefined()
      expect(graphTab.kind).toBe('graph')
    })

    it('resets state cleanly before restoring', async () => {
      // Set up some existing state
      workspace.openTab('old-file.md')
      workspace.toggleSplit()

      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      const session: PersistedWindowState = {
        panes: [
          {
            tabs: [{ kind: 'document', filePath: 'new-file.md' }, { kind: 'graph' }],
            activeTabIndex: 0
          }
        ],
        splitEnabled: false,
        splitRatio: 0.5
      }

      await workspace.restoreSession(session)

      // Old state should be gone
      expect(workspace.findTabByFilePath('old-file.md')).toBeNull()
      expect(workspace.paneOrder).toHaveLength(1)
      expect(workspace.splitEnabled).toBe(false)

      // New state should be present
      expect(workspace.findTabByFilePath('new-file.md')).not.toBeNull()
    })
  })

  describe('round-trip serialization', () => {
    it('serialize then restore produces equivalent workspace', async () => {
      // Set up a workspace
      workspace.openTab('file-a.md')
      workspace.openTab('file-b.md')
      workspace.openTab('file-c.md')
      workspace.toggleSplit()
      workspace.setSplitRatio(0.6)
      const pane2Id = workspace.paneOrder[1]
      workspace.openTab('file-d.md', pane2Id)

      // Serialize
      const session = workspace.serializeSession()

      // Mock API for restore
      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      // Restore
      await workspace.restoreSession(session)

      // Verify structural equivalence
      expect(workspace.paneOrder).toHaveLength(2)
      expect(workspace.splitEnabled).toBe(true)
      expect(workspace.splitRatio).toBe(0.6)

      const pane1Docs = workspace.getDocumentTabs(workspace.paneOrder[0])
      const pane2Docs = workspace.getDocumentTabs(workspace.paneOrder[1])

      expect(pane1Docs.map((t) => t.filePath)).toEqual(['file-a.md', 'file-b.md', 'file-c.md'])
      expect(pane2Docs.map((t) => t.filePath)).toEqual(['file-d.md'])
    })

    it('round-trip preserves active tab selection', async () => {
      workspace.openTab('a.md')
      const tabB = workspace.openTab('b.md')
      workspace.openTab('c.md')

      // Make b.md the active tab
      workspace.switchTab(tabB)

      const session = workspace.serializeSession()

      mockGetActiveCollection.mockResolvedValue({ path: '/tmp/project' })
      mockReadFile.mockResolvedValue('content')

      await workspace.restoreSession(session)

      const paneId = workspace.paneOrder[0]
      const pane = getPane(paneId)
      const activeTab = workspace.tabs[pane.activeTabId!]
      expect(activeTab.kind).toBe('document')
      expect((activeTab as DocumentTab).filePath).toBe('b.md')
    })
  })
  describe('bottom pane persistence', () => {
    /** Register a stub terminal-restore hook; returns the respawned slots. */
    function stubTerminalHooks(): Array<{ shell: string; cwd: string; title?: string }> {
      const restored: Array<{ shell: string; cwd: string; title?: string }> = []
      workspace.registerTerminalHooks(
        () => ({ shell: '/bin/zsh', cwd: '/proj' }),
        (slot) => {
          restored.push(slot)
          return `respawned-${restored.length}`
        }
      )
      return restored
    }

    it('serializes the bottom pane with open state and height, without the legacy field', () => {
      const tabId = workspace.openTab('a.md')
      workspace.moveTabToBottomPane(tabId)
      workspace.setBottomPaneHeight(420)

      const session = workspace.serializeSession()

      expect(session.bottomPane?.tabs).toEqual([{ kind: 'document', filePath: 'a.md' }])
      expect(session.bottomPane?.activeTabIndex).toBe(0)
      expect(session.bottomPaneOpen).toBe(true)
      expect(session.bottomPaneHeight).toBe(420)
      expect(session.bottomPanel).toBeUndefined()
    })

    it('defaults to a hidden, empty bottom pane when the session has no bottom fields', async () => {
      await workspace.restoreSession({
        panes: [{ tabs: [], activeTabIndex: -1 }],
        splitEnabled: false,
        splitRatio: 0.5
      })

      expect(workspace.bottomPane).toBeDefined()
      expect(workspace.bottomPane!.tabOrder).toEqual([])
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(workspace.bottomPaneHeight).toBe(300)
    })

    it('migrates the legacy bottomPanel slots into terminal tabs', async () => {
      const restored = stubTerminalHooks()

      await workspace.restoreSession({
        panes: [{ tabs: [], activeTabIndex: -1 }],
        splitEnabled: false,
        splitRatio: 0.5,
        bottomPanel: {
          open: true,
          height: 260,
          activeIndex: 1,
          slots: [
            { shell: '/bin/zsh', cwd: '/a', title: 'one' },
            { shell: '/bin/bash', cwd: '/b', title: 'two' }
          ]
        }
      })

      expect(restored).toEqual([
        { shell: '/bin/zsh', cwd: '/a', title: 'one' },
        { shell: '/bin/bash', cwd: '/b', title: 'two' }
      ])
      const bottom = workspace.bottomPane!
      expect(bottom.tabOrder).toHaveLength(2)
      const titles = bottom.tabOrder.map((id) => workspace.tabs[id].title)
      expect(titles).toEqual(['one', 'two'])
      expect(bottom.activeTabId).toBe(bottom.tabOrder[1])
      expect(workspace.bottomPaneOpen).toBe(true)
      expect(workspace.bottomPaneHeight).toBe(260)
    })

    it('restores legacy slots hidden when the legacy panel was closed', async () => {
      stubTerminalHooks()

      await workspace.restoreSession({
        panes: [{ tabs: [], activeTabIndex: -1 }],
        splitEnabled: false,
        splitRatio: 0.5,
        bottomPanel: {
          open: false,
          height: 200,
          activeIndex: 0,
          slots: [{ shell: '/bin/zsh', cwd: '/a' }]
        }
      })

      expect(workspace.bottomPane!.tabOrder).toHaveLength(1)
      expect(workspace.bottomPaneOpen).toBe(false)
    })

    it('prefers the new bottomPane over the legacy bottomPanel when both exist', async () => {
      const restored = stubTerminalHooks()

      await workspace.restoreSession({
        panes: [{ tabs: [], activeTabIndex: -1 }],
        splitEnabled: false,
        splitRatio: 0.5,
        bottomPane: {
          tabs: [
            {
              kind: 'terminal',
              terminalShell: '/bin/fish',
              terminalCwd: '/new',
              terminalTitle: 'new-term'
            }
          ],
          activeTabIndex: 0
        },
        bottomPaneOpen: false,
        bottomPaneHeight: 333,
        bottomPanel: {
          open: true,
          height: 111,
          activeIndex: 0,
          slots: [{ shell: '/bin/zsh', cwd: '/old', title: 'old-term' }]
        }
      })

      expect(restored).toEqual([{ shell: '/bin/fish', cwd: '/new', title: 'new-term' }])
      expect(workspace.bottomPane!.tabOrder).toHaveLength(1)
      expect(workspace.bottomPaneOpen).toBe(false)
      expect(workspace.bottomPaneHeight).toBe(333)
    })

    it('respawns terminal tabs persisted in the new bottomPane format via the hook', async () => {
      const restored = stubTerminalHooks()

      await workspace.restoreSession({
        panes: [{ tabs: [{ kind: 'document', filePath: 'a.md' }], activeTabIndex: 0 }],
        splitEnabled: false,
        splitRatio: 0.5,
        bottomPane: {
          tabs: [
            { kind: 'terminal', terminalShell: '/bin/zsh', terminalCwd: '/x', terminalTitle: 't' }
          ],
          activeTabIndex: 0
        },
        bottomPaneOpen: true,
        bottomPaneHeight: 300
      })

      expect(restored).toHaveLength(1)
      const bottom = workspace.bottomPane!
      expect(bottom.tabOrder).toHaveLength(1)
      const tab = workspace.tabs[bottom.tabOrder[0]]
      expect(tab.kind).toBe('terminal')
      if (tab.kind === 'terminal') {
        expect(tab.terminalId).toBe('respawned-1')
      }
    })

    it('round-trips a graph tab living in the bottom pane', async () => {
      const editor = getDefaultPaneId()
      const graphTabId = getPane(editor).graphTabId!
      workspace.moveTab(graphTabId, editor, BOTTOM_PANE_ID)

      const session = workspace.serializeSession()
      expect(session.bottomPane?.tabs.some((t) => t.kind === 'graph')).toBe(true)
      expect(session.panes.every((p) => p.tabs.every((t) => t.kind !== 'graph'))).toBe(true)

      await workspace.restoreSession(session)

      expect(workspace.bottomPane!.graphTabId).toBeTruthy()
      for (const pid of workspace.paneOrder) {
        expect(workspace.panes[pid].graphTabId).toBeNull()
      }
      // Exactly one graph tab exists overall
      const graphTabs = Object.values(workspace.tabs).filter((t) => t.kind === 'graph')
      expect(graphTabs).toHaveLength(1)
    })

    it('keeps the graph in pane 0 when no persisted pane holds one', async () => {
      await workspace.restoreSession({
        panes: [{ tabs: [], activeTabIndex: -1 }],
        splitEnabled: false,
        splitRatio: 0.5
      })

      const pane0 = workspace.panes[workspace.paneOrder[0]]
      expect(pane0.graphTabId).toBeTruthy()
      expect(workspace.bottomPane!.graphTabId).toBeNull()
    })
  })
  describe('flushSessionSync', () => {
    it('cancels the pending debounce and saves synchronously exactly once', () => {
      vi.useFakeTimers()
      try {
        workspace.enablePersistence()
        workspace.openTab('a.md') // schedules a debounced async save

        workspace.flushSessionSync()

        expect(mockSaveWindowSessionSync).toHaveBeenCalledTimes(1)
        const session = mockSaveWindowSessionSync.mock.calls[0][0]
        expect(session.panes[0].tabs).toContainEqual({ kind: 'document', filePath: 'a.md' })

        // The debounced save was cancelled — nothing fires later
        vi.advanceTimersByTime(2000)
        expect(mockSaveWindowSession).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does nothing in popup windows', () => {
      workspace.enablePersistence()
      workspace.isPopup = true
      try {
        workspace.flushSessionSync()
        expect(mockSaveWindowSessionSync).not.toHaveBeenCalled()
      } finally {
        workspace.isPopup = false
      }
    })
  })
})
