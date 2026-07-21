/**
 * TypeScript interfaces derived from mdvdb Rust Serialize structs.
 *
 * These types mirror the JSON output produced by `mdvdb --json` commands.
 * Keep in sync with src/*.rs when Rust types change.
 */

// ─── Search ──────────────────────────────────────────────────────────

/** Search mode controlling retrieval signals. */
export type SearchMode = 'hybrid' | 'semantic' | 'lexical'

/** Metadata filter for narrowing search results by frontmatter fields. */
export type MetadataFilter =
  | { type: 'equals'; field: string; value: JsonValue }
  | { type: 'in'; field: string; values: JsonValue[] }
  | { type: 'range'; field: string; min?: JsonValue; max?: JsonValue }
  | { type: 'exists'; field: string }

/** Chunk-level data within a search result. */
export interface SearchResultChunk {
  chunk_id: string
  heading_hierarchy: string[]
  content: string
  start_line: number
  end_line: number
}

/** File-level metadata within a search result. */
export interface SearchResultFile {
  path: string
  frontmatter: JsonValue | null
  file_size: number
  path_components: string[]
  modified_at: number | null
  /** Resolved frontmatter relations (phase 42) — present only under `--populate`. Mirrored for completeness; unused by the app in v1. */
  relations?: Record<string, RelationValue[]>
}

/** A single search result with relevance score, chunk, and file context. */
export interface SearchResult {
  score: number
  chunk: SearchResultChunk
  file: SearchResultFile
}

/** A supplementary chunk from a linked file, surfaced via graph expansion. */
export interface GraphContextItem {
  chunk: SearchResultChunk
  file: SearchResultFile
  linked_from: string
  hop_distance: number
}

/** Wrapped search output for JSON mode (from main.rs SearchOutput). */
export interface SearchOutput {
  results: SearchResult[]
  query: string
  total_results: number
  mode: SearchMode
  graph_context?: GraphContextItem[]
}

// ─── Index Status ────────────────────────────────────────────────────

/** Embedding configuration snapshot. */
export interface EmbeddingConfig {
  provider: string
  model: string
  dimensions: number
}

/** Status snapshot returned by Index::status(). */
export interface IndexStatus {
  document_count: number
  chunk_count: number
  vector_count: number
  /** Semantic-link vectors; optional for compatibility with older CLI versions. */
  edge_count?: number
  last_updated: number
  file_size: number
  embedding_config: EmbeddingConfig
}

/** Sync state of on-disk Markdown files compared with the index. */
export interface SyncBreakdown {
  new: number
  changed: number
  unchanged: number
  deleted: number
}

/** Whole-vault or folder-scoped statistics returned by `mdvdb info`. */
export interface VaultInfo {
  scope: string
  is_whole_vault: boolean
  file_count: number
  indexed_file_count: number
  /** null only for a scoped query through a legacy CLI that cannot expose the count. */
  chunk_count: number | null
  /** null only for a scoped query through a legacy CLI that cannot expose the count. */
  vector_count: number | null
  /** null only for a scoped query through a legacy CLI that cannot expose the count. */
  edge_count: number | null
  reindex_chunks: number
  reindex_estimated_tokens: number
  /** null only when a legacy CLI does not expose the batch size needed for a scoped estimate. */
  reindex_estimated_api_calls: number | null
  index_file_size: number
  embedding: EmbeddingConfig
  sync: SyncBreakdown
  last_updated: number
}

// ─── Ingestion ───────────────────────────────────────────────────────

/** Result of an ingestion operation. */
export interface IngestResult {
  files_indexed: number
  files_skipped: number
  files_removed: number
  chunks_created: number
  api_calls: number
  files_failed: number
  errors: IngestError[]
  duration_secs: number
  cancelled: boolean
}

/** A single ingestion error for a specific file. */
export interface IngestError {
  path: string
  message: string
}

/** Status of a file in an ingest preview. */
export type PreviewFileStatus = 'New' | 'Changed' | 'Unchanged'

/** Information about a single file in an ingest preview. */
export interface PreviewFileInfo {
  path: string
  status: PreviewFileStatus
  chunks: number
  estimated_tokens: number
}

