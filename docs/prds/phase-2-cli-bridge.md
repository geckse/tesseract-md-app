# PRD: CLI Bridge & IPC Layer

## Overview

Build the typed communication bridge between the Electron main process and the `mdvdb` CLI binary. This is the foundational layer that every feature depends on — all data operations flow through CLI commands spawned as child processes, with JSON output parsed into typed TypeScript objects and delivered to the renderer via IPC.

## Problem Statement

The desktop app is a thin GUI shell around the `mdvdb` CLI. The renderer process cannot spawn child processes directly (sandboxed). A secure, typed IPC layer is needed to: detect the CLI binary, execute commands, parse JSON output, handle errors and timeouts, and expose a clean API to Svelte components.

## Goals

- Detect `mdvdb` binary on system PATH and report its version
- Execute any CLI command with `--json --root <path>` flags and parse stdout
- Typed TypeScript interfaces for all CLI JSON output structures
- Typed IPC channels with `ipcMain.handle()` / `ipcRenderer.invoke()`
- Typed `window.api` object exposed via `contextBridge`
- Graceful error handling: CLI not found, execution failure, JSON parse error, timeout
- Configurable timeouts (30s default, 300s for ingest)

## Non-Goals

- CLI installation or download (Phase 10)
- Long-running process management like `watch` (Phase 7)
- Any UI beyond a basic CLI status indicator
- Caching of CLI results (handled by individual features)

## Technical Design

### Data Model Changes

No persistent data changes. This phase introduces in-memory TypeScript types only.

### Interface Changes

**New module: `app/src/main/cli.ts`**

```typescript
// CLI binary detection and command execution
findCli(): Promise<string>                    // Returns path to mdvdb binary, throws CliNotFoundError
getCliVersion(): Promise<string>              // Returns version string (e.g., "0.1.0")
execCommand<T>(
  command: string,                            // e.g., "search", "status", "ingest"
  args: string[],                             // e.g., ["--limit", "10", "query text"]
  root: string,                               // Collection root path
  options?: { timeout?: number }              // Default 30000ms
): Promise<T>                                 // Parsed JSON output, typed by caller
```

**New module: `app/src/main/ipc-handlers.ts`**

```typescript
// Registers all IPC handlers on app startup
registerIpcHandlers(): void

// Individual handlers (each calls execCommand internally):
// 'cli:find'         → findCli()
// 'cli:version'      → getCliVersion()
// 'cli:search'       → execCommand<SearchOutput>('search', ...)
// 'cli:status'       → execCommand<IndexStatus>('status', ...)
// 'cli:ingest'       → execCommand<IngestResult>('ingest', ...)
// 'cli:ingest-preview' → execCommand<IngestPreview>('ingest', ['--preview'], ...)
// 'cli:tree'         → execCommand<FileTree>('tree', ...)
// 'cli:get'          → execCommand<DocumentInfo>('get', ...)
// 'cli:links'        → execCommand<LinksOutput>('links', ...)
// 'cli:backlinks'    → execCommand<BacklinksOutput>('backlinks', ...)
// 'cli:orphans'      → execCommand<OrphansOutput>('orphans', ...)
// 'cli:clusters'     → execCommand<ClusterSummary[]>('clusters', ...)
// 'cli:schema'       → execCommand<Schema>('schema', ...)
// 'cli:config'       → execCommand<ConfigOutput>('config', ...)
// 'cli:doctor'       → execCommand<DoctorResult>('doctor', ...)
// 'cli:init'         → execCommand<void>('init', ...)
```

**Updated: `app/src/preload/index.ts`**

```typescript
// Exposed as window.api
interface MdvdbApi {
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
  config(root: string): Promise<ConfigOutput>
  doctor(root: string): Promise<DoctorResult>
  init(root: string): Promise<void>
}
```

### New Commands / API / UI

**TypeScript types file: `app/src/renderer/types/cli.ts`**

