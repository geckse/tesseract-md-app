# PRD: Settings & Onboarding

## Overview

Settings panel for managing app and CLI configuration, CLI installation flow for first-time users, and a first-run onboarding experience. The app detects whether `mdvdb` is on the system PATH and guides the user through installation if needed. The settings UI exposes user-level config (`~/.mdvdb/config`) and per-collection config in an accessible form.

## Problem Statement

End users downloading the desktop app may not have the `mdvdb` CLI installed. The app must guide them through installation. Additionally, the 26 CLI configuration options (API keys, embedding providers, search defaults, etc.) are currently managed via dotenv files — the app needs a visual settings panel to make these accessible without manual file editing.

## Goals

- CLI detection on system PATH at app startup
- CLI installation flow: download platform binary, place in standard location, add to PATH
- First-run onboarding wizard (welcome → CLI setup → add first collection)
- Settings panel with sections: CLI, user-level config, per-collection config, app preferences
- API key input with show/hide toggle
- Embedding provider/model selection
- Keyboard shortcuts reference panel
- "About" section with version info

## Non-Goals

- Auto-updating the CLI binary (manual update for now; the app auto-updates itself in Phase 11)
- Building the CLI from source (download pre-built binaries only)
- Remote settings sync
- Plugin or extension management
- Theme customization beyond font size

## Technical Design

### Data Model Changes

**Store additions:**

```typescript
interface AppStore {
  // ... existing fields ...
  cliPath: string | null              // Detected or installed CLI path
  cliVersion: string | null           // Cached CLI version
  onboardingComplete: boolean         // Whether first-run wizard was completed
  editorFontSize: number              // User preference (default 17)
}
```

### Interface Changes

**New module: `app/src/main/cli-install.ts`**

```typescript
interface CliInstallResult {
  success: boolean
  path: string              // Where the binary was installed
  version: string           // Installed version
  error?: string
}

// Detect CLI on PATH
detectCli(): Promise<{ found: boolean; path?: string; version?: string }>

// Download and install CLI for current platform
installCli(): Promise<CliInstallResult>

// Check latest version available on GitHub releases
checkLatestVersion(): Promise<string>

// Get platform-specific install path
getInstallPath(): string    // /usr/local/bin (macOS/Linux), %LOCALAPPDATA%\mdvdb (Windows)
```

**New IPC channels:**
- `'cli:detect'` → detect CLI on PATH
- `'cli:install'` → download and install CLI (with progress callback)
- `'cli:check-update'` → check if newer version available
- `'settings:get-user-config'` → read `~/.mdvdb/config` (parsed key-value)
- `'settings:set-user-config'` → write to `~/.mdvdb/config`
- `'settings:get-collection-config'` → read `.markdownvdb/.config` for active collection
- `'settings:set-collection-config'` → write to `.markdownvdb/.config`

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  detectCli(): Promise<{ found: boolean; path?: string; version?: string }>
  installCli(): Promise<CliInstallResult>
  checkLatestCliVersion(): Promise<string>
  getUserConfig(): Promise<Record<string, string>>
  setUserConfig(key: string, value: string): Promise<void>
  deleteUserConfig(key: string): Promise<void>
  getCollectionConfig(root: string): Promise<Record<string, string>>
  setCollectionConfig(root: string, key: string, value: string): Promise<void>
}
```

### New Commands / API / UI

**Onboarding wizard** (first run only):

```
Step 1: Welcome
┌─────────────────────────────────────────┐
│                                         │
│           [mdvdb logo]                  │
│                                         │
│   Markdown Vector Database              │
│   Search your notes by meaning          │
│                                         │
│         [Get Started]                   │
│                                         │
└─────────────────────────────────────────┘

Step 2: CLI Setup
┌─────────────────────────────────────────┐
│                                         │
│   CLI Detection                         │
│                                         │
│   ✓ mdvdb v0.1.0 found at /usr/local/bin │
│     (or)                                │
│   ✗ mdvdb not found                     │
│   [Install CLI]  [Skip for now]         │
│                                         │
│   Installing...  ████████░░  80%        │
│                                         │
└─────────────────────────────────────────┘

