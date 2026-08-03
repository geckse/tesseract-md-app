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
  CompactGraphData,
  GraphLevel,
  Schema,
  Config,
  DoctorResult,
  VaultInfo,
  AssetScanResult,
  CollectionOutput,
  JsonValue,
  WatchEventReport,
  MimeCategory,
  FormulaResultType,
  FormulaValidationResult,
  LookupRollupDefinition,
  ModuleDescriptor,
  ModuleReport,
  ShardInfo,
  ShardList,
  ShardMutation
} from '../renderer/types/cli'
import type { PropertyValueColors, PropertyValueColorSelection } from '../shared/value-colors'
import type { ExternalLinkPreview, LocalLinkPreview } from '../shared/link-preview'
import type {
  ImageEditRequest,
  ImageEditResult,
  ImageReadResult,
  ImageSavedExternallyEvent
} from '../shared/image-edit'
import type {
  ComputedEditorFlushRequest,
  ComputedEditorFlushResponse,
  ComputedSchemaAppliedEvent
} from '../shared/computed-editor-flush'

export type { PropertyValueColors, PropertyValueColorSelection } from '../shared/value-colors'
export type { ExternalLinkPreview, LocalLinkPreview } from '../shared/link-preview'
export type {
  CropAspectPreset,
  ImageEditDraft,
  ImageEditRecipe,
  ImageEditRequest,
  ImageEditResult,
  ImageReadResult,
  ImageSavedExternallyEvent,
  ImageRotation,
  NormalizedCropRect
} from '../shared/image-edit'

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

/** Supported project-local agent skill directories. */
export type CollectionSkillsTargetId = 'claude' | 'agents' | 'gemini'

export interface CollectionSkillsTarget {
  id: CollectionSkillsTargetId
  label: string
  relativePath: string
  state: 'missing' | 'outdated' | 'current' | 'blocked'
  installedSkillCount: number
  totalSkillCount: number
  agentDirectoryPresent: boolean
}

/** Health of the app-bundled Tesseract skills inside one collection. */
export interface CollectionSkillsStatus {
  state: 'missing' | 'outdated' | 'current'
  bundleVersion: string
  bundleFingerprint: string
  skillCount: number
  targets: CollectionSkillsTarget[]
  recommendedTargetId: CollectionSkillsTargetId
  dismissedForever: boolean
}

/** A simple confirmation rendered with the operating system's native dialog. */
export interface NativeConfirmationOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

