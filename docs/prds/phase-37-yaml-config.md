# PRD: Phase 37 — App YAML Configuration

## Overview

Update the Electron app's config read/write layer to work with YAML config files instead of dotenv-style `KEY=VALUE` files. The CLI (Phase 28) migrates mdvdb config to `.markdownvdb/config.yaml` (project) and `~/.mdvdb/config.yaml` (user). The app must read and write this new format through `config-io.ts`, update IPC handlers, settings store, and the Settings UI to use hierarchical YAML paths instead of flat `MDVDB_*` keys. Depends on Phase 28 (CLI YAML config migration).

## Problem Statement

Phase 28 replaces the dotenv config format with YAML on the CLI side. The app currently reads/writes dotenv files through `config-io.ts` (`readConfig`, `writeConfigKey`, `deleteConfigKey`) and references flat `MDVDB_*` keys throughout the Settings panel and store. After Phase 28, the app would be writing dotenv to files the CLI reads as YAML — a silent data corruption path.

The app needs to speak YAML natively: read hierarchical config objects, write nested keys, and present the cleaner YAML structure in the Settings UI.

## Goals

- `config-io.ts` reads and writes YAML files (`.markdownvdb/config.yaml`, `~/.mdvdb/config.yaml`)
- IPC handlers return nested config objects (not flat `Record<string, string>`)
- Settings store works with hierarchical config structure
- Settings UI uses dot-path keys (e.g., `embedding.provider`) instead of `MDVDB_*` keys
- Custom clusters read/write as native YAML arrays (no more `parseCustomClusters`/`encodeCustomClusters` for config files)
- Settings inheritance (user → collection) works at the nested-field level
- All existing settings functionality preserved (draft-save pattern, override badges, reset)

## Non-Goals

- CLI-side YAML migration — that's Phase 28
- Auto-migrating dotenv configs from the app — the CLI handles migration on first load
- Comment preservation in YAML files — `js-yaml`/`yaml` libraries don't support round-trip comments
- New settings categories or fields — only format migration
- Changes to how the app executes CLI commands — CLI bridge is unchanged

## Technical Design

### Config I/O Rewrite

Replace `app/src/main/config-io.ts` contents. Add `yaml` npm dependency (modern YAML library with TypeScript types).

**New exports:**

```typescript
import { parse, stringify } from 'yaml'

/** Read a YAML config file into a nested object. Returns {} if file missing. */
export async function readYamlConfig(filePath: string): Promise<Record<string, unknown>>

/** Write a full config object to a YAML file. Creates parent dirs if needed. */
export async function writeYamlConfig(
  filePath: string,
  config: Record<string, unknown>
): Promise<void>

/** Read YAML, set a nested key by dot-path, write back. */
export async function setConfigValue(
  filePath: string,
  keyPath: string, // e.g., "embedding.provider", "search.decay.enabled"
  value: unknown
): Promise<void>

/** Read YAML, remove a nested key by dot-path, write back. */
export async function deleteConfigValue(filePath: string, keyPath: string): Promise<void>
```

**Dot-path helper** (internal):

```typescript
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {}
    }
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function deleteNestedKey(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  let current: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) return
    current = current[parts[i]] as Record<string, unknown>
  }
  delete current[parts[parts.length - 1]]
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
```

### IPC Handler Changes

`app/src/main/ipc-handlers.ts` — update six handlers:

**File paths change:**

- `.markdownvdb/.config` → `.markdownvdb/config.yaml`
- `~/.mdvdb/config` → `~/.mdvdb/config.yaml`

**Return types change:**

```typescript
// Before: Record<string, string>
// After: Record<string, unknown> (nested YAML object)
ipcMain.handle('settings:get-user-config', () =>
  wrapHandler(() => readYamlConfig(join(homedir(), '.mdvdb', 'config.yaml')))
)

ipcMain.handle('settings:set-user-config', (_event, keyPath: string, value: unknown) =>
  wrapHandler(() => setConfigValue(join(homedir(), '.mdvdb', 'config.yaml'), keyPath, value))
)

ipcMain.handle('settings:delete-user-config', (_event, keyPath: string) =>
  wrapHandler(() => deleteConfigValue(join(homedir(), '.mdvdb', 'config.yaml'), keyPath))
)

// Same pattern for collection config with .markdownvdb/config.yaml
ipcMain.handle('settings:get-collection-config', (_event, root: string) =>
  wrapHandler(() => readYamlConfig(join(root, '.markdownvdb', 'config.yaml')))
)

ipcMain.handle(
  'settings:set-collection-config',
  (_event, root: string, keyPath: string, value: unknown) =>
    wrapHandler(() => setConfigValue(join(root, '.markdownvdb', 'config.yaml'), keyPath, value))
)

ipcMain.handle('settings:delete-collection-config', (_event, root: string, keyPath: string) =>
  wrapHandler(() => deleteConfigValue(join(root, '.markdownvdb', 'config.yaml'), keyPath))
)
```

