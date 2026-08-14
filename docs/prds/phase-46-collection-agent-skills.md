# Phase 46: Collection Agent Skills

## Overview

Help users make Tesseract collection knowledge available to AI coding agents. When a collection becomes active, the app compares its project-local agent skill folders with the `tesseract-skills` plugin bundled in the app. A banner offers an explicit install or update when no current copy is available.

This is an app-only distribution path. The bundled source is exclusively `tesseract-skills/plugins/tesseract`; the app does not discover or copy the repository's general `/skills` content. The umbrella checkout resolves the sibling subrepo, while standalone app CI stages its skills checkout into that same sibling layout before packaging and verifies the plugin manifest inside the packaged app.

## Supported project folders

- Claude Code: `.claude/skills`
- Codex and compatible agents: `.agents/skills`
- Gemini CLI: `.gemini/skills`

The banner recommends an outdated target first, then an already-present agent folder, and otherwise `.agents/skills`. A current copy in any supported folder satisfies the collection check. Installation never writes global user-level agent configuration.

## Update detection

The app computes a SHA-256 fingerprint from the plugin version, skill-relative file names, and file contents. An install marker stores the plugin version and fingerprint, while direct file comparison also recognizes a current manual installation. This detects content-only and version-only bundle updates.

Checks run when the active collection changes and when the app window regains focus. The bundle is local to the app, so this process requires no network request.

## User actions

- **Install skills / Update skills** copies the bundled skill directories into the selected collection-local target.
- **Not now** hides the banner for the current app session.
- **Never for this collection** stores a permanent per-collection dismissal in the app store.

Removing a collection also removes its stored dismissal. Installation replaces only bundled Tesseract skill files and its marker; unrelated skills remain untouched.

## Safety

The main process resolves the collection from its registered ID. Target IDs are a fixed union, paths cannot escape the collection, and symlinks anywhere below the collection root block inspection and installation for that target. The renderer has no direct filesystem access.

## Acceptance criteria

- Main-process tests cover missing/current/outdated detection, agent-folder recommendation, content and version updates, installation isolation, and symlink rejection.
- IPC tests cover collection validation, target forwarding, dismissal persistence, and channel registration.
- Store and component tests cover lifecycle checks, install/update actions, error/retry, and both dismissal modes.
- Release-hygiene coverage pins the packaged `tesseract-skills` resource.
- Typecheck, lint, unit/integration tests, and production build pass.
