# PRD: Phase 40 — Topics UI & Custom-Cluster Graph Coloring Fix

> **Depends on:** CLI repo `docs/prds/phase-30-leiden-clustering-and-topics.md` (Leiden auto-clustering + multi-label topics). **Supersedes** the Settings/config-write mechanism of Phase 36 (custom clusters UI) — that PRD remains as historical record.

## Overview

Adopt the Phase 30 CLI contract in the app: custom clusters become **topics** (multi-label membership with similarity scores, per-topic thresholds, a global floor, and an explicit Unassigned bucket), managed **exclusively through CLI subcommands** instead of the dead dotenv config path. Fix the broken custom-cluster graph coloring (nodes silently fell back to file-hash colors while the legend showed palette colors) by making the bridge's color function the single source of truth and carrying topic fields through the entire node pipeline. Settings gets a reworked "Topics" section with description/threshold editing, live document counts and mean scores, an Unassigned row, a global floor slider, an algorithm selector, a re-ingest banner, and a one-time import banner for legacy dotenv definitions.

## Problem Statement

1. **Topic edits in the GUI silently did nothing.** The Settings panel staged `MDVDB_CUSTOM_CLUSTERS` into the legacy dotenv file `.markdownvdb/.config` (`stageCollectionConfig` → `writeConfigKey`). Since Phase 37 (YAML config), the CLI only migrates that file when `config.yaml` is absent — once YAML exists, dotenv writes are dead. The CLI's own `clusters add/remove` commands write YAML correctly; the app just never used them. The `MDVDB_CLUSTER_GRANULARITY` slider had the same dead-write bug.
2. **Custom-cluster coloring was broken at the root.** `Graph3DNode` dropped `custom_cluster_id` entirely in `buildGraph3DData`, and `GraphView.getNodeColor` was a drifted duplicate of the bridge's `nodeColor` that only handled `'cluster' | 'folder'`. In custom-cluster mode, nodes rendered with per-file hash colors while the legend swatches used `customClusterPalette` — legend and graph disagreed, and mode switches (`graph.refresh()`) re-ran the buggy accessor. Hulls/labels only rendered in `'cluster'` mode. `toGraphNode` also omitted the field, so the node inspector never saw topic data.
3. **No UI for the new semantics.** Phase 30 introduces descriptions, per-topic thresholds, multi-label membership with scores, and an Unassigned bucket — none of which the app could display or edit.

## Goals

- Topic definitions are managed via CLI subcommands (`clusters add/update/remove`), applied **immediately** (no draft/save staging), with a re-ingest banner + one-click `Re-ingest now` after mutations.
- Legacy dotenv definitions get a one-time **Import** banner: parse → `addTopic` each → delete the dead key.
- Custom-cluster mode colors nodes by **primary topic** through one shared pure function (`nodeColorForMode`); Unassigned documents render in the default node color; chunks keep file-hash colors; hulls and floating labels work in custom-cluster mode like they do for auto clusters.
- Multi-label affordance: clicking a topic row in the legend highlights **all** members of that topic (dims non-members), mirroring the existing folder-highlight pattern — no halos or multi-color nodes.
- Scores surfaced: hover tooltip lists `{topic} · NN%` per membership (or "Unassigned"); legend gets a synthetic non-clickable Unassigned row (client-side count of doc nodes with `custom_cluster_id == null`); GraphPreview shows a Topics section with score badges.
- Settings "Topics" section: cards with description, seeds, threshold chip (`custom 0.35` / `global floor`), `N docs · avg NN%`; Unassigned count row; global floor slider (0–0.9, step 0.05) via `config set clustering.topics.min_similarity`; algorithm select (leiden/kmeans) via `config set clustering.algorithm`; the granularity slider migrated to `config set clustering.granularity`.
- Topic modal gains a description textarea and an optional threshold control (checkbox + 0.05–0.95 slider; unchecked = `null` = global floor).
- Type mirror stays version-skew tolerant: every new field optional, old CLI binaries still parse.
- Zero new test failures vs the known pre-existing baseline; zero new typecheck errors.

