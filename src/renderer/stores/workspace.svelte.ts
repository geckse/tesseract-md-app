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
import type { GraphLevel, MimeCategory } from '../types/cli'
import type { PersistedWindowState, PersistedPane, PersistedTab, TabTransferData } from '../../preload/api'

// ─── Asset Detection ──────────────────────────────────────────────────

/** Map of file extensions to MimeCategory for asset detection. */
const ASSET_EXT_MAP: Record<string, MimeCategory> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
}

/** Detect if a file path is an asset by extension. Returns MimeCategory or null. */
function detectAssetMime(filePath: string): MimeCategory | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ASSET_EXT_MAP[ext] ?? null
}

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
  /** Whether this tab represents a new unsaved file that doesn't exist on disk yet. */
  isUntitled: boolean
  editorMode: EditorMode
  content: string | null
  /** Content as last read from or written to disk — used for dirty tracking across editor mode switches. */
  savedContent: string | null
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

/** An asset tab — preview-only for non-markdown files (images, PDFs, etc.). */
export interface AssetTab {
  id: string
  kind: 'asset'
  filePath: string
  title: string
  mimeCategory: MimeCategory
  fileSize?: number
}

/** Discriminated union of all tab types. */
export type TabState = DocumentTab | GraphTab | AssetTab

// ─── Pane Types ────────────────────────────────────────────────────────

