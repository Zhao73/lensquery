#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Skipping LensQuery Finder extension outside macOS.\n'
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="$PROJECT_ROOT/native/macos/FinderIntegration"
PROJECT_PATH="$SOURCE_ROOT/LensQueryFinder.xcodeproj"
OUTPUT_ROOT="$PROJECT_ROOT/build-native/macos"

command -v xcodegen >/dev/null 2>&1 || {
  printf 'xcodegen is required to build the Finder extension. Install it with: brew install xcodegen\n' >&2
  exit 1
}

mkdir -p "$OUTPUT_ROOT"
xcodegen generate --spec "$SOURCE_ROOT/project.yml" --project "$SOURCE_ROOT" >/dev/null
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "LensQuery Finder" \
  -configuration Release \
  -derivedDataPath "$SOURCE_ROOT/.derived-data" \
  CONFIGURATION_BUILD_DIR="$OUTPUT_ROOT" \
  CODE_SIGNING_ALLOWED=NO \
  build

test -d "$OUTPUT_ROOT/LensQuery Finder.appex"
printf 'Finder extension: %s\n' "$OUTPUT_ROOT/LensQuery Finder.appex"
