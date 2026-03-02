/**
 * TypeScript interfaces derived from mdvdb Rust Serialize structs.
 *
 * These types mirror the JSON output produced by `mdvdb --json` commands.
 * Keep in sync with src/*.rs when Rust types change.
 */

// ─── Search ──────────────────────────────────────────────────────────

/** Search mode controlling retrieval signals. */
export type SearchMode = 'hybrid' | 'semantic' | 'lexical';

/** Metadata filter for narrowing search results by frontmatter fields. */
export type MetadataFilter =
  | { type: 'equals'; field: string; value: JsonValue }
  | { type: 'in'; field: string; values: JsonValue[] }
  | { type: 'range'; field: string; min?: JsonValue; max?: JsonValue }
  | { type: 'exists'; field: string };

/** Chunk-level data within a search result. */
export interface SearchResultChunk {
  chunk_id: string;
  heading_hierarchy: string[];
  content: string;
  start_line: number;
  end_line: number;
}

/** File-level metadata within a search result. */
export interface SearchResultFile {
  path: string;
  frontmatter: JsonValue | null;
  file_size: number;
  path_components: string[];
}

/** A single search result with relevance score, chunk, and file context. */
export interface SearchResult {
  score: number;
  chunk: SearchResultChunk;
  file: SearchResultFile;
}

/** Wrapped search output for JSON mode (from main.rs SearchOutput). */
export interface SearchOutput {
  results: SearchResult[];
  query: string;
  total_results: number;
  mode: SearchMode;
}

// ─── Index Status ────────────────────────────────────────────────────

/** Embedding configuration snapshot. */
export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimensions: number;
}

/** Status snapshot returned by Index::status(). */
export interface IndexStatus {
  document_count: number;
  chunk_count: number;
  vector_count: number;
  last_updated: number;
  file_size: number;
  embedding_config: EmbeddingConfig;
}

// ─── Ingestion ───────────────────────────────────────────────────────

/** Result of an ingestion operation. */
export interface IngestResult {
  files_indexed: number;
  files_skipped: number;
  files_removed: number;
  chunks_created: number;
  api_calls: number;
  files_failed: number;
  errors: IngestError[];
  duration_secs: number;
  cancelled: boolean;
}

/** A single ingestion error for a specific file. */
export interface IngestError {
  path: string;
  message: string;
}

/** Status of a file in an ingest preview. */
export type PreviewFileStatus = 'New' | 'Changed' | 'Unchanged';

/** Information about a single file in an ingest preview. */
export interface PreviewFileInfo {
  path: string;
  status: PreviewFileStatus;
  chunks: number;
  estimated_tokens: number;
}

/** Preview of what an ingestion would do. */
export interface IngestPreview {
  files: PreviewFileInfo[];
  total_files: number;
  files_to_process: number;
  files_unchanged: number;
  total_chunks: number;
  estimated_tokens: number;
  estimated_api_calls: number;
}

/** Phase of the ingestion pipeline, reported via progress callbacks. */
export type IngestPhase =
  | { phase: 'Discovering' }
  | { phase: 'Parsing'; current: number; total: number; path: string }
  | { phase: 'Skipped'; current: number; total: number; path: string }
  | { phase: 'Embedding'; batch: number; total_batches: number }
  | { phase: 'Saving' }
  | { phase: 'Clustering' }
  | { phase: 'Cleaning' }
  | { phase: 'Done' };

// ─── Document ────────────────────────────────────────────────────────

/** Information about an indexed document. */
export interface DocumentInfo {
  path: string;
  content_hash: string;
  frontmatter: JsonValue | null;
  chunk_count: number;
  file_size: number;
  indexed_at: number;
  modified_at: number | null;
}

// ─── Schema ──────────────────────────────────────────────────────────

/** The type of a frontmatter field. */
export type FieldType = 'String' | 'Number' | 'Boolean' | 'List' | 'Date' | 'Mixed';

/** A merged schema field combining inferred data with overlay annotations. */
export interface SchemaField {
  name: string;
  field_type: FieldType;
  description: string | null;
  occurrence_count: number;
  sample_values: string[];
  allowed_values: string[] | null;
  required: boolean;
}

/** The complete metadata schema. */
export interface Schema {
  fields: SchemaField[];
  last_updated: number;
}

// ─── Clustering ──────────────────────────────────────────────────────

/** Information about a single cluster. */
export interface ClusterInfo {
  id: number;
  label: string;
  centroid: number[];
  members: string[];
  keywords: string[];
}

/** Cluster state persisted in the index. */
export interface ClusterState {
  clusters: ClusterInfo[];
  docs_since_rebalance: number;
  docs_at_last_rebalance: number;
}

/** Summary of a cluster (from lib.rs ClusterSummary). */
export interface ClusterSummary {
  id: number;
  document_count: number;
  label: string | null;
  keywords: string[];
}

// ─── File Tree ───────────────────────────────────────────────────────

/** Sync state of a file relative to the index. */
export type FileState = 'indexed' | 'modified' | 'new' | 'deleted';

/** A node in the file tree (directory or file). */
export interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  state: FileState | null;
  children: FileTreeNode[];
}

/** Complete file tree with summary counts. */
export interface FileTree {
  root: FileTreeNode;
  total_files: number;
  indexed_count: number;
  modified_count: number;
  new_count: number;
  deleted_count: number;
}

// ─── Links ───────────────────────────────────────────────────────────

