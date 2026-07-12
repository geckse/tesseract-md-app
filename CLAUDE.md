# Markdown VDB — Electron App

Desktop GUI for markdown-vdb. Electron + Svelte 5 + CodeMirror 6. Bridges to the Rust CLI (`mdvdb`) via IPC subprocess execution.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                │
│   src/main/index.ts — window lifecycle, IPC handlers    │
│   cli.ts — spawns `mdvdb` binary via execFile           │
│   store.ts — electron-store for collections             │
│   errors.ts — typed error classes for IPC transport     │
├─────────────────────────────────────────────────────────┤
│                     Preload Script                      │
│   src/preload/index.ts — contextBridge API surface      │
│   api.d.ts — TypeScript types for window.api            │
├─────────────────────────────────────────────────────────┤
│                   Renderer (Svelte SPA)                 │
│   components/ — Sidebar, Header, Editor, FileTree, etc. │
│   stores/ — collections, editor, files (Svelte stores)  │
│   lib/ — editor theme, soft render, frontmatter deco    │
│   types/cli.ts — TS interfaces mirroring Rust structs   │
│   styles/ — tokens.css, global.css, app.css             │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
├── src/
│   ├── main/                       # Electron main process
│   │   ├── index.ts                # BrowserWindow creation, app lifecycle
│   │   ├── ipc-handlers.ts         # 30+ IPC channel handlers (cli:*, collections:*, fs:*)
│   │   ├── cli.ts                  # CLI binary detection (findCli) & execution (execCommand)
│   │   ├── store.ts                # electron-store schema (collections, window bounds)
│   │   ├── collections.ts          # Path validation, folder picker, init prompt
│   │   └── errors.ts               # CliNotFoundError, CliExecutionError, CliParseError, CliTimeoutError
│   ├── preload/
│   │   ├── index.ts                # contextBridge.exposeInMainWorld('api', ...)
│   │   └── api.d.ts                # MdvdbApi interface + Collection, SearchOptions, IngestOptions
│   └── renderer/
│       ├── main.ts                 # Svelte app mount
│       ├── App.svelte              # Root layout: Sidebar | Header + Editor + StatusBar
│       ├── index.html              # HTML shell with CSP headers
│       ├── components/
│       │   ├── Sidebar.svelte      # Collection list + file tree panel (256px)
│       │   ├── Header.svelte       # Breadcrumb path + dirty indicator + actions
│       │   ├── Editor.svelte       # CodeMirror 6 markdown editor
│       │   ├── FileTree.svelte     # Tree display with expand/collapse, stats
│       │   ├── FileTreeNode.svelte # Recursive tree node (dir or file)
│       │   ├── StatusBar.svelte    # Language, word count, reading time, CLI status
│       │   └── ui/                 # Design system primitives
│       │       ├── Button.svelte   # Primary/secondary, sm/md/lg
│       │       ├── Badge.svelte    # Status badges with semantic colors
│       │       ├── Input.svelte    # Text input with validation
│       │       ├── IconButton.svelte
│       │       └── Kbd.svelte      # Keyboard shortcut display
│       ├── stores/
│       │   ├── collections.ts      # collections, activeCollectionId, collectionStatus
│       │   ├── editor.ts           # isDirty, wordCount, readingTime (derived)
│       │   └── files.ts            # fileTree, selectedFilePath, fileContent, expandedPaths
│       ├── lib/
│       │   ├── editor-theme.ts     # CodeMirror dark theme + syntax highlighting
│       │   ├── soft-render.ts      # Soft markdown preview decorations
│       │   └── frontmatter-decoration.ts  # YAML frontmatter styling
│       ├── styles/
│       │   ├── tokens.css          # CSS custom properties (colors, spacing, typography)
│       │   ├── global.css          # Resets, grain texture, scrollbars
│       │   └── app.css             # App layout (flexbox shell)
│       └── types/
│           └── cli.ts              # TS interfaces mirroring Rust Serialize structs
├── tests/
│   ├── unit/                       # Vitest + @testing-library/svelte
│   ├── integration/                # Vitest integration tests
│   └── e2e/                        # Playwright E2E tests
├── out/                            # Build output (main/, preload/, renderer/)
├── electron.vite.config.ts         # Three-target build config
├── vitest.config.ts                # Unit test config (jsdom)
├── vitest.integration.config.ts    # Integration test config
├── playwright.config.ts            # E2E test config
├── tsconfig.json                   # Workspace references root
├── tsconfig.node.json              # Main + preload (ES2020, commonjs)
├── tsconfig.web.json               # Renderer (ESNext, extends @tsconfig/svelte)
├── eslint.config.js                # ESLint 9 flat config + svelte plugin
└── .prettierrc                     # Semi, single quotes, trailing comma es5
```

## Tech Stack

| Layer        | Technology                           | Purpose                                                          |
| ------------ | ------------------------------------ | ---------------------------------------------------------------- |
| Desktop      | Electron 39                          | Window management, native APIs                                   |
| Build        | electron-vite 3 + Vite 6             | Three-target bundling (main/preload/renderer)                    |
| UI Framework | Svelte 5                             | Reactive components with runes (`$state`, `$derived`, `$effect`) |
| Editor       | CodeMirror 6                         | Markdown editing (view, state, lang-markdown, commands)          |
| Styling      | CSS custom properties + Tailwind 4   | Dark theme tokens, utility classes                               |
| Persistence  | electron-store 10                    | Collections, window bounds (JSON on disk)                        |
| Packaging    | electron-builder 26                  | DMG/NSIS/AppImage distribution                                   |
| Unit Tests   | Vitest 3 + @testing-library/svelte 5 | Component + logic tests (jsdom)                                  |
| E2E Tests    | Playwright 1.49                      | Full app tests against Electron                                  |
| Linting      | ESLint 9 + Prettier 3                | Code quality + formatting                                        |
| Types        | TypeScript 5.7                       | Strict mode everywhere                                           |

## CLI Bridge Pattern

The app does NOT embed the Rust library. It shells out to the `mdvdb` CLI binary:

```
Renderer store action
  → window.api.search(root, query, opts)      [preload contextBridge]
  → ipcRenderer.invoke('cli:search', ...)      [IPC to main]
  → execFile('mdvdb', ['search', '--json', '--root', root, query, ...])
  → Parse JSON stdout → return typed result
  → Error? Serialize to { error: true, type, message } for IPC transport
  → Preload unwraps → throws Error in renderer