/** A pane containing an ordered list of tabs. */
export interface PaneState {
  id: string
  tabOrder: string[]
  activeTabId: string | null
  /** Graph tab ID. Only the primary pane has a graph tab (to avoid duplicate 3D renderers). */
  graphTabId: string | null
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
function createDocumentTab(filePath: string, isUntitled = false): DocumentTab {
  return {
    id: crypto.randomUUID(),
    kind: 'document',
    filePath,
    title: fileNameFromPath(filePath),
    isDirty: false,
    isUntitled,
    editorMode: 'wysiwyg',
    content: null,
    savedContent: null,
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

// ─── Untitled file counter ────────────────────────────────────────────

/** Global counter for untitled file names (Untitled-1, Untitled-2, ...). */
let untitledCounter = 0

// ─── Auto-save Debounce ────────────────────────────────────────────────

/** Debounce delay for auto-saving session state (ms). */
const SESSION_SAVE_DEBOUNCE_MS = 500

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

  /** Debounce timer for session auto-save. */
  private _saveTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether session persistence is enabled (set after initial restore). */
  private _persistenceEnabled = false

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

    this._scheduleSave()
    return tab.id
  }

  /**
   * Replace the current active document tab's file without creating a new tab.
   * Preserves navigation history within the tab. Resets content so it reloads.
   */
  replaceTab(filePath: string, paneId?: string): string {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Check if file is already open in this pane — just switch to it
    const existingTabId = this._findTabByFilePath(filePath, targetPaneId)
    if (existingTabId) {
      this.switchTab(existingTabId, targetPaneId)
      return existingTabId
    }

    // Find the active document tab to replace
    const activeTab = pane.activeTabId ? this.tabs[pane.activeTabId] : null
    if (!activeTab || activeTab.kind !== 'document') {
      // No active document tab to replace — fall back to openTab
      return this.openTab(filePath, targetPaneId)
    }

    // Replace the tab's file — keep same tab ID, same position in tab bar
    activeTab.filePath = filePath
    activeTab.title = fileNameFromPath(filePath)
    activeTab.isDirty = false
    activeTab.content = null
    activeTab.savedContent = null
    activeTab.contentLoading = false
    activeTab.contentError = null
    activeTab.scrollPosition = 0
    activeTab.cursorPosition = 0
    activeTab.wordCount = 0
    activeTab.tokenCount = 0
    // Navigation history is preserved — recordNavigation() handles the stacks

    this.tabs[activeTab.id] = { ...activeTab }
    this._scheduleSave()
    return activeTab.id
  }

  /**
   * Smart file open: replaces the current tab if it's clean (not dirty),
   * or opens a new tab if the current tab has unsaved changes.
   * Records navigation history for back/forward support.
   * Use `forceNewTab: true` to always open in a new tab (e.g., right-click "Open in New Tab").
   */
  openFile(filePath: string, options?: { forceNewTab?: boolean; paneId?: string }): string {
    const targetPaneId = options?.paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Detect asset files by extension and route to asset tab instead of document tab
    const detectedMime = detectAssetMime(filePath)
    if (detectedMime) {
      return this.openAssetTab(filePath, detectedMime, undefined, targetPaneId)
    }

    // Check if file is already open in this pane — just switch
    const existingTabId = this._findTabByFilePath(filePath, targetPaneId)
    if (existingTabId) {
      this.switchTab(existingTabId, targetPaneId)
      return existingTabId
    }

    // Force new tab requested
    if (options?.forceNewTab) {
      return this.openTab(filePath, targetPaneId)
    }

    // Check if current tab can be replaced (not dirty, is a document tab)
    const activeTab = pane.activeTabId ? this.tabs[pane.activeTabId] : null
    if (activeTab && activeTab.kind === 'document' && !activeTab.isDirty) {
      return this.replaceTab(filePath, targetPaneId)
    }

    // Current tab is dirty or not a document — open new tab
    return this.openTab(filePath, targetPaneId)
  }

  /**
   * Open a document tab from the graph view. Opens in the non-graph pane:
   * - If split is active, opens in whichever pane does NOT contain the graph tab
   * - If not split, creates a split with the document on the left and graph on the right
   */
  openTabFromGraph(filePath: string): string {
    // Find the pane that has the graph tab
    let graphPaneId: string | null = null
    let otherPaneId: string | null = null

    for (const pid of this.paneOrder) {
      const pane = this.panes[pid]
      if (pane?.graphTabId && pane.activeTabId === pane.graphTabId) {
        graphPaneId = pid
      } else if (!otherPaneId) {
        otherPaneId = pid
      }
    }

    // If no graph pane found, just use the non-active-graph pane
    if (!graphPaneId) {
      for (const pid of this.paneOrder) {
        if (this.panes[pid]?.graphTabId) {
          graphPaneId = pid
          break
        }
      }
    }

    if (this.splitEnabled && this.paneOrder.length >= 2) {
      // Split is active — open in whichever pane is NOT the graph pane
      const targetPaneId = this.paneOrder.find((pid) => pid !== graphPaneId) ?? this.paneOrder[0]
      const tabId = this.openTab(filePath, targetPaneId)
      this.activePaneId = targetPaneId
      return tabId
    }

    // Not split — create split, open doc in the new (secondary) pane.
    // Graph stays in its current pane untouched (no remount, no camera loss).
    this._enableSplit()

    const pane2Id = this.paneOrder[1]
    const tabId = this.openTab(filePath, pane2Id)
    this.activePaneId = pane2Id

    return tabId
  }

  /**
   * Create a new untitled document tab with empty content.
   * The tab is marked as `isUntitled` and pre-loaded with empty content
   * so it doesn't attempt to read from disk.
   * Returns the tab ID.
   */
  createUntitledTab(paneId?: string): string {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    untitledCounter++
    const fileName = `Untitled-${untitledCounter}.md`

    const tab = createDocumentTab(fileName, true)
    // Pre-load with empty content so auto-load doesn't try to read from disk
    tab.content = ''
    tab.savedContent = ''
    tab.isDirty = true
    this.tabs[tab.id] = tab

    // Insert before the graph tab
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

    this._scheduleSave()
    return tab.id
  }

  /**
   * Finalize an untitled tab after the user has chosen a filename.
   * Updates the tab's file path, title, and clears the untitled flag.
   */
  finalizeUntitledTab(tabId: string, filePath: string): void {
    const tab = this.tabs[tabId]
    if (!tab || tab.kind !== 'document' || !tab.isUntitled) return

    tab.filePath = filePath
    tab.title = fileNameFromPath(filePath)
    tab.isUntitled = false
    tab.navigation.current = filePath

    this.tabs[tabId] = { ...tab }
    this._scheduleSave()
  }

  /**
   * Open an asset (non-markdown) file in a preview tab.
   * If the file is already open, switch to that tab.
   * Returns the tab ID.
   */
  openAssetTab(filePath: string, mimeCategory: MimeCategory, fileSize?: number, paneId?: string): string {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Check if this asset is already open in this pane
    for (const tabId of pane.tabOrder) {
      const tab = this.tabs[tabId]
      if (tab && tab.kind === 'asset' && tab.filePath === filePath) {
        this.switchTab(tabId, targetPaneId)
        return tabId
      }
    }

    // Create a new asset tab
    const parts = filePath.split('/')
    const title = parts[parts.length - 1] || filePath
    const tab: AssetTab = {
      id: crypto.randomUUID(),
      kind: 'asset',
      filePath,
      title,
      mimeCategory,
      fileSize,
    }
    this.tabs[tab.id] = tab

    // Insert before the graph tab
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

    this._scheduleSave()
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

    // If this was the active tab, activate the nearest closable tab
    if (pane.activeTabId === tabId) {
      const closableTabs = pane.tabOrder.filter((id) => this.tabs[id]?.kind !== 'graph')
      if (closableTabs.length > 0) {
        const newIndex = Math.min(tabIndex, closableTabs.length - 1)
        pane.activeTabId = closableTabs[newIndex]
      } else {
        pane.activeTabId = null
      }
    }

    this.panes[targetPaneId] = { ...pane }

    // Remove tab from tabs record
    const closedTab = this.tabs[tabId]
    const { [tabId]: _, ...remainingTabs } = this.tabs
    this.tabs = remainingTabs

    // Auto-collapse split if this pane has no tabs at all
    if (this.splitEnabled && this.paneOrder.length >= 2) {
      if (pane.tabOrder.length === 0) {
        this._collapseSplit()
      }
    }

    this._scheduleSave()
    return closedTab
  }

  /**
   * Get all closeable tab IDs in a pane (excludes graph tabs).
   */
  getCloseableTabIds(paneId: string): string[] {
    const pane = this.panes[paneId]
    if (!pane) return []
    return pane.tabOrder.filter((id) => {
      const tab = this.tabs[id]
      return tab && tab.kind !== 'graph'
    })
  }

  /**
   * Get tab IDs to the left of a given tab in a pane (excludes graph tabs).
   */
  getTabIdsToLeft(tabId: string, paneId: string): string[] {
    const pane = this.panes[paneId]
    if (!pane) return []
    const idx = pane.tabOrder.indexOf(tabId)
    if (idx <= 0) return []
    return pane.tabOrder.slice(0, idx).filter((id) => {
      const tab = this.tabs[id]
      return tab && tab.kind !== 'graph'
    })
  }

  /**
   * Get tab IDs to the right of a given tab in a pane (excludes graph tabs).
   */
  getTabIdsToRight(tabId: string, paneId: string): string[] {
    const pane = this.panes[paneId]
    if (!pane) return []
    const idx = pane.tabOrder.indexOf(tabId)
    if (idx < 0) return []
    return pane.tabOrder.slice(idx + 1).filter((id) => {
      const tab = this.tabs[id]
      return tab && tab.kind !== 'graph'
    })
  }

  /**
   * Get tab IDs of all other closeable tabs in a pane (excludes the given tab and graph tabs).
   */
  getOtherTabIds(tabId: string, paneId: string): string[] {
    const pane = this.panes[paneId]
    if (!pane) return []
    return pane.tabOrder.filter((id) => {
      const tab = this.tabs[id]
      return tab && tab.kind !== 'graph' && id !== tabId
    })
  }

  /**
   * Get tab IDs of all saved (non-dirty) closeable tabs in a pane.
   */
  getSavedTabIds(paneId: string): string[] {
    const pane = this.panes[paneId]
    if (!pane) return []
    return pane.tabOrder.filter((id) => {
      const tab = this.tabs[id]
      if (!tab || tab.kind === 'graph') return false
      if (tab.kind === 'document' && tab.isDirty) return false
      return true
    })
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

    if (!fromPane.tabOrder.includes(tabId)) return false

    // Remove from source pane
    fromPane.tabOrder = fromPane.tabOrder.filter((id) => id !== tabId)

    // If moving the graph tab, update graphTabId on both panes
    if (tab.kind === 'graph') {
      fromPane.graphTabId = null
      toPane.graphTabId = tabId
    }

    // If it was active in the source pane, pick a new active tab
    if (fromPane.activeTabId === tabId) {
      const closableTabs = fromPane.tabOrder.filter((id) => this.tabs[id]?.kind !== 'graph')
      fromPane.activeTabId = closableTabs.length > 0 ? closableTabs[closableTabs.length - 1] : null
    }

    // Insert: graph tab always goes last, other tabs go before the graph tab
    if (tab.kind === 'graph') {
      toPane.tabOrder = [...toPane.tabOrder, tabId]
    } else {
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
    }

    toPane.activeTabId = tabId

    this.panes[fromPaneId] = { ...fromPane }
    this.panes[toPaneId] = { ...toPane }
    this.activePaneId = toPaneId

    // Auto-collapse split if source pane has no tabs at all
    if (this.splitEnabled && this.paneOrder.length >= 2) {
      if (fromPane.tabOrder.length === 0) {
        this._collapseSplit()
      }
    }

    this._scheduleSave()
    return true
  }

  /**
   * Split the view and move a tab to the target side in one atomic operation.
   * If not already split, creates the split first. If the source pane ends up
   * empty (no document tabs), the split auto-collapses.
   * Returns true if the tab was moved successfully.
   */
  splitAndMoveTab(tabId: string, targetSide: 'left' | 'right'): boolean {
    const tab = this.tabs[tabId]
    if (!tab || tab.kind === 'graph') return false

    const fromPaneId = this._findPaneForTab(tabId)
    if (!fromPaneId) return false

    // Enable split if not already active
    if (!this.splitEnabled) {
      this._enableSplit()
    }

    // Determine target pane
    const toPaneId = targetSide === 'left' ? this.paneOrder[0] : this.paneOrder[1]
    if (!toPaneId || fromPaneId === toPaneId) return false

    // Move the tab
    const moved = this.moveTab(tabId, fromPaneId, toPaneId)
    if (!moved) return false

    // Auto-collapse if source pane is completely empty
    const fromPane = this.panes[fromPaneId]
    if (fromPane && fromPane.tabOrder.length === 0) {
      this._collapseSplit()
    }

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
    this._scheduleSave()
  }

  /**
   * Set the split ratio (0-1) and trigger auto-save.
   */
  setSplitRatio(ratio: number): void {
    this.splitRatio = Math.max(0, Math.min(1, ratio))
    this._scheduleSave()
  }

  /**
   * Switch to the graph tab. Since there's only one graph tab in the
   * workspace, this finds whichever pane contains it and activates it.
   */
  switchToGraphTab(paneId?: string): void {
    // If a specific pane is requested and has the graph tab, use it
    if (paneId) {
      const pane = this.panes[paneId]
      if (pane?.graphTabId) {
        this.switchTab(pane.graphTabId, paneId)
        return
      }
    }

    // Find the pane that has the graph tab
    for (const pid of this.paneOrder) {
      const pane = this.panes[pid]
      if (pane?.graphTabId) {
        this.switchTab(pane.graphTabId, pid)
        return
      }
    }
  }

  /**
   * Find which pane contains a given tab ID. Returns null if not found.
   */
  findPaneForTab(tabId: string): string | null {
    return this._findPaneForTab(tabId)
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
    this._scheduleSave()
  }

  // ── Cross-Window Tab Transfer ───────────────────────────────────────

  /**
   * Serialize a tab for cross-window transfer.
   * Only document tabs can be transferred (graph tabs are pinned per pane).
   * Content is only included when the tab is dirty to avoid unnecessary data.
   */
  serializeTab(tabId: string): TabTransferData | null {
    const tab = this.tabs[tabId]
    if (!tab || tab.kind !== 'document') return null

    return {
      kind: 'document',
      filePath: tab.filePath,
      editorMode: tab.editorMode,
      isDirty: tab.isDirty,
      content: tab.isDirty ? tab.content : null,
      savedContent: tab.isDirty ? tab.savedContent : null,
    }
  }

  /**
   * Add a tab from cross-window transfer data.
   * Creates a new document tab in the target pane and makes it active.
   * Returns the new tab ID, or empty string if the data is invalid.
   */
  attachTab(data: TabTransferData, paneId?: string): string {
    if (data.kind !== 'document' || !data.filePath) return ''

    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Check if the file is already open in this pane — switch to it instead
    const existingTabId = this._findTabByFilePath(data.filePath, targetPaneId)
    if (existingTabId) {
      this.switchTab(existingTabId, targetPaneId)
      return existingTabId
    }

    // Create a new document tab from the transfer data
    const tab = createDocumentTab(data.filePath)
    if (data.editorMode) {
      tab.editorMode = data.editorMode as EditorMode
    }
    if (data.isDirty) {
      tab.isDirty = true
    }
    if (data.content !== undefined && data.content !== null) {
      tab.content = data.content
    }
    if (data.savedContent !== undefined && data.savedContent !== null) {
      tab.savedContent = data.savedContent
    }

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

    this._scheduleSave()
    return tab.id
  }

  /**
   * Detach a tab from this window and spawn it in a new window.
   * Serializes the tab, removes it from the source pane, and calls
   * the preload API to create a new window with the tab.
   * Returns the serialized tab data, or null if the tab cannot be detached.
   */
  async detachTab(tabId: string, paneId?: string): Promise<TabTransferData | null> {
    const data = this.serializeTab(tabId)
    if (!data) return null

    // Remove the tab from the source pane
    this.closeTab(tabId, paneId)

    // Spawn a new window with the detached tab via IPC
    await window.api.detachTab(data)

    return data
  }

  // ── Session Persistence ─────────────────────────────────────────────

  /**
   * Serialize the current workspace state into a PersistedWindowState.
   * Only persists file paths and layout — never file content.
   */
  serializeSession(): PersistedWindowState {
    const panes: PersistedPane[] = this.paneOrder.map((paneId) => {
      const pane = this.panes[paneId]
      if (!pane) return { tabs: [], activeTabIndex: -1 }

      const tabs: PersistedTab[] = []
      let activeTabIndex = -1

      for (let i = 0; i < pane.tabOrder.length; i++) {
        const tabId = pane.tabOrder[i]
        const tab = this.tabs[tabId]
        if (!tab) continue

        if (tab.kind === 'document') {
          // Don't persist untitled tabs — they can't be restored from disk
          if (tab.isUntitled) continue
          tabs.push({ kind: 'document', filePath: tab.filePath })
        } else if (tab.kind === 'graph') {
          tabs.push({ kind: 'graph', graphLevel: tab.graphLevel })
        } else if (tab.kind === 'asset') {
          tabs.push({ kind: 'asset', filePath: tab.filePath, mimeCategory: tab.mimeCategory })
        }

        if (tabId === pane.activeTabId) {
          activeTabIndex = tabs.length - 1
        }
      }

      return { tabs, activeTabIndex }
    })

    return {
      panes,
      splitEnabled: this.splitEnabled,
      splitRatio: this.splitRatio,
    }
  }

  /**
   * Restore workspace state from a persisted session.
   * Silently skips document tabs whose files no longer exist.
   * Validates file existence via the preload API.
   */
  async restoreSession(session: PersistedWindowState): Promise<void> {
    // Reset to clean state before restoring
    this.tabs = {}
    this.panes = {}
    this.paneOrder = []
    this.splitEnabled = false
    this.splitRatio = 0.5

    const api = window.api

    for (let paneIdx = 0; paneIdx < session.panes.length; paneIdx++) {
      const persistedPane = session.panes[paneIdx]
      const isPrimary = paneIdx === 0

      // Only the primary pane gets a graph tab (one 3D renderer only)
      let pane: PaneState
      if (isPrimary) {
        const created = createPane()
        pane = created.pane
        const graphTab = created.graphTab

        // Override graph tab settings if persisted
        const persistedGraphTab = persistedPane.tabs.find((t) => t.kind === 'graph')
        if (persistedGraphTab?.graphLevel) {
          graphTab.graphLevel = persistedGraphTab.graphLevel as GraphLevel
        }

        this.tabs[graphTab.id] = graphTab
      } else {
        pane = {
          id: crypto.randomUUID(),
          tabOrder: [],
          activeTabId: null,
          graphTabId: null,
        }
      }

      this.panes[pane.id] = pane
      this.paneOrder = [...this.paneOrder, pane.id]

      // Restore document tabs, silently skipping deleted files
      let activeTabId: string | null = null

      for (let i = 0; i < persistedPane.tabs.length; i++) {
        const persistedTab = persistedPane.tabs[i]

        if (persistedTab.kind === 'asset' && persistedTab.filePath) {
          // Restore asset tab — validate file exists via fileInfo
          let fileExists = true
          try {
            const activeCollection = await api.getActiveCollection()
            if (activeCollection) {
              const absolutePath = `${activeCollection.path}/${persistedTab.filePath}`
              await api.fileInfo(absolutePath)
            } else {
              fileExists = false
            }
          } catch {
            fileExists = false
          }
          if (!fileExists) continue

          const parts = persistedTab.filePath.split('/')
          const title = parts[parts.length - 1] || persistedTab.filePath
          const tab: AssetTab = {
            id: crypto.randomUUID(),
            kind: 'asset',
            filePath: persistedTab.filePath,
            title,
            mimeCategory: (persistedTab.mimeCategory ?? 'other') as MimeCategory,
          }
          this.tabs[tab.id] = tab

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

          if (i === persistedPane.activeTabIndex) {
            activeTabId = tab.id
          }
          continue
        }

        if (persistedTab.kind !== 'document' || !persistedTab.filePath) continue

        // Validate file still exists by attempting to read it.
        // Silently skip if the file is gone or no collection is active.
        let fileExists = true
        try {
          const activeCollection = await api.getActiveCollection()
          if (activeCollection) {
            const absolutePath = `${activeCollection.path}/${persistedTab.filePath}`
            await api.readFile(absolutePath)
          } else {
            fileExists = false
          }
        } catch {
          fileExists = false
        }

        if (!fileExists) continue

        // Create the document tab
        const tab = createDocumentTab(persistedTab.filePath)
        this.tabs[tab.id] = tab

        // Insert before the graph tab
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

        // Track active tab by persisted index
        if (i === persistedPane.activeTabIndex) {
          activeTabId = tab.id
        }
      }

      // Set active tab: use the persisted active, or the last restored document tab,
      // or null if no tabs were restored
      if (activeTabId) {
        pane.activeTabId = activeTabId
      } else {
        const docTabs = pane.tabOrder.filter((id) => this.tabs[id]?.kind === 'document')
        pane.activeTabId = docTabs.length > 0 ? docTabs[docTabs.length - 1] : null
      }

      this.panes[pane.id] = { ...pane }
    }

    // Set split state
    this.splitEnabled = session.splitEnabled && this.paneOrder.length >= 2
    this.splitRatio = session.splitRatio

    // Set active pane to the first one
    if (this.paneOrder.length > 0) {
      this.activePaneId = this.paneOrder[0]
    }

    // If no panes were restored, init a default one
    if (this.paneOrder.length === 0) {
      this._initDefaultPane()
    }

    // Enable persistence now that we've restored
    this._persistenceEnabled = true
  }

  /**
   * Schedule a debounced auto-save of the current session state.
   * Called internally after mutations that change tab/split layout.
   */
  private _scheduleSave(): void {
    if (!this._persistenceEnabled) return

    if (this._saveTimer !== null) {
      clearTimeout(this._saveTimer)
    }

    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      const session = this.serializeSession()
      window.api.saveWindowSession(session).catch(() => {
        // Best-effort persistence — don't crash on save failure
      })
    }, SESSION_SAVE_DEBOUNCE_MS)
  }

  /**
   * Enable session persistence (call after initial restore or when
   * starting fresh without a persisted session).
   */
  enablePersistence(): void {
    this._persistenceEnabled = true
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

    // Secondary pane has no graph tab — only one 3D renderer in the workspace
    const pane: PaneState = {
      id: crypto.randomUUID(),
      tabOrder: [],
      activeTabId: null,
      graphTabId: null,
    }
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

    // Move all non-graph tabs from secondary to primary
    const docTabIds = secondaryPane.tabOrder.filter(
      (id) => this.tabs[id]?.kind !== 'graph'
    )

    // If the graph tab lives in the secondary pane, move it back to primary
    if (secondaryPane.graphTabId && !primaryPane.graphTabId) {
      primaryPane.graphTabId = secondaryPane.graphTabId
      primaryPane.tabOrder = [...primaryPane.tabOrder, secondaryPane.graphTabId]
    }

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
