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
import type {
  PersistedWindowState,
  PersistedPane,
  PersistedTab,
  PersistedBottomPanel,
  TabTransferData,
  TableViewConfig
} from '../../preload/api'

// Re-export shared table-view config types for renderer consumers.
export type {
  TableViewConfig,
  TableSort,
  TableColumnLayout,
  TableColumnFilter,
  SavedTableView
} from '../../preload/api'

// ─── Asset Detection ──────────────────────────────────────────────────

/** Map of file extensions to MimeCategory for asset detection. */
const ASSET_EXT_MAP: Record<string, MimeCategory> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  pdf: 'pdf',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio'
}

/** Detect if a file path is an asset by extension. Returns MimeCategory or null. */
function detectAssetMime(filePath: string): MimeCategory | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ASSET_EXT_MAP[ext] ?? null
}

// ─── Tab Types ─────────────────────────────────────────────────────────

/** Graph coloring mode (duplicated from graph.ts to avoid circular deps). */
export type GraphColoringMode = 'cluster' | 'custom-cluster' | 'folder' | 'none'

/** localStorage key for the user's preferred graph view mode. */
const GRAPH_COLORING_MODE_KEY = 'graphColoringModeDefault'

/** Load the persisted default graph view mode ('cluster' if never set). */
export function loadDefaultGraphColoringMode(): GraphColoringMode {
  try {
    const v =
      typeof localStorage !== 'undefined' ? localStorage.getItem(GRAPH_COLORING_MODE_KEY) : null
    if (v === 'cluster' || v === 'custom-cluster' || v === 'folder' || v === 'none') return v
  } catch {
    // localStorage unavailable (e.g. non-browser test env) — fall through
  }
  return 'cluster'
}

/** Persist the default graph view mode so new graph tabs (and app restarts) start with it. */
export function saveDefaultGraphColoringMode(mode: GraphColoringMode): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GRAPH_COLORING_MODE_KEY, mode)
    }
  } catch {
    // best-effort — never break mode switching over persistence
  }
}

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
  /** True when the file was deleted on disk while open (drives the deleted banner). */
  diskMissing: boolean
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

/** A terminal tab — hosts a PTY rendered via xterm. */
export interface TerminalTab {
  id: string
  kind: 'terminal'
  /** Foreign key into the terminal store. */
  terminalId: string
  title: string
}

/** A table tab — editable frontmatter grid over a folder. */
export interface TableTab {
  id: string
  kind: 'table'
  /** Relative to collection root; '' = root (sent to the CLI as '.'). */
  folderPath: string
  /** Display title — folder name (or 'Root'). */
  title: string
  /** Include nested subfolders. */
  recursive: boolean
  /** Id of the saved view applied (null = ad-hoc/default). */
  activeViewId: string | null
  /** Ephemeral, unsaved table state overlaid on top of the active saved view. */
  ephemeral: TableViewConfig | null
}

/** Discriminated union of all tab types. */
export type TabState = DocumentTab | GraphTab | AssetTab | TerminalTab | TableTab

// ─── Pane Types ────────────────────────────────────────────────────────

/** A pane containing an ordered list of tabs. */
export interface PaneState {
  id: string
  tabOrder: string[]
  activeTabId: string | null
  /** Graph tab ID. Exactly one pane holds the graph tab (one 3D renderer); it can be moved between panes. */
  graphTabId: string | null
}

/**
 * Fixed ID of the bottom pane (the dockable panel below the editor area).
 * It lives in `panes` like any other pane — so tab moves, drops, close,
 * and keyboard shortcuts all work — but is intentionally NOT part of
 * `paneOrder`, which models only the left/right editor split.
 */
export const BOTTOM_PANE_ID = 'bottom-pane'

/** Bottom pane height bounds (px). */
export const MIN_BOTTOM_PANE_HEIGHT = 120
export const DEFAULT_BOTTOM_PANE_HEIGHT = 300

// ─── Helpers ───────────────────────────────────────────────────────────

