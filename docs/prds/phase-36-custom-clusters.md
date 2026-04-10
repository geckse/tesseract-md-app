# PRD: Phase 36 — App UI for Custom Clusters

## Overview

Add a UI in the Electron/Svelte app for creating, editing, and removing user-defined custom clusters. Users manage cluster definitions (name + seed phrases) through the Settings panel. The graph visualization gains a new "custom cluster" coloring mode to display assignments. Depends on Phase 27 (CLI `clusters add/remove/list` commands and `--custom` JSON output).

## Problem Statement

Phase 27 adds custom cluster support to the CLI, but managing clusters requires manual config editing or terminal commands. The app currently shows auto-clusters in the graph but has no UI for defining or viewing custom clusters. Users need an intuitive visual interface to:

1. Define their own semantic categories with seed words
2. See how their documents distribute across those categories in the 3D graph
3. Iterate on cluster definitions (add/remove seeds, rename, delete clusters)

## Goals

- Settings panel section for managing custom cluster definitions per collection
- Add/edit/remove clusters with name and comma-separated seed phrases
- Immediate visual feedback: cluster list with document counts after ingest
- New graph coloring mode: "custom cluster" alongside existing cluster/folder/none
- Custom clusters shown in graph legend/sidebar with names and colors
- Re-ingest prompt when cluster definitions change (seeds need embedding)
- Works with existing draft-save pattern (stage changes → save → write to `.markdownvdb/.config`)

## Non-Goals

- Drag-and-drop document assignment (assignments are automatic by cosine similarity)
- Real-time re-clustering without ingest (embedding requires the CLI pipeline)
- Custom cluster management at user level (only per-collection — clusters are project-specific)
- Editing computed state (centroids, members) directly — only definitions are editable
- Custom color assignment per cluster (harmonic palette auto-assigns colors)

## Technical Design

### Settings Panel: Custom Clusters Section

Add a new section to the Settings component, visible only when a collection is the active target (custom clusters are per-collection).

**Section Header:** "Custom Clusters" with `category` material icon.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  Custom Clusters                                    [+] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ AI Research ──────────────────────── [edit] [x] ─┐  │
│  │  Seeds: machine learning, neural networks,        │  │
│  │         deep learning                             │  │
│  │  Documents: 18                                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Web Dev ─────────────────────────── [edit] [x] ─┐  │
│  │  Seeds: html, css, javascript, react              │  │
│  │  Documents: 15                                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ DevOps ──────────────────────────── [edit] [x] ─┐  │
│  │  Seeds: docker, kubernetes, CI/CD                 │  │
│  │  Documents: 14                                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ⓘ Changes require re-ingest to take effect.           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Add Cluster Modal:**

```
┌──────────────────────────────────────────┐
│  ✦  Add Custom Cluster            [x]   │
├──────────────────────────────────────────┤
│                                          │
│  Name                                    │
│  ┌────────────────────────────────────┐  │
│  │ AI Research                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Seed phrases (comma-separated)          │
│  ┌────────────────────────────────────┐  │
│  │ machine learning, neural networks, │  │
│  │ deep learning, transformers        │  │
│  └────────────────────────────────────┘  │
│  ⓘ Describe what this cluster is about. │
│    Documents will be assigned by         │
│    semantic similarity to these phrases. │
│                                          │
├──────────────────────────────────────────┤
│              [Cancel]  [Add Cluster]     │
└──────────────────────────────────────────┘
```

**Edit uses the same modal** with pre-filled values and "Save Changes" button.

### Data Flow

**Adding a cluster:**
```
User fills modal → validate (name non-empty, no :/| in name, seeds non-empty, no dup names)
  → stage change in settings draft
  → on "Save Settings": write MDVDB_CUSTOM_CLUSTERS to .markdownvdb/.config via IPC
  → show "Re-ingest required" banner
  → user triggers ingest → CLI embeds seeds + assigns docs
  → reload custom cluster data → update graph
```

