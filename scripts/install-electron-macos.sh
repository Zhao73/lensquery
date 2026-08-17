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
REPOSITORY_SLUG="Zhao73/what-is-it"
REPOSITORY_URL="https://github.com/$REPOSITORY_SLUG"
INSTALL_TMP_ROOT="${TMPDIR:-/private/tmp}"
INSTALL_LOG="${INSTALL_TMP_ROOT%/}/lensquery-install.$$.log"
TOTAL_STAGES=6
CURRENT_STAGE=0

UI_LANGUAGE="${LENSQUERY_INSTALLER_LANG:-auto}"
if [[ "$UI_LANGUAGE" == "auto" ]]; then
  preferred_languages="$(/usr/bin/defaults read -g AppleLanguages 2>/dev/null | /usr/bin/head -n 3 || true)"
  if [[ "$preferred_languages" == *"zh-Hans"* || "$preferred_languages" == *"zh_CN"* ]]; then
    UI_LANGUAGE="zh"
  else
    UI_LANGUAGE="en"
  fi
fi

ui_text() {
  if [[ "$UI_LANGUAGE" == "zh" ]]; then
    printf '%s' "$2"
  else
    printf '%s' "$1"
  fi
}

UI_BOLD=""
UI_DIM=""
UI_BLUE=""
UI_GREEN=""
UI_AMBER=""
UI_RED=""
UI_RESET=""
if [[ -t 1 && "${TERM:-dumb}" != "dumb" && -z "${NO_COLOR:-}" ]]; then
  UI_BOLD=$'\033[1m'
  UI_DIM=$'\033[2m'
  UI_BLUE=$'\033[38;5;75m'
  UI_GREEN=$'\033[38;5;78m'
  UI_AMBER=$'\033[38;5;214m'
  UI_RED=$'\033[38;5;203m'
  UI_RESET=$'\033[0m'
fi

ui_rule() {
  local width=68
  local detected=""
  if [[ -t 1 ]]; then
    detected="$(/usr/bin/tput cols 2>/dev/null || true)"
    if [[ "$detected" =~ ^[0-9]+$ ]] && (( detected > 0 && detected < width + 4 )); then
      width=$((detected - 4))
    fi
  fi
  (( width < 32 )) && width=32
  local rule
  printf -v rule '%*s' "$width" ''
  rule="${rule// /─}"
  printf '  %b%s%b\n' "$UI_DIM" "$rule" "$UI_RESET"
}

ui_pair() {
  local label="$1"
  local value="$2"
  if (( ${#value} > 48 )); then
    printf '  %b%s%b\n' "$UI_DIM" "$label" "$UI_RESET"
    printf '    %s\n' "$value"
  elif [[ "$UI_LANGUAGE" == "zh" ]]; then
    printf '  %s：%s\n' "$label" "$value"
  else
    printf '  %-16s %s\n' "$label" "$value"
  fi
}

ui_banner() {
  printf '\n  %b%bLensQuery%b  %s\n' "$UI_BLUE" "$UI_BOLD" "$UI_RESET" \
    "$(ui_text "Desktop installer" "桌面安装程序")"
  printf '  %b%s%b\n' "$UI_DIM" \
    "$(ui_text "Ask anything visible. Keep the desktop in context." "一键选择屏幕内容，在原处获取答案。")" "$UI_RESET"
  ui_rule
  ui_pair "$(ui_text "Destination" "安装位置")" "$APP_DESTINATION"
  ui_pair "$(ui_text "Shortcut" "快捷键")" "Command + Shift + Space"
}

ui_stage() {
  local title="$1"
  local detail="${2:-}"
  CURRENT_STAGE=$((CURRENT_STAGE + 1))
  printf '\n  %b%02d/%02d%b  %b%s%b\n' \
    "$UI_BLUE" "$CURRENT_STAGE" "$TOTAL_STAGES" "$UI_RESET" \
    "$UI_BOLD" "$title" "$UI_RESET"
  [[ -n "$detail" ]] && printf '         %b%s%b\n' "$UI_DIM" "$detail" "$UI_RESET"
}

ui_status() {
  local state="$1"
  local label="$2"
  local value="${3:-}"
  local marker="INFO"
  local color="$UI_DIM"
  case "$state" in
    ok) marker="OK"; color="$UI_GREEN" ;;
    next) marker="NEXT"; color="$UI_AMBER" ;;
    wait) marker="WAIT"; color="$UI_BLUE" ;;
    fail) marker="FAIL"; color="$UI_RED" ;;
  esac
  if [[ "$UI_LANGUAGE" == "zh" ]]; then
    printf '         %b%-5s%b %s：%s\n' "$color" "$marker" "$UI_RESET" "$label" "$value"
  else
    printf '         %b%-5s%b %-17s %s\n' "$color" "$marker" "$UI_RESET" "$label" "$value"
  fi
}