/** A single link extracted from a markdown file. */
export interface LinkEntry {
  source: string;
  target: string;
  text: string;
  line_number: number;
  is_wikilink: boolean;
}

/** Whether a link target is valid or broken. */
export type LinkState = 'Valid' | 'Broken';

/** A resolved link with validity status. */
export interface ResolvedLink {
  entry: LinkEntry;
  state: LinkState;
}

/** Result of querying links for a specific file. */
export interface LinkQueryResult {
  file: string;
  outgoing: ResolvedLink[];
  incoming: LinkEntry[];
}

/** A file with no incoming or outgoing links. */
export interface OrphanFile {
  path: string;
}

/** Wrapped links output for JSON mode (from main.rs). */
export interface LinksOutput {
  file: string;
  links: LinkQueryResult;
}

/** Wrapped backlinks output for JSON mode (from main.rs). */
export interface BacklinksOutput {
  file: string;
  backlinks: ResolvedLink[];
  total_backlinks: number;
}

/** Wrapped orphans output for JSON mode (from main.rs). */
export interface OrphansOutput {
  orphans: OrphanFile[];
  total_orphans: number;
}

// ─── Link Graph ──────────────────────────────────────────────────────

/** The complete link graph stored in the index. */
export interface LinkGraph {
  forward: Record<string, LinkEntry[]>;
  last_updated: number;
}

// ─── Doctor ──────────────────────────────────────────────────────────

/** Status of a diagnostic check. */
export type CheckStatus = 'Pass' | 'Fail' | 'Warn';

/** A single diagnostic check. */
export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Result of a doctor diagnostic. */
export interface DoctorResult {
  checks: DoctorCheck[];
  passed: number;
  total: number;
}

// ─── Config ──────────────────────────────────────────────────────────

/** Supported embedding provider backends. */
export type EmbeddingProviderType = 'OpenAI' | 'Ollama' | 'Custom' | 'Mock';

/** Full configuration for mdvdb. */
export interface Config {
  embedding_provider: EmbeddingProviderType;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_batch_size: number;
  openai_api_key: string | null;
  ollama_host: string;
  embedding_endpoint: string | null;
  source_dirs: string[];
  ignore_patterns: string[];
  watch_enabled: boolean;
  watch_debounce_ms: number;
  chunk_max_tokens: number;
  chunk_overlap_tokens: number;
  clustering_enabled: boolean;
  clustering_rebalance_threshold: number;
  search_default_limit: number;
  search_min_score: number;
  search_default_mode: SearchMode;
  search_rrf_k: number;
  bm25_norm_k: number;
  search_decay_enabled: boolean;
  search_decay_half_life: number;
}

// ─── Watcher ─────────────────────────────────────────────────────────

/** Type of filesystem event from file watcher. */
export type WatchEventType = 'Created' | 'Modified' | 'Deleted' | 'Renamed';

/** Report generated after processing a single watch event. */
export interface WatchEventReport {
  event_type: WatchEventType;
  path: string;
  chunks_processed: number;
  duration_ms: number;
}

// ─── Index Storage Types ─────────────────────────────────────────────

/** A chunk stored in the index. */
export interface StoredChunk {
  source_path: string;
  heading_hierarchy: string[];
  content: string;
  start_line: number;
  end_line: number;
  chunk_index: number;
  is_sub_split: boolean;
}

/** A file entry stored in the index. */
export interface StoredFile {
  relative_path: string;
  content_hash: string;
  frontmatter: string | null;
  file_size: number;
  chunk_ids: string[];
  indexed_at: number;
}

/** Serialized metadata region of the index file. */
export interface IndexMetadata {
  chunks: Record<string, StoredChunk>;
  files: Record<string, StoredFile>;
  embedding_config: EmbeddingConfig;
  last_updated: number;
  schema: Schema | null;
  cluster_state: ClusterState | null;
  link_graph: LinkGraph | null;
  file_mtimes: Record<string, number> | null;
}

// ─── Error Types ─────────────────────────────────────────────────────

/** Error categories matching the Rust Error enum variants. */
export type MdvdbErrorKind =
  | 'Config'
  | 'IndexNotFound'
  | 'IndexCorrupted'
  | 'EmbeddingProvider'
  | 'MarkdownParse'
  | 'Io'
  | 'Serialization'
  | 'Watch'
  | 'LockTimeout'
  | 'Logging'
  | 'FileNotInIndex'
  | 'IndexAlreadyExists'
  | 'ConfigAlreadyExists'
  | 'Clustering'
  | 'LinkGraphNotBuilt'
  | 'Fts';

/** Structured error from the CLI. */
export interface MdvdbError {
  kind: MdvdbErrorKind;
  message: string;
}

// ─── Utility Types ───────────────────────────────────────────────────

/** JSON value type matching serde_json::Value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ─── CLI Command Result Types ────────────────────────────────────────

/** Generic wrapper for CLI JSON output with optional error. */
export interface CliResult<T> {
  data?: T;
  error?: MdvdbError;
}

/** Result type for the status command. */
export type StatusResult = IndexStatus;

/** Result type for the schema command. */
export type SchemaResult = Schema;

/** Result type for the clusters command. */
export type ClustersResult = ClusterSummary[];

/** Result type for the tree command. */
export type TreeResult = FileTree;

/** Result type for the get command. */
export type GetResult = DocumentInfo;

/** Result type for the doctor command. */
export type DoctorCheckResult = DoctorResult;

/** Result type for the config command. */
export type ConfigResult = Config;