/** Extract filename from a file path for use as tab title. */
function fileNameFromPath(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

/** Create a new graph tab. Starts in the user's persisted default view mode. */
function createGraphTab(): GraphTab {
  return {
    id: crypto.randomUUID(),
    kind: 'graph',
    title: 'Graph',
    graphLevel: 'document',
    graphPathFilter: null,
    graphColoringMode: loadDefaultGraphColoringMode()
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
    diskMissing: false,
    contentLoading: false,
    contentError: null,
    scrollPosition: 0,
    cursorPosition: 0,
    wordCount: 0,
    tokenCount: 0,
    navigation: {
      backStack: [],
      forwardStack: [],
      current: filePath
    }
  }
}

/** Create a new pane with a pinned graph tab. */
function createPane(): { pane: PaneState; graphTab: GraphTab } {
  const graphTab = createGraphTab()
  const pane: PaneState = {
    id: crypto.randomUUID(),
    tabOrder: [graphTab.id],
    activeTabId: null,
    graphTabId: graphTab.id
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

  /** Ordered list of editor pane IDs (left to right). Excludes the bottom pane. */
  paneOrder = $state<string[]>([])

  /** Backing state for activePaneId (getter/setter tracks the last editor pane). */
  private _activePaneId = $state<string>('')

  /**
   * Last focused pane that belongs to the editor row. Used to route file
   * opens to an editor pane while the bottom pane has focus.
   */
  private _lastEditorPaneId = $state<string>('')

  /** ID of the currently focused pane (editor panes or the bottom pane). */
  get activePaneId(): string {
    return this._activePaneId
  }

  set activePaneId(paneId: string) {
    this._activePaneId = paneId
    if (this.paneOrder.includes(paneId)) {
      this._lastEditorPaneId = paneId
    }
  }

  /** Whether the bottom pane is visible. Hiding it keeps its tabs alive. */
  bottomPaneOpen = $state<boolean>(false)

  /** Bottom pane height in px. */
  bottomPaneHeight = $state<number>(DEFAULT_BOTTOM_PANE_HEIGHT)

  /** Whether split pane mode is enabled. */
  splitEnabled = $state<boolean>(false)

  /** Split ratio (0-1) for the divider position. Default 0.5. */
  splitRatio = $state<number>(0.5)

  /** Debounce timer for session auto-save. */
  private _saveTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether this workspace is running in popup mode (single-content, no chrome). */
  isPopup = $state<boolean>(false)

  /** Whether session persistence is enabled (set after initial restore). */
  private _persistenceEnabled = false

  /** Listeners notified when a tab is closed (used by terminal store to dispose PTY). */
  private _tabClosedListeners: ((tab: TabState) => void)[] = []

  /**
   * Optional lookup hook for persisting terminal tab slots. The terminal
   * store registers this at init so serialize knows the shell/cwd for
   * each terminalId without a circular store import.
   */
  private _terminalSlotLookup:
    | ((terminalId: string) => { shell: string; cwd: string } | null)
    | null = null

  /**
   * Optional restore hook invoked for each persisted terminal tab during
   * restoreSession. Returns the terminalId that the tab should reference.
   */
  private _terminalSlotRestore:
    | ((slot: { shell: string; cwd: string; title?: string }) => string | null)
    | null = null

  /**
   * Hook that adopts a terminal transferred from another window: registers
   * its meta in the terminal store and rebinds the live PTY to this window.
   */
  private _terminalAdopt:
    | ((data: { terminalId: string; title: string; shell: string; cwd: string }) => void)
    | null = null

  /**
   * Hook that releases a terminal handed off to another window: drops the
   * local meta WITHOUT disposing the PTY (the adopting window owns it now).
   */
  private _terminalRelease: ((terminalId: string) => void) | null = null

  /** Register terminal-store hooks for session persistence and window transfer. */
  registerTerminalHooks(
    lookup: (terminalId: string) => { shell: string; cwd: string } | null,
    restore: (slot: { shell: string; cwd: string; title?: string }) => string | null,
    adopt?: (data: { terminalId: string; title: string; shell: string; cwd: string }) => void,
    release?: (terminalId: string) => void
  ): void {
    this._terminalSlotLookup = lookup
    this._terminalSlotRestore = restore
    if (adopt) this._terminalAdopt = adopt
    if (release) this._terminalRelease = release
  }

  /** Trigger a debounced session save (used by terminal store when panel state changes). */
  requestSave(): void {
    this._scheduleSave()
  }

  constructor() {
    this._initDefaultPane()
  }

  /** Register a listener invoked after a tab is removed from the workspace. */
  onTabClosed(cb: (tab: TabState) => void): void {
    this._tabClosedListeners.push(cb)
  }

  private _notifyTabClosed(tab: TabState): void {
    for (const cb of this._tabClosedListeners) {
      try {
        cb(tab)
      } catch {
        // ignore listener errors
      }
    }
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

  /** The bottom pane, or undefined (popup windows have none). */
  get bottomPane(): PaneState | undefined {
    return this.panes[BOTTOM_PANE_ID]
  }

  /**
   * The editor pane that file opens should target: the active pane if it is
   * an editor pane, otherwise the last-focused editor pane. Keeps file-tree /
   * quick-open opens out of the bottom pane while a terminal there has focus.
   */
  get defaultEditorPaneId(): string {
    if (this.paneOrder.includes(this._activePaneId)) return this._activePaneId
    if (this.paneOrder.includes(this._lastEditorPaneId)) return this._lastEditorPaneId
    return this.paneOrder[0] ?? this._activePaneId
  }

  // ── Bottom Pane ────────────────────────────────────────────────────

  /** Show or hide the bottom pane. Hiding keeps its tabs (and PTYs) alive. */
  setBottomPaneOpen(open: boolean): void {
    if (this.bottomPaneOpen === open) return
    this.bottomPaneOpen = open
    if (!open && this._activePaneId === BOTTOM_PANE_ID) {
      this.activePaneId = this.defaultEditorPaneId
    }
    this._scheduleSave()
  }

  /** Set the bottom pane height, clamped to [MIN, 80% of window height]. */
  setBottomPaneHeight(height: number): void {
    const maxHeight =
      typeof window !== 'undefined' && window.innerHeight
        ? Math.round(window.innerHeight * 0.8)
        : 800
    this.bottomPaneHeight = Math.max(MIN_BOTTOM_PANE_HEIGHT, Math.min(height, maxHeight))
    this._scheduleSave()
  }

  /** Move a tab into the bottom pane (opening it if hidden). */
  moveTabToBottomPane(tabId: string): boolean {
    if (!this.panes[BOTTOM_PANE_ID]) return false
    const fromPaneId = this._findPaneForTab(tabId)
    if (!fromPaneId || fromPaneId === BOTTOM_PANE_ID) return false
    return this.moveTab(tabId, fromPaneId, BOTTOM_PANE_ID)
  }

  /**
   * React to a pane becoming empty: the bottom pane auto-hides, an editor
   * pane collapses the split (mirrored behaviors).
   */
  private _handleEmptiedPane(paneId: string): void {
    if (paneId === BOTTOM_PANE_ID) {
      this.setBottomPaneOpen(false)
      return
    }
    if (this.splitEnabled && this.paneOrder.length >= 2 && this.paneOrder.includes(paneId)) {
      this._collapseSplit()
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /**
   * Open a file in a tab. If the file is already open in the active pane,
   * switch to that tab. Otherwise create a new document tab.
   * Returns the tab ID.
   */
  openTab(filePath: string, paneId?: string): string {
    const targetPaneId = paneId ?? this.defaultEditorPaneId
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
        ...pane.tabOrder.slice(graphIdx)
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
    const targetPaneId = options?.paneId ?? this.defaultEditorPaneId
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
    // Find the pane that has the graph tab (editor panes, then bottom pane)
    let graphPaneId: string | null = null
    for (const pid of [...this.paneOrder, BOTTOM_PANE_ID]) {
      if (this.panes[pid]?.graphTabId) {
        graphPaneId = pid
        break
      }
    }

    // Graph lives in the bottom pane (or nowhere): open into an editor pane
    // directly — no split gymnastics needed, the graph stays visible below.
    if (!graphPaneId || graphPaneId === BOTTOM_PANE_ID) {
      const targetPaneId = this.defaultEditorPaneId
      const tabId = this.openTab(filePath, targetPaneId)
      this.activePaneId = targetPaneId
      return tabId
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
    const targetPaneId = paneId ?? this.defaultEditorPaneId
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
        ...pane.tabOrder.slice(graphIdx)
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
  openAssetTab(
    filePath: string,
    mimeCategory: MimeCategory,
    fileSize?: number,
    paneId?: string
  ): string {
    const targetPaneId = paneId ?? this.defaultEditorPaneId
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
      fileSize
    }
    this.tabs[tab.id] = tab

    // Insert before the graph tab
    const graphIdx = pane.tabOrder.indexOf(pane.graphTabId)
    if (graphIdx >= 0) {
      pane.tabOrder = [
        ...pane.tabOrder.slice(0, graphIdx),
        tab.id,
        ...pane.tabOrder.slice(graphIdx)
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
   * Open a terminal tab hosting a PTY. The terminalId is a foreign key into
   * the terminal store, where the PTY session is tracked.
   */
  openTerminalTab(terminalId: string, title: string, paneId?: string): string {
    // Terminals default to the bottom pane (their home); popups have no
    // bottom pane and fall back to the popup's single pane.
    const targetPaneId = paneId ?? (this.panes[BOTTOM_PANE_ID] ? BOTTOM_PANE_ID : this.activePaneId)
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    if (targetPaneId === BOTTOM_PANE_ID) {
      // Spawning into the bottom pane reveals and focuses it — the user is
      // about to type into the new terminal.
      this.bottomPaneOpen = true
      this.activePaneId = BOTTOM_PANE_ID
    }

    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      kind: 'terminal',
      terminalId,
      title
    }
    this.tabs[tab.id] = tab

    // Insert before the graph tab
    const graphIdx = pane.graphTabId ? pane.tabOrder.indexOf(pane.graphTabId) : -1
    if (graphIdx >= 0) {
      pane.tabOrder = [
        ...pane.tabOrder.slice(0, graphIdx),
        tab.id,
        ...pane.tabOrder.slice(graphIdx)
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
   * Open a folder as an editable frontmatter table. If a table tab for the same
   * folder already exists in the target pane, switch to it. Returns the tab ID.
   */
  openTableTab(folderPath: string, opts?: { recursive?: boolean; paneId?: string }): string {
    const targetPaneId = opts?.paneId ?? this.defaultEditorPaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    // Dedupe: switch to an existing table tab for the same folder in this pane.
    for (const tabId of pane.tabOrder) {
      const tab = this.tabs[tabId]
      if (tab && tab.kind === 'table' && tab.folderPath === folderPath) {
        this.switchTab(tabId, targetPaneId)
        return tabId
      }
    }

    const parts = folderPath.split('/').filter(Boolean)
    const title = parts.length > 0 ? parts[parts.length - 1] : 'Root'
    const tab: TableTab = {
      id: crypto.randomUUID(),
      kind: 'table',
      folderPath,
      title,
      recursive: opts?.recursive ?? false,
      activeViewId: null,
      ephemeral: null
    }
    this.tabs[tab.id] = tab

    // Insert before the graph tab
    const graphIdx = pane.graphTabId ? pane.tabOrder.indexOf(pane.graphTabId) : -1
    if (graphIdx >= 0) {
      pane.tabOrder = [
        ...pane.tabOrder.slice(0, graphIdx),
        tab.id,
        ...pane.tabOrder.slice(graphIdx)
      ]
    } else {
      pane.tabOrder = [...pane.tabOrder, tab.id]
    }

    pane.activeTabId = tab.id
    this.panes[targetPaneId] = { ...pane }

    this._scheduleSave()
    return tab.id
  }

  /** Toggle recursive scope on a table tab. */
  setTableRecursive(tabId: string, recursive: boolean): void {
    const tab = this.tabs[tabId]
    if (tab && tab.kind === 'table') {
      this.tabs[tabId] = { ...tab, recursive }
      this._scheduleSave()
    }
  }

  /** Set the active saved view for a table tab (null = ad-hoc). Clears ephemeral edits. */
  setTableActiveView(tabId: string, viewId: string | null): void {
    const tab = this.tabs[tabId]
    if (tab && tab.kind === 'table') {
      this.tabs[tabId] = { ...tab, activeViewId: viewId, ephemeral: null }
      this._scheduleSave()
    }
  }

  /** Merge a patch into a table tab's ephemeral (unsaved) view config. */
  setTableEphemeral(tabId: string, patch: Partial<TableViewConfig>): void {
    const tab = this.tabs[tabId]
    if (tab && tab.kind === 'table') {
      const base: TableViewConfig = tab.ephemeral ?? {
        sort: [],
        filters: [],
        columns: [],
        groupBy: null,
        collapsedGroups: []
      }
      this.tabs[tabId] = { ...tab, ephemeral: { ...base, ...patch } }
      this._scheduleSave()
    }
  }

  /** Update a terminal tab's title in response to foreground-process changes. */
  setTerminalTabTitle(terminalId: string, title: string): void {
    for (const tabId of Object.keys(this.tabs)) {
      const tab = this.tabs[tabId]
      if (tab.kind === 'terminal' && tab.terminalId === terminalId) {
        tab.title = title
        this.tabs[tabId] = { ...tab }
      }
    }
  }

  /** Find the workspace tab that hosts a given terminalId (if any). */
  findTabByTerminalId(terminalId: string): string | null {
    for (const tabId of Object.keys(this.tabs)) {
      const tab = this.tabs[tabId]
      if (tab.kind === 'terminal' && tab.terminalId === terminalId) {
        return tabId
      }
    }
    return null
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

    // Auto-collapse split / auto-hide bottom pane when it has no tabs at all
    if (pane.tabOrder.length === 0) {
      this._handleEmptiedPane(targetPaneId)
    }

    if (closedTab) this._notifyTabClosed(closedTab)
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

    // Switching to a tab hidden in the bottom pane implies showing the pane
    if (targetPaneId === BOTTOM_PANE_ID && !this.bottomPaneOpen) {
      this.bottomPaneOpen = true
    }
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
          ...toPane.tabOrder.slice(graphIdx)
        ]
      } else {
        toPane.tabOrder = [...toPane.tabOrder, tabId]
      }
    }

    toPane.activeTabId = tabId

    this.panes[fromPaneId] = { ...fromPane }
    this.panes[toPaneId] = { ...toPane }
    this.activePaneId = toPaneId

    // Moving a tab into the hidden bottom pane reveals it
    if (toPaneId === BOTTOM_PANE_ID && !this.bottomPaneOpen) {
      this.bottomPaneOpen = true
    }

    // Auto-collapse split / auto-hide bottom pane when the source emptied
    if (fromPane.tabOrder.length === 0) {
      this._handleEmptiedPane(fromPaneId)
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

    // Auto-collapse / auto-hide if the source pane is completely empty
    const fromPane = this.panes[fromPaneId]
    if (fromPane && fromPane.tabOrder.length === 0) {
      this._handleEmptiedPane(fromPaneId)
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

    // Find the pane that has the graph tab (editor panes first, then bottom)
    for (const pid of [...this.paneOrder, BOTTOM_PANE_ID]) {
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
   *
   * Terminal tabs survive the reset: their PTYs are independent of the
   * vault, and wiping the tabs here would orphan the processes (no
   * onTabClosed fires). Survivors regroup in the bottom pane.
   */
  reset(): void {
    const survivingTerminals: TerminalTab[] = []
    for (const paneId of Object.keys(this.panes)) {
      for (const tabId of this.panes[paneId].tabOrder) {
        const tab = this.tabs[tabId]
        if (tab?.kind === 'terminal') survivingTerminals.push(tab)
      }
    }

    this.tabs = {}
    this.panes = {}
    this.paneOrder = []
    this.splitEnabled = false
    this.splitRatio = 0.5
    this._initDefaultPane()

    const bottomPane = this.panes[BOTTOM_PANE_ID]
    if (bottomPane && survivingTerminals.length > 0) {
      for (const tab of survivingTerminals) {
        this.tabs[tab.id] = tab
      }
      bottomPane.tabOrder = survivingTerminals.map((t) => t.id)
      bottomPane.activeTabId = survivingTerminals[survivingTerminals.length - 1].id
      this.panes[BOTTOM_PANE_ID] = { ...bottomPane }
    } else {
      this.bottomPaneOpen = false
    }
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
   * All tab kinds can be serialized for popup window transfer.
   * Content is only included when the tab is dirty to avoid unnecessary data.
   */
  serializeTab(tabId: string): TabTransferData | null {
    const tab = this.tabs[tabId]
    if (!tab) return null

    if (tab.kind === 'document') {
      const includeContent = tab.isDirty || tab.isUntitled
      return {
        kind: 'document',
        filePath: tab.filePath,
        editorMode: tab.editorMode,
        isDirty: tab.isDirty,
        isUntitled: tab.isUntitled || undefined,
        content: includeContent ? (tab.content ?? '') : null,
        savedContent: includeContent ? (tab.savedContent ?? '') : null
      }
    }

    if (tab.kind === 'asset') {
      return {
        kind: 'asset',
        filePath: tab.filePath,
        mimeCategory: tab.mimeCategory
      }
    }

    if (tab.kind === 'graph') {
      return {
        kind: 'graph',
        graphLevel: tab.graphLevel,
        graphColoringMode: tab.graphColoringMode
      }
    }

    if (tab.kind === 'table') {
      // Ephemeral (unsaved sort/columns) intentionally stays behind — same
      // semantics as session restore.
      return {
        kind: 'table',
        filePath: tab.folderPath,
        recursive: tab.recursive,
        tableViewId: tab.activeViewId ?? undefined
      }
    }

    if (tab.kind === 'terminal') {
      // The live PTY moves with the tab (rebound in the target window);
      // shell + cwd ride along as a respawn fallback if the PTY died.
      const slot = this._terminalSlotLookup?.(tab.terminalId) ?? null
      return {
        kind: 'terminal',
        terminalId: tab.terminalId,
        title: tab.title,
        shell: slot?.shell,
        cwd: slot?.cwd
      }
    }

    return null
  }

  /**
   * Add a tab from cross-window transfer data.
   * Supports document, asset, and graph tab kinds.
   * Returns the new tab ID, or empty string if the data is invalid.
   */
  attachTab(data: TabTransferData, paneId?: string): string {
    const targetPaneId = paneId ?? this.activePaneId
    const pane = this.panes[targetPaneId]
    if (!pane) return ''

    if (data.kind === 'document') {
      if (!data.filePath) return ''

      // Check if the file is already open in this pane — switch to it instead
      const existingTabId = this._findTabByFilePath(data.filePath, targetPaneId)
      if (existingTabId) {
        this.switchTab(existingTabId, targetPaneId)
        return existingTabId
      }

      const tab = createDocumentTab(data.filePath, data.isUntitled)
      if (data.editorMode) {
        tab.editorMode = data.editorMode as EditorMode
      }
      if (data.isUntitled) {
        tab.content = data.content ?? ''
        tab.savedContent = data.savedContent ?? ''
        tab.isDirty = true
      } else {
        if (data.isDirty) {
          tab.isDirty = true
        }
        if (data.content !== undefined && data.content !== null) {
          tab.content = data.content
        }
        if (data.savedContent !== undefined && data.savedContent !== null) {
          tab.savedContent = data.savedContent
        }
      }

      this.tabs[tab.id] = tab
      this._insertTabBeforeGraph(pane, tab.id)
      pane.activeTabId = tab.id
      this.panes[targetPaneId] = { ...pane }
      this._scheduleSave()
      return tab.id
    }

    if (data.kind === 'asset' && data.filePath) {
      const parts = data.filePath.split('/')
      const title = parts[parts.length - 1] || data.filePath
      const tab: AssetTab = {
        id: crypto.randomUUID(),
        kind: 'asset',
        filePath: data.filePath,
        title,
        mimeCategory: (data.mimeCategory as MimeCategory) ?? 'other'
      }
      this.tabs[tab.id] = tab
      this._insertTabBeforeGraph(pane, tab.id)
      pane.activeTabId = tab.id
      this.panes[targetPaneId] = { ...pane }
      this._scheduleSave()
      return tab.id
    }

    if (data.kind === 'graph') {
      // For graph, just switch to the existing graph tab in this pane
      if (pane.graphTabId) {
        this.switchTab(pane.graphTabId, targetPaneId)
        return pane.graphTabId
      }
      return ''
    }

    if (data.kind === 'table') {
      // openTableTab dedupes per-pane and inserts before the graph tab
      const tabId = this.openTableTab(data.filePath ?? '', {
        recursive: data.recursive,
        paneId: targetPaneId
      })
      if (data.tableViewId) this.setTableActiveView(tabId, data.tableViewId)
      return tabId
    }

    if (data.kind === 'terminal' && data.terminalId) {
      // Adopt the live PTY into this window's terminal store (rebind + replay),
      // then host it in a tab. The hook keeps workspace ⇄ terminal-store acyclic.
      this._terminalAdopt?.({
        terminalId: data.terminalId,
        title: data.title ?? 'Terminal',
        shell: data.shell ?? '',
        cwd: data.cwd ?? ''
      })
      return this.openTerminalTab(data.terminalId, data.title ?? 'Terminal', targetPaneId)
    }

    return ''
  }

  /** Insert a tab ID before the graph tab in a pane's tab order. */
  private _insertTabBeforeGraph(pane: PaneState, tabId: string): void {
    const graphIdx = pane.tabOrder.indexOf(pane.graphTabId)
    if (graphIdx >= 0) {
      pane.tabOrder = [...pane.tabOrder.slice(0, graphIdx), tabId, ...pane.tabOrder.slice(graphIdx)]
    } else {
      pane.tabOrder = [...pane.tabOrder, tabId]
    }
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

    // Remove the tab from the source pane (graph tabs are pinned so closeTab is a no-op for them)
    if (data.kind === 'terminal') {
      // The PTY must survive the move — closeTab would auto-dispose it via
      // the terminal store's onTabClosed hook. Release drops the local meta
      // (ownership transfers to the adopting window).
      this.removeTabSilently(tabId)
      if (data.terminalId) this._terminalRelease?.(data.terminalId)
    } else if (data.kind !== 'graph') {
      this.closeTab(tabId, paneId)
    }

    // Spawn a popup window with the detached tab via IPC
    await window.api.detachTab(data)

    return data
  }

  /**
   * Remove a tab from the workspace WITHOUT firing onTabClosed listeners.
   * Used when a tab's backing resource must outlive the tab (e.g. a terminal
   * PTY moving to another window or back into the bottom panel).
   */
  removeTabSilently(tabId: string): void {
    const paneId = this.findPaneForTab(tabId)
    if (!paneId) return
    const pane = this.panes[paneId]
    if (!pane) return

    pane.tabOrder = pane.tabOrder.filter((id) => id !== tabId)
    if (pane.activeTabId === tabId) {
      const remaining = pane.tabOrder.filter((id) => this.tabs[id]?.kind !== 'graph')
      pane.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null
    }
    this.panes[paneId] = { ...pane }

    const { [tabId]: _dropped, ...rest } = this.tabs
    this.tabs = rest

    // The bottom pane auto-hides when its last tab is silently removed
    // (e.g. detached to a popup). Split panes keep their layout here —
    // silent removal is a transfer, not a close.
    if (paneId === BOTTOM_PANE_ID && pane.tabOrder.length === 0) {
      this.setBottomPaneOpen(false)
    }

    this._scheduleSave()
  }

  // ── Session Persistence ─────────────────────────────────────────────

  /**
   * Serialize the current workspace state into a PersistedWindowState.
   * Only persists file paths and layout — never file content.
   */
  serializeSession(): PersistedWindowState {
    const panes: PersistedPane[] = this.paneOrder.map((paneId) =>
      this._serializePane(this.panes[paneId])
    )
    const bottomPane = this.panes[BOTTOM_PANE_ID]

    return {
      panes,
      splitEnabled: this.splitEnabled,
      splitRatio: this.splitRatio,
      bottomPane: bottomPane ? this._serializePane(bottomPane) : undefined,
      bottomPaneOpen: this.bottomPaneOpen,
      bottomPaneHeight: this.bottomPaneHeight
    }
  }

  /** Serialize one pane's tabs and active-tab index. */
  private _serializePane(pane: PaneState | undefined): PersistedPane {
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
      } else if (tab.kind === 'table') {
        tabs.push({
          kind: 'table',
          filePath: tab.folderPath,
          recursive: tab.recursive,
          tableViewId: tab.activeViewId ?? undefined
        })
      } else if (tab.kind === 'terminal') {
        // Persist terminal slots via terminal store lookup — tab itself
        // only remembers that this slot is a terminal; shell/cwd live in
        // the terminal store and are captured here by the restore hook.
        const lookup = this._terminalSlotLookup?.(tab.terminalId)
        tabs.push({
          kind: 'terminal',
          terminalShell: lookup?.shell,
          terminalCwd: lookup?.cwd,
          terminalTitle: tab.title
        })
      }

      if (tabId === pane.activeTabId) {
        activeTabIndex = tabs.length - 1
      }
    }

    return { tabs, activeTabIndex }
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

    // Exactly one pane owns the graph tab. Find the persisted owner
    // (editor panes first, then the bottom pane); fall back to pane 0.
    let graphPaneIdx = session.panes.findIndex((p) => p.tabs.some((t) => t.kind === 'graph'))
    const graphInBottom =
      graphPaneIdx < 0 && Boolean(session.bottomPane?.tabs.some((t) => t.kind === 'graph'))
    if (graphPaneIdx < 0 && !graphInBottom) graphPaneIdx = 0

    for (let paneIdx = 0; paneIdx < session.panes.length; paneIdx++) {
      const persistedPane = session.panes[paneIdx]

      let pane: PaneState
      if (paneIdx === graphPaneIdx) {
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
          graphTabId: null
        }
      }

      this.panes[pane.id] = pane
      this.paneOrder = [...this.paneOrder, pane.id]

      await this._restoreTabsIntoPane(persistedPane, pane)
    }

    // If no panes were restored, init a default layout (graph in pane 0)
    if (this.paneOrder.length === 0) {
      this._initDefaultPane()
    }

    // The bottom pane always exists in a main window. Create it — with the
    // graph tab when the persisted session kept the graph down there.
    if (!this.panes[BOTTOM_PANE_ID]) {
      const bottomPane: PaneState = {
        id: BOTTOM_PANE_ID,
        tabOrder: [],
        activeTabId: null,
        graphTabId: null
      }
      if (graphInBottom) {
        const graphTab = createGraphTab()
        const persistedGraphTab = session.bottomPane?.tabs.find((t) => t.kind === 'graph')
        if (persistedGraphTab?.graphLevel) {
          graphTab.graphLevel = persistedGraphTab.graphLevel as GraphLevel
        }
        this.tabs[graphTab.id] = graphTab
        bottomPane.graphTabId = graphTab.id
        bottomPane.tabOrder = [graphTab.id]
      }
      this.panes[BOTTOM_PANE_ID] = bottomPane
    }

    // Restore bottom-pane tabs: the new pane format wins; otherwise migrate
    // the legacy terminal-only bottomPanel (slots -> terminal tabs).
    const persistedBottom = session.bottomPane ?? this._legacyBottomPanelToPane(session.bottomPanel)
    if (persistedBottom) {
      await this._restoreTabsIntoPane(persistedBottom, this.panes[BOTTOM_PANE_ID])
    }
    this.bottomPaneOpen = session.bottomPaneOpen ?? session.bottomPanel?.open ?? false
    this.bottomPaneHeight =
      session.bottomPaneHeight ?? session.bottomPanel?.height ?? DEFAULT_BOTTOM_PANE_HEIGHT

    // Set split state
    this.splitEnabled = session.splitEnabled && this.paneOrder.length >= 2
    this.splitRatio = session.splitRatio

    // Set active pane to the first editor pane
    if (this.paneOrder.length > 0) {
      this.activePaneId = this.paneOrder[0]
    }

    // Enable persistence now that we've restored
    this._persistenceEnabled = true
  }

  /** Convert the legacy terminal-only bottom panel into a PersistedPane. */
  private _legacyBottomPanelToPane(legacy?: PersistedBottomPanel): PersistedPane | null {
    if (!legacy || legacy.slots.length === 0) return null
    return {
      tabs: legacy.slots.map((slot) => ({
        kind: 'terminal' as const,
        terminalShell: slot.shell,
        terminalCwd: slot.cwd,
        terminalTitle: slot.title
      })),
      activeTabIndex: legacy.activeIndex
    }
  }

  /**
   * Restore a persisted pane's tabs into an existing pane. Validates file
   * existence (silently skipping deleted files), respawns terminals via the
   * terminal-store hook, and resolves the active tab.
   */
  private async _restoreTabsIntoPane(persistedPane: PersistedPane, pane: PaneState): Promise<void> {
    const api = window.api
    let activeTabId: string | null = null

    for (let i = 0; i < persistedPane.tabs.length; i++) {
      const persistedTab = persistedPane.tabs[i]

      if (persistedTab.kind === 'terminal') {
        // Ask the terminal store to respawn a PTY for this slot.
        const slot = {
          shell: persistedTab.terminalShell ?? '',
          cwd: persistedTab.terminalCwd ?? '',
          title: persistedTab.terminalTitle
        }
        const terminalId = this._terminalSlotRestore?.(slot) ?? null
        if (!terminalId) continue

        const tab: TerminalTab = {
          id: crypto.randomUUID(),
          kind: 'terminal',
          terminalId,
          title: persistedTab.terminalTitle ?? 'Terminal'
        }
        this.tabs[tab.id] = tab
        this._insertTabBeforeGraph(pane, tab.id)

        if (i === persistedPane.activeTabIndex) {
          activeTabId = tab.id
        }
        continue
      }

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
          mimeCategory: (persistedTab.mimeCategory ?? 'other') as MimeCategory
        }
        this.tabs[tab.id] = tab
        this._insertTabBeforeGraph(pane, tab.id)

        if (i === persistedPane.activeTabIndex) {
          activeTabId = tab.id
        }
        continue
      }

      if (persistedTab.kind === 'table') {
        // Restore table tab — folderPath '' is the (always-valid) root.
        const folderPath = persistedTab.filePath ?? ''
        if (folderPath) {
          let folderExists = true
          try {
            const activeCollection = await api.getActiveCollection()
            if (activeCollection) {
              await api.fileInfo(`${activeCollection.path}/${folderPath}`)
            } else {
              folderExists = false
            }
          } catch {
            folderExists = false
          }
          if (!folderExists) continue
        }

        const parts = folderPath.split('/').filter(Boolean)
        const title = parts.length > 0 ? parts[parts.length - 1] : 'Root'
        const tab: TableTab = {
          id: crypto.randomUUID(),
          kind: 'table',
          folderPath,
          title,
          recursive: persistedTab.recursive ?? false,
          activeViewId: persistedTab.tableViewId ?? null,
          ephemeral: null
        }
        this.tabs[tab.id] = tab
        this._insertTabBeforeGraph(pane, tab.id)

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
      this._insertTabBeforeGraph(pane, tab.id)

      // Track active tab by persisted index
      if (i === persistedPane.activeTabIndex) {
        activeTabId = tab.id
      }
    }

    // Set active tab: the persisted active, or the last restored document
    // tab; the bottom pane additionally falls back to its last non-graph tab
    // (it commonly holds no documents at all).
    if (activeTabId) {
      pane.activeTabId = activeTabId
    } else {
      const docTabs = pane.tabOrder.filter((id) => this.tabs[id]?.kind === 'document')
      if (docTabs.length > 0) {
        pane.activeTabId = docTabs[docTabs.length - 1]
      } else if (pane.id === BOTTOM_PANE_ID) {
        const nonGraph = pane.tabOrder.filter((id) => this.tabs[id]?.kind !== 'graph')
        pane.activeTabId = nonGraph.length > 0 ? nonGraph[nonGraph.length - 1] : null
      } else {
        pane.activeTabId = null
      }
    }

    this.panes[pane.id] = { ...pane }
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

  /**
   * Synchronously flush the session to disk. Called from beforeunload so a
   * layout change made within the last debounce window isn't lost on quit.
   */
  flushSessionSync(): void {
    if (!this._persistenceEnabled || this.isPopup) return
    if (this._saveTimer !== null) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    try {
      window.api.saveWindowSessionSync?.(this.serializeSession())
    } catch {
      // best-effort — never block window teardown
    }
  }

  // ── Popup Mode ────────────────────────────────────────────────────

  /**
   * Initialize workspace in popup mode with a single pane and single tab.
   * Popup windows show one piece of content with no chrome. Session
   * persistence is disabled — popups are ephemeral.
   */
  initAsPopup(
    kind: 'document' | 'asset' | 'graph' | 'table' | 'terminal',
    options: {
      filePath?: string
      editorMode?: EditorMode
      isUntitled?: boolean
      content?: string | null
      savedContent?: string | null
      mimeCategory?: MimeCategory
      graphLevel?: GraphLevel
      graphColoringMode?: GraphColoringMode
      recursive?: boolean
      tableViewId?: string
      terminalId?: string
      title?: string
    }
  ): string {
    this.isPopup = true
    // Do not enable session persistence for popups
    this._persistenceEnabled = false

    // Create a single pane without a graph tab
    const pane: PaneState = {
      id: 'popup-pane',
      tabOrder: [],
      activeTabId: null,
      graphTabId: null
    }

    let tab: TabState

    if (kind === 'document') {
      const docTab = createDocumentTab(options.filePath ?? 'Untitled', options.isUntitled)
      if (options.editorMode) {
        docTab.editorMode = options.editorMode
      }
      if (options.isUntitled) {
        // Untitled files need empty content so the editor mounts immediately
        docTab.content = options.content ?? ''
        docTab.savedContent = options.savedContent ?? ''
        docTab.isDirty = true
      } else {
        if (options.content !== undefined && options.content !== null) {
          docTab.content = options.content
        }
        if (options.savedContent !== undefined && options.savedContent !== null) {
          docTab.savedContent = options.savedContent
        }
        if (
          options.content != null &&
          options.savedContent != null &&
          options.content !== options.savedContent
        ) {
          docTab.isDirty = true
        }
      }
      tab = docTab
    } else if (kind === 'asset') {
      const parts = (options.filePath ?? '').split('/')
      const title = parts[parts.length - 1] || 'Asset'
      tab = {
        id: crypto.randomUUID(),
        kind: 'asset',
        filePath: options.filePath ?? '',
        title,
        mimeCategory: options.mimeCategory ?? 'other'
      } as AssetTab
    } else if (kind === 'table') {
      const folderPath = options.filePath ?? ''
      const parts = folderPath.split('/').filter(Boolean)
      tab = {
        id: crypto.randomUUID(),
        kind: 'table',
        folderPath,
        title: parts.length > 0 ? parts[parts.length - 1] : 'Root',
        recursive: options.recursive ?? false,
        activeViewId: options.tableViewId ?? null,
        ephemeral: null
      } as TableTab
    } else if (kind === 'terminal') {
      tab = {
        id: crypto.randomUUID(),
        kind: 'terminal',
        terminalId: options.terminalId ?? '',
        title: options.title ?? 'Terminal'
      } as TerminalTab
    } else {
      // Graph tab
      tab = {
        id: crypto.randomUUID(),
        kind: 'graph',
        title: 'Graph',
        graphLevel: options.graphLevel ?? 'document',
        graphPathFilter: null,
        graphColoringMode: options.graphColoringMode ?? loadDefaultGraphColoringMode()
      } as GraphTab
    }

    pane.tabOrder = [tab.id]
    pane.activeTabId = tab.id
    if (kind === 'graph') {
      // Register the graph tab on the pane so getFocusedGraphTab() resolves it —
      // graphLevel/graphColoringMode reads and writes depend on pane.graphTabId.
      pane.graphTabId = tab.id
    }

    this.tabs = { [tab.id]: tab }
    this.panes = { [pane.id]: pane }
    this.paneOrder = [pane.id]
    this.activePaneId = pane.id

    return tab.id
  }

  // ── Private Helpers ────────────────────────────────────────────────

  /** Initialize with a single default editor pane (with graph tab) plus the bottom pane. */
  private _initDefaultPane(): void {
    const { pane, graphTab } = createPane()
    const bottomPane: PaneState = {
      id: BOTTOM_PANE_ID,
      tabOrder: [],
      activeTabId: null,
      graphTabId: null
    }
    this.tabs = { [graphTab.id]: graphTab }
    this.panes = { [pane.id]: pane, [BOTTOM_PANE_ID]: bottomPane }
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
      graphTabId: null
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
    const docTabIds = secondaryPane.tabOrder.filter((id) => this.tabs[id]?.kind !== 'graph')

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
      ...primaryPane.tabOrder.slice(insertIdx)
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