### Preload API Type Changes

`app/src/preload/index.ts` and `app/src/preload/api.d.ts`:

```typescript
// Before
getUserConfig(): Promise<Record<string, string>>
setUserConfig(key: string, value: string): Promise<void>
deleteUserConfig(key: string): Promise<void>
getCollectionConfig(root: string): Promise<Record<string, string>>
setCollectionConfig(root: string, key: string, value: string): Promise<void>
deleteCollectionConfig(root: string, key: string): Promise<void>

// After
getUserConfig(): Promise<Record<string, unknown>>
setUserConfig(keyPath: string, value: unknown): Promise<void>
deleteUserConfig(keyPath: string): Promise<void>
getCollectionConfig(root: string): Promise<Record<string, unknown>>
setCollectionConfig(root: string, keyPath: string, value: unknown): Promise<void>
deleteCollectionConfig(root: string, keyPath: string): Promise<void>
```

The preload `invoke()` wrappers stay the same — only type signatures change.

### Settings Store Changes

`app/src/renderer/stores/settings.ts`:

**Store types change:**

```typescript
// Before
let userConfig = $state<Record<string, string>>({})
let collectionConfig = $state<Record<string, string>>({})

// After
let userConfig = $state<Record<string, unknown>>({})
let collectionConfig = $state<Record<string, unknown>>({})
```

**Draft mechanism stays flat** — drafts remain as `Record<string, unknown>` with dot-path keys:

```typescript
let userDraft = $state<Record<string, unknown>>({}) // e.g., { "embedding.provider": "ollama" }
let collectionDraft = $state<Record<string, unknown>>({})
let collectionDeletions = $state<Set<string>>(new Set()) // dot-path keys to delete
```

**`getConfigValue(keyPath)` changes:**

```typescript
// Before: flat lookup by MDVDB_* key
function getConfigValue(key: string): string

// After: dot-path lookup into nested objects
function getConfigValue(keyPath: string): unknown {
  // Priority: collection draft > collection saved > user draft > user saved > undefined
  if (keyPath in collectionDraft) return collectionDraft[keyPath]
  const collVal = getNestedValue(collectionConfig, keyPath)
  if (collVal !== undefined) return collVal
  if (keyPath in userDraft) return userDraft[keyPath]
  return getNestedValue(userConfig, keyPath)
}
```

**`saveAllSettings()` changes:**

```typescript
async function saveAllSettings(collectionRoot?: string) {
  // Save user draft entries
  for (const [keyPath, value] of Object.entries(userDraft)) {
    await window.api.setUserConfig(keyPath, value)
  }
  // Save collection draft entries
  if (collectionRoot) {
    for (const [keyPath, value] of Object.entries(collectionDraft)) {
      await window.api.setCollectionConfig(collectionRoot, keyPath, value)
    }
    for (const keyPath of collectionDeletions) {
      await window.api.deleteCollectionConfig(collectionRoot, keyPath)
    }
  }
  // Reload configs, clear drafts
}
```

### Settings UI Key Migration

`app/src/renderer/components/Settings.svelte` — all key references change:

