#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="LensQuery Electron Preview"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DESTINATION="/Applications/$APP_NAME.app"
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

staging="/Applications/.LensQueryElectronPreview.install.$$"
backup="/private/tmp/${APP_NAME// /-}.app.backup.$(date +%Y%m%d-%H%M%S)"
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

stop_existing_preview() {
  local process_pattern="$APP_DESTINATION/Contents/MacOS/$APP_NAME"
  /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 || return 0
  log "Stopping the installed Electron preview"
  /usr/bin/pkill -TERM -f "$process_pattern" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8; do
    /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 || return 0
    /bin/sleep 0.25
  done
  fail "quit the running Electron preview, then rerun this installer."
}

install_bundle() {
  run_install_command /usr/bin/ditto "$APP_SOURCE" "$staging"
  run_install_command /usr/bin/xattr -dr com.apple.quarantine "$staging" 2>/dev/null || true
  run_install_command /usr/bin/codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" "$staging"

  if [[ -e "$APP_DESTINATION" ]]; then
    run_install_command /bin/mv "$APP_DESTINATION" "$backup"
  fi
  if ! run_install_command /bin/mv "$staging" "$APP_DESTINATION"; then
    [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
    return 1
  fi
}

log "Installing the preview beside the existing /Applications/LensQuery.app"
if (( requires_sudo )); then
  /usr/bin/sudo -v
fi
stop_existing_preview
install_bundle

if ! /usr/bin/codesign --verify --deep --strict "$APP_DESTINATION"; then
  run_install_command /bin/mv "$APP_DESTINATION" "$failed_install" || true
  [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
  fail "the installed app did not pass code-signature validation."
fi

/usr/bin/open "$APP_DESTINATION"
launched=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if /usr/bin/pgrep -f "$APP_DESTINATION/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
    launched=1
    break
  fi
  /bin/sleep 0.25
done
(( launched == 1 )) || fail "$APP_NAME was installed but did not remain running."

bundle_size="$(/usr/bin/du -sh "$APP_DESTINATION" | /usr/bin/awk '{ print $1 }')"
printf '\nInstalled: %s\n' "$APP_DESTINATION"
printf 'Bundle size: %s\n' "$bundle_size"
printf 'Stable Tauri app preserved: /Applications/LensQuery.app\n'
[[ -e "$backup" ]] && printf 'Previous preview backup: %s\n' "$backup"
if [[ "$SIGNING_IDENTITY" == "-" ]]; then
  printf 'Signature: local ad-hoc (macOS may ask for screen access again after an update).\n'
else
  printf 'Signature: %s\n' "$SIGNING_IDENTITY"
fi
printf 'Use the menu-bar icon or Command+Shift+Space to start recognition.\n'
