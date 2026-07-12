# Windows Beta Checklist

Manual verification pass for the unsigned Windows beta build (NSIS installer, Windows 10+).
Run on a real Windows machine (not a VM shortcut) before announcing the release.

## Install & first run

- [ ] Download the NSIS `.exe` installer from the GitHub release on a clean machine.
- [ ] SmartScreen appears for the unsigned installer; the "More info" → "Run anyway" flow works and **matches the wording documented in the README** (update whichever is wrong).
- [ ] Installer allows choosing the installation directory (non-one-click) and completes.
- [ ] App launches from the Start Menu entry and shows onboarding.

## CLI auto-download

- [ ] With no `mdvdb` on `PATH`, the app offers to download the CLI and installs it to `%LOCALAPPDATA%\mdvdb\mdvdb.exe`.
- [ ] Status bar switches from "CLI not found" to `mdvdb v…` after the download without restarting the app.

## Nested vault handling (path separators)

- [ ] Open a collection with nested folders (e.g. `docs/guides/a.md`): the file tree shows **nested folders**, NOT flat entries like `docs\a.md`.
- [ ] Wikilink click-through works on files inside nested folders.
- [ ] Backlinks panel resolves correctly for nested files.

## Live index & concurrency

- [ ] `mdvdb watch` picks up live edits: editing a file externally updates sync status / search results.
- [ ] Concurrent watch + manual ingest shows a friendly "index busy" message — NOT a raw tantivy lock error.

## Terminal panel

- [ ] Terminal opens PowerShell by default.
- [ ] `mdvdb --version` works inside the terminal (CLI dir is on the terminal's PATH).
- [ ] Resizing the terminal pane reflows the shell correctly.
- [ ] No orphaned `conhost.exe` (or pty helper) processes remain after closing the terminal panel and after quitting the app (check Task Manager).

## Window behavior

- [ ] Minimize / maximize / close buttons all work.
- [ ] Windows 11 snap layouts appear on hovering the maximize button and snapping works.
- [ ] Double-clicking the titlebar maximizes/restores the window.

## Editor & assets

- [ ] Drag-and-drop an image from **inside** the collection into the editor → correct relative link inserted.
- [ ] Drag-and-drop an image from **outside** the collection (e.g. Desktop) → image is copied into the collection and a correct relative link is inserted.

## Theming

- [ ] Switching the app theme (accent color) updates the native window control colors (titlebar overlay buttons match the theme).
