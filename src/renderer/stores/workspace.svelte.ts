/**
 * Core workspace state for multi-tab, split-pane editing.
 *
 * Uses Svelte 5 $state runes for reactivity. MUST remain a .svelte.ts file.
 * Export via singleton class instance — bare $state variables lose reactivity
 * when exported.
 *
 * Uses Record<string, T> (not Map) for Svelte 5 proxy reactivity.
 * Uses $state.raw() for external library types that must not be deeply proxied.
 */

import type { EditorMode } from './editor'
import type { GraphLevel } from '../types/cli'

// ─── Tab Types ─────────────────────────────────────────────────────────

/** Graph coloring mode (duplicated from graph.ts to avoid circular deps). */
export type GraphColoringMode = 'cluster' | 'folder' | 'none'

/** Per-tab navigation history. */
export interface TabNavigation {
  backStack: string[]
  forwardStack: string[]
  current: string | null
}

/** A document tab — editing a markdown file. */
export interface DocumentTab {
  id: string
  kind: 'document'
  filePath: string
  title: string
  isDirty: boolean
  editorMode: EditorMode
  content: string | null
  contentLoading: boolean
  contentError: string | null
  scrollPosition: number
  cursorPosition: number
  wordCount: number
  tokenCount: number
  navigation: TabNavigation
}

/** A graph tab — 3D graph view, pinned per pane. */
export interface GraphTab {
  id: string
  kind: 'graph'
  title: string
  graphLevel: GraphLevel
  graphPathFilter: string | null
  graphColoringMode: GraphColoringMode
}

/** Discriminated union of all tab types. */
export type TabState = DocumentTab | GraphTab

// ─── Pane Types ────────────────────────────────────────────────────────

