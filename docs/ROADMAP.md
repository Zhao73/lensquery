# Roadmap

## 0.1 Foundation

- [x] Product and implementation specification
- [x] Tauri/React/Rust repository scaffold
- [x] Main application shell and provider-independent contracts
- [x] Browser-safe mock bridge for interface development
- [x] Core CI checks

## 0.2 Capture preview

- [x] Tray/menu bar and global shortcut
- [x] Hidden main window and capture overlay
- [x] Click/drag/keyboard region UX
- [x] Windows and macOS region capture backend
- [x] Windows UI Automation and macOS Accessibility click inspection baseline
- [x] Configurable outbound-data preview

## 0.3 Model connections

- [x] Credential vault
- [ ] OpenAI Responses
- [ ] Anthropic Messages
- [ ] OpenAI-compatible endpoints
- [x] Bounded Codex CLI, Claude Code, OpenCode, and Grok compatibility adapters
- [ ] App Server/SDK streaming, cancel, native session retry, and normalized errors

## 0.4 Documents and workflow

- [x] Image, machine-readable PDF, text, and code file ingestion
- [x] Video classification and provider-independent evidence contract
- [x] Local FFprobe metadata and bounded FFmpeg keyframe/audio preparation
- [x] Timestamped keyframe gallery
- [ ] Audio-transcription transport
- [x] Customer-answer prompt template and configurable output contracts
- [x] Native result notification, conversation timeline, Markdown, speech, and follow-up
- [x] Local history and capture-retention controls
- [ ] Explorer integration

## 1.0 Windows release

- [ ] Mixed-DPI/multi-monitor test matrix
- [ ] Accessibility and high-contrast verification
- [ ] Privacy/security review
- [ ] Installer smoke tests
- [ ] Maintainer signing and GitHub release workflow

## Later

- Browser Native Messaging installer manifests and optional DevTools/CDP source inspection
- macOS Accessibility permission UX and richer character-range geometry
- Codex App Server threads; Realtime Voice only after an eligible realtime thread route is available
- Offline OCR and local-model adapters
- Scene-change-aware video sampling and bundled verified FFmpeg sidecar
- Organization-managed policies