/** Preview of what an ingestion would do. */
export interface IngestPreview {
  files: PreviewFileInfo[]
  total_files: number
  files_to_process: number
  files_unchanged: number
  total_chunks: number
  estimated_tokens: number
  estimated_api_calls: number
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
  | { phase: 'Done' }

// ─── Document ────────────────────────────────────────────────────────

/** Information about an indexed document. */
export interface DocumentInfo {
  path: string
  content_hash: string
  frontmatter: JsonValue | null
  chunk_count: number
  file_size: number
  indexed_at: number
  modified_at: number | null
  /** Resolved frontmatter relations (phase 42) — present only under `--populate`. */
  relations?: Record<string, RelationValue[]>
  /** Reverse relation lookups, sorted by (source, field) — present only under `--populate`. */
  referenced_by?: ReferencedByEntry[]
}

// ─── Relations (phase 42, mirrors CLI phase-31 contract) ─────────────

/**
 * A resolved frontmatter relation value. Emitted wherever a relation
 * resolves — always inside arrays. `frontmatter` is an ALWAYS-present key
 * (`object | null` — null when the target is missing or has none); a
 * populated target's frontmatter is never itself populated (depth 1).
 */
export interface RelationValue {
  raw: string
  /** Resolved root-relative candidate path; null only if unresolvable. */
  path: string | null
  exists: boolean
  /** Server-derived display title; null when `!exists`. */
  title: string | null
  /** Always-present key; null when `!exists` or the target has no frontmatter. */
  frontmatter: Record<string, JsonValue> | null
}

/** One reverse relation lookup: which document references this one, via which field. */
export interface ReferencedByEntry {
  source: string
  field: string
  title: string
}

// ─── Schema ──────────────────────────────────────────────────────────

/** The type of a frontmatter field. */
export type FieldType = 'String' | 'Number' | 'Boolean' | 'List' | 'Date' | 'Mixed' | 'Relation'

/** A merged schema field combining inferred data with overlay annotations. */
export interface SchemaField {
  name: string
  field_type: FieldType
  description: string | null
  occurrence_count: number
  sample_values: string[]
  allowed_values: string[] | null
  required: boolean
  /** Overlay-declared FK target folder for relation fields (NO trailing slash). */
  relation_target: string | null
}

/** The complete metadata schema. */
export interface Schema {
  fields: SchemaField[]
  last_updated: number
}

// ─── Collection (folder-as-table, phase-29 contract) ─────────────────

/** How a collection row's title was derived. */
export type TitleSource = 'frontmatter' | 'filename'

/**
 * One table column. Mirrors the canonical `mdvdb collection` contract.
 * Note: the field is `name` (NOT `key`); `field_type` is PascalCase.
 */
export interface CollectionColumn {
  name: string // == frontmatter key
  field_type: FieldType // PascalCase: String|Number|Boolean|List|Date|Mixed|Relation
  description: string | null
  occurrence_count: number
  sample_values: string[]
  allowed_values: string[] | null
  required: boolean
  in_schema: boolean // false = key found only in a row's frontmatter, not the scoped schema
  /** Overlay-declared FK target folder for relation columns (NO trailing slash). */
  relation_target: string | null
}

/** One table row = one Markdown document. */
export interface CollectionRow {
  path: string
  title: string
  title_source: TitleSource
  /** Always a JSON object (`{}` when none) — never null. RAW even under populate. */
  frontmatter: Record<string, JsonValue>
  content_hash: string | null // null for state:'new'
  file_size: number
  modified_at: number | null
  indexed_at: number | null // null for state:'new'
  state: FileState
  /** Resolved frontmatter relations (phase 42) — present only under `--populate`. */
  relations?: Record<string, RelationValue[]>
}

/** Top-level `mdvdb collection <PATH> --json` response. */
export interface CollectionOutput {
  scope: string
  recursive: boolean
  columns: CollectionColumn[]
  rows: CollectionRow[]
  total_rows: number // post-filter, pre-limit/offset (NOT "total")
  limit?: number // omitted when None
  offset: number
}

// ─── Clustering ──────────────────────────────────────────────────────

/** Information about a single cluster. */
export interface ClusterInfo {
  id: number
  label: string
  centroid: number[]
  members: string[]
  keywords: string[]
}

/** Cluster state persisted in the index. */
export interface ClusterState {
  clusters: ClusterInfo[]
  docs_since_rebalance: number
  docs_at_last_rebalance: number
}

/** Summary of a cluster (from lib.rs ClusterSummary). */
export interface ClusterSummary {
  id: number
  document_count: number
  label: string | null
  keywords: string[]
  /** Leiden hierarchy parent cluster id — ignored by the UI in v1. */
  parent_id?: number | null
  /** Representative document path for the cluster. */
  representative?: string
}

// ─── Topics (Custom Clusters) ────────────────────────────────────

/**
 * User-defined topic definition (from config, not computed).
 * Mirrors `mdvdb clusters list --json` entries.
 */
export interface TopicDef {
  name: string
  seeds: string[]
  /** Natural-language description — improves matching accuracy. */
  description?: string | null
  /** Per-topic similarity threshold. null/absent = global floor. */
  threshold?: number | null
}

/** @deprecated Use TopicDef. Kept as an alias for older call sites. */
export type CustomClusterDef = TopicDef

/**
 * Computed topic (custom cluster) summary from the index after ingest.
 * Mirrors `mdvdb clusters --custom --json` entries (top-level array).
 */
export interface CustomClusterSummary {
  id: number
  name: string
  seed_phrases: string[]
  document_count: number
  description?: string | null
  threshold?: number | null
  /** Mean assignment score across member documents (0-1). */
  mean_score?: number
}

/** Output of `mdvdb clusters unassigned --json`. */
export interface TopicUnassigned {
  count: number
  paths: string[]
}

// ─── Graph ───────────────────────────────────────────────────────

/** Graph level controlling node granularity. */
export type GraphLevel = 'document' | 'chunk'

/** A node in the graph representing an indexed file or chunk. */
export interface GraphNode {
  id: string
  path: string
  label: string | null
  cluster_id: number | null
  /**
   * PRIMARY topic assignment (highest score; separate layer from
   * auto-clusters). null = Unassigned.
   */
  custom_cluster_id: number | null
  /** All topic memberships, score-descending. Omitted when empty. */
  custom_cluster_ids?: number[]
  /** Scores parallel to custom_cluster_ids. Omitted when empty. */
  custom_cluster_scores?: number[]
  chunk_index: number | null
  /** Optional size metric (e.g. content length for chunks). */
  size?: number | null
}

/** An edge in the graph representing a link between two indexed files or chunks. */
export interface GraphEdge {
  source: string
  target: string
  weight: number | null
  /** Semantic relationship type label (e.g. "references", "extends"). */
  relationship_type?: string | null
  /** Semantic strength score in [0, 1]. */
  strength?: number | null
  /** Context text excerpt describing the relationship. */
  context_text?: string | null
  /**
   * Zero-based index into the response-level GraphData.contexts string table.
   * Present on compact CLI graph responses instead of context_text.
   */
  context_index?: number | null
  /** ID of the edge cluster this edge belongs to. */
  edge_cluster_id?: number | null
  /**
   * Originating frontmatter field for relation edges (phase 42). REQUIRED key,
   * not optional — the CLI always emits it; `null` = body/similarity edge.
   */
  field: string | null
}

/** A cluster of semantically similar edges. */
export interface GraphEdgeCluster {
  id: number
  label: string
  count: number
}

/** A cluster summary for graph visualization. */
export interface GraphCluster {
  id: number
  label: string
  keywords: string[]
  member_count: number
  /** Topic description (custom clusters only). */
  description?: string | null
  /** Per-topic similarity threshold (custom clusters only). */
  threshold?: number | null
  /** Leiden hierarchy parent cluster id — ignored by the UI in v1. */
  parent_id?: number | null
}

/** Complete graph topology combining nodes, edges, and clusters. */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Full, deduplicated edge contexts used by compact graph responses. */
  contexts?: string[]
  clusters: GraphCluster[]
  level: GraphLevel
  /** Edge clusters discovered by semantic analysis. */
  edge_clusters?: GraphEdgeCluster[]
  /** User-defined custom clusters, if available. */
  custom_clusters?: GraphCluster[]
}