**Config write strategy:**

Custom clusters use a single env var `MDVDB_CUSTOM_CLUSTERS`. Unlike other settings where each key maps to one value, here the entire cluster list is one value. The settings store must:

1. Parse the current `MDVDB_CUSTOM_CLUSTERS` value into a `CustomClusterDef[]` array
2. Allow add/edit/remove operations on that array
3. Re-encode to the pipe-delimited format on save
4. Write the single key via `setCollectionConfig(root, 'MDVDB_CUSTOM_CLUSTERS', encoded)`

### IPC Additions

**New handler in `ipc-handlers.ts`:**

```typescript
ipcMain.handle('cli:custom-clusters', (_event, root: string) =>
  wrapHandler(() => execCommand<CustomClusterSummary[]>('clusters', ['--custom'], root))
)
```

**New handler for cluster definitions (parsed from config):**

```typescript
ipcMain.handle('cli:clusters-list', (_event, root: string) =>
  wrapHandler(() => execCommand<CustomClusterDef[]>('clusters', ['list', '--json'], root))
)
```

No new write handlers needed — cluster definitions are written via the existing `settings:set-collection-config` handler (writing `MDVDB_CUSTOM_CLUSTERS` key).

### Preload API Additions

```typescript
customClusters: (root: string) => invoke<CustomClusterSummary[]>('cli:custom-clusters'),
clusterDefinitions: (root: string) => invoke<CustomClusterDef[]>('cli:clusters-list'),
```

### TypeScript Type Additions

In `app/src/renderer/types/cli.ts`:

```typescript
/** User-defined cluster definition (from config, not computed). */
export interface CustomClusterDef {
  name: string
  seeds: string[]
}

/** Computed custom cluster summary (from index after ingest). */
export interface CustomClusterSummary {
  id: number
  name: string
  seed_phrases: string[]
  document_count: number
}
```

Update existing `GraphNode`:
```typescript
export interface GraphNode {
  // ...existing fields...
  custom_cluster_id: number | null  // NEW
}
```

Update existing `GraphData`:
```typescript
export interface GraphData {
  // ...existing fields...
  custom_clusters: GraphCluster[]  // NEW
}
```

### Graph Coloring Mode Extension

**Expand `GraphColoringMode`:**

```typescript
export type GraphColoringMode = 'cluster' | 'custom-cluster' | 'folder' | 'none'
```

**Cycle order:** cluster → custom-cluster → folder → none → cluster

**Custom cluster coloring in `graph-3d-bridge.ts`:**

```typescript
case 'custom-cluster':
  if (node.custom_cluster_id != null) {
    return paletteColor(customClusterPalette, node.custom_cluster_id)
  }
  return defaultColor
```

**Custom cluster palette:** Uses same harmonic palette generation but with a separate `customClusterPalette` store (distinct color set from auto-clusters to avoid confusion when switching modes).

### Graph Legend / Sidebar

When coloring mode is `'custom-cluster'`, the graph legend panel shows:

```
Custom Clusters
──────────────────
● AI Research (18)
● Web Dev (15)
● DevOps (14)
```

Each entry shows the cluster name (user-defined) and document count. Color dot matches the harmonic palette color for that cluster ID.

### Re-Ingest Banner

When custom cluster definitions are saved (dirty state cleared), show a non-blocking banner at the top of the graph or file tree:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⓘ  Cluster definitions changed. Re-ingest to update assignments. │
│                                                [Ingest Now]      │
└──────────────────────────────────────────────────────────────────┘
```

The "Ingest Now" button opens the existing IngestModal with full ingest pre-selected (incremental won't recompute seed centroids).

### Settings Store Changes

**New derived state in settings store:**

```typescript
// Parsed from MDVDB_CUSTOM_CLUSTERS config value
export function parseCustomClusters(raw: string): CustomClusterDef[] {
  if (!raw) return []
  return raw.split('|').map(entry => {
    const [name, seedsStr] = entry.split(':')
    return { name: name.trim(), seeds: seedsStr.split(',').map(s => s.trim()) }
  }).filter(c => c.name && c.seeds.length > 0)
}

