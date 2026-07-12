# PRD: Phase 43 — Native App Menu, Structure Tools, Doctor UI & Export

## Overview

Replace the near-empty native menu bar (File > Open Recent + OS roles) with a full application menu — File (new/open/save, Save a Copy…, Export ▸ HTML/PDF/Word (.docx)/OpenDocument (.odt)/EPUB/Plain Text/RTF), Edit, Format (markdown formatting + document-structure tools), View, Collection (switch/sync/reindex/watcher/doctor/settings deep links), Window, Help — plus the renderer surfaces it drives: a Doctor modal over the previously-unrendered `collectionDoctorResult`, an extended collection context menu, and inline Rename/Duplicate in the file tree. The mdvdb CLI needs zero changes.

## Problem Statement

- The menu bar exposed almost nothing; every action lived behind in-app UI or undiscoverable shortcuts.
- `mdvdb doctor` was fetched into a store on every collection switch and never rendered anywhere.
- No way to save a copy outside the collection or export to other formats.
- No document-structure tooling (TOC, heading normalization) in either editor.
- File tree lacked Rename and Duplicate despite `renameFile`/`copyFile` existing in the preload API.

## Architecture

### Command transport (the one new pattern)

```
Menu item click (main)
  → sendMenuCommand(id, payload)                 [src/main/menu.ts]
  → focused non-popup window .send('menu:command', {id, payload})
    (popup windows render PopupShell and never register the dispatcher;
     fallback = primary window; NEVER broadcastToAll — a broadcast
     file.save would save every window's focused tab)
  → preload onMenuCommand                        [src/preload/index.ts]
  → handleMenuCommand dispatch map               [src/renderer/lib/menu-commands.ts]
  → existing store actions
```

The pre-existing `menu:open-recent` channel is unchanged.

### Menu modules

- `src/main/menu.ts` — orchestrator: `buildAppMenu(windowManager)`, `refreshAppMenu()` (microtask-coalesced full rebuild), `sendMenuCommand`, about panel, updater/external-link actions.
- `src/main/menu-state.ts` — `getMenuState()`: pure snapshot from electron-store (collections, activeCollectionId, watcherEnabled, recents joined+capped at 15, platform, isDev).
- `src/main/menu-template.ts` — `buildTemplate(state, actions)`: **pure function**, unit-testable without Electron mocks. Every command item carries a stable `id` (e2e drives `Menu.getMenuItemById(id).click()`).

Rebuild triggers (all main-side): recents add/clear, collections add/remove/set-active, `store:set-watcher-enabled`.

### Accelerator rule

Menu items always declare `accelerator` for display. Keys the **renderer already owns** (shortcutManager in App.svelte, or editor-internal like ⌘B) additionally set `registerAccelerator: false` on **Windows/Linux** — there, menu accelerators fire before the page sees the keydown. On macOS the page gets first crack and `preventDefault` wins, so registering is safe. Menu-owned keys (⌥⌘B sidebar, ⌘+/−/0 zoom) register everywhere. **Never attach any accelerator to a Z binding** (table-undo registers with `preventDefault: false` by design). Guarded structurally by the platform matrix in `tests/unit/menu-template.test.ts`.

### Editor command signal

`stores/editor.ts` gains `editorCommand: writable<EditorCommandSignal>` (`{id, payload?, nonce}`) + `dispatchEditorCommand()` — the same monotonic-signal pattern as `saveRequested`. Both editors subscribe; the instance hosting the **focused document tab in its matching mode** executes (pane-pooled editors × split panes), everything else ignores. The dispatcher additionally suppresses format/structure commands while the settings modal is open or no document tab is focused.

