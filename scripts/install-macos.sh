#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="LensQuery"
MIN_FREE_GIB=12
WARM_BUILD_MIN_FREE_GIB=4
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SOURCE="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"
APP_DESTINATION="/Applications/$APP_NAME.app"

log() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf '\nLensQuery installation stopped: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer is for macOS."
command -v npm >/dev/null 2>&1 || fail "Node.js/npm is missing. Install Node.js 20 or newer first."
command -v cargo >/dev/null 2>&1 || fail "Rust/Cargo is missing. Install Rust stable first."
command -v xcode-select >/dev/null 2>&1 || fail "Xcode Command Line Tools are missing."
xcode-select -p >/dev/null 2>&1 || fail "run 'xcode-select --install', then rerun this installer."

required_free_gib=$MIN_FREE_GIB
if [[ -x "$PROJECT_ROOT/src-tauri/target/release/lensquery" && -d "$APP_SOURCE" ]]; then
  required_free_gib=$WARM_BUILD_MIN_FREE_GIB
fi

available_kib="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
required_kib=$((required_free_gib * 1024 * 1024))
if (( available_kib < required_kib )); then
  available_gib=$((available_kib / 1024 / 1024))
  fail "this Rust build needs at least ${required_free_gib} GiB free; only about ${available_gib} GiB is available. Remove regenerable build caches such as src-tauri/target, then retry."
fi

cd "$PROJECT_ROOT"

log "Installing exact JavaScript dependencies"
npm ci

log "Building the macOS app and DMG"
npm run tauri build -- --bundles app,dmg

[[ -d "$APP_SOURCE" ]] || fail "the build completed without producing $APP_SOURCE"

staging="/Applications/.${APP_NAME}.install.$$"
backup="/private/tmp/${APP_NAME}.app.backup.$(date +%Y%m%d-%H%M%S)"
failed_install="/private/tmp/${APP_NAME}.app.failed.$(date +%Y%m%d-%H%M%S)"
requires_sudo=0
[[ -w /Applications ]] || requires_sudo=1

run_install_command() {
  if (( requires_sudo )); then
    /usr/bin/sudo "$@"
  else
    "$@"
  fi
}

stop_existing_app() {
  local process_pattern="$APP_DESTINATION/Contents/MacOS/lensquery"

  /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 || return 0
  log "Stopping the installed $APP_NAME process"
  /usr/bin/pkill -TERM -f "$process_pattern" 2>/dev/null || true

  for _ in 1 2 3 4 5 6 7 8; do
    /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 || return 0
    /bin/sleep 0.25
  done

  fail "quit the running $APP_NAME app, then rerun this installer."
}

install_bundle() {
  run_install_command /usr/bin/ditto "$APP_SOURCE" "$staging"
  run_install_command /usr/bin/xattr -dr com.apple.quarantine "$staging" 2>/dev/null || true
  run_install_command /usr/bin/codesign --force --deep --sign - "$staging"

  if [[ -e "$APP_DESTINATION" ]]; then
    run_install_command /bin/mv "$APP_DESTINATION" "$backup"
  fi

  if ! run_install_command /bin/mv "$staging" "$APP_DESTINATION"; then
    [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
    return 1
  fi
}

log "Installing $APP_NAME into /Applications"
if (( requires_sudo )); then
  /usr/bin/sudo -v
fi
stop_existing_app
install_bundle

if ! /usr/bin/codesign --verify --deep --strict "$APP_DESTINATION"; then
  run_install_command /bin/mv "$APP_DESTINATION" "$failed_install" || true
  [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
  fail "the installed app did not pass code-signature validation."
fi

/usr/bin/open "$APP_DESTINATION"

launched=0
for _ in 1 2 3 4 5 6 7 8; do
  if /usr/bin/pgrep -f "$APP_DESTINATION/Contents/MacOS/lensquery" >/dev/null 2>&1; then
    launched=1
    break
  fi
  /bin/sleep 0.25
done
(( launched == 1 )) || fail "$APP_NAME was installed but did not remain running."

printf '\nInstalled: %s\n' "$APP_DESTINATION"
printf 'DMG: %s\n' "$PROJECT_ROOT/src-tauri/target/release/bundle/dmg"
[[ -e "$backup" ]] && printf 'Previous version backup: %s\n' "$backup"
printf 'LensQuery now runs from the menu bar. Press Command+Shift+Space to start.\n'
