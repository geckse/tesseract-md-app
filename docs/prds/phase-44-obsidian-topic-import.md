# PRD: Phase 44 — Obsidian Vault Topic Auto-Import & Sync

## Overview

When a collection folder is an Obsidian vault — detected by the presence of a `.obsidian/` directory — Tesseract derives topic (custom cluster) definitions from the organization the user already built in Obsidian and **keeps them in sync**: the first scan imports, later scans add newly qualifying tags, update stale seeds, and remove topics whose tags disappeared. The cardinal rule: **sync only ever touches topics it created and that are still byte-identical to what it last wrote** — anything the user edits or deletes is theirs forever. The mdvdb CLI needs zero changes.

## Problem Statement

- Topics (phase 40) are powerful but start empty; every new collection requires manual topic curation in Settings.
- Obsidian users have usually already expressed their vault's thematic structure — through frontmatter/inline tags and graph-view color groups — and that structure keeps evolving while they work in Obsidian.
- A one-time import goes stale; a naive re-import would clobber user curation. Sync needs ownership semantics.

## What gets derived

Two sources, ranked and capped at **12 topics** total:

1. **Graph color groups** (`.obsidian/graph.json` → `colorGroups[].query`) — explicit, user-defined groupings; always ranked first, in graph.json order:
   - `tag:#x` / `tag:x` → pins tag `x` as a topic even below the note-count floor.
   - Plain-text query (no `:`) → its own topic, seeded with the query text.
   - `path:` / `file:` / boolean queries → skipped (no topic equivalent).
