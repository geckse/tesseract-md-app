import type {
  SearchOutput,
  IndexStatus,
  IngestResult,
  IngestPreview,
  FileTree,
  DocumentInfo,
  LinksOutput,
  BacklinksOutput,
  OrphansOutput,
  NeighborhoodResult,
  ClusterSummary,
  CustomClusterSummary,
  TopicDef,
  TopicUnassigned,
  GraphData,
  GraphLevel,
  Schema,
  Config,
  DoctorResult,
  AssetScanResult,
  CollectionOutput,
  JsonValue,
  WatchEventReport,
  MimeCategory
} from '../renderer/types/cli'

/** A collection (project folder) managed by the app. */
export interface Collection {
  id: string
  name: string
  path: string
  addedAt: number
  lastOpenedAt: number
}

/** A favorited file entry. */
export interface FavoriteEntry {
  collectionId: string // Which collection this file belongs to
  filePath: string // Relative path within the collection
  addedAt: number // Unix timestamp
}

/** A recently opened file entry. */
export interface RecentEntry {
  collectionId: string
  filePath: string
  openedAt: number // Unix timestamp, updated on each open
}

/** Options for the search command. */
export interface SearchOptions {
  limit?: number
  mode?: string
  path?: string
  filter?: string
  expand?: number
  hops?: number
  boostLinks?: boolean
}

/** Options for the ingest command. */
export interface IngestOptions {
  reindex?: boolean
}

/** Options for the collection (folder-as-table) command. */
export interface CollectionViewOptions {
  recursive?: boolean
  /** Frontmatter field name to sort by (separate from `order`). */
  sort?: string
  order?: 'asc' | 'desc'
  /** Repeatable server-side equality filters, each `KEY=VALUE`. */
  filter?: string[]
  limit?: number
  offset?: number
}

/** Result of CLI detection. */
export interface CliDetectResult {
  found: boolean
  path?: string
  version?: string
}

/** Progress update during CLI installation. */
export interface CliInstallProgress {
  stage: string
  percent?: number
  error?: string
}

/** Result of CLI installation. */
export interface CliInstallResult {
  success: boolean
  path: string
  version: string
  error?: string
}

/** A persisted tab — only file paths and layout, never file content. */
export interface PersistedTab {
  kind: 'document' | 'graph' | 'asset' | 'terminal' | 'table'
  filePath?: string
  graphLevel?: string
  mimeCategory?: string
  terminalShell?: string
  terminalCwd?: string
  terminalTitle?: string
  /** For table tabs: include nested subfolders. */
  recursive?: boolean
  /** For table tabs: the saved view id applied on open. */
  tableViewId?: string
}

/** A persisted pane within a window session. */
export interface PersistedPane {
  tabs: PersistedTab[]
  activeTabIndex: number
}

// ─── Table view config (shared shape; persisted in saved views) ──────

/** A single sort directive over a table column. */
export interface TableSort {
  columnName: string
  direction: 'asc' | 'desc'
}

/** Per-column layout state (visibility, width, order). */
export interface TableColumnLayout {
  /** Frontmatter key (== CLI column.name), or '__title__' for the Title column. */
  name: string
  hidden: boolean
  width: number
  order: number
}

/** A typed filter over a column. `equals` maps to the CLI; the rest are client-side in v1. */
export interface TableColumnFilter {
  columnName: string
  op: 'equals' | 'in' | 'range' | 'exists' | 'contains'
  value?: JsonValue
  values?: JsonValue[]
  min?: JsonValue
  max?: JsonValue
}

/** Composable, persistable table view configuration. */
export interface TableViewConfig {
  sort: TableSort[]
  filters: TableColumnFilter[]
  columns: TableColumnLayout[]
  groupBy: string | null
  collapsedGroups: string[]
}

/** Current config schema version for saved views (bump on shape changes). */
export type SavedTableViewVersion = number

