#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?usage: verify-linux-artifacts.sh ARTIFACT_DIR [DEB_ARCH]}"
expected_deb_arch="${2:-amd64}"

if [[ ! -d "$artifact_dir" ]]; then
  echo "Artifact directory does not exist: $artifact_dir" >&2
  exit 1
fi
artifact_dir="$(cd "$artifact_dir" && pwd)"

shopt -s nullglob
appimages=("$artifact_dir"/*.AppImage)
debs=("$artifact_dir"/*.deb)
update_metadata=("$artifact_dir"/latest-linux*.yml)
shopt -u nullglob

if ((${#appimages[@]} != 1)); then
  echo "Expected exactly one AppImage in $artifact_dir; found ${#appimages[@]}." >&2
  exit 1
fi
if ((${#debs[@]} != 1)); then
  echo "Expected exactly one deb in $artifact_dir; found ${#debs[@]}." >&2
  exit 1
fi
if ((${#update_metadata[@]} < 1)); then
  echo "Missing latest-linux update metadata in $artifact_dir." >&2
  exit 1
fi

appimage="${appimages[0]}"
deb="${debs[0]}"
chmod +x "$appimage"

file "$appimage"
dpkg-deb --info "$deb"
deb_arch="$(dpkg-deb --field "$deb" Architecture)"
if [[ "$deb_arch" != "$expected_deb_arch" ]]; then
  echo "Expected deb architecture $expected_deb_arch; got $deb_arch." >&2
  exit 1
fi

extract_dir="$(mktemp -d)"
launch_log="$(mktemp)"
cleanup() {
  rm -rf "$extract_dir"
  rm -f "$launch_log"
}
trap cleanup EXIT

(
  cd "$extract_dir"
  "$appimage" --appimage-extract >/dev/null
)
app_root="$extract_dir/squashfs-root"
test -d "$app_root"

desktop_entry="$(find "$app_root" -type f -name '*.desktop' -print -quit)"
test -n "$desktop_entry"
grep -F 'Name=Tesseract' "$desktop_entry"

skills_manifest="$(
  find "$app_root" -path '*/resources/tesseract-skills/.claude-plugin/plugin.json' -print -quit
)"
test -n "$skills_manifest"

mapfile -d '' native_modules < <(find "$app_root" -type f -name '*.node' -print0)
if ((${#native_modules[@]} == 0)); then
  echo 'Packaged app contains no native Node modules.' >&2
  exit 1
fi
checked_native_modules=0
for module in "${native_modules[@]}"; do
  # Native packages such as sharp and Canvas publish separate glibc and musl
  # optional binaries for Linux. npm can install both x64 variants, but each
  # package selects exactly one at runtime. Running glibc's ldd against an
  # unused musl binary necessarily reports the musl loader as missing, so
  # validate only binaries that can execute on this glibc release target. The
  # AppImage launch below exercises runtime selection in the packaged app.
  if [[ "$module" == *musl* ]]; then
    echo "Skipping optional musl native module on glibc target: $module"
    continue
  fi

  module_description="$(file -b "$module")"
  echo "$module: $module_description"
  if [[ "$module_description" != *'ELF 64-bit LSB shared object, x86-64'* ]]; then
    echo "Skipping native module for another platform or architecture: $module"
    continue
  fi

  if ! dependencies="$(ldd "$module" 2>&1)"; then
    printf '%s\n' "$dependencies" >&2
    echo "Could not inspect native-module dependencies: $module" >&2
    exit 1
  fi
  if grep -F 'not found' <<<"$dependencies"; then
    printf '%s\n' "$dependencies" >&2
    echo "Unresolved native-module dependency: $module" >&2
    exit 1
  fi
  ((checked_native_modules += 1))
done
if ((checked_native_modules == 0)); then
  echo 'Packaged app contains no native modules for the glibc release target.' >&2
  exit 1
fi

smoke_launch() {
  local label="$1"
  shift
  : >"$launch_log"

  # Launch in a separate process group so Xvfb and every Electron subprocess
  # can be cleaned up together. Inspect health before teardown: Electron may
  # emit a shutdown-only fatal message when a test harness sends SIGTERM, which
  # says nothing about whether the packaged application launched successfully.
  setsid xvfb-run --auto-servernum "$@" >"$launch_log" 2>&1 &
  local launch_pid=$!
  local elapsed=0
  while ((elapsed < 20)); do
    sleep 1
    if ! kill -0 "$launch_pid" 2>/dev/null; then
      set +e
      wait "$launch_pid"
      local launch_status=$?
      set -e
      cat "$launch_log" >&2
      echo "$label did not remain healthy during launch smoke (exit $launch_status)." >&2
      exit 1
    fi
    ((elapsed += 1))
  done

  if grep -Eiq 'FATAL|No usable sandbox|error while loading shared libraries|Trace/breakpoint trap' "$launch_log"; then
    cat "$launch_log" >&2
    echo "$label emitted a fatal launch error." >&2
    kill -KILL -- "-$launch_pid" 2>/dev/null || true
    wait "$launch_pid" 2>/dev/null || true
    exit 1
  fi

  kill -TERM -- "-$launch_pid" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-$launch_pid" 2>/dev/null || true
  wait "$launch_pid" 2>/dev/null || true
}

if [[ "${INSTALL_DEB:-false}" == 'true' ]]; then
  sudo apt-get install -y "$deb"
  package_name="$(dpkg-deb --field "$deb" Package)"
  dpkg-query --show --showformat='${Status}\n' "$package_name" | grep -F 'install ok installed'
  installed_desktop="$(dpkg-query --listfiles "$package_name" | grep -E '/applications/.*\.desktop$' | head -1)"
  test -n "$installed_desktop"
  test -f "$installed_desktop"
  installed_executable="$(readlink -f "/usr/bin/$package_name")"
  test -x "$installed_executable"
  test -f "$(dirname "$installed_executable")/resources/apparmor-profile"
  smoke_launch 'Installed deb application' "$installed_executable"
else
  # Ubuntu 22.04 allows the unprivileged user namespace Electron uses for its
  # Chromium sandbox. Ubuntu 24.04 restricts that namespace for unconfined
  # applications, so its clean-machine gate launches the installed deb above;
  # electron-builder's deb postinst installs a narrowly scoped AppArmor profile
  # (and a SUID sandbox fallback) instead of disabling Chromium's sandbox.
  smoke_launch 'AppImage' env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage"
fi

echo "Linux packages verified: $(basename "$appimage"), $(basename "$deb")"
