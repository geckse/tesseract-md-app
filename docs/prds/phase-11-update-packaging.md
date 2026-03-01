# PRD: Auto-Update & Packaging

## Overview

Build, package, and distribute the Electron app for macOS, Windows, and Linux. Integrate `electron-updater` for automatic app updates via GitHub Releases. Set up CI/CD with GitHub Actions to build platform binaries on every release.

## Problem Statement

The app needs to be distributed as installable packages for all three platforms. End users expect auto-update functionality so they don't have to manually download new versions. A CI pipeline ensures every release is built consistently and published as downloadable artifacts.

## Goals

- macOS: DMG with universal binary (arm64 + x64)
- Windows: NSIS installer
- Linux: AppImage + deb packages
- `electron-updater` for automatic app updates
- Update notification UI: "A new version is available"
- Background download with update-on-restart
- GitHub Actions CI/CD: build on all platforms, publish to Releases
- Code signing setup (macOS notarization, optional Windows signing)
- App icons derived from the mockup's cyan database icon

## Non-Goals

- Mac App Store distribution (direct download only)
- Microsoft Store distribution
- Snap or Flatpak packages for Linux
- Delta/differential updates (full download each time)
- Custom update server (GitHub Releases only)
- Beta/canary update channels (single stable channel)
- CLI binary auto-update (separate from app update)

## Technical Design

### Data Model Changes

**Store additions:**

```typescript
interface AppStore {
  // ... existing fields ...
  updateChannel: 'stable'                    // Only stable for now
  lastUpdateCheck: number                    // Unix timestamp
  skipVersion: string | null                 // User can skip a specific version
}
```

### Interface Changes

**New module: `app/src/main/updater.ts`**

```typescript
class AppUpdater {
  checkForUpdates(): Promise<UpdateCheckResult | null>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
  onUpdateAvailable(callback: (info: UpdateInfo) => void): void
  onDownloadProgress(callback: (progress: ProgressInfo) => void): void
  onUpdateDownloaded(callback: (info: UpdateInfo) => void): void
}
```

**New IPC channels:**
- `'updater:check'` → manually check for updates
- `'updater:download'` → start downloading the update
- `'updater:install'` → quit and install (restart)
- `'updater:status'` → current update state
- `'updater:skip-version'` → skip this version

### New Commands / API / UI

**Update notification:**
- When update is available: subtle banner at top of app or in status bar
- "A new version (v1.2.0) is available"
- Buttons: "Download", "Skip This Version", "Remind Me Later"
- After download: "Update ready. Restart to apply."
- Buttons: "Restart Now", "Later"
- Download progress: small progress bar in the notification

**About section** (in Settings):
- Current version number
- "Check for Updates" button
- Last check time
- Update status: "Up to date" / "Update available" / "Downloading..."

### Migration Strategy

N/A — new build and distribution infrastructure.

## Implementation Steps

1. **Install electron-builder and electron-updater** — `npm install -D electron-builder` and `npm install electron-updater`. These handle packaging and auto-updates respectively.

2. **Configure electron-builder** — In `package.json` or `electron-builder.yml`:
   ```yaml
   appId: "com.mdvdb.app"
   productName: "mdvdb"
   directories:
     output: dist
   mac:
     category: "public.app-category.developer-tools"
     target:
       - target: dmg
         arch: [universal]
     hardenedRuntime: true
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.inherit.plist
   win:
     target: nsis
   nsis:
     oneClick: false
     allowToChangeInstallationDirectory: true
   linux:
     target:
       - AppImage
       - deb
     category: Development
   publish:
     provider: github
   ```

3. **Create app icons** — Generate icon files from the mockup's cyan database icon:
   - `build/icon.icns` (macOS)
   - `build/icon.ico` (Windows)
   - `build/icon.png` (Linux, 512x512)
   - Use the cyan `#00E5FF` database icon on dark `#0f0f10` background.

4. **Create macOS entitlements** — `build/entitlements.mac.plist`:
   - `com.apple.security.cs.allow-jit`: needed for JIT in Electron
   - `com.apple.security.cs.allow-unsigned-executable-memory`: required for Electron
   - `com.apple.security.files.user-selected.read-write`: file access

5. **Build AppUpdater module** — `app/src/main/updater.ts`:
   - Initialize `autoUpdater` from `electron-updater`.
   - Set `autoUpdater.autoDownload = false` (let user opt in).
   - Set `autoUpdater.autoInstallOnAppQuit = true`.
   - On app ready (after 5s delay): call `autoUpdater.checkForUpdates()`.
   - Set interval: check every 6 hours.
   - Forward events to renderer: `update-available`, `download-progress`, `update-downloaded`.
   - Handle errors gracefully (no network, rate limited, etc.).