/** A named, persisted table view, keyed by collection + folder. */
export interface SavedTableView {
  id: string
  name: string
  version: SavedTableViewVersion
  config: TableViewConfig
  recursive: boolean
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

/** A persisted slot in the legacy bottom panel (terminal) — shell + cwd only. */
export interface PersistedTerminalSlot {
  shell: string
  cwd: string
  title?: string
}

/**
 * LEGACY persisted bottom panel (pre bottom-pane unification). Read once for
 * migration into `PersistedWindowState.bottomPane`; never written anymore.
 */
export interface PersistedBottomPanel {
  open: boolean
  height: number
  slots: PersistedTerminalSlot[]
  activeIndex: number
}

/** Persisted window state — restored on app restart. */
export interface PersistedWindowState {
  panes: PersistedPane[]
  splitEnabled: boolean
  splitRatio: number
  /** The bottom pane — same shape as editor panes (any tab kind). */
  bottomPane?: PersistedPane
  bottomPaneOpen?: boolean
  bottomPaneHeight?: number
  /** Legacy field (terminal-only bottom panel). Migrated on restore. */
  bottomPanel?: PersistedBottomPanel
}

/**
 * Serialized tab data for cross-window transfer (detach/attach).
 * Content is only included when the tab is dirty (unsaved changes).
 * Clean tabs reload content from disk in the target window.
 */
export interface TabTransferData {
  kind: 'document' | 'asset' | 'graph' | 'table' | 'terminal'
  /** For 'table' tabs this carries the folder path ('' = collection root). */
  filePath?: string
  editorMode?: string
  isDirty?: boolean
  isUntitled?: boolean
  content?: string | null
  savedContent?: string | null
  mimeCategory?: string
  graphLevel?: string
  graphColoringMode?: string
  recursive?: boolean
  tableViewId?: string
  /** Terminal tabs: the live PTY id (session survives the move via rebind). */
  terminalId?: string
  title?: string
  shell?: string
  cwd?: string
}

/** Options for opening a popup window (renderer → main). */
export interface PopupOpenOptions {
  kind: 'document' | 'asset' | 'graph' | 'table' | 'terminal'
  filePath?: string
  editorMode?: string
  isUntitled?: boolean
  collectionId?: string
  collectionPath?: string
  mimeCategory?: string
  graphLevel?: string
  graphColoringMode?: string
  isDirty?: boolean
  content?: string | null
  savedContent?: string | null
  recursive?: boolean
  tableViewId?: string
  terminalId?: string
  title?: string
  shell?: string
  cwd?: string
}

/** Data sent to popup renderer for dirty document transfer (main → renderer). */
export interface PopupInitData {
  content: string | null
  savedContent: string | null
  isDirty: boolean
}

/** Typed API exposed to the renderer process via contextBridge. */
export interface MdvdbApi {
  findCli(): Promise<string>
  getCliVersion(): Promise<string>
  search(root: string, query: string, options?: SearchOptions): Promise<SearchOutput>
  status(root: string): Promise<IndexStatus>
  ingest(root: string, options?: IngestOptions): Promise<IngestResult>
  ingestPreview(root: string): Promise<IngestPreview>
  tree(root: string, path?: string): Promise<FileTree>
  getFile(root: string, filePath: string): Promise<DocumentInfo>
  links(root: string, filePath: string): Promise<LinksOutput>
  backlinks(root: string, filePath: string): Promise<BacklinksOutput>
  neighborhood(root: string, filePath: string, depth: number): Promise<NeighborhoodResult>
  orphans(root: string): Promise<OrphansOutput>
  clusters(root: string): Promise<ClusterSummary[]>
  customClusters(root: string): Promise<CustomClusterSummary[]>
  clusterDefinitions(root: string): Promise<TopicDef[]>
  addTopic(root: string, def: TopicDef): Promise<void>
  updateTopic(root: string, name: string, def: TopicDef): Promise<void>
  removeTopic(root: string, name: string): Promise<void>
  topicUnassigned(root: string): Promise<TopicUnassigned>
  setConfigValue(root: string, key: string, value: string): Promise<void>
  graphData(root: string, level?: GraphLevel, path?: string): Promise<GraphData>
  schema(root: string, path?: string): Promise<Schema>
  collection(
    root: string,
    folderPath: string,
    options?: CollectionViewOptions
  ): Promise<CollectionOutput>
  config(root: string): Promise<Config>
  doctor(root: string): Promise<DoctorResult>
  init(root: string): Promise<void>
  resetIndex(root: string): Promise<void>