```

Key details:

- `execFile()` (not `exec()`) to prevent shell injection
- All CLI commands pass `--json` for machine-parseable output
- `--root <path>` sets the collection directory
- Timeout: 30s default, 300s for ingest
- Max buffer: 10MB for stdout/stderr

### IPC Channels

| Prefix         | Channels                                                                                                                                              | Purpose                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli:`         | find, version, search, status, info, ingest, ingest-preview, tree, get, links, backlinks, orphans, clusters, schema, collection, config, doctor, init | mdvdb CLI commands (`cli:info` accepts an optional folder scope; `cli:get` and `cli:collection` accept `{ populate?: boolean }` → `--populate`, phase 42) |
| `collections:` | list, add, remove, set-active, get-active                                                                                                             | Collection management (electron-store)                                                                                                                    |
| `fs:`          | read-file, write-file, update-frontmatter, …                                                                                                          | File I/O (validated against collection paths)                                                                                                             |
| `schema:`      | preview-property-op, apply-property-op, update-overlay-field (+ `property-op-progress` event)                                                         | Phase 41: recursive property type conversion / rename + schema-overlay annotation edits                                                                   |

## Core Design Decisions

- **CLI bridge, not FFI**: The app spawns the `mdvdb` binary as a subprocess. No Rust FFI, no WASM. The CLI's `--json` output is the contract.
- **Context isolation**: Preload script exposes a typed `window.api` surface via `contextBridge`. Renderer never accesses Node.js directly.
- **Svelte stores for state**: Writable stores (`collections`, `fileTree`, `selectedFilePath`, etc.) with derived stores for computed values. No external state library.
- **Dark theme only**: No light mode. CSS custom properties in `tokens.css` are the single source of truth. Primary accent: `#00E5FF` (cyan).
- **Types mirror Rust**: `src/renderer/types/cli.ts` contains TypeScript interfaces that mirror the Rust `Serialize` structs. Keep in sync when Rust types change.
- **Error serialization**: Electron IPC can't transport Error instances. Custom error classes serialize to `{ error: true, type, message }` objects. Preload deserializes them back to thrown Errors.
- **Schema overlay writer (phase 41)**: `src/main/schema-overlay.ts` is the app's only write path for `.markdownvdb.schema.yml` (eemeli `yaml` Document API, comment-preserving, atomic write, own-write registered). Scope keys are relative folder paths WITHOUT a trailing slash — the CLI's `schema_key` format. Batch property conversion/rename lives in `src/main/property-ops.ts` (deterministic conversion matrix, skip + report, watcher paused, per-file atomic writes via the shared `frontmatter.ts` tail). After an apply, the renderer owns the follow-up: one incremental ingest → schema/table refresh → routing changed paths through `file-sync.ts` (required — own writes are watcher-suppressed).
- **Frontmatter relations (phase 42)**: GUI over CLI phase-31 (`app/docs/prds/phase-42-frontmatter-relations.md`; contract lives in the CLI repo's `docs/prds/phase-31-frontmatter-relations.md`). The CLI is the SINGLE resolver — the app renders `RelationValue`s from `--populate` and writes plain `[[root-relative-path-sans-.md]]` strings through the normal frontmatter pipeline; `src/renderer/lib/relation-format.ts` mirrors the link-shape predicate/`relation_key` for the optimistic display fallback + filter parity only. Every relation CAPABILITY (passing `--populate`, the Relation type option, the target-folder field, Referenced-by) gates on `cliFeatures.supportsRelations` (`lib/cli-features.svelte.ts`, min version `0.2.0`, detected via `mdvdb --version --json`; unparseable ⇒ unsupported) — RENDERING never gates (a `Relation` column must not crash `CELLS` dispatch). Shared chips: `RelationChip.svelte` (resolved/broken/neutral states); decoupled picker: `RelationPicker.svelte` (scoped to `relation_target` via one cached collection call). Table filters normalize relation syntax at MATCH time; saved views store raw values. The type vocabulary has exactly two hand-synced copies (`DetectedType` in PropertyRow.svelte, `PropertyTargetType` in api.d.ts) guarded by `UNION_CONGRUENT` in `lib/property-types.ts`. Converting a property to relation is a schema pin, never a value rewrite. Graph: `isFrontmatterEdge` (edge-utils) drives violet frontmatter edges (color only — `linkLineDash` is a 2D force-graph API that does NOT exist on 3d-force-graph; calling it breaks graph init, guarded by `tests/unit/graph-3d-api-contract.test.ts`) + the `via frontmatter: <field>` tooltip.
- **Obsidian topic auto-import & sync (phase 44)**: `src/main/obsidian-import.ts`, spec in `docs/prds/phase-44-obsidian-topic-import.md`. Collections that are Obsidian vaults (`.obsidian/` dir) get topics derived from frontmatter/inline tags (≥2 notes, top 12, seeded with up to 5 note titles) and `.obsidian/graph.json` color groups (tag queries pin, plain-text queries import, `path:`/`file:` skipped), written via real `mdvdb clusters add/update/remove`. Sync triggers: app startup, `collections:add`/`set-active`, vault-watcher markdown batches (30s debounce), and a dedicated `fs.watch` on `.obsidian/` (the vault watcher skips that dir). Ownership: per-collection `obsidianTopicSync` electron-store state maps managed topic names to a name+seeds SHA-256 — sync only touches topics whose hash still matches what it last wrote; user-edited topics are released forever, user-deleted ones tombstoned (`'deleted'`), name collisions skipped, and vaults that already had topics at first scan are `managed:false` permanently. Changes broadcast on `topics:obsidian-synced` → `stores/obsidian-import.ts` → `ObsidianImportNotification.svelte` banner (import vs sync-summary phrasing; Sync now = `runIngest()` + clears `topicsNeedIngest`, active collection only).

## Development Workflow

```bash
npm run dev              # Start Electron with HMR (main + renderer hot reload)
npm run build            # Production build → out/
npm run preview          # Preview production build locally

npm test                 # Run unit tests (vitest)
npm run test:watch       # Watch mode for unit tests
npm run test:e2e         # Run E2E tests (playwright)

npm run lint             # ESLint + Prettier check
npm run lint:fix         # Auto-fix lint issues
npm run typecheck        # tsc --noEmit (full type check)
```

Note: the app holds a single-instance lock — a second `npm run dev` (or packaged launch) exits immediately and focuses the running instance's primary window instead.

Known test issue: selected `PropertiesPanel.test.ts` and `LocalGraph.test.ts` component cases are
quarantined because the jsdom/Svelte 5 harness can throw `effect_update_depth_exceeded`. This is a
test-harness artifact; keep the pure graph/data tests enabled and remove the skips when the harness
is fixed.

## Testing Requirements

**Every change must have automated tests. No exceptions.**

### Unit Tests (Vitest + jsdom)

- Config: `vitest.config.ts` — jsdom environment, `@testing-library/svelte`
- Location: `tests/unit/**/*.test.ts`
- Path alias: `@renderer` → `src/renderer`

**Patterns:**

```typescript
// Mock window.api before importing components
const mockApi = { findCli: vi.fn(), search: vi.fn(), ... }
Object.defineProperty(globalThis, 'window', { value: { api: mockApi } })

// Mock Electron/Node modules for main process tests
vi.mock('electron', () => ({ app: { ... }, ipcMain: { handle: vi.fn() } }))

// Mock CodeMirror for Editor tests (heavy dependency)
vi.mock('@codemirror/view', () => ({ EditorView: vi.fn(), ... }))

// Render and assert
import { render, screen } from '@testing-library/svelte'
render(MyComponent, { props: { ... } })
expect(screen.getByText('...')).toBeInTheDocument()
```

### Integration Tests

- Config: `vitest.integration.config.ts`
- Location: `tests/integration/**/*.test.ts`

### E2E Tests (Playwright)

- Config: `playwright.config.ts` — 30s timeout, trace on first retry
- Location: `tests/e2e/**/*.test.ts`
- Runs against the full Electron app

### What to test:

- Component rendering and user interactions
- Store state transitions and derived computations
- IPC handler registration and error serialization
- CLI command construction and response parsing
- File tree expansion, selection, state display
- Editor mount, content binding, save flow

## Styling Guide

### Design Tokens (`tokens.css`)

```css
--color-primary: #00e5ff; /* Cyan accent */
--color-surface: #161617; /* Component backgrounds */
--color-surface-dark: #0a0a0a; /* Deepest background */
--color-bg: #0f0f10; /* App background */
--color-border: #27272a; /* Subtle dividers */
--color-text-main: #e4e4e7; /* Primary text */
--color-text-dim: #71717a; /* Secondary text */

--font-sans: 'Space Grotesk'; /* Display text */
--font-mono: 'JetBrains Mono'; /* Code, status bar */
--icon-font: 'Material Symbols Outlined';
```

### Layout Constants

- Sidebar: 256px fixed width
- Header: 56px fixed height
- Status bar: fixed at bottom
- Content: flex-grow to fill remaining space

### Component Styles

- Scoped `<style>` blocks in each `.svelte` file
- Use CSS custom properties from `tokens.css`
- Transitions: `var(--transition-fast)` (150ms ease)
- No CSS-in-JS

## State Management

```
stores/collections.ts
  ├── collections: Writable<Collection[]>
  ├── activeCollectionId: Writable<string | null>
  ├── collectionStatus: Writable<IndexStatus | null>
  ├── collectionsLoading: Writable<boolean>
  └── activeCollection: Derived<Collection | null>

stores/files.ts
  ├── fileTree: Writable<FileTree | null>
  ├── selectedFilePath: Writable<string | null>
  ├── fileContent: Writable<string | null>
  ├── expandedPaths: Writable<Set<string>>
  ├── flatFileList: Derived<FileTreeNode[]>
  └── fileStateCounts: Derived<Record<FileState, number>>

stores/editor.ts
  ├── isDirty: Writable<boolean>
  ├── wordCount: Writable<number>
  └── readingTime: Derived<number>          /* wordCount / 250 */
```

Actions (exported functions) mutate stores and call `window.api.*` methods. Components subscribe to stores reactively.

## Key Conventions

- Return `Promise<T>` from all IPC-facing functions — never fire-and-forget
- All CLI interactions go through `window.api` — never spawn processes from the renderer
- TypeScript strict mode — no `any` types, no `@ts-ignore`
- Svelte 5 runes (`$state`, `$derived`) for new reactive code
- Component props use `interface Props { ... }` with `let { prop }: Props = $props()`
- Material Symbols icon font for all icons — no icon component library
- Scoped styles in components, tokens in `tokens.css` — no inline styles
- `console.log` only in dev — use structured logging or remove before commit

## Polish & Performance Rules

### Animations

- Every `transition` and `animation` MUST have a `@media (prefers-reduced-motion: reduce)` fallback that disables it
- Use CSS transitions or Svelte `transition:` directives — never `setTimeout` for visual state changes
- Keep durations short (100–200ms) and use standard easings (`ease-out` for entrances, `ease-in-out` for state changes)

### Keyboard & Focus

- Never override browser-native shortcuts (`Cmd+C/V/Z/A`) — they must always work in the editor
- Suppress custom shortcuts inside input/textarea unless they're universal (`Cmd+S`, `Escape`)
- All shortcuts must be platform-aware: `Cmd` on macOS, `Ctrl` on Windows/Linux
- Modals must trap focus and restore it to the previous element on close
- Tab/Shift+Tab should cycle between major UI regions; arrow keys navigate within lists/trees

### Accessibility

- Add ARIA attributes only where native HTML semantics are insufficient — don't over-label
- Use landmark roles on major regions (`navigation`, `main`, `complementary`)
- Dynamic content changes (result counts, progress, status) need `aria-live="polite"` regions
- All interactive elements must have a visible focus indicator

### Performance

- Virtualize long lists (500+ items) — only render what's in the viewport plus a buffer
- Cache recently viewed documents (LRU, bounded) to avoid redundant disk reads
- Debounce and deduplicate CLI calls — never fire duplicate concurrent requests for the same command
- Diff data before re-rendering — update only what changed, don't replace entire trees
- Lazy-load heavy or rarely-used components via dynamic import

### Error & Edge Case Handling

- CLI/network failures must show user-friendly messages with a retry action — never silent failures
- Long operations should have a visible progress indicator and a way to cancel
- When external changes conflict with the editor, prompt the user — never auto-overwrite
- Degrade gracefully for large files: warn and disable expensive decorations/parsing