/** A simple one-action message rendered with the operating system's native dialog. */
export interface NativeMessageOptions {
  title: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

/** A native menu command pushed from main via the `menu:command` channel (phase 43). */
export interface MenuCommand {
  id: string
  payload?: unknown
}

/** Transient state used to keep the native Graph menu in sync with its focused view. */
export interface GraphMenuContext {
  active: boolean
  ready: boolean
  labelsVisible: boolean
  linesVisible: boolean
  shapesVisible: boolean
  shapesAvailable: boolean
  unconnectedHighlighted: boolean
  unconnectedCount: number
  hasSelection: boolean
  presentationState: 'idle' | 'playing' | 'paused'
  exportingScreenshot: boolean
  level: 'document' | 'chunk'
  coloringMode: 'cluster' | 'custom-cluster' | 'folder' | 'none'
  topicsAvailable: boolean
}

/**
 * Broadcast from main via `topics:obsidian-synced` after an Obsidian vault
 * sync changed at least one topic (phase 44). The first sync of a fresh
 * vault is a pure import (`updated`/`removed` empty).
 */
export interface ObsidianTopicsSyncedEvent {
  collectionId: string
  root: string
  added: string[]
  updated: string[]
  removed: string[]
}

/**
 * Request for `export:save` — export via native save dialog (phase 43).
 * `content` is a string for text formats (html/text/rtf/markdown) and an
 * ArrayBuffer or Uint8Array for binary formats (PNG/docx/odt/epub).
 */
export interface ExportSaveRequest {
  defaultName: string
  content: string | ArrayBuffer | Uint8Array
  filters: { name: string; extensions: string[] }[]
}

/** Request for `export:pdf` — standalone HTML printed to PDF (phase 43). */
export interface ExportPdfRequest {
  defaultName: string
  html: string
}

/** Result of an export operation; `saved: false` means the dialog was canceled. */
export interface ExportResult {
  saved: boolean
  path?: string
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
  /** Resolve frontmatter relations on the returned page rows (phase 42). Never pass on unsupported CLIs. */
  populate?: boolean
}

/** Options for the get (single document) command. */
export interface GetFileOptions {
  /** Resolve frontmatter relations + referenced_by (phase 42). Never pass on unsupported CLIs. */
  populate?: boolean
}

/** Fields accepted when creating a project-local Shard definition. */
export interface AddShardOptions {
  name?: string
  createDir?: boolean
}

/** Editable Shard fields. IDs are intentionally immutable. */
export interface UpdateShardOptions {
  name?: string
  path?: string
  createDir?: boolean
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

// ─── Property type conversion / schema editing (phase 41) ────────────

/**
 * UI-level property type. Mirrors the renderer's `DetectedType`
 * (`PropertyRow.svelte`) — defined here too so the main process can share it.
 */
export type PropertyTargetType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'url'
  | 'email'
  | 'select'
  | 'tags'
  | 'relation'
  | 'file'
  | 'complex'

/** A recursive property operation: add, retype, rename, or vault-wide drop. */
export type PropertyOp =
  | { kind: 'add'; target: PropertyTargetType; allowedValues?: string[] }
  | { kind: 'convert'; target: PropertyTargetType; allowedValues?: string[] }
  | { kind: 'rename'; newKey: string }
  | { kind: 'drop'; confirmedPaths?: string[] }

/**
 * Request for a property operation. `scope` is the folder subtree (relative
 * path, no trailing slash; `''`/`'.'` = whole vault); `scope: null` targets the
 * single `filePath` only (vault-root files — no overlay pin). Drop ignores
 * `scope`/`filePath` and always targets the entire vault.
 */
export interface PropertyOpRequest {
  collectionId: string
  scope: string | null
  filePath: string | null
  key: string
  op: PropertyOp
}

/** Per-file outcome the preview predicts. */
export type PropertyOpPlanAction =
  | 'add'
  | 'convert'
  | 'rename'
  | 'drop'
  | 'unchanged'
  | 'no-value'
  | 'skip'

/** One file's row in the preview plan (values display-truncated). */
export interface PropertyOpPlanEntry {
  path: string
  action: PropertyOpPlanAction
  before: string | null
  after: string | null
  /** Why a skipped/unchanged entry will not be written. */
  reason?: string
}

/** The schema-overlay pin the apply step will write (null = no pin). */
export interface PropertyOpSchemaPin {
  /** Overlay scope key (no trailing slash), or null for the global `fields:` section. */
  scopeKey: string | null
  fieldType: string
  allowedValues?: string[]
}

/** Full preview of a property operation across its scope. */
export interface PropertyOpPlan {
  scope: string | null
  files: PropertyOpPlanEntry[]
  totals: {
    add: number
    convert: number
    drop: number
    unchanged: number
    noValue: number
    skip: number
  }
  schemaPin: PropertyOpSchemaPin | null
}

/** One file's outcome after apply. */
export interface PropertyOpResultEntry {
  path: string
  status: 'ok' | 'skipped' | 'failed'
  reason?: string
}

/** Batch result: every enumerated file is accounted for. */
export interface PropertyOpResult {
  entries: PropertyOpResultEntry[]
  totals: { ok: number; skipped: number; failed: number }
  overlayWritten: boolean
}

/** Streaming progress for a running property operation. */
export interface PropertyOpProgress {
  opId: string
  done: number
  total: number
  path: string
}

/** Overlay annotation patch (null clears the annotation). */
export interface OverlayFieldPatch {
  fieldType?: string | null
  description?: string | null
  required?: boolean | null
  allowedValues?: string[] | null
  /** Relation target folder annotation (phase 42; no trailing slash; null clears). */
  target?: string | null
  /** JavaScript-style expression for a formula field; null clears it. */
  formula?: string | null
  /** Declared formula output type; null clears it. */
  resultType?: FormulaResultType | null
  /** Relation field traversed by Lookup/Rollup; null clears it. */
  relationField?: string | null
  /** Related-document field retrieved by Lookup/Rollup; null clears it. */
  targetField?: string | null
  /** Traversal direction; Lookup supports outgoing only. */
  relationDirection?: 'outgoing' | 'incoming' | null
  /** Relative collection scope containing related documents. */
  relationScope?: string | null
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
  imageEditDraft?: ImageEditDraft
  graphLevel?: string
  graphColoringMode?: string
  /** Shard analysis context for graph tabs; null explicitly selects the collection root. */
  shardId?: string | null
  /** Optional descendant folder filter inside the graph's Shard/collection boundary. */
  graphPathFilter?: string | null
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
  /** Default collection-relative directory for an untitled note's first save. */
  defaultDirectory?: string
  mimeCategory?: string
  graphLevel?: string
  graphColoringMode?: string
  /** Immutable Shard id selecting graph analysis context. */
  shardId?: string
  /** Optional descendant folder filter within the active graph boundary. */
  graphPathFilter?: string
  isDirty?: boolean
  content?: string | null
  savedContent?: string | null
  imageEditDraft?: ImageEditDraft
  recursive?: boolean
  tableViewId?: string
  terminalId?: string
  title?: string
  shell?: string
  cwd?: string
}

/** Data sent to a popup renderer for dirty document or image transfer. */
export interface PopupInitData {
  content: string | null
  savedContent: string | null
  isDirty: boolean
  imageEditDraft?: ImageEditDraft
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
  getFile(root: string, filePath: string, options?: GetFileOptions): Promise<DocumentInfo>
  links(root: string, filePath: string): Promise<LinksOutput>
  backlinks(root: string, filePath: string): Promise<BacklinksOutput>
  neighborhood(root: string, filePath: string, depth: number): Promise<NeighborhoodResult>
  orphans(root: string): Promise<OrphansOutput>
  clusters(root: string, shardId?: string): Promise<ClusterSummary[]>
  customClusters(root: string, shardId?: string): Promise<CustomClusterSummary[]>
  clusterDefinitions(root: string, shardId?: string): Promise<TopicDef[]>
  addTopic(root: string, def: TopicDef, shardId?: string): Promise<void>
  updateTopic(root: string, name: string, def: TopicDef, shardId?: string): Promise<void>
  removeTopic(root: string, name: string, shardId?: string): Promise<void>
  topicUnassigned(root: string, shardId?: string): Promise<TopicUnassigned>
  onObsidianTopicsSynced(callback: (event: ObsidianTopicsSyncedEvent) => void): void
  removeObsidianTopicsSyncedListener(): void
  setConfigValue(root: string, key: string, value: string): Promise<void>
  graphData(
    root: string,
    level?: GraphLevel,
    path?: string,
    shardId?: string
  ): Promise<CompactGraphData>
  schema(root: string, path?: string): Promise<Schema>
  collection(
    root: string,
    folderPath: string,
    options?: CollectionViewOptions
  ): Promise<CollectionOutput>
  config(root: string): Promise<Config>
  doctor(root: string): Promise<DoctorResult>
  info(root: string, path?: string): Promise<VaultInfo>
  init(root: string): Promise<void>
  resetIndex(root: string): Promise<void>
  /** Parse and validate one formula without mutating schema or index state. */
  validateFormula(
    root: string,
    formula: string,
    resultType: FormulaResultType
  ): Promise<FormulaValidationResult>
  /** Recompute and materialize formulas into Markdown for the vault or one folder scope. */
  runFormulaModule(root: string, scope?: string): Promise<ModuleReport>
  /** List compiled-in CLI modules for capability detection. */
  listModules(root: string): Promise<ModuleDescriptor[]>
  /** Validate a Rollup expression in the lookup_rollup module sandbox. */
  validateRollup(
    root: string,
    formula: string,
    resultType: FormulaResultType
  ): Promise<FormulaValidationResult>

