# Changelog

All notable changes to Tesseract are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-12

First public beta of Tesseract, the desktop GUI for [mdvdb](https://github.com/geckse/markdown-vdb).

### Added

- Markdown editor with two modes: CodeMirror source editing and a WYSIWYG editor (Tiptap), including tables, code blocks with syntax highlighting, Mermaid diagrams, and image embeds.
- Semantic, hybrid, and lexical search over collections, driven by the mdvdb CLI (`--json` contract), with path scoping and metadata filters.
- Graph views: full-collection 3D force graph and per-file local graph, with topic coloring, frontmatter-relation edges, and search overlay.
- Topics and clusters: Leiden auto-clustering plus user-defined topics (create, edit, remove) with multi-label assignment and an Unassigned bucket.
- Database table view over collections with sortable/filterable columns, saved views, and recursive property type conversion / rename.
- Frontmatter relations: wiki-link foreign keys with resolved relation chips, a scoped relation picker, referenced-by panel, and relation-aware filters.
- Integrated terminal panel (node-pty + xterm.js) opening the platform shell.
- Native application menus with platform-aware accelerators, export pipeline (HTML/PDF/RTF/TXT), and a doctor diagnostics modal.
- File tree with live sync status, favorites and recents, multi-window support, and live reactivity via a two-tier filesystem watcher.
- Automatic mdvdb CLI download and setup on first run.
- Auto-update via electron-updater (GitHub Releases).

### Supported platforms

- macOS 11+ (signed and notarized; arm64 and x64 DMG/zip)
- Windows 10+ (NSIS installer; unsigned beta — expect a SmartScreen prompt)
- Linux (AppImage with auto-update, deb with manual updates)

[0.1.0]: https://github.com/geckse/tesseract-md-app/releases/tag/v0.1.0
