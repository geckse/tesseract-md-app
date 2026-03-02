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
  DoctorResult,
  CliResult
} from '../renderer/types/cli'

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
  findCli(): Promise<CliResult<string>>
  getCliVersion(): Promise<CliResult<string>>
  search(root: string, query: string, options?: SearchOptions): Promise<CliResult<SearchOutput>>
  status(root: string): Promise<CliResult<IndexStatus>>
  ingest(root: string, options?: IngestOptions): Promise<CliResult<IngestResult>>
  ingestPreview(root: string): Promise<CliResult<IngestPreview>>
  tree(root: string, path?: string): Promise<CliResult<FileTree>>
  getFile(root: string, filePath: string): Promise<CliResult<DocumentInfo>>
  links(root: string, filePath: string): Promise<CliResult<LinksOutput>>
  backlinks(root: string, filePath: string): Promise<CliResult<BacklinksOutput>>
  orphans(root: string): Promise<CliResult<OrphansOutput>>
  clusters(root: string): Promise<CliResult<ClusterSummary[]>>
  schema(root: string): Promise<CliResult<Schema>>
  config(root: string): Promise<CliResult<Config>>
  doctor(root: string): Promise<CliResult<DoctorResult>>
  init(root: string): Promise<CliResult<void>>
}

declare global {
  interface Window {
    api: MdvdbApi
    electron: typeof import('@electron-toolkit/preload').electronAPI
  }
}