  // Collection management
  listCollections(): Promise<Collection[]>
  addCollection(): Promise<Collection | null>
  removeCollection(id: string): Promise<void>
  setActiveCollection(id: string): Promise<void>
  getActiveCollection(): Promise<Collection | null>

  // File operations
  readFile(absolutePath: string): Promise<string>
  writeFile(absolutePath: string, content: string): Promise<void>
  /**
   * Safely update a single file's YAML frontmatter (set/unset keys), preserving
   * the body byte-for-byte. Resolves the absolute path from (collectionId,
   * relativePath) in the main process. Returns the updated frontmatter object.
   */
  updateFrontmatter(
    collectionId: string,
    relativePath: string,
    patch: { set?: Record<string, JsonValue>; unset?: string[] }
  ): Promise<Record<string, JsonValue>>
  createFile(absolutePath: string, content: string): Promise<void>
  createDirectory(absolutePath: string): Promise<void>
  readBinary(absolutePath: string): Promise<string>
  writeBinary(absolutePath: string, base64Data: string): Promise<void>
  fileInfo(absolutePath: string): Promise<{ size: number; mtime: string }>
  copyFile(sourcePath: string, destPath: string): Promise<void>
  isWithinCollection(
    absolutePath: string
  ): Promise<{ within: boolean; collectionPath: string | null }>
  renameFile(oldAbsolutePath: string, newAbsolutePath: string): Promise<void>
  deleteFile(absolutePath: string): Promise<void>

  // Asset scanning
  scanAssets(collectionPath: string): Promise<AssetScanResult>

  // Get native file path from a dropped File object (Electron webUtils)
  getPathForFile(file: File): string

  // Shell operations
  showItemInFolder(absolutePath: string): Promise<void>
  openPath(absolutePath: string): Promise<void>

  // Clipboard operations
  writeToClipboard(text: string): Promise<void>

  // Single-file ingest
  ingestFile(root: string, filePath: string, options?: IngestOptions): Promise<IngestResult>

  // Favorites management
  listFavorites(): Promise<FavoriteEntry[]>
  addFavorite(collectionId: string, filePath: string): Promise<void>
  removeFavorite(collectionId: string, filePath: string): Promise<void>
  isFavorite(collectionId: string, filePath: string): Promise<boolean>

  // Recents management
  listRecents(): Promise<RecentEntry[]>
  addRecent(collectionId: string, filePath: string): Promise<void>
  clearRecents(): Promise<void>

  // Saved table views (per collection + folder)
  listTableViews(collectionId: string, folderPath: string): Promise<SavedTableView[]>
  saveTableView(
    collectionId: string,
    folderPath: string,
    view: SavedTableView
  ): Promise<SavedTableView[]>
  updateTableView(
    collectionId: string,
    folderPath: string,
    view: SavedTableView
  ): Promise<SavedTableView[]>
  deleteTableView(
    collectionId: string,
    folderPath: string,
    viewId: string
  ): Promise<SavedTableView[]>
  setDefaultTableView(
    collectionId: string,
    folderPath: string,
    viewId: string
  ): Promise<SavedTableView[]>

  // Window state persistence
  setSidebarWidth(width: number): Promise<void>
  setMetadataPanelWidth(width: number): Promise<void>
  getSidebarWidth(): Promise<number>
  getMetadataPanelWidth(): Promise<number>

  // Ingest cancellation
  cancelIngest(): Promise<void>

  // Watcher management
  startWatcher(root: string): Promise<void>
  stopWatcher(): Promise<void>
  getWatcherStatus(): Promise<WatcherStatus>
  onWatcherEvent(callback: (event: WatcherEvent) => void): void
  removeWatcherEventListener(): void