export function encodeCustomClusters(defs: CustomClusterDef[]): string {
  return defs.map(d => `${d.name}:${d.seeds.join(',')}`).join('|')
}
```

These are used by the Settings panel to read/write the cluster list within the existing draft-save pattern.

### GraphView Button Tooltip Update

The coloring mode cycle button tooltip updates:

| Current Mode | Tooltip |
|---|---|
| `cluster` | "Color by custom clusters" |
| `custom-cluster` | "Color by folders" |
| `folder` | "No coloring" |
| `none` | "Color by clusters" |

If no custom clusters are defined, skip `custom-cluster` in the cycle.

### Workspace Tab State

`GraphTab.graphColoringMode` type widens to include `'custom-cluster'`. Default remains `'cluster'`.

## Implementation Steps

1. **TypeScript types** — `app/src/renderer/types/cli.ts`: Add `CustomClusterDef`, `CustomClusterSummary`. Add `custom_cluster_id` to `GraphNode`. Add `custom_clusters` to `GraphData`.

2. **IPC handlers** — `app/src/main/ipc-handlers.ts`: Add `cli:custom-clusters` and `cli:clusters-list` handlers.

3. **Preload API** — `app/src/preload/index.ts`: Expose `customClusters()` and `clusterDefinitions()` methods.

4. **Settings store helpers** — Add `parseCustomClusters()` and `encodeCustomClusters()` utility functions (in a new `app/src/renderer/lib/custom-clusters.ts` or in settings store).

5. **Settings UI section** — `app/src/renderer/components/Settings.svelte`: Add "Custom Clusters" section with cluster list, add/edit/remove buttons. Only visible when collection target is active.

6. **Add/Edit Cluster Modal** — New component `app/src/renderer/components/CustomClusterModal.svelte`: Name input, seeds textarea, validation, add/save/cancel actions.

7. **Graph coloring mode** — `app/src/renderer/stores/graph.ts`: Expand `GraphColoringMode` type to include `'custom-cluster'`. Update `cycleColoringMode()` to include new mode (skip if no custom clusters). Update workspace tab type.

8. **Graph coloring logic** — `app/src/renderer/lib/graph-3d-bridge.ts`: Add `'custom-cluster'` case to `nodeColor()`. Use separate palette store for custom cluster colors.

9. **Custom cluster palette** — `app/src/renderer/stores/palette.ts`: Add `customClusterPalette` derived from `graphData.custom_clusters.length`.

10. **Graph legend** — Update legend/sidebar in `GraphView.svelte` to show custom cluster names + counts when in `'custom-cluster'` mode.

11. **Re-ingest banner** — Add a conditional banner component that appears when cluster definitions have been saved but ingest hasn't run. Track via comparing config defs vs. index state.

12. **Graph data loading** — `app/src/renderer/stores/graph.ts`: Ensure `loadGraphData()` passes through `custom_cluster_id` and `custom_clusters` from CLI response.

## Files Modified

| File | Change |
|---|---|
| `app/src/renderer/types/cli.ts` | `CustomClusterDef`, `CustomClusterSummary`, `GraphNode.custom_cluster_id`, `GraphData.custom_clusters` |
| `app/src/main/ipc-handlers.ts` | `cli:custom-clusters`, `cli:clusters-list` handlers |
| `app/src/preload/index.ts` | `customClusters()`, `clusterDefinitions()` API methods |
| `app/src/renderer/components/Settings.svelte` | Custom Clusters section with list + add/edit/remove |
| `app/src/renderer/components/CustomClusterModal.svelte` | New modal for add/edit cluster |
| `app/src/renderer/stores/graph.ts` | `GraphColoringMode` expansion, `cycleColoringMode()` update |
| `app/src/renderer/lib/graph-3d-bridge.ts` | `nodeColor()` custom-cluster case |
| `app/src/renderer/stores/palette.ts` | `customClusterPalette` store |
| `app/src/renderer/lib/custom-clusters.ts` | `parseCustomClusters()`, `encodeCustomClusters()` |
| `app/src/renderer/stores/workspace.svelte.ts` | `GraphTab.graphColoringMode` type update |
| `app/src/renderer/components/GraphView.svelte` | Legend for custom clusters, coloring button tooltip |
| `app/src/preload/api.d.ts` | Type declarations for new API methods |

## Validation Criteria

- [ ] Settings panel shows "Custom Clusters" section when a collection is targeted
- [ ] "Add Cluster" button opens modal with name + seeds inputs
- [ ] Validation: empty name rejected, `:` or `|` in name rejected, empty seeds rejected
- [ ] Validation: duplicate cluster name rejected with clear message
- [ ] Saving writes correct `MDVDB_CUSTOM_CLUSTERS=Name:seed1,seed2|Name2:seed3` to `.markdownvdb/.config`
- [ ] Edit pre-fills modal with existing name and seeds
- [ ] Remove deletes cluster from list and updates encoded config value
- [ ] After save, re-ingest banner appears prompting user to ingest
- [ ] After ingest, document counts appear next to each cluster name
- [ ] Graph coloring mode cycles through: cluster → custom-cluster → folder → none
- [ ] Custom cluster mode skipped in cycle if no custom clusters defined
- [ ] In custom-cluster coloring mode, nodes colored by `custom_cluster_id`
- [ ] Legend shows custom cluster names with colored dots and doc counts
- [ ] Existing auto-cluster coloring unchanged
- [ ] Settings section hidden when no collection is selected (global settings view)
- [ ] Draft-save pattern respected: changes staged until explicit save

## Anti-Patterns to Avoid

- **Do not call CLI `clusters add/remove` from the app** — Use the existing `settings:set-collection-config` IPC path to write `MDVDB_CUSTOM_CLUSTERS` directly. The CLI commands are for terminal users. The app manages the full encoded value atomically.

- **Do not embed seeds from the app** — Embedding happens during CLI ingest only. The app never calls embedding APIs directly.

- **Do not show computed state (centroids, member lists) in settings** — Settings shows definitions only. Graph shows assignments visually. Keep settings focused on what the user controls.

- **Do not auto-ingest after cluster definition changes** — Ingest can be slow. Show a banner and let the user choose when to run it. Never silently trigger a long operation.

- **Do not share palette with auto-clusters** — Use a separate harmonic palette seed for custom clusters so colors are distinct from auto-cluster colors and don't shift when switching modes.

## Patterns to Follow

- **Settings section structure:** Follow existing sections in `Settings.svelte` (icon tabs, `handleChange()` pattern, override badges)
- **Modal component:** Follow `IngestModal.svelte` pattern (backdrop, keyboard escape, header/body/footer, disabled states)
- **IPC handler:** Follow `cli:clusters` pattern in `ipc-handlers.ts` (wrapHandler + execCommand)
- **Config write:** Follow `settings:set-collection-config` pattern (writeConfigKey to .markdownvdb/.config)
- **Graph coloring:** Follow existing `'cluster'` case in `graph-3d-bridge.ts` nodeColor()
- **Palette store:** Follow `clusterPalette` in `stores/palette.ts`
- **Type definitions:** Follow existing interfaces in `types/cli.ts` (match Rust Serialize output)

## Dependencies

- **Phase 27 (CLI Custom Clusters)** must be implemented first:
  - `mdvdb clusters --custom --json` returns `CustomClusterSummary[]`
  - `mdvdb clusters list --json` returns `CustomClusterDef[]`
  - `GraphData` JSON includes `custom_cluster_id` on nodes and `custom_clusters` array
  - `MDVDB_CUSTOM_CLUSTERS` env var parsed by CLI during ingest
