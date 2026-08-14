# Linux Beta Checklist

Manual verification pass for the Linux beta build (AppImage + deb).
Test on Ubuntu 22.04 **and** 24.04, on X11 **and** Wayland sessions.

## AppImage

- [ ] `chmod +x Tesseract-*.AppImage` then launch — starts on Ubuntu 22.04 (X11).
- [ ] Launches on Ubuntu 22.04 (Wayland).
- [ ] On Ubuntu 24.04, exits with the documented sandbox error rather than silently adding `--no-sandbox`; use the deb package there.
- [ ] No release or desktop metadata injects `--no-sandbox`.

## deb package

- [ ] `sudo apt install ./tesseract-app_*.deb` installs cleanly (maintainer/description fields present, no dpkg warnings that block install).
- [ ] App launches from the desktop entry after deb install on Ubuntu 22.04 (X11 and Wayland).
- [ ] App launches from the desktop entry after deb install on Ubuntu 24.04 (X11 and Wayland); the package installs its scoped AppArmor profile.

## Window controls

- [ ] Window controls (min/max/close) render via the window controls overlay.
- [ ] If WCO does not render on the tested desktop environment: decide on and apply the native-frame fallback (document the decision) — the window must never be undraggable/uncloseable.

## CLI auto-download

- [ ] With no `mdvdb` on `PATH`, the app offers to download the CLI and installs it to `~/.local/bin/mdvdb`.
- [ ] Status bar switches from "CLI not found" to `mdvdb v…` after the download without restarting the app.

## Terminal panel

- [ ] Terminal opens the user's `$SHELL` (not hardcoded bash).
- [ ] `mdvdb --version` works inside the terminal.

## Menus & shortcuts

- [ ] Menu accelerators show `Ctrl` labels (not `Cmd`).
- [ ] Core shortcuts (Ctrl+S, Ctrl+N, Ctrl+W) work.

## Auto-update

- [ ] Auto-update works from the AppImage: an older AppImage detects the new release via `latest-linux.yml` and updates itself.
- [ ] deb has no auto-update — confirm this is documented (README/release notes) as a manual update path.