  // Vault watcher (Tier-1 raw fs events; lifecycle is main-owned)
  getVaultWatcherStatus(): Promise<VaultWatcherStatus>
  onVaultFileEvents(callback: (batch: VaultEventBatch) => void): void
  removeVaultFileEventsListener(): void
  onVaultWatcherStatus(callback: (status: VaultWatcherStatus) => void): void
  removeVaultWatcherStatusListener(): void

  // Native menu events
  onMenuOpenRecent(callback: (data: { collectionId: string; filePath: string }) => void): void
  removeMenuOpenRecentListener(): void

  // CLI detection & installation
  detectCli(): Promise<CliDetectResult>
  installCli(): Promise<CliInstallResult>
  onInstallProgress(callback: (progress: CliInstallProgress) => void): void
  removeInstallProgressListener(): void
  checkLatestCliVersion(): Promise<string>

  // User-level config (~/.mdvdb/config)
  getUserConfig(): Promise<Record<string, string>>
  setUserConfig(key: string, value: string): Promise<void>
  deleteUserConfig(key: string): Promise<void>

  // Collection-level config (.markdownvdb/.config)
  getCollectionConfig(root: string): Promise<Record<string, string>>
  setCollectionConfig(root: string, key: string, value: string): Promise<void>
  deleteCollectionConfig(root: string, key: string): Promise<void>

  // Onboarding state
  getOnboardingComplete(): Promise<boolean>
  setOnboardingComplete(value: boolean): Promise<void>

  // Editor preferences
  getEditorFontSize(): Promise<number>
  setEditorFontSize(value: number): Promise<void>
  getAutoShowDiff(): Promise<boolean>
  setAutoShowDiff(value: boolean): Promise<void>
  getWatcherEnabled(collectionId: string): Promise<boolean>
  setWatcherEnabled(collectionId: string, enabled: boolean): Promise<void>

  // Zoom
  getZoomLevel(): Promise<number>
  setZoomLevel(value: number): Promise<void>

  // Accent color
  getPrimaryColor(): Promise<string | null>
  setPrimaryColor(hex: string | null): Promise<void>
  getCollectionColor(collectionId: string): Promise<string | null>
  setCollectionColor(collectionId: string, hex: string | null): Promise<void>

  // Theme
  getTheme(): Promise<string>
  setTheme(mode: string): Promise<void>
  getCollectionTheme(collectionId: string): Promise<string | null>
  setCollectionTheme(collectionId: string, mode: string | null): Promise<void>

  // Window session persistence
  saveWindowSession(session: PersistedWindowState): Promise<void>
  /** Synchronous flush for beforeunload — survives window teardown. */
  saveWindowSessionSync(session: PersistedWindowState): void
  getWindowSession(): Promise<PersistedWindowState | null>

  // Multi-window management
  newWindow(): Promise<void>

  // Cross-window tab transfer
  detachTab(tabData: TabTransferData): Promise<void>
  onTabAttach(callback: (data: TabTransferData) => void): void
  removeTabAttachListener(): void

  // Cross-window file sync
  onFileSavedExternally(callback: (data: { path: string; content: string }) => void): void
  removeFileSavedExternallyListener(): void

  // Popup windows
  openPopup(options: PopupOpenOptions): Promise<void>
  onPopupInit(callback: (data: PopupInitData) => void): void
  removePopupInitListener(): void
  updatePopupTitle(title: string): Promise<void>
  setPopupAlwaysOnTop(enabled: boolean): Promise<void>
  popBack(tabData: TabTransferData): Promise<void>

  // Auto-updater
  checkForUpdates(): Promise<UpdateCheckResult>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  getAppVersion(): Promise<string>
  onUpdateEvent(callback: (event: UpdateEvent) => void): void
  removeUpdateEventListener(): void