| Before (dotenv)                | After (YAML dot-path)     |
| ------------------------------ | ------------------------- |
| `MDVDB_EMBEDDING_PROVIDER`     | `embedding.provider`      |
| `MDVDB_EMBEDDING_MODEL`        | `embedding.model`         |
| `MDVDB_EMBEDDING_DIMENSIONS`   | `embedding.dimensions`    |
| `MDVDB_SEARCH_MODE`            | `search.mode`             |
| `MDVDB_SEARCH_DEFAULT_LIMIT`   | `search.limit`            |
| `MDVDB_SEARCH_MIN_SCORE`       | `search.min_score`        |
| `MDVDB_SEARCH_BOOST_LINKS`     | `search.boost_links`      |
| `MDVDB_SEARCH_BOOST_HOPS`      | `search.boost_hops`       |
| `MDVDB_SEARCH_EXPAND_GRAPH`    | `search.expand_graph`     |
| `MDVDB_SEARCH_EXPAND_LIMIT`    | `search.expand_limit`     |
| `MDVDB_SEARCH_DECAY`           | `search.decay.enabled`    |
| `MDVDB_SEARCH_DECAY_HALF_LIFE` | `search.decay.half_life`  |
| `MDVDB_SEARCH_DECAY_INCLUDE`   | `search.decay.include`    |
| `MDVDB_SEARCH_DECAY_EXCLUDE`   | `search.decay.exclude`    |
| `MDVDB_CHUNK_MAX_TOKENS`       | `chunking.max_tokens`     |
| `MDVDB_CHUNK_OVERLAP_TOKENS`   | `chunking.overlap_tokens` |
| `MDVDB_CUSTOM_CLUSTERS`        | `clustering.custom`       |
| `MDVDB_CLUSTER_GRANULARITY`    | `clustering.granularity`  |
| `MDVDB_SEARCH_RRF_K`           | `search.rrf_k`            |

The `handleChange(keyPath, value)` function signature stays the same — only the key format changes.

### Custom Clusters: Native YAML Arrays

The `parseCustomClusters(raw)` and `encodeCustomClusters(defs)` functions in `app/src/renderer/lib/custom-clusters.ts` are no longer needed for config file operations. In YAML, custom clusters are a native array:

```yaml
clustering:
  custom:
    - name: 'AI Research'
      seeds: ['machine learning', 'neural networks']
```

**Reading:** `getConfigValue('clustering.custom')` returns the array directly.

**Writing:** `stageCollectionConfig('clustering.custom', updatedArray)` stages the full array.

The encode/decode functions can be kept for backwards compat with the `MDVDB_CUSTOM_CLUSTERS` env var, but are no longer used in the settings save/load path.

### TypeScript Config Interface

Add to `app/src/renderer/types/cli.ts` (optional but helpful for IDE support):

```typescript
/** YAML config structure (all fields optional — partial configs valid) */
export interface YamlConfig {
  embedding?: {
    provider?: string
    model?: string
    dimensions?: number
    batch_size?: number
    endpoint?: string | null
  }
  search?: {
    mode?: string
    limit?: number
    min_score?: number
    rrf_k?: number
    bm25_norm_k?: number
    boost_links?: boolean
    boost_hops?: number
    expand_graph?: number
    expand_limit?: number
    decay?: {
      enabled?: boolean
      half_life?: number
      exclude?: string[]
      include?: string[]
    }
  }
  chunking?: {
    max_tokens?: number
    overlap_tokens?: number
  }
  clustering?: {
    enabled?: boolean
    rebalance_threshold?: number
    granularity?: number
    custom?: Array<{ name: string; seeds: string[] }>
  }
  watch?: {
    enabled?: boolean
    debounce_ms?: number
  }
  index?: {
    quantization?: string
    compression?: boolean
    edge_embeddings?: boolean
    edge_boost_weight?: number
    edge_cluster_rebalance?: number
  }
  sources?: {
    dirs?: string[]
    ignore?: string[]
  }
}
```

## Implementation Steps

1. **Add `yaml` npm dependency** — `npm install yaml` in `app/`.

2. **Rewrite `config-io.ts`** — Replace dotenv read/write with YAML functions: `readYamlConfig()`, `writeYamlConfig()`, `setConfigValue()`, `deleteConfigValue()`. Add dot-path helpers (`setNestedValue`, `deleteNestedKey`, `getNestedValue`).

3. **Update IPC handlers** — `app/src/main/ipc-handlers.ts`: Change file paths to `config.yaml`. Update function calls to new `config-io.ts` exports. Return types change from `Record<string, string>` to `Record<string, unknown>`.

4. **Update preload types** — `app/src/preload/index.ts` and `app/src/preload/api.d.ts`: Update type signatures for config methods.

5. **Update settings store** — `app/src/renderer/stores/settings.ts`: Change store types. Update `getConfigValue()` to use dot-path nested lookups. Update `saveAllSettings()`.

6. **Add TypeScript config interface** — `app/src/renderer/types/cli.ts`: Add `YamlConfig` interface.