/** A pane containing an ordered list of tabs. */
export interface PaneState {
  id: string
  tabOrder: string[]
  activeTabId: string | null
  graphTabId: string
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Extract filename from a file path for use as tab title. */
function fileNameFromPath(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

/** Create a new graph tab. */
function createGraphTab(): GraphTab {
  return {
    id: crypto.randomUUID(),
    kind: 'graph',
    title: 'Graph',
    graphLevel: 'document',
    graphPathFilter: null,
    graphColoringMode: 'cluster',
  }
}

/** Create a new document tab for a file path. */
function createDocumentTab(filePath: string): DocumentTab {
  return {
    id: crypto.randomUUID(),
    kind: 'document',
    filePath,
    title: fileNameFromPath(filePath),
    isDirty: false,
    editorMode: 'wysiwyg',
    content: null,
    contentLoading: false,
    contentError: null,
    scrollPosition: 0,
    cursorPosition: 0,
    wordCount: 0,
    tokenCount: 0,
    navigation: {
      backStack: [],
      forwardStack: [],
      current: filePath,
    },
  }
}

/** Create a new pane with a pinned graph tab. */
function createPane(): { pane: PaneState; graphTab: GraphTab } {
  const graphTab = createGraphTab()
  const pane: PaneState = {
    id: crypto.randomUUID(),
    tabOrder: [graphTab.id],
    activeTabId: null,
    graphTabId: graphTab.id,
  }
  return { pane, graphTab }
}

// ─── WorkspaceStore ────────────────────────────────────────────────────

class WorkspaceStore {
  /** All tabs keyed by tab ID. */
  tabs = $state<Record<string, TabState>>({})

  /** All panes keyed by pane ID. */
  panes = $state<Record<string, PaneState>>({})

  /** Ordered list of pane IDs (left to right). */
  paneOrder = $state<string[]>([])

  /** ID of the currently focused pane. */
  activePaneId = $state<string>('')

  /** Whether split pane mode is enabled. */
  splitEnabled = $state<boolean>(false)

  /** Split ratio (0-1) for the divider position. Default 0.5. */
  splitRatio = $state<number>(0.5)

  constructor() {
    this._initDefaultPane()
  }

  // ── Computed Getters ───────────────────────────────────────────────

  /** The currently focused pane, or undefined if none. */
  get focusedPane(): PaneState | undefined {
    return this.panes[this.activePaneId]
  }

  /** The active tab in the focused pane, or undefined if none. */
  get focusedTab(): TabState | undefined {
    const pane = this.focusedPane
    if (!pane || !pane.activeTabId) return undefined
    return this.tabs[pane.activeTabId]
  }

  /** The active document tab in the focused pane, or undefined if active tab is not a document. */
  get focusedDocumentTab(): DocumentTab | undefined {
    const tab = this.focusedTab
    if (!tab || tab.kind !== 'document') return undefined
    return tab
  }

  /** The selected file path from the focused pane's active document tab. */
  get selectedFilePath(): string | null {
    return this.focusedDocumentTab?.filePath ?? null
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /**
   * Open a file in a tab. If the file is already open in the active pane,
   * switch to that tab. Otherwise create a new document tab.
   * Returns the tab ID.
   */
  openTab(filePath: string, paneId?: string): string {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Check if file is already open in this pane
    const existingTabId = this._findTabByFilePath(filePath, targetPaneId)
    if (existingTabId) {
      this.switchTab(existingTabId, targetPaneId)
      return existingTabId
    }

    // Create a new document tab
    const tab = createDocumentTab(filePath)
    this.tabs[tab.id] = tab

    // Insert before the graph tab (graph is always last)
    const graphIdx = pane.tabOrder.indexOf(pane.graphTabId)
    if (graphIdx >= 0) {
      pane.tabOrder = [
        ...pane.tabOrder.slice(0, graphIdx),
        tab.id,
        ...pane.tabOrder.slice(graphIdx),
      ]
    } else {
      pane.tabOrder = [...pane.tabOrder, tab.id]
    }

    pane.activeTabId = tab.id
    this.panes[targetPaneId] = { ...pane }

    return tab.id
  }

  /**
   * Close a tab by ID. If it's the active tab, activate the nearest tab.
   * Returns the closed tab state (for undo/reopen), or null if not found
   * or if the tab is a pinned graph tab.
   */
  closeTab(tabId: string, paneId?: string): TabState | null {
    const targetPaneId = paneId ?? this._findPaneForTab(tabId)
    if (!targetPaneId) return null

    const pane = this.panes[targetPaneId]
    if (!pane) return null

    const tab = this.tabs[tabId]
    if (!tab) return null

    // Cannot close the pinned graph tab
    if (tab.kind === 'graph') return null

    const tabIndex = pane.tabOrder.indexOf(tabId)
    if (tabIndex < 0) return null

    // Remove tab from pane order
    pane.tabOrder = pane.tabOrder.filter((id) => id !== tabId)

    // If this was the active tab, activate the nearest tab
    if (pane.activeTabId === tabId) {
      const documentTabs = pane.tabOrder.filter((id) => this.tabs[id]?.kind === 'document')
      if (documentTabs.length > 0) {
        // Pick the tab at the same index or the last document tab
        const newIndex = Math.min(tabIndex, documentTabs.length - 1)
        pane.activeTabId = documentTabs[newIndex]
      } else {
        // No document tabs left — set active to null (empty state)
        pane.activeTabId = null
      }
    }

    this.panes[targetPaneId] = { ...pane }

    // Remove tab from tabs record
    const closedTab = this.tabs[tabId]
    const { [tabId]: _, ...remainingTabs } = this.tabs
    this.tabs = remainingTabs

    return closedTab
  }

  /**
   * Switch to a tab by ID within a specific pane.
   */
  switchTab(tabId: string, paneId?: string): void {
    const targetPaneId = paneId ?? this._findPaneForTab(tabId)
    if (!targetPaneId) return

    const pane = this.panes[targetPaneId]
    if (!pane) return

    if (!pane.tabOrder.includes(tabId)) return

    pane.activeTabId = tabId
    this.panes[targetPaneId] = { ...pane }
    this.activePaneId = targetPaneId
  }

  /**
   * Set the active (focused) pane.
   */
  setActivePane(paneId: string): void {
    if (!this.panes[paneId]) return
    this.activePaneId = paneId
  }

  /**
   * Move a tab from one pane to another.
   * Returns true if the move succeeded.
   */
  moveTab(tabId: string, fromPaneId: string, toPaneId: string): boolean {
    if (fromPaneId === toPaneId) return false

    const fromPane = this.panes[fromPaneId]
    const toPane = this.panes[toPaneId]
    if (!fromPane || !toPane) return false

    const tab = this.tabs[tabId]
    if (!tab) return false

    // Cannot move a pinned graph tab
    if (tab.kind === 'graph') return false

    if (!fromPane.tabOrder.includes(tabId)) return false

    // Remove from source pane
    fromPane.tabOrder = fromPane.tabOrder.filter((id) => id !== tabId)

    // If it was active in the source pane, pick a new active tab
    if (fromPane.activeTabId === tabId) {
      const documentTabs = fromPane.tabOrder.filter((id) => this.tabs[id]?.kind === 'document')
      fromPane.activeTabId = documentTabs.length > 0 ? documentTabs[documentTabs.length - 1] : null
    }

    // Insert before the graph tab in the destination pane
    const graphIdx = toPane.tabOrder.indexOf(toPane.graphTabId)
    if (graphIdx >= 0) {
      toPane.tabOrder = [
        ...toPane.tabOrder.slice(0, graphIdx),
        tabId,
        ...toPane.tabOrder.slice(graphIdx),
      ]
    } else {
      toPane.tabOrder = [...toPane.tabOrder, tabId]
    }

    toPane.activeTabId = tabId

    this.panes[fromPaneId] = { ...fromPane }
    this.panes[toPaneId] = { ...toPane }
    this.activePaneId = toPaneId

    return true
  }

  /**
   * Toggle split pane mode. When enabling, creates a second pane.
   * When disabling, merges all tabs from the second pane into the first.
   */
  toggleSplit(): void {
    if (this.splitEnabled) {
      this._collapseSplit()
    } else {
      this._enableSplit()
    }
  }

  /**
   * Switch to the graph tab in the active pane.
   */
  switchToGraphTab(paneId?: string): void {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return

    this.switchTab(pane.graphTabId, targetPaneId)
  }

  /**
   * Reset all workspace state (e.g., on collection switch).
   */
  reset(): void {
    this.tabs = {}
    this.panes = {}
    this.paneOrder = []
    this.splitEnabled = false
    this.splitRatio = 0.5
    this._initDefaultPane()
  }

  /**
   * Get all document tabs in a given pane (excluding graph tab).
   */
  getDocumentTabs(paneId: string): DocumentTab[] {
    const pane = this.panes[paneId]
    if (!pane) return []

    return pane.tabOrder
      .map((id) => this.tabs[id])
      .filter((tab): tab is DocumentTab => tab?.kind === 'document')
  }

  /**
   * Get all tabs in a given pane in order.
   */
  getTabsInOrder(paneId: string): TabState[] {
    const pane = this.panes[paneId]
    if (!pane) return []

    return pane.tabOrder
      .map((id) => this.tabs[id])
      .filter((tab): tab is TabState => tab !== undefined)
  }

  /**
   * Check if a file is open in any pane. Returns the tab ID if found.
   */
  findTabByFilePath(filePath: string): string | null {
    for (const tabId of Object.keys(this.tabs)) {
      const tab = this.tabs[tabId]
      if (tab.kind === 'document' && tab.filePath === filePath) {
        return tabId
      }
    }
    return null
  }

  /**
   * Reorder a tab within its pane by moving it to a new index.
   * The graph tab cannot be reordered (it stays pinned last).
   */
  reorderTab(tabId: string, newIndex: number, paneId?: string): void {
    const targetPaneId = paneId ?? this._findPaneForTab(tabId)
    if (!targetPaneId) return

    const pane = this.panes[targetPaneId]
    if (!pane) return

    const tab = this.tabs[tabId]
    if (!tab || tab.kind === 'graph') return

    const currentIndex = pane.tabOrder.indexOf(tabId)
    if (currentIndex < 0) return

    // Clamp new index: must be before the graph tab
    const graphIdx = pane.tabOrder.indexOf(pane.graphTabId)
    const maxIndex = graphIdx >= 0 ? graphIdx - 1 : pane.tabOrder.length - 1
    const clampedIndex = Math.max(0, Math.min(newIndex, maxIndex))

    if (currentIndex === clampedIndex) return

    const newOrder = pane.tabOrder.filter((id) => id !== tabId)
    newOrder.splice(clampedIndex, 0, tabId)
    pane.tabOrder = newOrder
    this.panes[targetPaneId] = { ...pane }
  }

  // ── Private Helpers ────────────────────────────────────────────────

  /** Initialize with a single default pane and graph tab. */
  private _initDefaultPane(): void {
    const { pane, graphTab } = createPane()
    this.tabs = { [graphTab.id]: graphTab }
    this.panes = { [pane.id]: pane }
    this.paneOrder = [pane.id]
    this.activePaneId = pane.id
  }

  /** Find a tab by file path in a specific pane. */
  private _findTabByFilePath(filePath: string, paneId: string): string | null {
    const pane = this.panes[paneId]
    if (!pane) return null

    for (const tabId of pane.tabOrder) {
      const tab = this.tabs[tabId]
      if (tab && tab.kind === 'document' && tab.filePath === filePath) {
        return tabId
      }
    }
    return null
  }

  /** Find which pane contains a given tab ID. */
  private _findPaneForTab(tabId: string): string | null {
    for (const paneId of Object.keys(this.panes)) {
      if (this.panes[paneId].tabOrder.includes(tabId)) {
        return paneId
      }
    }
    return null
  }

  /** Enable split mode by creating a second pane. */
  private _enableSplit(): void {
    if (this.paneOrder.length >= 2) {
      this.splitEnabled = true
      return
    }

    const { pane, graphTab } = createPane()
    this.tabs[graphTab.id] = graphTab
    this.panes[pane.id] = pane
    this.paneOrder = [...this.paneOrder, pane.id]
    this.splitEnabled = true
  }

  /** Collapse split mode: merge second pane's tabs into the first. */
  private _collapseSplit(): void {
    if (this.paneOrder.length < 2) {
      this.splitEnabled = false
      return
    }

    const primaryPaneId = this.paneOrder[0]
    const secondaryPaneId = this.paneOrder[1]
    const primaryPane = this.panes[primaryPaneId]
    const secondaryPane = this.panes[secondaryPaneId]

    if (!primaryPane || !secondaryPane) {
      this.splitEnabled = false
      return
    }

    // Move all document tabs from secondary to primary (before graph tab)
    const docTabIds = secondaryPane.tabOrder.filter(
      (id) => this.tabs[id]?.kind === 'document'
    )

    const graphIdx = primaryPane.tabOrder.indexOf(primaryPane.graphTabId)
    const insertIdx = graphIdx >= 0 ? graphIdx : primaryPane.tabOrder.length

    primaryPane.tabOrder = [
      ...primaryPane.tabOrder.slice(0, insertIdx),
      ...docTabIds,
      ...primaryPane.tabOrder.slice(insertIdx),
    ]

    // If the secondary pane was focused, make the primary focused
    // and activate the last moved tab (or keep current)
    if (this.activePaneId === secondaryPaneId) {
      this.activePaneId = primaryPaneId
      if (docTabIds.length > 0) {
        primaryPane.activeTabId = docTabIds[docTabIds.length - 1]
      }
    }

    // Clean up secondary pane's graph tab
    const secondaryGraphTabId = secondaryPane.graphTabId
    const { [secondaryGraphTabId]: _removedGraph, ...remainingTabs } = this.tabs
    this.tabs = remainingTabs

    // Remove secondary pane
    const { [secondaryPaneId]: _removedPane, ...remainingPanes } = this.panes
    this.panes = remainingPanes
    this.panes[primaryPaneId] = { ...primaryPane }

    this.paneOrder = [primaryPaneId]
    this.splitEnabled = false
  }
}

/** Singleton workspace store instance. */
export const workspace = new WorkspaceStore()