  // Named Shards (project-local definitions stored by the CLI)
  listShards(root: string): Promise<ShardList>
  getShard(root: string, id: string): Promise<ShardInfo>
  addShard(
    root: string,
    id: string,
    path: string,
    options?: AddShardOptions
  ): Promise<ShardMutation>
  updateShard(root: string, id: string, options: UpdateShardOptions): Promise<ShardMutation>
  removeShard(root: string, id: string): Promise<ShardMutation>
  retargetShards(root: string, oldPrefix: string, newPrefix: string): Promise<ShardMutation>
  getActiveShardId(collectionId: string): Promise<string | null>
  setActiveShardId(collectionId: string, shardId: string | null): Promise<void>
  onShardsInvalidated(callback: (event: { root: string }) => void): void
  removeShardsInvalidatedListener(): void

  // Collection management
  listCollections(): Promise<Collection[]>
  addCollection(): Promise<Collection | null>
  createExampleCollection(): Promise<Collection>
  removeCollection(id: string): Promise<void>
  setActiveCollection(id: string): Promise<void>
  getActiveCollection(): Promise<Collection | null>
  checkCollectionSkills(collectionId: string): Promise<CollectionSkillsStatus>
  installCollectionSkills(
    collectionId: string,
    targetId: CollectionSkillsTargetId
  ): Promise<CollectionSkillsStatus>
  setCollectionSkillsDismissed(collectionId: string, dismissed: boolean): Promise<void>