Step 3: First Collection
┌─────────────────────────────────────────┐
│                                         │
│   Add Your First Collection             │
│                                         │
│   Select a folder containing markdown   │
│   files to get started.                 │
│                                         │
│   [Choose Folder]  [Skip]              │
│                                         │
└─────────────────────────────────────────┘
```

**Settings panel** (accessible via sidebar footer or menu):

```
┌─ Settings ──────────────────────────────┐
│                                          │
│ CLI                                      │
│ ├ Path: /usr/local/bin/mdvdb            │
│ ├ Version: 0.1.0                        │
│ ├ [Check for Update]                    │
│ └ [Reinstall]                           │
│                                          │
│ Embedding Provider                       │
│ ├ Provider: [OpenAI ▾]                  │
│ ├ Model: [text-embedding-3-small]       │
│ ├ API Key: [••••••••••] [👁]            │
│ └ Dimensions: [1536]                    │
│                                          │
│ Search Defaults                          │
│ ├ Mode: [Hybrid ▾]                      │
│ ├ Result Limit: [10]                    │
│ ├ Min Score: [0.0]                      │
│ └ Time Decay: [Off ▾] Half-life: [90]  │
│                                          │
│ Chunking                                 │
│ ├ Max Tokens: [512]                     │
│ └ Overlap: [50]                         │
│                                          │
│ Appearance                               │
│ └ Editor Font Size: [17] [-][+]         │
│                                          │
│ About                                    │
│ ├ App Version: 1.0.0                    │
│ ├ GitHub: github.com/...                │
│ └ [Keyboard Shortcuts]                  │
│                                          │
└──────────────────────────────────────────┘
```

**Keyboard shortcuts modal:**

| Shortcut | Action |
|---|---|
| `Cmd+K` | Search |
| `Cmd+S` | Save file |
| `Cmd+B` | Toggle sidebar |
| `Cmd+Shift+B` | Toggle metadata panel |

**Settings scope:**
- **User-level settings** (written to `~/.mdvdb/config`): API key, embedding provider/model/dimensions, search defaults. These apply to all collections that don't override them.
- **Collection settings** (written to `.markdownvdb/.config`): per-collection overrides. Shown with "(collection override)" label.
- **App settings** (written to electron-store): editor font size, window bounds. Not mdvdb config — app-specific only.

### Migration Strategy

N/A — new components and modules.

## Implementation Steps

1. **Build CLI detection** — `app/src/main/cli-install.ts`:
   - `detectCli()`: run `which mdvdb` (or `where mdvdb` on Windows). Parse output for path. If found, run `mdvdb --version` for version string. Return `{ found, path, version }`.
   - Cache result in electron-store.

2. **Build CLI installation** — `installCli()`:
   - Determine platform: `process.platform` (darwin, win32, linux) + `process.arch` (x64, arm64).
   - Fetch latest release from GitHub API: `https://api.github.com/repos/<owner>/<repo>/releases/latest`.
   - Find the correct asset for the platform (e.g., `mdvdb-darwin-arm64`, `mdvdb-linux-x64`, `mdvdb-windows-x64.exe`).
   - Download with progress reporting (stream to temp file).
   - Move to install location: `/usr/local/bin/mdvdb` (macOS/Linux, may need `sudo`), `%LOCALAPPDATA%\mdvdb\mdvdb.exe` (Windows).
   - Set executable permission on macOS/Linux: `chmod +x`.
   - On Windows: add install directory to user PATH via registry or setx.
   - Verify installation: run `mdvdb --version`.
   - Note: macOS/Linux may require elevated permissions. Use `electron.shell.openExternal` or `sudo-prompt` if needed. Alternatively, install to a user-writable location and add to PATH.

3. **Build config read/write** — In `app/src/main/ipc-handlers.ts`:
   - `'settings:get-user-config'`: read `~/.mdvdb/config` (or `$MDVDB_CONFIG_HOME/config`), parse as dotenv key=value pairs, return as `Record<string, string>`.
   - `'settings:set-user-config'`: read existing config, update/add the key, write back. Preserve comments and ordering.
   - `'settings:get-collection-config'`: read `.markdownvdb/.config` for the given root.
   - `'settings:set-collection-config'`: same pattern.

4. **Register IPC handlers** — Add CLI detection, installation, and settings handlers.

5. **Update preload** — Add new methods to `window.api`.

6. **Build Onboarding component** — `app/src/renderer/components/Onboarding.svelte`:
   - Three-step wizard with forward/skip navigation.
   - Step 1: Welcome screen with logo and description.
   - Step 2: CLI detection result. If not found: "Install" button with progress bar. If found: green checkmark + version.
   - Step 3: "Add Your First Collection" with folder picker button.
   - On complete: set `onboardingComplete = true` in store.
   - Rendered full-screen over the app when `!onboardingComplete`.

