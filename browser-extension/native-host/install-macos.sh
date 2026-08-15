#!/usr/bin/env bash

set -Eeuo pipefail

EXTENSION_ID="${1:-}"
if [[ -n "${2:-}" ]]; then
  LENSQUERY_APP="$2"
elif [[ -d "/Applications/LensQuery Electron Preview.app" ]]; then
  LENSQUERY_APP="/Applications/LensQuery Electron Preview.app"
else
  LENSQUERY_APP="/Applications/LensQuery.app"
fi
INSTALL_DIR="$HOME/Library/Application Support/LensQuery/NativeMessaging"
HOST_NAME="com.lensquery.desktop"
HOST_WRAPPER="$INSTALL_DIR/lensquery-native-host"

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  printf 'Usage: %s EXTENSION_ID [/Applications/LensQuery.app]\n' "$0" >&2
  printf 'Copy the 32-character ID from chrome://extensions after loading browser-extension.\n' >&2
  exit 2
fi

executable_candidates=(
  "$LENSQUERY_APP/Contents/Resources/sidecar/lensquery-core"
  "$LENSQUERY_APP/Contents/MacOS/lensquery"
)
LENSQUERY_EXE=""
for candidate in "${executable_candidates[@]}"; do
  if [[ -x "$candidate" ]]; then
    LENSQUERY_EXE="$candidate"
    break
  fi
done
if [[ -z "$LENSQUERY_EXE" ]]; then
  printf 'LensQuery native messaging executable not found inside: %s\n' "$LENSQUERY_APP" >&2
  exit 1
fi

/bin/mkdir -p "$INSTALL_DIR"
/usr/bin/python3 - "$HOST_WRAPPER" "$LENSQUERY_EXE" <<'PY'
import pathlib
import shlex
import sys

wrapper = pathlib.Path(sys.argv[1])
executable = sys.argv[2]
wrapper.write_text(f"#!/bin/sh\nexec {shlex.quote(executable)} --native-messaging-host\n")
PY
/bin/chmod 700 "$HOST_WRAPPER"

browser_roots=(
  "$HOME/Library/Application Support/Google/Chrome"
  "$HOME/Library/Application Support/Microsoft Edge"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
  "$HOME/Library/Application Support/Chromium"
)

installed=0
for browser_root in "${browser_roots[@]}"; do
  manifest_dir="$browser_root/NativeMessagingHosts"
  manifest_path="$manifest_dir/$HOST_NAME.json"
  /bin/mkdir -p "$manifest_dir"
  /usr/bin/python3 - "$manifest_path" "$HOST_WRAPPER" "$EXTENSION_ID" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "name": "com.lensquery.desktop",
    "description": "LensQuery browser-to-desktop context bridge",
    "path": sys.argv[2],
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{sys.argv[3]}/"],
}
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
  /bin/chmod 600 "$manifest_path"
  printf 'Installed: %s\n' "$manifest_path"
  installed=$((installed + 1))
done

printf 'Native Messaging host ready for extension %s in %d browser profiles.\n' "$EXTENSION_ID" "$installed"
printf 'Restart the browser or reload LensQuery Web Connector once.\n'