- **CodeMirror** (`Editor.svelte`): ids → text transforms via pure helpers in `lib/markdown-structure.ts`, one `view.dispatch` each (normal update path syncs tab content/dirty). Fix-hierarchy reuses `computeMinimalChanges` but **without** `addToHistory: false` — menu edits must be undoable.
- **Tiptap** (`WysiwygEditor.svelte`): ids → the same chains `EditorContextMenu` uses; Insert Link fires the existing `open-link-modal` event; TOC inserts nested bulletList JSON (`lib/tiptap/toc-content.ts`); fix-hierarchy applies all `tr.setNodeMarkup` changes in **one transaction** (one undo step; never `setMarkdownContent` — it resets undo history, tiptap#5708).

Shared core (`lib/markdown-structure.ts`, fully unit-tested): `parseHeadings` (frontmatter/fence-aware, extracted from the properties outline), `slugify`/`assignSlugs` (GitHub-style, duplicate suffixes), `buildTocMarkdown`, `computeFixedHeadingLevels` (`fixed[i] = min(level[i], fixed[i-1]+1)`; both editors call this so they cannot diverge), `shiftHeadingInLine` (clamp 1–6), `toggleInlineMark`, list/quote line-prefix toggles, `buildTableMarkdown`.

### Export pipeline

Renderer converts (it owns `marked` and the live buffer); main shows the dialog and writes bytes.

| Channel       | Contract                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export:save` | `{defaultName, content, filters}` → save dialog → write → `{saved, path?}`. `content` is a string (html/text/rtf/markdown) or a Uint8Array (docx/odt/epub zip containers) |
| `export:pdf`  | `{defaultName, html}` → save dialog → temp HTML file → hidden sandboxed BrowserWindow → `printToPDF({printBackground: true})` → write → `{saved, path?}`                  |

Deliberately **not** routed through the collection-bounded `fs:*` handlers: the user-driven native save dialog is the consent boundary for writing outside a collection. 10MB payload cap (matches the CLI bridge buffer). PDF uses a temp file (not a `data:` URL) so relative-image `file://` rewrites resolve.

Content source: `workspace.focusedDocumentTab.content` — live-synced on every keystroke by both editors, so exports capture unsaved edits. **Save a Copy keeps frontmatter (it IS the markdown); the format exports strip it.**

Converters in `lib/export/`:

- `html.ts` — standalone document over the existing `renderMarkdown`; mermaid placeholders → `<pre>` of the source; relative `<img src>` → `file://` under the collection root; neutral readable stylesheet (not app tokens — exports must read well in light-mode consumers).
- `text.ts` — marked-lexer walk (headings, `•`/numbered lists, `text (url)` links, tab-separated tables, verbatim code).
- `rtf.ts` — hand-rolled RTF 1.x subset from lexer tokens, zero new deps. **Fidelity limits:** tables are tab-separated lines (no `\trowd`), links flatten to `text (url)` (no `\field` hyperlinks), images become `[image: alt]`, nested ordered lists restart literal numbering.
- `zip.ts` — minimal STORED-only ZIP writer (CRC-32, UTF-8 names, fixed timestamp → deterministic bytes), shared by the three container formats below. STORED is required anyway for the `mimetype`-first rule of ODF/EPUB, and makes archive content greppable in tests.
- `docx.ts` — hand-built WordprocessingML: Heading1–6 styles (same half-point scale as RTF), real hyperlink relationships (`TargetMode="External"`; `#anchors` stay plain), real `w:tbl` tables with alignment, `numbering.xml` with a shared bullet numId and a per-ordered-list numId + `startOverride` so every markdown list restarts correctly, monospace-shaded code blocks (`xml:space="preserve"`), task items as `☐/☑` runs, `docProps/core.xml` title.
- `odt.ts` — hand-built ODF 1.2 (LibreOffice native): built-in style names (`Heading_20_N`, `Quotations`, `Preformatted_20_Text`, `Table_20_Heading`) so LibreOffice maps them onto its own hierarchy; 9-level bullet/number list styles with `text:start-value` restarts; whitespace-exact code via `<text:s>`/`<text:tab/>`; bordered table cells.
- `epub.ts` — single-chapter EPUB 3: XHTML emitted straight from lexer tokens (never the HTML preview pipeline — content documents must be well-formed XML), heading ids from the same `slugify` + duplicate-suffix rule as Insert TOC so in-document `#anchor` links keep working, nested nav document built from the collected headings (fallback single entry when heading-less), OPF with caller-supplied `dc:identifier` (fresh `urn:uuid:` per export) and a millisecond-stripped `dcterms:modified`. **Fidelity limits:** relative links flatten to `text (target)` (targets aren't in the book), images become `[image: alt]` (EPUB disallows remote images; no asset embedding).
- `index.ts` — `exportActiveDocument(format)`: guards (document tab with loaded content, else silent no-op), per-format filters, `window.alert` on failure.

Container formats share the RTF/text exporters' policy for raw HTML (dropped) and were validated against `unzip -t` (structure/CRC) and Apple's `textutil` importer (docx + odt) in addition to the unit suite's XML well-formedness checks.

### Doctor UI

Greenfield UI over existing data: `collectionDoctorResult` is already fetched on every collection load/switch. `DoctorModal.svelte` (always-mounted, store-flag pattern like IngestModal; focus-trapped): `{passed}/{total}` summary, per-check Pass/Warn/Fail rows, **contextual CTAs keyed on the CLI's check-name strings** — `API key`/`Provider reachable` → embedding settings; `Config loaded`/`User config`/`Project config` → CLI settings; `Index` → Reindex; `Source directories` → Reveal Collection; unknown names get no CTA (forward-compatible). Run Again re-invokes `runDoctor()`; null result shows a "CLI installed?" fallback. StatusBar shows an amber warning icon (→ opens the modal) whenever any check is `Fail` — zero extra CLI calls.

### Context menus (CSS, per phase-13)

- **Sidebar collection menu**: Reveal · Copy Path · Open in Terminal | Sync · Reindex · Watcher start/stop (active collection only — the watcher is single-instance) · Run Doctor… | Settings ▸ nested CSS submenu (Embedding/Search/Chunking/Topics/Appearance → `openSettingsSection`, which also fixes the old bare "Settings" item that forgot to set a section) | Remove (confirm stays main-side).
- **FileTree Rename** (files, folders, assets): inline input swaps into the tree row; FileNameEditor's validation (no separators, no `[<>:"|?*]`); extension re-appended for files. On success the handler's synthesized `renamed` vault event retargets tabs and patches the tree — **no manual tree/tab mutation**; favorites are explicitly retargeted via `retargetFavoritesOnRename` (new).
- **FileTree Duplicate** (files only): `name copy.ext` / `name copy 2.ext` probing the in-memory tree + `fileInfo` (`fs.copyFile` overwrites — the probe is the guard); `copyFile` registers an own-write (no vault event) so the tree node is inserted manually. No auto-open, no ingest.

### Lifted state

`propertiesOpen` (was App.svelte-local) and new `sidebarVisible`, `shortcutsModalOpen` live in `stores/ui.ts` (localStorage-persisted booleans). `closeFocusedTabWithConfirm`/`reopenLastClosedTab`/`cycleTab` extracted to `stores/workspace-actions.ts` so shortcuts and menu items share one dirty-check path. `fetchCollectionDoctorStatus` exported; `addAndActivateCollection` extracted from Sidebar. KeyboardShortcuts modal is globally openable (Help menu + Settings→About) and focus-trapped.

## Menu Command IDs (contract)

`app.open-settings` · `file.new-note|new-untitled|quick-open|save|save-copy|export{format}|reveal-current|close-tab|reopen-tab` · `edit.search` · `format.bold|italic|strike|code|clear|heading{level}|paragraph|bullet-list|ordered-list|task-list|blockquote|code-block|link|insert-table|hr` · `structure.toc|promote|demote|fix-hierarchy` · `view.toggle-sidebar|toggle-properties|toggle-bottom-panel|toggle-editor-mode|toggle-graph|next-tab|previous-tab|split-editor|zoom-in|zoom-out|zoom-reset` · `collection.switch{collectionId}|add|sync|reindex|rebuild|preview|toggle-watcher|doctor|reveal|copy-path|open-terminal` · `settings.open{target,section}` · `help.shortcuts`

Main-direct (no renderer round trip): New Window, Check for Updates, About, Documentation/Report Issue links, Open Recent, Clear Recents.

## Validation Criteria

- All 8 top-level menus present; every command item has a stable id (unit + e2e).
- Platform accelerator matrix: † keys display everywhere, register only on macOS (unit).
- Fix Heading Hierarchy: `[1,3,2,5] → [1,2,2,3]`, idempotent, single undo step in both editors.
- Export captures the live (unsaved) buffer; Save a Copy retains frontmatter; RTF output has balanced braces and escaped non-ASCII.
- Container exports (docx/odt/epub) parse as valid STORED zips with matching CRCs; every XML part is well-formed; ODF/EPUB `mimetype` is the first, uncompressed entry; EPUB nav hrefs resolve to heading ids in the content document.
- Doctor modal renders all checks with correct CTA per name; StatusBar badge appears only on `Fail`.
- Rename retargets open tabs (vault event) and favorites; Duplicate inserts the tree node without a vault event.

## Testing

- Unit: `menu-template` (pure tree + platform matrix), `menu-commands` (dispatch map incl. guards), `markdown-structure` (all pure helpers), `export-converters` (HTML/text/RTF), `export-zip-formats` (zip round-trip/CRC vector + docx/odt/epub structure via an in-test zip reader and DOMParser well-formedness), `export-handlers` (mocked dialog/BrowserWindow, string + binary payloads), `DoctorModal` (render states + CTAs), `FileTreeNode` (inline rename), `ui-panels-store`, `toc-content`.
- E2E (`tests/e2e/menu.test.ts`): menu structure + ids, properties/sidebar toggle round-trips, Help shortcuts modal, export no-op guard, and a seeded mock-provider vault flow (raw-mode fix-hierarchy → live-buffer HTML export → EPUB export asserting the OCF byte layout and the fixed heading inside the raw STORED archive → Doctor modal with real CLI checks). Uses `--user-data-dir` profile isolation; run with `env -u ELECTRON_RUN_AS_NODE npx playwright test`.

## Known Limitations / Risks

- Dev builds show "Electron" as the macOS app-menu title (the dev binary's Info.plist); packaged builds show Tesseract. Not a bug — don't chase it.
- Watcher checkbox reflects persisted intent, not live state; StatusBar's WatcherToggle remains the live source.
- RTF/PDF fidelity limits documented above; PDF images resolve only for collection-relative paths.
- docx/odt/epub embed no images (placeholders only) and drop raw HTML; archives are uncompressed (STORED) — larger than a Deflate zip but trivial for text documents.
- EPUB is single-chapter (one spine item); readers paginate it but there are no per-heading file splits.
- Case-only renames on case-insensitive filesystems (APFS) hit the "already exists" guard.
- Recents are not retargeted on rename (pre-existing behavior, unchanged).
- `format.clear` in raw mode strips inline markers textually — a heuristic, not a parser.

## Anti-Patterns to Avoid

- Adding a menu accelerator for a renderer-owned key without the win/linux `registerAccelerator: false` guard.
- Broadcasting `menu:command` to all windows.
- `setMarkdownContent` for WYSIWYG structure edits (resets undo history).
- `addToHistory: false` on menu-initiated CodeMirror edits (must be undoable).
- Routing exports through the collection-bounded `fs:write-file`.
- Mutating the tree/tabs manually after `renameFile` (the vault event owns that).
