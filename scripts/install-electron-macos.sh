#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="LensQuery"
APP_BUNDLE_ID="com.lensquery.desktop.electron-preview"
OLD_APP_BUNDLE_ID="com.lensquery.desktop"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DESTINATION="/Applications/$APP_NAME.app"
LEGACY_PREVIEW_DESTINATION="/Applications/LensQuery Electron Preview.app"
FINDER_EXTENSION_ID="com.lensquery.desktop.electron-preview.finder"
BROWSER_EXTENSION_ID="filelbpgenppllkeeofajalcgbnifgmi"
RELEASE_ROOT="$PROJECT_ROOT/release-electron"
MIN_FREE_GIB=4
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

log() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf '\nLensQuery Electron installation stopped: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer is for macOS."
command -v npm >/dev/null 2>&1 || fail "Node.js/npm is missing. Install Node.js 22 or newer first."
command -v cargo >/dev/null 2>&1 || fail "Rust/Cargo is missing. Install Rust stable first."
command -v xcode-select >/dev/null 2>&1 || fail "Xcode Command Line Tools are missing."
xcode-select -p >/dev/null 2>&1 || fail "run 'xcode-select --install', then rerun this installer."

available_kib="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
required_kib=$((MIN_FREE_GIB * 1024 * 1024))
if (( available_kib < required_kib )); then
  available_gib=$((available_kib / 1024 / 1024))
  fail "the Electron package needs at least ${MIN_FREE_GIB} GiB free; only about ${available_gib} GiB is available."
fi

if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
    | /usr/bin/head -n 1)"
fi
if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="-"
fi

cd "$PROJECT_ROOT"

log "Installing exact JavaScript dependencies"
npm ci

log "Building the Electron renderer, Rust sidecar, and macOS directory package"
npm run build:electron

APP_SOURCE="$(/usr/bin/find "$RELEASE_ROOT" -maxdepth 3 -type d -name "$APP_NAME.app" -print -quit)"
[[ -n "$APP_SOURCE" && -d "$APP_SOURCE" ]] || fail "the build completed without producing $APP_NAME.app under $RELEASE_ROOT."

staging="/Applications/.LensQueryElectron.install.$$"
backup="/private/tmp/${APP_NAME// /-}.legacy.app.backup.$(date +%Y%m%d-%H%M%S)"
failed_install="/private/tmp/${APP_NAME// /-}.app.failed.$(date +%Y%m%d-%H%M%S)"
requires_sudo=0
[[ -w /Applications ]] || requires_sudo=1

run_install_command() {
  if (( requires_sudo )); then
    /usr/bin/sudo "$@"
  else
    "$@"
  fi
}

stop_existing_clients() {
  local patterns=(
    "$APP_DESTINATION/Contents/MacOS/LensQuery"
    "$APP_DESTINATION/Contents/MacOS/lensquery"
    "$LEGACY_PREVIEW_DESTINATION/Contents/MacOS/LensQuery Electron Preview"
  )
  local running=0
  for process_pattern in "${patterns[@]}"; do
    if /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1; then
      running=1
      /usr/bin/pkill -TERM -f "$process_pattern" 2>/dev/null || true
    fi
  done
  (( running == 1 )) || return 0
  log "Stopping installed LensQuery clients"
  for _ in 1 2 3 4 5 6 7 8; do
    running=0
    for process_pattern in "${patterns[@]}"; do
      /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 && running=1
    done
    (( running == 0 )) && return 0
    /bin/sleep 0.25
  done
  fail "quit every running LensQuery client, then rerun this installer."
}

