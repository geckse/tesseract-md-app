# Phase 45: Collection Information Modal

## Overview

Surface the CLI phase-32 `mdvdb info [path]` contract in Tesseract. A collection context menu opens whole-vault information; a Markdown folder context menu opens the same modal scoped to that relative folder. The CLI PRD, `docs/prds/phase-32-vault-info-command.md` in the parent repository, is authoritative for field definitions and counting semantics.

## Goals

- Add an optional-folder `cli:info` bridge from main IPC through preload to renderer types.
- Add “Information” after “Run Doctor…” in the sidebar collection menu.
- Add “Information” to non-asset directory context menus in the file tree.
- Show content/index counts, sync state, full-reindex chunk/token/API-call estimates, index size and update time, and embedding provider/model/dimensions.
- Preserve compatibility with older CLIs: `IndexStatus.edge_count` is optional in TypeScript, and an unavailable `info` command produces a visible error with Retry and an update-CLI hint.

## Data flow

```text
Sidebar collection menu ─┐
                        ├─ openInfoModal(scope?)
File-tree folder menu ──┘       │
                                ▼
collections store → window.api.info(root, scope?) → cli:info → mdvdb info [scope] --json
                                │
                                ▼
                      CollectionInfoModal
```

`infoScope` is `null` for the whole vault and a slash-relative folder path for scoped requests. Switching or removing a collection clears the modal, scope, result, loading, and error state. Refresh and Retry repeat the request for the current active collection and scope.

## Presentation

The always-mounted, focus-trapped modal follows the Doctor modal shell. Escape, backdrop, and Close dismiss it. Initial requests show a reduced-motion-safe skeleton. Existing statistics remain visible but dimmed during a refresh.

The subtitle is the collection name for whole-vault information and the folder path for scoped information. Sections are:

- Contents: Markdown files, indexed files, chunks, vectors with semantic-edge count.
- Sync: new, changed, unchanged, and deleted badges.
- Full reindex estimate: chunks, locale-formatted tokens, and API calls.
- Index: human-readable byte size, localized last-updated time, provider, model, and dimensions.

## Acceptance criteria

- IPC tests cover handler registration and scoped/whole-vault arguments.
- Store tests cover opening, scope propagation, result storage, closing, and errors.
- Modal tests cover closed, loading, statistics, scope subtitle, error/retry, Escape, and Close states.
- File-tree coverage proves a Markdown directory opens scoped information.
- Typecheck and unit tests pass without introducing new lint failures.
