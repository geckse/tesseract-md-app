# Phase 48: Shard-Native Graph Analysis

## Summary

When a Shard is active, Tesseract renders graph communities and Topics computed for that Shard
rather than projecting Collection-wide assignments. The graph still reads the shared Collection
index: only disposable analysis state and local Topic definitions are Shard-owned.

## Graph request context

Every graph request carries:

- Collection root.
- Active Shard ID, when present.
- Graph level.
- Effective optional descendant path.

The graph snapshot cache uses all four values as identity. Its source revision covers the
Collection index and project `.markdownvdb/config.yaml`; timestamps below
`.markdownvdb/cache/shards/` are deliberately excluded so a derived-cache write does not
immediately invalidate its own response.

Changing the Collection-or-Shard analysis context is a replacement load, not a background patch:
the previous graph is cleared before the request begins. A Shard response is accepted only when
its analysis metadata reports `context: shard` and the requested Shard ID. Missing or mismatched
provenance is shown as an error rather than allowing Collection data to be labeled as a Shard.

The active Shard is the outer analysis boundary. A descendant folder filter changes visible
topology without changing local cluster or Topic identities. An ancestor filter clamps to the
Shard, a disjoint filter shows an empty state, and clearing a filter returns to the Shard.

## Graph presentation

- Legends are titled `<Name> Shard Clusters` and `<Name> Shard Topics`.
- Counts and memberships come only from the returned local analysis.
- Chunk legends count unique parent documents rather than chunk nodes.
- Analysis-context changes clear cluster and Topic highlights, edge filters, selections, and other
  state that could incorrectly reuse numeric IDs across Shards.
- A `needs_ingest` Topic status shows a non-blocking “Shard Topics need re-ingest” notice and a
  Re-ingest action.
- `none` is presented separately as “No Topics configured.”
- Graph overlay search uses the effective descendant graph boundary, not only the outer Shard.
- Detached graph tabs and graph popouts preserve Shard ID and descendant path.

Missing Shards keep their Topic configuration available for repair, but computed graph and cluster
results are disabled until the folder exists.

## Scoped Topic settings

Settings → Topics provides an analysis-scope selector containing the Collection root and its
inferred Shard tree. It defaults to the active Shard when Settings opens for that Collection.

Topic definitions, computed summaries, unassigned documents, loading, errors, and re-ingest state
are keyed by `(collection, shard-or-root)` and protected by generation guards. Editing a Shard
scope calls the Shard-aware CLI and never modifies Collection, parent-Shard, or sibling Topic
definitions.

The similarity floor and automatic-clustering controls remain Collection-wide and are labelled as
such. Obsidian Topic import continues to target the Collection root.

“Manage Topics…” is available from Shard and graph context actions. Removing a Shard confirms that
its Topic definitions are also removed while its files, folder, shared index, links, and embeddings
remain untouched.

## IPC and invalidation

Preload and IPC Topic methods accept an optional Shard ID while preserving existing Collection
calls. Graph payload types accept optional analysis metadata without changing compact wire
version 1. Project-config invalidation refreshes scoped Topic state and graph source revisions.
All asynchronous scoped stores reject stale responses after Collection or Shard changes.

## Compatibility

No app, CLI, compact-wire, or index-version bump. Existing Collection graph and Topic behavior is
unchanged when no Shard ID is present.

## Acceptance criteria

- Shard ID and descendant filter reach standard and compact graph requests and participate in
  snapshot identity.
- A failed or mismatched Shard context change cannot retain or relabel the previous Collection
  graph.
- Switching between Shards cannot leak highlights, edge filters, selections, labels, or numeric
  IDs.
- Local legends and status notices accurately distinguish ready, empty, too-small, needs-ingest,
  missing, and error states.
- Overlay search, graph popouts, and detached tabs preserve the exact effective graph context.
- Settings edits and unassigned results remain independent for Collection and every nested Shard.
- External project-config edits invalidate the correct scoped state without response races.
- Removing a Shard clearly explains Topic removal and never deletes content.
- Typecheck, lint, unit/integration tests, E2E coverage, and the production build pass.