/** Versioned, wire-efficient graph contract returned by the Tesseract IPC bridge. */
export interface CompactGraphData extends GraphData {
  format: 'mdvdb.graph.compact'
  version: 1
  contexts: string[]
}

// ─── File Tree ───────────────────────────────────────────────────────

/** Sync state of a file relative to the index. */
export type FileState = 'indexed' | 'modified' | 'new' | 'deleted'

/** A node in the file tree (directory or file). */
export interface FileTreeNode {
  name: string
  path: string
  is_dir: boolean
  state: FileState | null
  children: FileTreeNode[]
}

/** Complete file tree with summary counts. */
export interface FileTree {
  root: FileTreeNode
  total_files: number
  indexed_count: number
  modified_count: number
  new_count: number
  deleted_count: number
}

// ─── Asset Discovery (App-Only Types — NOT mirroring Rust) ──────────

/** Mime category for display purposes. */
export type MimeCategory = 'image' | 'pdf' | 'video' | 'audio' | 'other'

/** A non-markdown asset file discovered by the app scanner. */
export interface AssetFileNode {
  name: string
  path: string
  is_dir: boolean
  children: AssetFileNode[]
  fileSize?: number
  mimeCategory?: MimeCategory
}

/** Result of app-level asset scanning. */
export interface AssetScanResult {
  root: AssetFileNode
  totalAssets: number
  scanDurationMs: number
}