run_task() {
  local label="$1"
  shift
  printf '\n[%s]\n$' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" >>"$INSTALL_LOG"
  printf ' %q' "$@" >>"$INSTALL_LOG"
  printf '\n' >>"$INSTALL_LOG"

  "$@" >>"$INSTALL_LOG" 2>&1 &
  local task_pid=$!
  local frames=('|' '/' '-' '\')
  local frame_index=0
  if [[ -t 1 && "${TERM:-dumb}" != "dumb" ]]; then
    while /bin/kill -0 "$task_pid" 2>/dev/null; do
      printf '\r\033[2K         %b%-5s%b %-17s %s' \
        "$UI_BLUE" "${frames[$((frame_index % 4))]}" "$UI_RESET" "$label" \
        "$(ui_text "working" "处理中")"
      frame_index=$((frame_index + 1))
      /bin/sleep 0.12
    done
    printf '\r\033[2K'
  else
    ui_status wait "$label" "$(ui_text "working" "处理中")"
  fi

  local task_status=0
  if wait "$task_pid"; then
    ui_status ok "$label" "$(ui_text "complete" "完成")"
    return 0
  else
    task_status=$?
  fi

  ui_status fail "$label" "exit $task_status"
  printf '\n  %b%s%b\n' "$UI_BOLD" \
    "$(ui_text "Last build output" "最后的构建输出")" "$UI_RESET" >&2
  /usr/bin/tail -n 28 "$INSTALL_LOG" >&2 || true
  return "$task_status"
}

fail() {
  printf '\n' >&2
  ui_rule >&2
  printf '  %b%b%s%b\n' "$UI_RED" "$UI_BOLD" \
    "$(ui_text "Installation stopped" "安装已停止")" "$UI_RESET" >&2
  printf '  %s\n' "$1" >&2
  [[ -s "$INSTALL_LOG" ]] && printf '  %s: %s\n' "$(ui_text "Log" "日志")" "$INSTALL_LOG" >&2
  exit 1
}

show_finish_actions() {
  ui_rule
  printf '  %b%s%b\n' "$UI_BOLD" "$(ui_text "Next actions" "下一步")" "$UI_RESET"
  ui_pair "$(ui_text "Chrome setup" "Chrome 配置")" \
    "$(ui_text "open chrome://extensions and load the packaged connector" "打开 chrome://extensions，加载已打包的连接器")"
  ui_pair "GitHub" "$REPOSITORY_URL"

  local repository_state=""
  local already_starred=0
  if command -v gh >/dev/null 2>&1; then
    repository_state="$(GH_PROMPT_DISABLED=1 GH_HTTP_TIMEOUT=5 \
      gh repo view "$REPOSITORY_SLUG" --json viewerHasStarred,stargazerCount \
      --jq '[.viewerHasStarred, .stargazerCount] | @tsv' 2>/dev/null || true)"
  fi
  if [[ "$repository_state" == true$'\t'* ]]; then
    already_starred=1
    ui_status ok "GitHub Star" \
      "$(ui_text "already starred · ${repository_state#*$'\t'} total" "已点赞 · 共 ${repository_state#*$'\t'} 个 Star")"
  fi

  if [[ ! -t 0 || ! -t 1 || -n "${CI:-}" || "${LENSQUERY_INSTALLER_NONINTERACTIVE:-0}" == "1" ]]; then
    ui_pair "$(ui_text "Chrome command" "Chrome 命令")" \
      "open -a 'Google Chrome' 'chrome://extensions'"
    (( already_starred == 1 )) \
      || ui_pair "$(ui_text "Star command" "点赞命令")" \
        "gh api --method PUT /user/starred/$REPOSITORY_SLUG"
    return 0
  fi

  while true; do
    printf '\n  %b[C]%b %s' "$UI_BLUE" "$UI_RESET" \
      "$(ui_text "Configure Chrome" "配置 Chrome")"
    if (( already_starred == 0 )); then
      printf '  %b[S]%b %s' "$UI_BLUE" "$UI_RESET" \
        "$(ui_text "Star on GitHub" "在 GitHub 点赞")"
    fi
    printf '  %b[Enter]%b %s  ' "$UI_DIM" "$UI_RESET" "$(ui_text "Finish" "完成")"

    local answer=""
    IFS= read -r -n 1 answer || true
    printf '\n'
    case "$answer" in
      c|C)
        printf '%s' "$APP_DESTINATION/Contents/Resources/browser-extension" | /usr/bin/pbcopy
        /usr/bin/open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1 || true
        ui_status next "$(ui_text "Chrome setup" "Chrome 配置")" \
          "$(ui_text "page opened · connector path copied" "页面已打开 · 连接器路径已复制")"
        ;;
      s|S)
        if (( already_starred == 1 )); then
          ui_status ok "GitHub Star" "$(ui_text "already starred" "已点赞")"
        elif command -v gh >/dev/null 2>&1 \
          && GH_PROMPT_DISABLED=1 gh auth status >/dev/null 2>&1 \
          && GH_PROMPT_DISABLED=1 GH_HTTP_TIMEOUT=8 gh api --method PUT "/user/starred/$REPOSITORY_SLUG" >/dev/null 2>&1; then
          repository_state="$(GH_PROMPT_DISABLED=1 GH_HTTP_TIMEOUT=5 \
            gh repo view "$REPOSITORY_SLUG" --json stargazerCount \
            --jq '.stargazerCount' 2>/dev/null || true)"
          already_starred=1
          ui_status ok "GitHub Star" \
            "$(ui_text "added${repository_state:+ · $repository_state total}" "已点赞${repository_state:+ · 共 $repository_state 个 Star}")"
        else
          /usr/bin/open "$REPOSITORY_URL" >/dev/null 2>&1 || true
          ui_status next "GitHub Star" \
            "$(ui_text "repository opened in your browser" "仓库已在浏览器中打开")"
        fi
        ;;
      *)
        ui_status ok "$(ui_text "Installer" "安装程序")" "$(ui_text "finished" "已完成")"
        return 0
        ;;
    esac
  done
}