All interfaces derived from the Rust `Serialize` structs. Reference:
- `src/main.rs` — command argument structs and output wrappers
- `src/lib.rs` — public re-exports and `MarkdownVdb` methods
- `src/search.rs` — `SearchResult`, `SearchResultChunk`, `SearchResultFile`, `SearchMode`
- `src/index/types.rs` — `StoredChunk`, `StoredFile`, `IndexMetadata`
- `src/tree.rs` — `FileTree`, `FileTreeNode`, `FileState`
- `src/links.rs` — `LinkGraph`, `LinkEntry`, `ResolvedLink`
- `src/schema.rs` — `Schema`, `SchemaField`, `FieldType`
- `src/clustering.rs` — `ClusterInfo`

Key types to define:
```typescript
interface SearchOutput {
  results: SearchResult[]
  query: string
  total_results: number
  mode: 'hybrid' | 'semantic' | 'lexical'
}

interface SearchResult {
  score: number
  chunk: SearchResultChunk
  file: SearchResultFile
}

interface SearchResultChunk {
  chunk_id: string
  heading_hierarchy: string[]
  content: string
  start_line: number
  end_line: number
}

interface SearchResultFile {
  path: string
  frontmatter: Record<string, unknown>
  file_size: number
  path_components: string[]
  modified_at: number
}

interface IngestResult {
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

interface IndexStatus {
  document_count: number
  chunk_count: number
  vector_count: number
  last_updated: number
  file_size: number
  embedding_config: EmbeddingConfig
}

interface FileTree {
  root: FileTreeNode
  total_files: number
  indexed_count: number
  modified_count: number
  new_count: number
  deleted_count: number
}

interface FileTreeNode {
  name: string
  path: string
  is_dir: boolean
  state: 'indexed' | 'modified' | 'new' | 'deleted' | null
  children: FileTreeNode[]
}

// ... (full types for all CLI outputs)
```

**Error types: `app/src/main/errors.ts`**

```typescript
class CliNotFoundError extends Error { name = 'CliNotFoundError' }
class CliExecutionError extends Error {
  name = 'CliExecutionError'
  constructor(message: string, public exitCode: number, public stderr: string) { ... }
}
class CliParseError extends Error { name = 'CliParseError' }
class CliTimeoutError extends Error { name = 'CliTimeoutError' }
```

### Migration Strategy

N/A — new code, no migration needed.

## Implementation Steps

1. **Create error types** — `app/src/main/errors.ts` with `CliNotFoundError`, `CliExecutionError`, `CliParseError`, `CliTimeoutError`. Each extends `Error` with a distinct `name` property for identification across IPC serialization.

2. **Build CLI bridge module** — `app/src/main/cli.ts`:
   - `findCli()`: use `which` (or `where` on Windows) to locate `mdvdb` on PATH. Return the absolute path. Throw `CliNotFoundError` if not found.
   - `getCliVersion()`: spawn `mdvdb --version`, parse the output string.
   - `execCommand<T>(command, args, root, options)`: spawn `child_process.execFile` with `['command', '--json', '--root', root, ...args]`. Collect stdout/stderr. On exit code 0: parse stdout as JSON, return typed result. On non-zero exit: throw `CliExecutionError` with stderr. On timeout: kill process, throw `CliTimeoutError`. On JSON parse failure: throw `CliParseError`.
   - Use `child_process.execFile` (not `exec`) for security — no shell injection.
   - Set `maxBuffer` to 10MB for large search results.

3. **Create TypeScript CLI types** — `app/src/renderer/types/cli.ts`: define all interfaces matching the CLI JSON output. Cross-reference with the Rust source files (`src/main.rs`, `src/lib.rs`, `src/search.rs`, `src/index/types.rs`, `src/tree.rs`, `src/links.rs`, `src/schema.rs`, `src/clustering.rs`).

4. **Build IPC handlers** — `app/src/main/ipc-handlers.ts`:
   - `registerIpcHandlers()` function called from `src/main/index.ts` on app ready.
   - One `ipcMain.handle()` per CLI command.
   - Each handler: extract args from the event, call `execCommand` with the correct type parameter, return the result. Catch errors and re-throw serializable error objects (IPC strips Error prototype).
   - Ingest handler: use 300s timeout. Other handlers: 30s timeout.

5. **Update preload script** — `app/src/preload/index.ts`:
   - Use `contextBridge.exposeInMainWorld('api', { ... })` to expose typed methods.
   - Each method calls `ipcRenderer.invoke('cli:channelName', ...args)`.
   - Add TypeScript declaration file `app/src/preload/api.d.ts` so the renderer sees `window.api` with full types.