  // File operations
  readFile(absolutePath: string): Promise<string>
  writeFile(absolutePath: string, content: string): Promise<void>
  /**
   * Write only when the file still exactly matches the caller's baseline.
   * Used by computed-schema transactions to avoid overwriting another window.
   */
  writeFileIfUnchanged(
    absolutePath: string,
    expectedContent: string,
    content: string
  ): Promise<void>
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
  createBinary(absolutePath: string, base64Data: string): Promise<{ size: number }>
  readImage(absolutePath: string): Promise<ImageReadResult>
  editImage(absolutePath: string, request: ImageEditRequest): Promise<ImageEditResult>
  cancelImageEdit(requestId: string): Promise<void>
  fileInfo(absolutePath: string): Promise<{ size: number; mtime: string }>
  copyFile(sourcePath: string, destPath: string): Promise<void>
  isWithinCollection(
    absolutePath: string
  ): Promise<{ within: boolean; collectionPath: string | null }>
  renameFile(oldAbsolutePath: string, newAbsolutePath: string): Promise<void>
  deleteFile(absolutePath: string): Promise<void>

  // Asset scanning
  scanAssets(collectionPath: string): Promise<AssetScanResult>
  fileThumbnail(absolutePath: string, width?: number, height?: number): Promise<string | null>
  externalLinkPreview(url: string): Promise<ExternalLinkPreview | null>
  localLinkPreview(collectionPath: string, relativePath: string): Promise<LocalLinkPreview | null>

  // Get native file path from a dropped File object (Electron webUtils)
  getPathForFile(file: File): string

  // Shell operations
  showItemInFolder(absolutePath: string): Promise<void>
  openPath(absolutePath: string): Promise<void>

  // Clipboard operations
  writeToClipboard(text: string): Promise<void>

  // Native simple dialogs (complex workflows remain renderer modals)
  showConfirmation(options: NativeConfirmationOptions): Promise<boolean>
  showMessage(options: NativeMessageOptions): Promise<void>

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
  getDefaultTableColumns(
    collectionId: string,
    folderPath: string
  ): Promise<TableColumnLayout[] | null>
  saveDefaultTableColumns(
    collectionId: string,
    folderPath: string,
    columns: TableColumnLayout[]
  ): Promise<TableColumnLayout[]>
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