show_preview() {
  ui_banner
  ui_stage "$(ui_text "Preflight" "安装检查")" \
    "$(ui_text "Checking the machine before any files change" "更改文件前先检查当前 Mac")"
  ui_status ok "$(ui_text "Platform" "系统")" "macOS 15 · arm64"
  ui_status ok "$(ui_text "Toolchain" "工具链")" "Node.js · Rust · Xcode tools"
  ui_status ok "$(ui_text "Disk" "磁盘空间")" "$(ui_text "48 GiB available" "可用 48 GiB")"
  ui_stage "$(ui_text "Dependencies" "依赖")" \
    "$(ui_text "Using the lockfile for a reproducible install" "按锁定文件安装，确保结果可复现")"
  ui_status ok "$(ui_text "JavaScript packages" "JavaScript 依赖")" "$(ui_text "complete" "完成")"
  ui_stage "$(ui_text "Build" "构建")" \
    "$(ui_text "Renderer, native sidecar, and Finder integration" "渲染器、本地辅助程序与 Finder 集成")"
  ui_status ok "$(ui_text "Electron package" "Electron 安装包")" "$(ui_text "complete" "完成")"
  ui_stage "$(ui_text "Install" "安装")" \
    "$(ui_text "Replacing only the existing LensQuery bundle" "仅替换现有 LensQuery 应用")"
  ui_status ok "$(ui_text "Application" "应用")" "$APP_DESTINATION"
  ui_status ok "$(ui_text "Code signature" "代码签名")" "$(ui_text "verified" "已验证")"
  ui_stage "$(ui_text "Launch" "启动")" \
    "$(ui_text "Starting the resident process in the background" "在后台启动驻留进程")"
  ui_status ok "$(ui_text "Menu-bar process" "菜单栏进程")" "$(ui_text "running" "运行中")"
  ui_stage "$(ui_text "Integrations" "系统集成")" \
    "$(ui_text "Connecting files and browser context" "连接文件与浏览器上下文")"
  ui_status ok "$(ui_text "Finder action" "Finder 操作")" "$(ui_text "enabled" "已启用")"
  ui_status ok "$(ui_text "Browser bridge" "浏览器桥接")" "Chrome · Edge · Brave · Chromium"
  ui_status next "$(ui_text "Chrome extension" "Chrome 扩展")" \
    "$(ui_text "one-time activation required" "需要一次激活")"
  printf '\n  %b%b%s%b\n' "$UI_GREEN" "$UI_BOLD" "$(ui_text "Ready" "安装完成")" "$UI_RESET"
  ui_rule
  ui_pair "$(ui_text "Start" "启动方式")" \
    "$(ui_text "menu bar or Command + Shift + Space" "菜单栏或 Command + Shift + Space")"
  ui_pair "$(ui_text "Browser files" "浏览器扩展文件")" \
    "$APP_DESTINATION/Contents/Resources/browser-extension"
  show_finish_actions
}