6. **Register updater IPC handlers** — In `app/src/main/ipc-handlers.ts`:
   - `'updater:check'`: trigger manual check.
   - `'updater:download'`: start download.
   - `'updater:install'`: call `autoUpdater.quitAndInstall()`.
   - Forward progress events to renderer via `webContents.send`.

7. **Build UpdateNotification component** — `app/src/renderer/components/UpdateNotification.svelte`:
   - Subtle banner at top of app (above header).
   - States: hidden, update-available, downloading (with progress bar), ready-to-install.
   - Buttons: "Download" / "Skip" / "Later" for available state.
   - Buttons: "Restart Now" / "Later" for ready state.
   - Styled to match design system: `bg-surface-darker border-b border-border-dark`.

8. **Update About section in Settings** — Show app version, "Check for Updates" button, update status.

9. **Create GitHub Actions workflow** — `.github/workflows/build-app.yml`:
   ```yaml
   name: Build Desktop App
   on:
     push:
       tags: ['app-v*']
   jobs:
     build:
       strategy:
         matrix:
           os: [macos-latest, windows-latest, ubuntu-latest]
       runs-on: ${{ matrix.os }}
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 20
         - run: cd app && npm ci
         - run: cd app && npm run build
         - run: cd app && npx electron-builder --publish always
           env:
             GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
             CSC_LINK: ${{ secrets.MAC_CERT_BASE64 }}
             CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
   ```

10. **Add build scripts to package.json**:
    ```json
    {
      "scripts": {
        "build:mac": "electron-builder --mac",
        "build:win": "electron-builder --win",
        "build:linux": "electron-builder --linux",
        "build:all": "electron-builder -mwl",
        "publish": "electron-builder --publish always"
      }
    }
    ```

11. **Code signing setup**:
    - macOS: Document the process for obtaining a Developer ID certificate. Set `CSC_LINK` and `CSC_KEY_PASSWORD` in CI secrets. Enable notarization via `afterSign` hook.
    - Windows: Optional — document the process for EV code signing. Without signing, Windows SmartScreen may warn users.
    - Linux: No signing needed for AppImage/deb.

12. **Write tests**:
    - `tests/unit/updater.test.ts`: mock `electron-updater`, verify check schedule (5s delay, 6h interval), verify event forwarding, verify skip version logic.
    - `tests/unit/UpdateNotification.test.ts`: render in each state, verify correct buttons and behavior.
    - Integration: build the app for current platform, verify the output exists and is a valid package.
    - CI: the GitHub Actions workflow itself validates all three platform builds.

## Validation Criteria

- [ ] `npm run build:mac` produces a working DMG (universal binary)
- [ ] `npm run build:win` produces a working NSIS installer
- [ ] `npm run build:linux` produces a working AppImage
- [ ] App installs and launches on all three platforms
- [ ] Auto-updater checks for updates on launch (after 5s delay)
- [ ] Update available notification appears when a newer version exists
- [ ] User can download the update with visible progress
- [ ] "Restart Now" applies the update
- [ ] "Skip This Version" suppresses notification for that version
- [ ] GitHub Actions builds all three platforms on tag push
- [ ] Built artifacts are uploaded to GitHub Releases
- [ ] macOS build is code-signed and notarized (when certificates are configured)
- [ ] All unit tests pass

## Anti-Patterns to Avoid

- **Do NOT auto-download updates without user consent** — Set `autoDownload: false`. Show a notification and let the user choose. Surprise downloads waste bandwidth and can be disruptive.
- **Do NOT check for updates on every launch** — First check after 5s delay (don't slow down startup). Then every 6 hours. Not more frequently.
- **Do NOT force-quit during unsaved work** — When user clicks "Restart Now", check for dirty editors first. Prompt to save before restarting.
- **Do NOT bundle the CLI binary inside the Electron app package** — The CLI is installed separately (Phase 10). The app package should only contain the Electron app code.
- **Do NOT use `electron-builder`'s auto-update with S3/generic server** — Use GitHub Releases as the update provider. Simpler, free, and integrates with the existing repo.

## Patterns to Follow

- **electron-updater conventions** — Follow the standard pattern: check → notify → download (manual trigger) → notify ready → install on restart. This is the most common and least disruptive pattern.
- **Semantic versioning** — App versions follow semver. Git tags for app releases: `app-v1.0.0`, `app-v1.1.0`, etc. (prefixed to distinguish from CLI releases).
- **CI matrix builds** — Build all three platforms in parallel for faster releases. Each platform job is independent.
- **Delayed update check** — `setTimeout(() => autoUpdater.checkForUpdates(), 5000)` ensures the app is fully loaded before checking. Prevents slow startup on poor network.
