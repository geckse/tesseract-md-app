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
  ClusterSummary,
  GraphData,
  GraphLevel,
  Schema,
  Config,
  DoctorResult
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
}

/** Options for the ingest command. */
export interface IngestOptions {
  reindex?: boolean
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
  orphans(root: string): Promise<OrphansOutput>
  clusters(root: string): Promise<ClusterSummary[]>
  graphData(root: string, level?: GraphLevel): Promise<GraphData>
  schema(root: string): Promise<Schema>
  config(root: string): Promise<Config>
  doctor(root: string): Promise<DoctorResult>
  init(root: string): Promise<void>

  // Collection management
  listCollections(): Promise<Collection[]>
  addCollection(): Promise<Collection | null>
  removeCollection(id: string): Promise<void>
  setActiveCollection(id: string): Promise<void>
  getActiveCollection(): Promise<Collection | null>

  // File operations
  readFile(absolutePath: string): Promise<string>
  writeFile(absolutePath: string, content: string): Promise<void>

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

  // Native menu events
  onMenuOpenRecent(callback: (data: { collectionId: string; filePath: string }) => void): void
  removeMenuOpenRecentListener(): void
}

/** Watcher status returned by getWatcherStatus. */
export interface WatcherStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  root: string | null
}

/** Watcher event forwarded from the main process. */
export interface WatcherEvent {
  type: 'state-change' | 'watch-event' | 'error'
  data: unknown
}

declare global {
  interface Window {
    api: MdvdbApi
    electron: typeof import('@electron-toolkit/preload').electronAPI
  }
}