if [[ "${1:-}" == "--preview-terminal" ]]; then
  show_preview
  exit 0
fi

: >"$INSTALL_LOG"
ui_banner
ui_stage "$(ui_text "Preflight" "安装检查")" \
  "$(ui_text "Checking the machine before any files change" "更改文件前先检查当前 Mac")"

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
available_gib=$((available_kib / 1024 / 1024))

if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
    | /usr/bin/head -n 1)"
fi
if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="-"
fi

ui_status ok "$(ui_text "Platform" "系统")" \
  "$(/usr/bin/sw_vers -productVersion) · $(/usr/bin/uname -m)"
ui_status ok "$(ui_text "Toolchain" "工具链")" \
  "Node $(node --version) · $(cargo --version | /usr/bin/awk '{ print $2 }')"
ui_status ok "$(ui_text "Disk" "磁盘空间")" \
  "$(ui_text "${available_gib} GiB available" "可用 ${available_gib} GiB")"
if [[ "$SIGNING_IDENTITY" == "-" ]]; then
  ui_status next "$(ui_text "Signing" "签名")" \
    "$(ui_text "local ad-hoc; permissions may repeat after updates" "本地临时签名；升级后可能需重新授权")"
else
  ui_status ok "$(ui_text "Signing" "签名")" "$SIGNING_IDENTITY"
fi

cd "$PROJECT_ROOT"

ui_stage "$(ui_text "Dependencies" "依赖")" \
  "$(ui_text "Using the lockfile for a reproducible install" "按锁定文件安装，确保结果可复现")"
run_task "$(ui_text "JavaScript packages" "JavaScript 依赖")" npm ci --no-audit --no-fund \
  || fail "dependency installation failed."

ui_stage "$(ui_text "Build" "构建")" \
  "$(ui_text "Renderer, native sidecar, Finder integration, and app bundle" "渲染器、本地辅助程序、Finder 集成与应用包")"
run_task "$(ui_text "Electron package" "Electron 安装包")" npm run build:electron \
  || fail "the Electron build failed."

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
  ui_status wait "$(ui_text "Running client" "正在运行的客户端")" \
    "$(ui_text "stopping cleanly" "正在安全停止")"
  for _ in 1 2 3 4 5 6 7 8; do
    running=0
    for process_pattern in "${patterns[@]}"; do
      /usr/bin/pgrep -f "$process_pattern" >/dev/null 2>&1 && running=1
    done
    if (( running == 0 )); then
      ui_status ok "$(ui_text "Running client" "正在运行的客户端")" \
        "$(ui_text "stopped" "已停止")"
      return 0
    fi
    /bin/sleep 0.25
  done
  fail "quit every running LensQuery client, then rerun this installer."
}