/** Unified tree node combining CLI markdown nodes and app asset nodes. */
export interface UnifiedTreeNode {
  name: string
  path: string
  is_dir: boolean
  children: UnifiedTreeNode[]
  state: FileState | null
  isAsset: boolean
  mimeCategory?: MimeCategory
  fileSize?: number
}

// ─── Links ───────────────────────────────────────────────────────────

/** A single link extracted from a markdown file. */
export interface LinkEntry {
  source: string
  target: string
  text: string
  /** 1-based; `0` is the frontmatter sentinel — invariant: `field != null ⇔ line_number == 0`. */
  line_number: number
  is_wikilink: boolean
  /**
   * Originating frontmatter field for relation edges (phase 42). REQUIRED key,
   * not optional — the CLI always emits it; `null` = body link.
   */
  field: string | null
}

/** Whether a link target is valid or broken. */
export type LinkState = 'Valid' | 'Broken'

/** A resolved link with validity status. */
export interface ResolvedLink {
  entry: LinkEntry
  state: LinkState
}

/** Result of querying links for a specific file. */
export interface LinkQueryResult {
  file: string
  outgoing: ResolvedLink[]
  incoming: LinkEntry[]
}

/** A file with no incoming or outgoing links. */
export interface OrphanFile {
  path: string
}

/** Wrapped links output for JSON mode (from main.rs). */
export interface LinksOutput {
  file: string
  links: LinkQueryResult
}

/** Wrapped backlinks output for JSON mode (from main.rs). */
export interface BacklinksOutput {
  file: string
  backlinks: ResolvedLink[]
  total_backlinks: number
}

/** Wrapped orphans output for JSON mode (from main.rs). */
export interface OrphansOutput {
  orphans: OrphanFile[]
  total_orphans: number
}

/** A node in a multi-hop neighborhood tree (recursive). */
export interface NeighborhoodNode {
  path: string
  state: LinkState
  children: NeighborhoodNode[]
}

/** Result of querying the multi-hop link neighborhood of a file. */
export interface NeighborhoodResult {
  file: string
  outgoing: NeighborhoodNode[]
  incoming: NeighborhoodNode[]
  outgoing_count: number
  incoming_count: number
  outgoing_depth_count: number
  incoming_depth_count: number
}

// ─── Link Graph ──────────────────────────────────────────────────────