## Non-Goals

- Rendering the Leiden hierarchy (`parent_id`/`parent_clusters`) — types tolerate the fields; a grouped legend is a pure-frontend follow-up.
- Writing YAML from Node — the CLI bridge remains the only config writer (single source of validation and merge semantics).
- Migrating the *other* Settings keys (embedding, chunking, search) off the dead dotenv path — same bug, separate follow-up; this phase migrates only topics, granularity, and the new clustering keys it touches.
- Multi-color/halo rendering for multi-label nodes — primary-topic coloring + legend highlight is the whole affordance.
- Drag-and-drop assignment, per-topic custom colors (harmonic palette auto-assigns), user-level topics (per-collection only).

## Technical Design

### CLI Contract (from Phase 30 — the app consumes exactly this)

```jsonc
// clusters list --json → TopicDef[]
[{ "name": "AI", "description": "ML notes" /* optional */, "seeds": ["…"], "threshold": 0.4 /* optional */ }]

// clusters --custom --json → CustomClusterSummary[]  (top-level ARRAY, unchanged shape + additive fields)
[{ "id": 0, "name": "AI", "seed_phrases": ["…"], "document_count": 12,
   "description": "…", "threshold": 0.4, "mean_score": 0.61 /* all optional */ }]

// clusters unassigned --json
{ "count": 2, "paths": ["a.md", "b.md"] }

// graph --json — GraphNode additions (parallel arrays, score-descending, omitted when empty)
{ "custom_cluster_id": 3,            // PRIMARY topic; null = Unassigned
  "custom_cluster_ids": [3, 1],
  "custom_cluster_scores": [0.52, 0.31] }

// GraphCluster additions: description?, threshold?, parent_id?   ClusterSummary: parent_id?, representative?
```