7. **Build Settings component** — `app/src/renderer/components/Settings.svelte`:
   - Full-page panel (replaces the editor area when open).
   - Sections: CLI, Embedding Provider, Search Defaults, Chunking, Appearance, About.
   - Form inputs: text inputs, dropdowns, number inputs, toggle switches.
   - API key input: password field with eye icon toggle to show/hide.
   - Provider dropdown: OpenAI, Ollama, Custom options. Shows/hides relevant fields based on selection (e.g., API key for OpenAI, host URL for Ollama).
   - Save: writes to `~/.mdvdb/config` via IPC on change (auto-save per field with debounce).
   - Per-collection tab: shows collection-specific overrides. Label fields that override user-level settings.

8. **Build KeyboardShortcuts component** — `app/src/renderer/components/KeyboardShortcuts.svelte`:
   - Modal/overlay listing all keyboard shortcuts.
   - Grouped by category: Navigation, Editing, Search.
   - Use `<Kbd>` component from Phase 1 for shortcut keys.

9. **Add settings access point** — Sidebar footer: gear icon or settings button. Opens the settings panel.

10. **Wire onboarding to app startup** — In `App.svelte`: check `onboardingComplete` on mount. If false, show Onboarding overlay. If true, show normal app.

11. **Write unit tests**:
    - `tests/unit/cli-install.test.ts`: mock `which`/`where`, test detection on each platform. Mock HTTP for download. Test install path logic per platform.
    - `tests/unit/config-readwrite.test.ts`: test dotenv reading/writing, preserve comments, handle missing files.
    - `tests/unit/Settings.test.ts`: render with mock config, verify form fields, verify save calls API.
    - `tests/unit/Onboarding.test.ts`: render each step, verify navigation, verify completion flag.

12. **Write E2E tests** — `tests/e2e/onboarding.test.ts`:
    - Clear app store (simulate first launch).
    - Verify onboarding wizard appears.
    - Step through wizard.
    - Verify app loads normally after completion.
    - `tests/e2e/settings.test.ts`: open settings, change a value, verify it persists.

## Validation Criteria

- [ ] First launch shows onboarding wizard
- [ ] Onboarding detects CLI presence and shows version or "not found"
- [ ] CLI installation downloads correct platform binary and places it on PATH
- [ ] After installation, `mdvdb --version` works from terminal
- [ ] Onboarding completion flag persists (not shown on subsequent launches)
- [ ] Settings panel shows all user-level config options
- [ ] API key input has show/hide toggle
- [ ] Provider dropdown shows/hides relevant fields based on selection
- [ ] Settings changes write to `~/.mdvdb/config`
- [ ] Per-collection settings override user-level settings
- [ ] Keyboard shortcuts panel lists all shortcuts
- [ ] Editor font size preference is applied
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT store API keys in electron-store** — API keys belong in `~/.mdvdb/config` (the CLI's config file), not in the app's own store. The app reads/writes the CLI's config files.
- **Do NOT require sudo for CLI installation** — Prefer installing to user-writable locations (`~/.local/bin` on Linux, `%LOCALAPPDATA%` on Windows). Only fall back to system locations if the user explicitly grants permission.
- **Do NOT block the app on CLI installation** — Show the onboarding wizard but allow users to "Skip" CLI installation and still explore the app (with warnings about limited functionality).
- **Do NOT write config files without preserving existing content** — Read the full file, parse, update the specific key, and write back. Never overwrite the entire file with just the changed key.
- **Do NOT validate API keys by making test API calls during settings save** — Validation happens when the user runs their first ingest. The settings panel just stores the value.

## Patterns to Follow

- **dotenv format** — CLI config files use `KEY=value` format (one per line). Parse with simple line splitting, not a full dotenv library (to avoid incompatibilities). Preserve empty lines, comments (`#`), and key ordering.
- **Platform-specific paths** — Use `process.platform` to determine install paths and PATH modification strategy. macOS: `/usr/local/bin` or `~/.local/bin`. Linux: `~/.local/bin`. Windows: `%LOCALAPPDATA%\mdvdb`.
- **GitHub Releases API** — Use `https://api.github.com/repos/OWNER/REPO/releases/latest` to find the latest version. Match assets by naming convention: `mdvdb-{os}-{arch}[.exe]`.
- **Progressive disclosure in settings** — Show the most common settings (provider, API key, model) prominently. Hide advanced settings (RRF K, BM25 norm K, chunk overlap) behind an "Advanced" toggle.