install_bundle() {
  run_install_command /usr/bin/ditto "$APP_SOURCE" "$staging" >>"$INSTALL_LOG" 2>&1 || return 1
  run_install_command /usr/bin/xattr -dr com.apple.quarantine "$staging" >>"$INSTALL_LOG" 2>&1 || true
  run_install_command /usr/bin/codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" \
    "$staging" >>"$INSTALL_LOG" 2>&1 || return 1
  local sidecar="$staging/Contents/Resources/sidecar/lensquery-core"
  if [[ -f "$sidecar" ]]; then
    # Keep the helper's designated requirement stable across builds. Without a
    # certificate-backed identifier macOS keys TCC to a changing CDHash and can
    # present the recording confirmation again after every update.
    run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
      --identifier "com.lensquery.desktop.electron-preview.sidecar" "$sidecar" \
      >>"$INSTALL_LOG" 2>&1 || return 1
  fi
  local finder_extension="$staging/Contents/PlugIns/LensQuery Finder.appex"
  if [[ -d "$finder_extension" ]]; then
    run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
      --entitlements "$PROJECT_ROOT/native/macos/FinderIntegration/LensQueryFinder/LensQueryFinder.entitlements" \
      "$finder_extension" >>"$INSTALL_LOG" 2>&1 || return 1
  fi
  run_install_command /usr/bin/codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" \
    --identifier "$APP_BUNDLE_ID" "$staging" >>"$INSTALL_LOG" 2>&1 || return 1

  if [[ -e "$APP_DESTINATION" ]]; then
    run_install_command /bin/mv "$APP_DESTINATION" "$backup" >>"$INSTALL_LOG" 2>&1 || return 1
  fi
  if ! run_install_command /bin/mv "$staging" "$APP_DESTINATION" >>"$INSTALL_LOG" 2>&1; then
    [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
    return 1
  fi
}

ui_stage "$(ui_text "Install" "安装")" \
  "$(ui_text "Replacing only the existing LensQuery bundle" "仅替换现有 LensQuery 应用")"
if (( requires_sudo )); then
  ui_status next "$(ui_text "Administrator" "管理员权限")" \
    "$(ui_text "macOS will ask once" "macOS 将询问一次")"
  /usr/bin/sudo -v
fi
stop_existing_clients
install_bundle || fail "the app bundle could not be copied or signed; the previous installation remains available."
ui_status ok "$(ui_text "Application" "应用")" "$APP_DESTINATION"

if ! /usr/bin/codesign --verify --deep --strict "$APP_DESTINATION"; then
  run_install_command /bin/mv "$APP_DESTINATION" "$failed_install" || true
  [[ -e "$backup" ]] && run_install_command /bin/mv "$backup" "$APP_DESTINATION"
  fail "the installed app did not pass code-signature validation."
fi
ui_status ok "$(ui_text "Code signature" "代码签名")" "$(ui_text "verified" "已验证")"

ui_stage "$(ui_text "Launch" "启动")" \
  "$(ui_text "Starting the resident process in the background" "在后台启动驻留进程")"
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
ui_status ok "$(ui_text "Menu-bar process" "菜单栏进程")" "$(ui_text "running" "运行中")"

ui_stage "$(ui_text "Integrations" "系统集成")" \
  "$(ui_text "Connecting files and browser context" "连接文件与浏览器上下文")"
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
  ui_status ok "$(ui_text "Finder action" "Finder 操作")" "$(ui_text "enabled" "已启用")"
else
  ui_status next "$(ui_text "Finder action" "Finder 操作")" \
    "$(ui_text "not packaged in this build" "当前构建未包含")"
fi

run_task "$(ui_text "Browser bridge" "浏览器桥接")" \
  "$PROJECT_ROOT/browser-extension/native-host/install-macos.sh" "$BROWSER_EXTENSION_ID" "$APP_DESTINATION" \
  || fail "the browser Native Messaging bridge could not be installed."
ui_status next "$(ui_text "Chrome extension" "Chrome 扩展")" \
  "$(ui_text "one-time activation required" "需要一次激活")"

# The removed Tauri bundle used a different TCC identity. Clear every permission
# record owned by that old identity so macOS no longer retains a second LensQuery.
/usr/bin/tccutil reset All "$OLD_APP_BUNDLE_ID" >/dev/null 2>&1 || true

if [[ -e "$backup" ]]; then
  run_install_command /bin/rm -rf "$backup"
fi

bundle_size="$(/usr/bin/du -sh "$APP_DESTINATION" | /usr/bin/awk '{ print $1 }')"
printf '\n  %b%b%s%b\n' "$UI_GREEN" "$UI_BOLD" "$(ui_text "Ready" "安装完成")" "$UI_RESET"
ui_rule
ui_pair "$(ui_text "Application" "应用")" "$APP_DESTINATION"
ui_pair "$(ui_text "Bundle size" "应用大小")" "$bundle_size"
ui_pair "$(ui_text "Start" "启动方式")" \
  "$(ui_text "menu bar or Command + Shift + Space" "菜单栏或 Command + Shift + Space")"
if [[ "$SIGNING_IDENTITY" == "-" ]]; then
  ui_pair "$(ui_text "Signature" "签名")" "$(ui_text "local ad-hoc" "本地临时签名")"
else
  ui_pair "$(ui_text "Signature" "签名")" "$SIGNING_IDENTITY"
fi
ui_pair "$(ui_text "Screen access" "屏幕权限")" \
  "$(ui_text "LensQuery · requested on first capture" "LensQuery · 首次识别时申请")"
ui_pair "$(ui_text "Browser files" "浏览器扩展文件")" \
  "$APP_DESTINATION/Contents/Resources/browser-extension"
ui_pair "$(ui_text "Install log" "安装日志")" "$INSTALL_LOG"

show_finish_actions