Write commands print only to stderr (stdout empty — safe with `execCommand`'s injected `--json`):
`clusters add <name> [--seeds a,b] [--description "…"] [--threshold 0.4]` · `clusters update <name> [--seeds …] --description "<s|empty-to-clear>" (--threshold t | --threshold=-1 to clear) [--rename New]` · `clusters remove <name>` · `config set <dotted.key> <value>`.

Auto-cluster ids are now **stable but non-contiguous** — treat as opaque (palette-by-id-modulo is fine; `graph-delta.ts` id-diffing benefits directly: background refreshes stop recoloring the whole graph).

### Type Mirror (`src/renderer/types/cli.ts`)

`TopicDef { name, seeds, description?, threshold? }` with `export type CustomClusterDef = TopicDef` kept as a deprecated alias; `CustomClusterSummary` += `description?`, `threshold?`, `mean_score?`; new `TopicUnassigned { count, paths }`; `GraphNode` += `custom_cluster_ids?: number[]`, `custom_cluster_scores?: number[]`; `GraphCluster` += `description?`, `threshold?`, `parent_id?`; `ClusterSummary` += `parent_id?`, `representative?`. All optional for version-skew tolerance.

### IPC / Preload (`src/main/ipc-handlers.ts`, `src/preload/index.ts`, `api.d.ts`)

| Channel | CLI invocation | Notes |
|---|---|---|
| `cli:clusters-add` | `clusters add <name> [--seeds s1,s2] [--description d] [--threshold t]` | flags omitted when unset |
| `cli:clusters-update` | `clusters update <name> [--seeds …] --description <d or "">` + (`--threshold t` \| `--threshold=-1`) + `--rename` iff name changed | always sends description/threshold so clearing works; `=-1` equals-form because clap rejects a bare `-1` value |
| `cli:clusters-remove` | `clusters remove <name>` | |
| `cli:clusters-unassigned` | `clusters unassigned` → `TopicUnassigned` | |
| `cli:config-set` | `config set <key> <value>` | generic YAML write (floor, algorithm, granularity) |
| `cli:clusters-list` | `clusters list` (duplicate `--json` removed — `execCommand` injects it) | → `TopicDef[]` |

Preload surface: `addTopic(root, def)`, `updateTopic(root, name, def)`, `removeTopic(root, name)`, `topicUnassigned(root)`, `setConfigValue(root, key, value)` alongside the existing `clusters/customClusters/clusterDefinitions`.

### Topics Store (`src/renderer/stores/topics.ts`, new)

Writable stores `topicDefs`, `topicSummaries`, `topicUnassigned`, `topicsNeedIngest`, `topicsLoading`; `LEGACY_TOPICS_KEY = 'MDVDB_CUSTOM_CLUSTERS'`. Actions:

- `loadTopics(root)` — three independent sub-loads (defs / summaries / unassigned) that fail independently (summaries need an index; defs don't).
- `addTopic` / `updateTopic(root, currentName, def)` / `removeTopic` — immediate CLI write → `loadTopics` → `topicsNeedIngest = true`. Errors propagate to the caller (shown as `topicsError` in Settings) without flagging re-ingest.
- `migrateLegacyDotenvTopics(root, raw)` — `parseCustomClusters(raw)` (the legacy parser survives *only* for this), `addTopic` each (skip CLI rejects, keep migrating), delete the dotenv key via `deleteCollectionConfig`, sync the in-memory `collectionConfig` mirror, reload; returns imported count; flags re-ingest iff > 0.
- `resetTopicsState()` on collection switch.

`encodeCustomClusters` is deleted — the app never writes the dotenv format again.

### Graph Coloring & Multi-Label Rendering

- **`src/renderer/lib/graph-3d-bridge.ts`** — `Graph3DNode` carries `custom_cluster_id`, `custom_cluster_ids`, `custom_cluster_scores` (defaulted `null`/`[]`/`[]` in `buildGraph3DData` for old binaries). The private `nodeColor` becomes the exported pure function:

  ```ts
  nodeColorForMode(node, mode, folderColorMap, isChunk, palette, customPalette): string
  // cluster:        palette by cluster_id; unclustered docs → default, chunks → file-hash
  // custom-cluster: customPalette by PRIMARY custom_cluster_id; null (Unassigned) doc → default, chunk → file-hash
  // folder:         folderColorMap by top-level dir;  none: file-hash for chunks, default for docs
  ```

  `BuildGraph3DOptions` gains `customClusterPalette: HarmonicPalette`.
- **`src/renderer/components/GraphView.svelte`** — `getNodeColor` delegates to `nodeColorForMode` (deleting the drifted duplicate — the actual bug), plus the topic-highlight dimming layer: when `highlightedTopicId != null` in custom-cluster mode, non-members (`!node.custom_cluster_ids?.includes(id)`) render the default color. `toGraphNode` and the delta-patched node path carry the three fields. `updateClusterSpheres` accepts `'custom-cluster'` (group by primary id, `customClusterPalette`, skip null — Unassigned gets no hull); the mode-switch subscription and tick/engine-stop/drag-end/feedData call sites use the two-mode check. Legend topic rows are clickable (highlight members, clear-filter chip, mirroring the folder-highlight pattern); a synthetic non-clickable **Unassigned** row shows the client-side count. Hover tooltip in custom-cluster mode lists each membership as `{topicName} · NN%` or `Unassigned`.
- **`src/renderer/components/GraphPreview.svelte`** — "Topics" section for the opened node: badge per membership with score percentage.
- **`src/renderer/stores/graph.ts`** — ad-hoc node literals gain `custom_cluster_id: null` (fixes latent type errors); `cycleColoringMode`'s `hasCustomClusters` check keeps working (serde still omits the empty array).

### Settings (`src/renderer/components/Settings.svelte`, `CustomClusterModal.svelte`)

- Section renamed **Topics**; the dotenv staging path (`MDVDB_CUSTOM_CLUSTERS` `$effect` + stage handlers) is deleted in favor of `topics.ts` store calls keyed on the target collection.
- Topic cards: name, threshold chip, description (2-line clamp), seeds, `N docs · avg NN%` from summaries.
- Rows/controls beneath the list: Unassigned count; **Similarity Floor** slider → `setConfigValue('clustering.topics.min_similarity')`; **Clustering Algorithm** select (leiden default / kmeans) → `setConfigValue('clustering.algorithm')`; the existing granularity slider migrated to `setConfigValue('clustering.granularity')` (same dead-dotenv bug, same section).
- Banners (reuse `.field-notice`): *legacy import* (shown when the dotenv key holds a value and CLI defs are empty → `migrateLegacyDotenvTopics`) and *re-ingest needed* (shown while `topicsNeedIngest`, with a `Re-ingest now` button calling `runIngest()` when the target is the active collection).
- Modal (filename kept, retitled "Topic"): description textarea ("Optional — a sentence describing this topic improves matching accuracy"), threshold checkbox + 0.05–0.95 slider (unchecked → `null`), validation = name required / no `:` `|` / no duplicates / seeds-or-description required / threshold bounds; emits a `TopicDef`.

Deliberate UX divergence: topic edits apply **immediately** (the CLI writes `config.yaml` on the spot) rather than through the staged draft/save system — matching CLI behavior; the re-ingest banner covers the "when does it take effect" question.

## Implementation Steps

1. **Type mirror** — `src/renderer/types/cli.ts`: `TopicDef` (+alias), `CustomClusterSummary`/`GraphNode`/`GraphCluster`/`ClusterSummary` additions, `TopicUnassigned`.
2. **IPC + preload** — `src/main/ipc-handlers.ts`: five new handlers per the table (arg construction incl. clearing forms; no duplicate `--json`); `src/preload/index.ts` + `api.d.ts`: the five new API methods.
3. **Bridge + GraphView** — `graph-3d-bridge.ts`: `Graph3DNode` fields, `buildGraph3DData` carry-through with defaults, export `nodeColorForMode`, `customClusterPalette` option. `GraphView.svelte`: delegate `getNodeColor`, topic highlight state + legend click + clear chip, `toGraphNode`/delta carry-through, `updateClusterSpheres` two-mode support, tooltip topic lines, Unassigned legend row. `GraphPreview.svelte`: Topics section. `stores/graph.ts`: node-literal field.
4. **Topics store + Settings + modal** — new `stores/topics.ts`; `Settings.svelte` rework (delete dotenv path, Topics section, sliders/select via `config set`, banners); `CustomClusterModal.svelte` description + threshold; `lib/custom-clusters.ts` reduced to the legacy parser.
5. **Tests** — see Validation Criteria; update the IPC channel-registration count for the five new channels.
6. **Integration harness fix** — `tests/integration/cli-bridge.test.ts`: resolve the binary **synchronously at module load** (`execFileSync which`) — the `describe.skipIf` conditions evaluate at collection time, so the previous async `beforeAll` left the real-binary suite permanently skipped; add the topics round-trip suite (add with description/threshold → list → ingest with mock provider → `--custom` + `unassigned` → update/rename/clear → remove → `config set`).

## Validation Criteria

- [ ] `tests/unit/graph-3d-bridge.test.ts`: `buildGraph3DData` carries id/ids/scores and defaults them for old binaries; ids/scores stay parallel; `nodeColorForMode` custom-cluster mode returns `paletteColor(customPalette, primaryId)`, Unassigned doc → default color, unassigned chunk → file-hash, cluster mode unaffected by topic membership.
- [ ] `tests/unit/ipc-handlers.test.ts`: all five channels registered (count assertion updated); exact CLI args for add (with/without optionals), update (clearing forms `--description ""` / `--threshold=-1`, rename iff changed), remove, unassigned, config-set; no `--json` in constructed args.
- [ ] `tests/unit/topics-store.test.ts` (new): `loadTopics` loads all three and tolerates independent sub-load failures; mutations write via CLI, reload, and flag `topicsNeedIngest`; failed mutations propagate without flagging; legacy migration adds each def, skips rejects, deletes the dotenv key, syncs `collectionConfig`, and only flags re-ingest when something imported; `resetTopicsState` clears everything.
- [ ] `tests/unit/CustomClusterModal.test.ts` (new): renders description/threshold controls; emits `TopicDef` with `threshold: null` when unchecked and the numeric value when set; rejects empty definitions, `:`/`|` names, duplicates; prefills on edit.
- [ ] `tests/integration/cli-bridge.test.ts`: full topics round-trip green against a real `mdvdb` binary; the no-binary guard suite still passes when the binary is absent.
- [ ] Full unit suite: **zero new failures** vs the pre-existing baseline (compare per-file failure counts against a HEAD worktree, not just totals).
- [ ] `tsc --noEmit` (web + node): zero new errors vs a HEAD-worktree baseline (this phase should *reduce* the count — the missing `custom_cluster_id` node literals were pre-existing errors).
- [ ] Manual: custom-cluster mode node colors match the legend swatches; legend topic click dims non-members; Settings topic add writes `config.yaml` (not `.markdownvdb/.config`) and raises the re-ingest banner; floor slider round-trips through `mdvdb config` output.

## Anti-Patterns to Avoid

- **Never write topic (or any new) config through the dotenv `.config` path** — the CLI ignores it once `config.yaml` exists; this exact silent failure is what this phase removes. All config writes go through CLI commands.
- **Never keep two node-color implementations.** `GraphView.getNodeColor` drifting from the bridge's builder-time color is the root cause of the coloring bug; anything color-related belongs in `nodeColorForMode`.
- **Do not append `--json` in handlers** — `execCommand` injects it globally; a duplicate happens to work today but encodes a wrong mental model of the bridge.
- **Do not assume cluster ids are contiguous or reusable** — Phase 30 makes them stable-but-opaque; index-based palette math must go through the id, never through array position.
- **Do not route topic edits through the draft/save staging system** — the CLI applies them immediately; staging would show state the config no longer has.
- **Do not make new type-mirror fields required** — old binaries must keep parsing (version-skew tolerance is the compatibility strategy, since app and CLI ship together but aren't lock-stepped on disk).
- **Do not evaluate async state in `describe.skipIf`** — vitest resolves skip conditions at collection time; the always-skipped integration suite hid a latent test failure for months.
- **Do not try to fix the known pre-existing test failures in this phase** — compare against a baseline snapshot instead, so regressions are distinguishable from inherited noise.

## Patterns to Follow

- **IPC handler shape** — `ipcMain.handle('cli:x', (_e, root, …) => wrapHandler(() => execCommand<T>('cmd', args, root)))` exactly as the existing `cli:clusters` block in `src/main/ipc-handlers.ts`; typed error serialization comes free from `wrapHandler`.
- **Store + actions module** — `stores/topics.ts` mirrors `stores/settings.ts`/`stores/collections.ts`: writable stores, exported async actions that call `window.api.*` and mutate stores, a reset function for collection switches.
- **Component conventions** — Svelte 5 runes (`$state`, `$derived`, `$props` with `interface Props`), scoped styles with `tokens.css` custom properties, Material Symbols icons, `.field-notice`/`.field-hint` classes for banners and help text (see `Settings.svelte`).
- **Unit-test mocking** — `Object.defineProperty(globalThis, 'window', { value: { api: mockApi } })` before importing stores (see `tests/unit/settings-store.test.ts`); electron/module mocks per `tests/unit/ipc-handlers.test.ts`; `@testing-library/svelte` render pattern per `tests/unit/Badge.test.ts`.
- **Legend interaction** — the topic-highlight click follows the existing folder-highlight pattern (`legend-item-clickable`, active class, clear-filter chip) in `GraphView.svelte`.