  // Terminal (embedded PTY)
  terminalCreate(opts: TerminalCreateOpts): Promise<TerminalCreateResult>
  terminalWrite(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalDispose(id: string): Promise<void>
  terminalList(): Promise<TerminalInfo[]>
  /** Adopt a PTY into this window; returns buffered scrollback for repaint. */
  terminalRebind(id: string): Promise<{ scrollback: string; shell: string; cwd: string }>
  onTerminalData(
    callback: (payload: TerminalDataPayload) => void
  ): (payload: TerminalDataPayload) => void
  onTerminalExit(
    callback: (payload: TerminalExitPayload) => void
  ): (payload: TerminalExitPayload) => void
  onTerminalTitle(
    callback: (payload: TerminalTitlePayload) => void
  ): (payload: TerminalTitlePayload) => void
  removeTerminalDataListener(handler: (payload: TerminalDataPayload) => void): void
  removeTerminalExitListener(handler: (payload: TerminalExitPayload) => void): void
  removeTerminalTitleListener(handler: (payload: TerminalTitlePayload) => void): void

  // Terminal settings (persisted via electron-store)
  getTerminalShellPath(): Promise<string>
  setTerminalShellPath(value: string): Promise<void>
  getTerminalShellArgs(): Promise<string>
  setTerminalShellArgs(value: string): Promise<void>
  getTerminalFontSize(): Promise<number>
  setTerminalFontSize(value: number): Promise<void>

  // Home directory (fallback cwd)
  getHomeDir(): Promise<string>
}

/** Result of checking for updates. */
export interface UpdateCheckResult {
  updateAvailable: boolean
  version?: string
  releaseNotes?: string
}

/** Current status of the auto-updater. */
export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
  version?: string
  progress?: number
  error?: string
}

/** Event emitted by the auto-updater. */
export interface UpdateEvent {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  data: UpdateCheckResult | UpdateStatus | { percent: number } | { error: string } | null
}

/** Watcher status returned by getWatcherStatus. */
export interface WatcherStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  running: boolean
  root: string | null
}

/** Options for creating a new terminal PTY (renderer → main). */
export interface TerminalCreateOpts {
  id: string
  cwd: string
  shell?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
}

/** Result of creating a terminal PTY (main → renderer). */
export interface TerminalCreateResult {
  pid: number
  shell: string
}

/** Info about a live terminal PTY. */
export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  status: 'running' | 'exited'
}

/** Payload pushed from main when a PTY emits stdout/stderr. */
export interface TerminalDataPayload {
  id: string
  data: string
}

/** Payload pushed from main when a PTY exits. */
export interface TerminalExitPayload {
  id: string
  code: number
  signal?: number
}

/** Payload pushed from main when a PTY's foreground title changes. */
export interface TerminalTitlePayload {
  id: string
  title: string
}

/** Watcher event forwarded from the main process. */
export type WatcherEvent =
  | { type: 'watch-event'; data: WatchEventReport }
  | { type: 'state-change'; data: WatcherStatus['state'] }
  | { type: 'error'; data: { message: string } }

/** Kind of raw filesystem change observed by the vault watcher. */
export type VaultFileEventKind = 'created' | 'modified' | 'deleted' | 'renamed'

/** A raw (pre-reindex) filesystem event inside the active collection. */
export interface VaultFileEvent {
  kind: VaultFileEventKind
  /** Relative to the collection root, POSIX separators (matches FileTreeNode.path). */
  path: string
  /** Only for kind 'renamed' (app-synthesized): previous relative path. */
  oldPath?: string
  isDirectory: boolean
  /** Precomputed classification; null for directories. */
  fileKind: 'markdown' | 'asset' | null
  /** Asset mime category (null for markdown files and directories). */
  mimeCategory: MimeCategory | null
  mtimeMs: number | null
  size: number | null
  /** 'app' when matched against the recent-own-writes registry, else 'external'. */
  origin: 'app' | 'external'
  ts: number
}

/** Micro-batched vault watcher events broadcast to all windows. */
export interface VaultEventBatch {
  /** Absolute collection root the watcher was watching — consumers filter on this. */
  root: string
  events: VaultFileEvent[]
  /** True when the burst exceeded the batch cap: events is truncated; consumers must resync. */
  overflow: boolean
}

/** Lifecycle status of the Tier-1 vault watcher. */
export interface VaultWatcherStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  root: string | null
  message?: string
}

declare global {
  interface Window {
    api: MdvdbApi
    electron: typeof import('@electron-toolkit/preload').electronAPI
  }
}