/** The complete link graph stored in the index. */
export interface LinkGraph {
  forward: Record<string, LinkEntry[]>
  last_updated: number
}

// ─── Doctor ──────────────────────────────────────────────────────────

/** Status of a diagnostic check. */
export type CheckStatus = 'Pass' | 'Fail' | 'Warn'

/** A single diagnostic check. */
export interface DoctorCheck {
  name: string
  status: CheckStatus
  detail: string
}

/** Result of a doctor diagnostic. */
export interface DoctorResult {
  checks: DoctorCheck[]
  passed: number
  total: number
}

// ─── Config ──────────────────────────────────────────────────────────

/** Supported embedding provider backends. */
export type EmbeddingProviderType = 'OpenAI' | 'Ollama' | 'Custom' | 'Mock'

/** Full configuration for mdvdb. */
export interface Config {
  embedding_provider: EmbeddingProviderType
  embedding_model: string
  embedding_dimensions: number
  embedding_batch_size: number
  openai_api_key: string | null
  ollama_host: string
  embedding_endpoint: string | null
  source_dirs: string[]
  ignore_patterns: string[]
  watch_enabled: boolean
  watch_debounce_ms: number
  chunk_max_tokens: number
  chunk_overlap_tokens: number
  clustering_enabled: boolean
  clustering_rebalance_threshold: number
  /** Auto-clustering algorithm: 'leiden' (default) or 'kmeans'. Optional for older CLIs. */
  clustering_algorithm?: string
  /** Cluster granularity multiplier. Optional for older CLIs. */
  clustering_granularity?: number
  /** Global topics similarity floor (clustering.topics.min_similarity). Optional for older CLIs. */
  topics_min_similarity?: number
  search_default_limit: number
  search_min_score: number
  search_default_mode: SearchMode
  search_rrf_k: number
  bm25_norm_k: number
  search_decay_enabled: boolean
  search_decay_half_life: number
}

// ─── Watcher ─────────────────────────────────────────────────────────

/** Type of filesystem event from file watcher. */
export type WatchEventType = 'Created' | 'Modified' | 'Deleted' | 'Renamed'

/** Report generated after processing a single watch event. */
export interface WatchEventReport {
  event_type: WatchEventType
  path: string
  success: boolean
  chunks_processed: number
  duration_ms: number
  error: string | null
}

// ─── Index Storage Types ─────────────────────────────────────────────

/** A chunk stored in the index. */
export interface StoredChunk {
  source_path: string
  heading_hierarchy: string[]
  content: string
  start_line: number
  end_line: number
  chunk_index: number
  is_sub_split: boolean
}

/** A file entry stored in the index. */
export interface StoredFile {
  relative_path: string
  content_hash: string
  frontmatter: string | null
  file_size: number
  chunk_ids: string[]
  indexed_at: number
}

/** Serialized metadata region of the index file. */
export interface IndexMetadata {
  chunks: Record<string, StoredChunk>
  files: Record<string, StoredFile>
  embedding_config: EmbeddingConfig
  last_updated: number
  schema: Schema | null
  cluster_state: ClusterState | null
  link_graph: LinkGraph | null
  file_mtimes: Record<string, number> | null
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
  | 'Fts'

/** Structured error from the CLI. */
export interface MdvdbError {
  kind: MdvdbErrorKind
  message: string
}

// ─── Utility Types ───────────────────────────────────────────────────

/** JSON value type matching serde_json::Value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// ─── CLI Command Result Types ────────────────────────────────────────

/** Generic wrapper for CLI JSON output with optional error. */
export interface CliResult<T> {
  data?: T
  error?: MdvdbError
}

/** Result type for the status command. */
export type StatusResult = IndexStatus

/** Result type for the schema command. */
export type SchemaResult = Schema

/** Result type for the clusters command. */
export type ClustersResult = ClusterSummary[]

/** Result type for the tree command. */
export type TreeResult = FileTree

/** Result type for the get command. */
export type GetResult = DocumentInfo

/** Result type for the doctor command. */
export type DoctorCheckResult = DoctorResult

/** Result type for the config command. */
export type ConfigResult = Config
