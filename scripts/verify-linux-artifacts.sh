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
for module in "${native_modules[@]}"; do
  file "$module"
  dependencies="$(ldd "$module")"
  if grep -F 'not found' <<<"$dependencies"; then
    printf '%s\n' "$dependencies" >&2
    echo "Unresolved native-module dependency: $module" >&2
    exit 1
  fi
done

set +e
APPIMAGE_EXTRACT_AND_RUN=1 timeout --signal=TERM 20s \
  xvfb-run --auto-servernum "$appimage" >"$launch_log" 2>&1
launch_status=$?
set -e

if ((launch_status != 124)); then
  cat "$launch_log" >&2
  echo "AppImage did not remain healthy during launch smoke (exit $launch_status)." >&2
  exit 1
fi
if grep -Eiq 'FATAL|No usable sandbox|error while loading shared libraries|Trace/breakpoint trap' "$launch_log"; then
  cat "$launch_log" >&2
  echo 'AppImage emitted a fatal launch error.' >&2
  exit 1
fi

if [[ "${INSTALL_DEB:-false}" == 'true' ]]; then
  sudo apt-get install -y "$deb"
  package_name="$(dpkg-deb --field "$deb" Package)"
  dpkg-query --show --showformat='${Status}\n' "$package_name" | grep -F 'install ok installed'
  installed_desktop="$(dpkg-query --listfiles "$package_name" | grep -E '/applications/.*\.desktop$' | head -1)"
  test -n "$installed_desktop"
  test -f "$installed_desktop"
fi

echo "Linux packages verified: $(basename "$appimage"), $(basename "$deb")"