7. **Update Settings.svelte** — Replace all `MDVDB_*` key references with dot-path equivalents. Update custom clusters to read/write native YAML arrays.

8. **Clean up custom-clusters.ts** — Remove or deprecate `parseCustomClusters()`/`encodeCustomClusters()` from the settings save path. Keep if needed for env var display.

9. **Update tests** — Rewrite `config-io.test.ts` for YAML semantics. Update `settings-store.test.ts` mock return types. Update `ipc-handlers.test.ts` expectations.

## Files Modified

| File                                          | Change                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `app/package.json`                            | Add `yaml` dependency                                              |
| `app/src/main/config-io.ts`                   | Complete rewrite: dotenv → YAML read/write                         |
| `app/src/main/ipc-handlers.ts`                | File paths → `config.yaml`, function calls → new config-io exports |
| `app/src/preload/index.ts`                    | Type signature updates for config methods                          |
| `app/src/preload/api.d.ts`                    | Type declaration updates                                           |
| `app/src/renderer/stores/settings.ts`         | Store types, `getConfigValue()`, `saveAllSettings()`               |
| `app/src/renderer/types/cli.ts`               | `YamlConfig` interface                                             |
| `app/src/renderer/components/Settings.svelte` | All key references: `MDVDB_*` → dot-path                           |
| `app/src/renderer/lib/custom-clusters.ts`     | Deprecate/remove encode/decode for settings path                   |
| `app/tests/unit/config-io.test.ts`            | Rewrite for YAML semantics                                         |
| `app/tests/unit/settings-store.test.ts`       | Update mock return types                                           |
| `app/tests/unit/ipc-handlers.test.ts`         | Update expectations                                                |

## Validation Criteria

- [ ] Settings panel loads and displays all config values correctly from YAML
- [ ] Changing a setting stages it as a draft (dot-path key)
- [ ] Saving writes correct YAML to `.markdownvdb/config.yaml`
- [ ] User-level config reads from `~/.mdvdb/config.yaml`
- [ ] Collection config overrides user config at the field level
- [ ] Override badges show correctly for collection-level overrides
- [ ] Reset button removes collection override (deletes nested key from YAML)
- [ ] Custom clusters display as native list (no pipe-separated encoding)
- [ ] Adding a custom cluster writes `clustering.custom` array to YAML
- [ ] Removing a custom cluster updates `clustering.custom` array
- [ ] Partial config files (missing sections) don't cause errors
- [ ] Empty/missing config files return empty objects (no errors)
- [ ] All existing settings continue to work (embedding, search, chunking, decay, etc.)
- [ ] `npm test` passes — all unit tests
- [ ] `npm run typecheck` passes — no type errors
- [ ] `npm run lint` passes

## Anti-Patterns to Avoid

- **Do not write dotenv format to YAML files** — The old `KEY=VALUE` format must never be written to `config.yaml`. Ensure all code paths go through the new YAML functions.

- **Do not flatten YAML into `Record<string, string>` in the store** — Keep the nested structure. Use dot-path helpers for field access. Flattening loses type information and makes arrays (like custom clusters) awkward.

- **Do not auto-migrate dotenv from the app** — The CLI handles migration on first `mdvdb` command. The app only reads/writes YAML. If the CLI hasn't run yet, the app may see an empty config — that's fine (defaults apply).

- **Do not duplicate the YAML schema in the app** — The `YamlConfig` TypeScript interface is optional documentation, not validation. The CLI is the source of truth for config validation.

- **Do not stringify values before writing** — YAML preserves types natively. Write numbers as numbers, booleans as booleans, arrays as arrays. Don't `toString()` everything.

## Patterns to Follow

- **Config I/O:** Current `config-io.ts` pattern (file read/write with graceful ENOENT handling)
- **IPC handlers:** Current `wrapHandler()` pattern in `ipc-handlers.ts`
- **Settings store:** Current draft-save pattern (`stageUserConfig`, `stageCollectionConfig`, `saveAllSettings`)
- **Settings UI:** Current `handleChange(key, value)` → `getConfigValue(key)` pattern in `Settings.svelte`
- **Custom clusters UI:** Current list + modal pattern in Settings.svelte

## Dependencies

- **Phase 28 (CLI YAML Config)** must be implemented first — the CLI creates and migrates `config.yaml` files. The app reads/writes them.