2. **Tags** — frontmatter `tags`/`tag`/`Tags` keys (flow array, block list, comma- or space-separated string) plus inline `#tag` occurrences (fenced blocks/inline code stripped; must follow whitespace or line start so link anchors and URL fragments don't match). A tag must appear in **≥ 2 notes**; casing variants merge (first-seen casing wins); ranked by note count.

Each tag topic is seeded with up to **5 note titles** (first `# ` heading, else file name) of tagged notes — seeds are embedded text phrases in mdvdb's centroid formula, so real titles anchor the topic near its actual documents. Seeds are sanitized (`,` and `|` stripped — the CLI comma-joins `--seeds` and rejects pipes). Obsidian tag validity is enforced (letters/digits/`_`/`-`/`/`, at least one non-numeric character; ≤ 60 chars). Nested tags (`project/acme`) import verbatim — mdvdb topic names only forbid `:` and `|`.

## Ownership model (provenance)

Persisted per collection in electron-store: `obsidianTopicSync: Record<collectionId, ObsidianSyncState>` where `ObsidianSyncState = { managed: boolean; topics: Record<name, hash | 'deleted'> }`. The hash is SHA-256 of `[name, seeds]` as last written by sync.

| Situation on sync                                      | Action                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Candidate tag, no topic, no provenance                 | `clusters add`, record hash                                                                                 |
| Managed topic, hash matches, seeds stale               | `clusters update --seeds`, advance hash (user's description/threshold untouched — only `--seeds` is passed) |
| Managed topic, hash matches, tag gone                  | `clusters remove`, drop entry                                                                               |
| Managed topic, hash **mismatch** (user edited)         | Released forever — provenance dropped, never touched again                                                  |
| Managed topic missing from CLI (user deleted)          | `'deleted'` tombstone — never re-added                                                                      |
| Candidate collides with an unmanaged (user) topic name | Skipped, never managed                                                                                      |
| Vault already had topics at FIRST scan                 | `managed: false` — the whole collection is never synced                                                     |
| CLI write fails                                        | Logged; provenance not advanced → retried next sync                                                         |

Frontmatter stays read-only; the only write path is the CLI into `.markdownvdb/config.yaml`.

## Triggers

All fire-and-forget (`maybeSyncObsidianTopics`), guarded by an in-flight set:

1. **App startup** (`src/main/index.ts`) — catches tag/graph changes made while Tesseract was closed.
2. **`collections:add` / `collections:set-active`** (`src/main/ipc-handlers.ts`).
3. **Vault watcher batches** — the Tier-1 `onBatch` forwarder schedules a **30s-debounced** sync when a batch contains markdown events (own writes are already filtered from batches, so these are external edits — i.e. Obsidian).
4. **`.obsidian/` config watcher** — a dedicated `fs.watch` (the vault watcher deliberately skips `.obsidian/`), so graph.json color-group edits also schedule a sync. Retargeted on collection switch, closed on quit.

## Flow

```
trigger → maybeSyncObsidianTopics(collection, windowManager)
  guards: in-flight · isObsidianVault · state.managed !== false
  first encounter: clusters list non-empty → managed:false, stop
  → syncObsidianTopics(root, state)            [src/main/obsidian-import.ts]
      scan → diff vs provenance → clusters add/update/remove
  → setObsidianSyncState(collectionId, nextState)
  → if anything changed: broadcastToAll('topics:obsidian-synced',
      {collectionId, root, added, updated, removed})
  → preload onObsidianTopicsSynced → stores/obsidian-import.ts
      sets the notice; for the active collection flags topicsNeedIngest
      and reloads topic state
  → <ObsidianImportNotification />             [App.svelte, next to UpdateNotification]
      first import: "Imported N topics from your Obsidian vault: …"
      later syncs:  "Obsidian topics synced (2 added · 1 updated · 1 removed): …"
      + Sync now (active collection only: runIngest, clears topicsNeedIngest) + dismiss
```

## Files

- `src/main/obsidian-import.ts` — detection, tag/graph extraction, scan, hash, sync diff engine, orchestrator, debounced scheduler, `.obsidian/` config watcher.
- `src/main/store.ts` — `ObsidianSyncState` + `obsidianTopicSync` schema + get/set helpers.
- `src/main/ipc-handlers.ts` — add/set-active hooks, watcher-batch scheduling, sync-state cleanup on remove.
- `src/main/index.ts` — startup sync + config watcher lifecycle.
- `src/preload/index.ts` + `api.d.ts` — `onObsidianTopicsSynced` / `removeObsidianTopicsSyncedListener` + `ObsidianTopicsSyncedEvent`.
- `src/renderer/stores/obsidian-import.ts` — notice store + broadcast handler.
- `src/renderer/components/ObsidianImportNotification.svelte` — banner (status role, reduced-motion safe).
- `src/renderer/App.svelte` — listener setup/teardown + banner render.

## Testing

- `tests/unit/obsidian-import.test.ts` — 36 tests: tag normalization (Obsidian rules), frontmatter forms, inline-tag false-positive guards, scan against real temp vaults (thresholds, casing merge, graph groups, skip dirs, caps, seed sanitation), and the full sync matrix against a **stateful CLI mock** (import, no-op, add-later, update, remove, user-edit release, user-delete tombstone, name collision, write-failure retry), orchestrator guards, debounce coalescing.
- `tests/unit/store.test.ts` — sync-state helper coverage.
- `tests/unit/ipc-handlers.test.ts` — sync kicked off on add/activate (+ config-watcher retarget), skipped on cancel/no-active.
- `tests/unit/obsidian-import-store.test.ts` + `tests/unit/ObsidianImportNotification.test.ts` — renderer store + banner behavior (import vs sync phrasing, truncation, sync flow, error keeps notice).
- `tests/integration/obsidian-import.test.ts` — real mdvdb binary + real temp vault: import → vault edits → add/update/remove propagated to `config.yaml`; user-edited/deleted topics untouched; pre-existing-topics vaults never managed. Skipped when mdvdb is not on PATH.

## Non-goals / future work

- No import of Obsidian bookmarks, starred files, or community-plugin data.
- No nested-tag roll-up (`project/acme` does not also credit `project`).
- No way (yet) to re-adopt a released or tombstoned topic, or to opt an unmanaged collection into sync — a Settings affordance could clear the collection's sync state.
- No e2e coverage of the add-collection path — the native folder picker cannot be driven by Playwright (same limitation as onboarding e2e).
