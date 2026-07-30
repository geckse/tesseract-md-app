# Phase 47: Named Shards

## Overview

A **Shard** is a named, recursive folder lens inside one collection. It is not
an index partition, nested collection, or access boundary. The collection keeps
one root, configuration, watcher, link graph, index, and collection-root-relative
document identity.

Definitions are project-local and CLI-owned in `.markdownvdb/config.yaml`. The
app reads and mutates them exclusively through `mdvdb shards`; it never mirrors
definitions into `electron-store`. Only the last selected Shard ID is persisted
per collection.

## State and synchronization

`stores/shards.ts` caches definitions, loading state, and errors by collection.
`activeShardId`, `activeShard`, and `activeScopePath` describe the active
working lens. Per-collection generation counters make refreshes
last-request-wins.

Definitions refresh when a collection loads, the switcher opens, a window gains
focus, a CRUD operation completes, or the main process broadcasts
`shards:invalidated`. `src/main/shard-watcher.ts` uses one debounced watcher for
registered collections' `.markdownvdb/config.yaml` files, so agent and CLI edits
appear in open app windows.

On startup, the app restores the last selected ID only if its definition and
folder still exist. Otherwise it returns to the collection root and clears the
stale persisted selection.

## Collection switcher

The collection switcher is an ARIA tree. Collection roots and Shards are
selectable rows, and Shards nest beneath their CLI-derived `parent_id`.
Arrow keys move, expand, and collapse; Enter or Space selects. Selecting a
collection clears its Shard, while selecting a Shard changes only the working
context: open tabs, editor state, watcher state, and index state remain intact.

Missing definitions remain visible with a warning and management actions.
Closed labels and the header use `Collection › Shard`; in-scope document paths
are displayed relative to the Shard, and an open document outside it is marked
`Outside Shard`.

## Creation and management

`ShardModal.svelte` supports existing folders and optional creation of a typed
missing folder. IDs are generated once from the name as normalized kebab-case;
collisions use `-2`, `-3`, and so on. Editing changes only name and path.

Collection and folder context menus expose creation. Shard context menus expose
Edit, Information, Show in Graph, Reveal, Copy Path, Open Terminal, Open in New
Window, and Remove. Removal deletes only the definition and explicitly states
that files and folders are untouched.

IPC and preload expose list/get/add/update/remove/retarget plus persisted active
ID methods. All Shard CRUD travels through CLI JSON contracts.

## Scope behavior

The full Markdown and asset catalogs remain loaded. `fullUnifiedTree` and
`flatFileList` stay collection-wide for links, backlinks, autocomplete,
favorites, and explicit navigation. The visible `unifiedTree`, visible counts,
normal search, Quick Open, global graph, Information, schema, table root, and
new-file defaults derive from `activeScopePath`.

Scope comparisons are slash-normalized and segment-safe: `docs` includes
`docs/note.md` but not `docs-old/note.md`.

Opening a link, favorite, or existing tab outside the Shard does not deactivate
the Shard. Search graph expansion may likewise show linked context outside the
boundary; clients label it `Outside Shard`.

“Open Shard as Table” is explicit and recursive. Selecting a Shard never opens a
table automatically.

## Graph boundary

The active Shard is a non-removable graph boundary:

- No ad-hoc filter requests the Shard path.
- A descendant filter narrows the Shard.
- An ancestor filter resolves back to the Shard boundary.
- A disjoint filter yields an empty graph.
- Clearing an ad-hoc filter returns to the Shard.

The graph UI renders the Shard as its own boundary chip and a descendant filter
as a separate removable chip.

## Folder lifecycle

Ordinary file moves change membership through path alone. In-app directory
renames call `mdvdb shards retarget` when the renamed prefix contains a Shard;
if manifest retargeting fails, the filesystem rename is rolled back. External
renames cannot be paired reliably, so their definitions remain missing until
edited or repaired with `shards retarget`.

Deleting a Shard folder never deletes its definition. If the deleted folder was
active, the window returns to the collection root.

## Compatibility

Phase 47 makes no app, CLI, wire-format, compact-wire, or index-version bump.
Shards reuse existing path-scoped CLI APIs and index metadata.

## Acceptance criteria

- IPC tests cover channel registration, exact CLI arguments, errors, and active
  ID persistence.
- Store tests cover hierarchy, segment boundaries, ID generation, generation
  guards, restoration/fallback, graph intersection, and CRUD refresh.
- File-tree tests prove the visible Shard lens and counts are scoped while the
  full flat catalog remains available.
- Component tests cover the accessible hierarchy, missing state, management,
  and recursive “Open Shard as Table”.
- Typecheck, lint, unit/integration tests, E2E tests, and production build pass.