6. **Update main process entry** — `app/src/main/index.ts`: call `registerIpcHandlers()` after app ready. Run `findCli()` on startup and store the result for the renderer to query.

7. **Add basic CLI status to UI** — Update `StatusBar.svelte` to show CLI detection status: call `window.api.findCli()` on mount. Show green indicator + version if found, red indicator + "CLI not found" if missing.

8. **Write unit tests** — `tests/unit/cli.test.ts`:
   - Mock `child_process.execFile` using `vi.mock`.
   - Test `findCli()` returns path when binary exists, throws `CliNotFoundError` when missing.
   - Test `execCommand()` parses valid JSON stdout correctly.
   - Test `execCommand()` throws `CliExecutionError` on non-zero exit code.
   - Test `execCommand()` throws `CliParseError` on malformed JSON.
   - Test `execCommand()` throws `CliTimeoutError` after timeout.
   - Test each IPC handler calls `execCommand` with correct arguments.

9. **Write integration tests** — `tests/integration/cli-bridge.test.ts`:
   - Requires `mdvdb` binary on PATH (skip if not available).
   - Create a temp directory with a markdown file.
   - Run `init`, `ingest` (with mock provider), `status`, `tree`, `search` through the bridge.
   - Validate response shapes match TypeScript interfaces.

10. **Write E2E test** — Update `tests/e2e/app-launch.test.ts`:
    - After app launches, verify the status bar shows either the CLI version or "CLI not found".
    - If CLI is available: verify version string format.

## Validation Criteria

- [ ] `window.api.findCli()` returns the binary path when `mdvdb` is on PATH
- [ ] `window.api.findCli()` throws `CliNotFoundError` when `mdvdb` is not on PATH
- [ ] `window.api.getCliVersion()` returns a version string like "0.1.0"
- [ ] `window.api.status(root)` returns a valid `IndexStatus` object for an indexed collection
- [ ] `window.api.tree(root)` returns a valid `FileTree` with correct structure
- [ ] `window.api.search(root, query)` returns `SearchOutput` with results array
- [ ] All IPC channels handle errors gracefully and return serializable error info
- [ ] Timeout kills the child process and returns `CliTimeoutError`
- [ ] Status bar shows CLI version or "CLI not found"
- [ ] TypeScript types compile without errors
- [ ] All unit tests pass (mocked CLI)
- [ ] Integration tests pass (real CLI, if available)

## Anti-Patterns to Avoid

- **Do NOT use `child_process.exec()`** — Use `execFile()` to avoid shell injection vulnerabilities. The CLI path and arguments must never be concatenated into a shell string.
- **Do NOT parse CLI output as plain text** — Always use `--json` flag and parse as JSON. Text output formats may change between versions.
- **Do NOT expose Node.js APIs directly to renderer** — Everything goes through the preload `contextBridge`. Never set `nodeIntegration: true`.
- **Do NOT duplicate type definitions** — Define CLI output types once in `src/renderer/types/cli.ts` and import everywhere. The preload script types should reference these same interfaces.
- **Do NOT swallow errors** — Every error from the CLI must be surfaced to the renderer with enough context (command, args, stderr, exit code) for meaningful error messages.
- **Do NOT hardcode the CLI binary name** — Use a constant (`CLI_BINARY_NAME = 'mdvdb'`) so it can be changed if the binary is renamed.

## Patterns to Follow

- **Rust type → TypeScript type mapping** — Read the Rust source files to derive exact TypeScript interfaces. Every `#[derive(Serialize)]` struct in the Rust code should have a corresponding TypeScript interface. Reference `src/lib.rs` for the public API types.
- **IPC channel naming** — Use `'cli:<command>'` pattern (e.g., `'cli:search'`, `'cli:status'`). Consistent, discoverable, easy to grep.
- **Error serialization** — IPC strips Error prototypes. Return `{ error: true, type: 'CliNotFoundError', message: '...' }` objects that the renderer can reconstruct into typed errors.
- **Process cleanup** — Track spawned child processes and kill them on app quit to prevent zombies. Use `app.on('before-quit', cleanup)`.