  // Property type conversion / schema editing (phase 41)
  /** Compute the per-file add/convert/rename/drop plan for a property op (no writes). */
  previewPropertyOp(req: PropertyOpRequest): Promise<PropertyOpPlan>
  /**
   * Apply a property op with the watcher paused and atomic per-file writes.
   * Drop is vault-wide and removes every matching overlay definition. Streams
   * progress events keyed by `opId` and returns per-file results.
   */
  applyPropertyOp(opId: string, req: PropertyOpRequest): Promise<PropertyOpResult>
  /** Write schema-overlay annotations (description/required/allowed values) — no file rewrites. */
  updateOverlayField(
    collectionId: string,
    scope: string | null,
    key: string,
    patch: OverlayFieldPatch
  ): Promise<void>
  /** Validate, persist, and materialize one database formula with the watcher paused. */
  saveFormula(
    collectionId: string,
    scope: string | null,
    key: string,
    formula: string,
    resultType: FormulaResultType
  ): Promise<ModuleReport>
  /** Remove one database formula definition and its materialized Markdown values. */
  removeFormula(collectionId: string, scope: string | null, key: string): Promise<ModuleReport>
  /** Persist and materialize one Lookup or Rollup definition. */
  saveLookupRollup(
    collectionId: string,
    scope: string | null,
    key: string,
    definition: LookupRollupDefinition,
    previousKey?: string
  ): Promise<ModuleReport>
  /** Remove one Lookup/Rollup definition and recompute its materialized values. */
  removeLookupRollup(collectionId: string, scope: string | null, key: string): Promise<ModuleReport>
  /** Receive main's collection-wide dirty-document save barrier request. */
  onComputedEditorFlushRequest(callback: (request: ComputedEditorFlushRequest) => void): () => void
  /** Acknowledge one inspect/flush/verify phase to the main process. */
  respondComputedEditorFlush(response: ComputedEditorFlushResponse): void
  /** Refresh collection-scoped views after materialization or rollback. */
  onComputedSchemaApplied(callback: (event: ComputedSchemaAppliedEvent) => void): () => void
  /** Read theme-palette slots persisted beside fields in `.markdownvdb.schema.yml`. */
  getPropertyValueColors(collectionId: string, scope: string | null): Promise<PropertyValueColors>
  /** Set one synced value-color slot; null restores its automatic assignment. */
  setPropertyValueColor(
    collectionId: string,
    scope: string | null,
    field: string,
    value: string,
    selection: PropertyValueColorSelection | null
  ): Promise<PropertyValueColors>
  /** Subscribe to property-op progress events. Returns an unsubscribe function. */
  onPropertyOpProgress(callback: (progress: PropertyOpProgress) => void): () => void

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
  onMenuCommand(callback: (command: MenuCommand) => void): void
  removeMenuCommandListener(): void
  setMenuContext(context: Partial<GraphMenuContext>): Promise<void>

  // Export (phase 43) — native save dialog, writes outside collection bounds
  exportSave(request: ExportSaveRequest): Promise<ExportResult>
  exportPdf(request: ExportPdfRequest): Promise<ExportResult>

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
  embeddingModels(
    root: string,
    provider?: string
  ): Promise<import('../renderer/types/cli').EmbeddingModelsResponse>
  embeddingProbe(root: string): Promise<import('../renderer/types/cli').EmbeddingProbe>

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
  /** Open a full app window, optionally with a specific collection selected. */
  newWindow(collectionId?: string, shardId?: string): Promise<void>

  // Dirty-close guard (data safety): main intercepts native window close and
  // asks the renderer; the renderer answers with confirmClose() once the
  // window may really close (clean, or unsaved changes explicitly discarded).
  onCloseRequest(callback: () => void): void
  removeCloseRequestListener(): void
  confirmClose(): Promise<void>
  cancelClose(): Promise<void>

  // Cross-window tab transfer
  detachTab(tabData: TabTransferData): Promise<void>
  onTabAttach(callback: (data: TabTransferData) => void): void
  removeTabAttachListener(): void

  // Cross-window file sync
  onFileSavedExternally(callback: (data: { path: string; content: string }) => void): void
  removeFileSavedExternallyListener(): void
  onImageSavedExternally(callback: (data: ImageSavedExternallyEvent) => void): void
  removeImageSavedExternallyListener(): void

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
  | { type: 'module-report'; data: ModuleReport }
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
