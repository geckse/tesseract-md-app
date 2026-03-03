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

  // Single-file ingest
  ingestFile(root: string, filePath: string, options?: IngestOptions): Promise<IngestResult>
}

declare global {
  interface Window {
    api: MdvdbApi
    electron: typeof import('@electron-toolkit/preload').electronAPI
  }
}