install_bundle() {
  run_install_command /usr/bin/ditto "$APP_SOURCE" "$staging"
  run_install_command /usr/bin/xattr -dr com.apple.quarantine "$staging" 2>/dev/null || true
  run_install_command /usr/bin/codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" "$staging"
  local sidecar="$staging/Contents/Resources/sidecar/lensquery-core"
  if [[ -f "$sidecar" ]]; then
    # Keep the helper's designated requirement stable across builds. Without a
    # certificate-backed identifier macOS keys TCC to a changing CDHash and can
    # present the recording confirmation again after every update.
    run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
      --identifier "com.lensquery.desktop.electron-preview.sidecar" "$sidecar"
  fi
  local finder_extension="$staging/Contents/PlugIns/LensQuery Finder.appex"
  if [[ -d "$finder_extension" ]]; then
    run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
      --entitlements "$PROJECT_ROOT/native/macos/FinderIntegration/LensQueryFinder/LensQueryFinder.entitlements" \
      "$finder_extension"
  fi
  run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
    --identifier "$APP_BUNDLE_ID" "$staging"

  if [[ -e "$APP_DESTINATION" ]]; then
    run_install_command /bin/mv "$APP_DESTINATION" "$backup"
  fi
  if ! run_install_command /bin/mv "$staging" "$APP_DESTINATION"; then
    [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
    return 1
  fi
}

log "Replacing the legacy Tauri client with the Electron client"
if (( requires_sudo )); then
  /usr/bin/sudo -v
fi
stop_existing_clients
install_bundle

if ! /usr/bin/codesign --verify --deep --strict "$APP_DESTINATION"; then
  run_install_command /bin/mv "$APP_DESTINATION" "$failed_install" || true
  [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
  fail "the installed app did not pass code-signature validation."
fi

/usr/bin/open "$APP_DESTINATION" --args --background
launched=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if /usr/bin/pgrep -f "$APP_DESTINATION/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
    launched=1
    break
  fi
  /bin/sleep 0.25
done
if (( launched != 1 )); then
  [[ -e "$APP_DESTINATION" ]] && run_install_command /bin/mv "$APP_DESTINATION" "$failed_install"
  [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
  fail "$APP_NAME was installed but did not remain running; the previous app was restored."
fi

legacy_finder_extension="$LEGACY_PREVIEW_DESTINATION/Contents/PlugIns/LensQuery Finder.appex"
if [[ -d "$legacy_finder_extension" ]]; then
  /usr/bin/pluginkit -r "$legacy_finder_extension" 2>/dev/null || true
fi
if [[ -d "$LEGACY_PREVIEW_DESTINATION" ]]; then
  run_install_command /bin/rm -rf "$LEGACY_PREVIEW_DESTINATION"
fi

finder_extension="$APP_DESTINATION/Contents/PlugIns/LensQuery Finder.appex"
if [[ -d "$finder_extension" ]]; then
  /usr/bin/pluginkit -a "$finder_extension" 2>/dev/null || true
  /usr/bin/pluginkit -e use -i "$FINDER_EXTENSION_ID" 2>/dev/null || true
fi

"$PROJECT_ROOT/browser-extension/native-host/install-macos.sh" "$BROWSER_EXTENSION_ID" "$APP_DESTINATION"

# The removed Tauri bundle used a different TCC identity. Clear every permission
# record owned by that old identity so macOS no longer retains a second LensQuery.
/usr/bin/tccutil reset All "$OLD_APP_BUNDLE_ID" 2>/dev/null || true

if [[ -e "$backup" ]]; then
  run_install_command /bin/rm -rf "$backup"
fi

bundle_size="$(/usr/bin/du -sh "$APP_DESTINATION" | /usr/bin/awk '{ print $1 }')"
printf '\nInstalled: %s\n' "$APP_DESTINATION"
printf 'Bundle size: %s\n' "$bundle_size"
printf 'Legacy Tauri client: removed\n'
printf 'Legacy Electron preview path: removed\n'
if [[ "$SIGNING_IDENTITY" == "-" ]]; then
  printf 'Signature: local ad-hoc (macOS may ask for screen access again after an update).\n'
else
  printf 'Signature: %s\n' "$SIGNING_IDENTITY"
fi
printf 'Use the menu-bar icon or Command+Shift+Space to start recognition.\n'
printf 'Screen Recording entry: %s (%s).\n' "$APP_NAME" "$APP_DESTINATION"
[[ -d "$finder_extension" ]] && printf 'Finder right-click: enabled (%s).\n' "$FINDER_EXTENSION_ID"
printf 'Browser connector folder: %s\n' "$APP_DESTINATION/Contents/Resources/browser-extension"
