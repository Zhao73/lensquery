# LensQuery implementation plan

## Release definition

The release is successful when a Windows user can leave LensQuery in the tray, press one shortcut from another application, click an object or drag a region, receive an automatic answer, and continue that answer in a local conversation timeline.

## Milestones and current state

### M0 — Repository and contracts: complete

- Electron, Rust sidecar, React, TypeScript, Vite, tests, CI, MIT license; legacy Tauri shell retained as a capture fallback.
- Provider-independent capture, browser context, file, video, request, result, and session contracts.
- Local discovery for Codex, Claude Code, OpenCode, and Grok executables.

### M1 — Electron resident shortcut shell: implemented, packaged permission verification pending

- Hidden-at-login resident process with a template menu-bar/tray mark.
- Left-click Quick Ask plus a distilled right-click menu: Start, Analyze Files, Timeline, Settings, and Quit.
- Main-window close hides to tray.
- Configurable global shortcut registration in Electron, with rollback to the previous shortcut if a new accelerator is occupied.
- Separate transparent all-monitor capture overlay whose document/root canvas is explicitly transparent.
- Transparent desktop, small question-mark cursor, real-target first-click highlight, second-click confirmation, drag threshold, Escape cancellation, and configured analysis intent.
- Permission-independent upper-right result card, card/window/both result presentation, autostart preference, and system speech.

macOS compilation is verified locally. Windows behavior must still be exercised on physical Windows 10/11, especially mixed-DPI coordinates and tray lifecycle.

### M2 — Native capture: implemented macOS ownership fix, Windows QA pending

- XCap region capture to a temporary PNG.
- Packaged macOS Electron capture through the resident `desktopCapturer` identity, with scale-aware cropping; Accessibility inspection receives Electron monitor bounds and does not invoke helper screen capture.
- One-request-per-run permission gate plus stable certificate-backed sidecar identifier, preventing repeated allow/deny prompts from an ephemeral helper identity.
- Windows UI Automation `ElementFromPoint` lookup for name, role, class, AutomationId, and bounding rectangle.
- Pixel fallback when UI Automation exposes nothing useful.
- Automatic confirmed evidence event into the background conversation pipeline without a client confirmation page; macOS document URLs are promoted to PDF/image/video/file evidence after explicit two-click confirmation.

Remaining: multi-monitor mixed-DPI test matrix, protected/elevated-surface errors, capture-retention cleanup, and optional frozen-snapshot rendering so dynamic content does not move while dragging.

### M3 — Conversation workbench: implemented

- No upload/dashboard homepage.
- Searchable local timeline, source metadata, answer states, semantic Markdown, copy/read-aloud/retry, deletion, and clear history.
- Same-session follow-up with transcript context.
- Inline per-session provider/model, reasoning-effort, and automatic/compact/full/evidence-only history controls.
- Six analysis modes, six output contracts, and optional annotations.
- Plain Windows/macOS/Codex-like workbench styling with system typography and one action color.
- Persistent coding-agent-style sidebar, centered new-conversation composer, provider chip, and dedicated Plugins/Skills capability view.

Remaining: replace transcript replay with native thread IDs when Codex App Server/OpenCode adapters land; add token streaming and cancellation.

### M4 — Plugins and Skills: implemented declarative baseline

- Local-folder and Git installation for LensQuery plugins and Codex-compatible Skills.
- Discovery of managed `~/.codex/skills` and read-only `~/.agents/skills`.
- Enable/disable, rescan, open-location, recoverable Trash removal, package metadata, and compatibility/permission display.
- Secure copy boundaries: no symbolic links, dependency/VCS skips, 800-file / 32-MB package limit.
- Enabled Markdown instruction injection bounded per item and per request; no arbitrary extension code execution.
- GitHub monorepo subdirectory installation plus a reviewed catalog that records source/license and leaves script-bearing workflows disabled.

Remaining: signed catalog metadata, dependency/version resolution, per-session capability selection, and audited executable extension APIs if later required.

### M4.5 — Direct provider catalog: implemented Electron baseline

- Searchable categories for local agents, cloud APIs, local models, and custom endpoints.
- Built-in profiles for OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter, Groq Cloud, Mistral, Together, Fireworks, SiliconFlow, Ollama, and LM Studio.
- Working Anthropic Messages and OpenAI-compatible Chat Completions transports with real connection tests, safeStorage secrets, HTTPS enforcement for remote hosts, bounded text/images, and removable custom profiles.

Remaining: OpenAI Responses/file-upload/audio endpoints, streaming and cancellation, provider-specific capability probes, and opt-in live integration fixtures.

### M5 — Agent runtime adapters: next

The bounded Codex CLI fallback is packaged and runtime-verified: it prefers the native binary, uses low reasoning effort for fast identify/summary requests, isolates LensQuery state from the user's Codex history database, preserves existing config/auth references, captures useful timeout diagnostics, and kills the full process tree. Installed macOS acceptance produced client-visible ordinary-photo, trusted-C2PA AI-image, timestamped short-video results, and a whole-ledger long-video path. Long videos use local sidecar/Whisper transcripts, at most 12 chronological chapters, and extended but bounded analysis timeouts; captionless YouTube imports use an explicit bounded local yt-dlp path.

1. Implement a long-lived `codex app-server --stdio` JSON-RPC client.
2. Generate schemas from the installed Codex version at build/test time.
3. Map LensQuery session IDs to Codex thread IDs; use `thread/start`, `thread/resume`, `turn/start`, item deltas, and `turn/completed`.
4. Add OpenCode Server/SDK adapter with session and SSE mapping.
5. Add ACP adapter for compatible agents.
6. Retain bounded headless CLI invocation as the compatibility fallback.

Acceptance: follow-ups append to the original agent session without replaying the entire transcript, partial output streams into the timeline, and approvals remain visible/user-controlled.

### M6 — Browser connector: right-click actions, picker, and native host implemented

- MV3 extension manifest.
- Native context-menu actions for selected text, images, videos, and the current page.
- Shortcut/action starts an in-page pointer picker.
- Click extraction for selection/word/paragraph/page/object text, button/link roles, images, video/audio state, selector, nearby text, sanitized outer HTML, URL, title, intent, and annotation.
- Visible target crop is compressed in the extension worker, validated/materialized by the native host, attached to the model request, and shown in the local conversation.
- `activeTab` limits access to explicit user invocation.
- Bounded framed Native Messaging host and resident queue handoff.
- macOS and Windows scripts install the native host after the extension ID is known.

Remaining: wire the host automatically after a fixed store extension ID exists, resolve global-vs-extension shortcut precedence per browser, and add optional explicit DevTools/CDP deep-source mode.

### M7 — Files, PDF, and video baseline implemented

- Native file picker/drop already enters the conversation pipeline.
- Text and machine-readable PDFs are extracted locally with bounded content and page metadata.
- Video selection automatically runs FFprobe/FFmpeg and prepares bounded timestamped frames plus an audio derivative.
- Same-name VTT/SRT subtitles are normalized into bounded time-coded evidence; YouTube right-click analysis can fetch a caption track already published by the active page.
- Images are checked locally with the official C2PA Rust SDK plus a release-pinned official trust-list snapshot, and common EXIF fields remain separate from visual inference.

Remaining: OCR/page rendering for scanned PDFs, speech transcription when no subtitle track exists, issuer-specific invisible-watermark verification, Explorer/Finder shell integration, outbound derivative preview, a bundled FFmpeg sidecar, and cleanup policies.

### M8 — Distribution

- Windows 10/11 tests at 100/125/150/200% scaling and mixed monitors.
- Installer creates tray/startup preferences, Native Messaging manifests, and optional Explorer action.
- Signed MSIX/NSIS once maintainer certificates exist.
- Release artifacts label unsigned development builds clearly.

## Verification matrix

| Layer | Current command / gate |
| --- | --- |
| Frontend lint/types/tests/build | `npm run check` |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` |
| Rust compile/lints/tests | `cargo clippy --all-targets -- -D warnings`, `cargo test` |
| Electron IPC/extensions | `node --check electron/main.js`; `npm test` |
| Rust sidecar | `npm run build:sidecar`; JSON stdin/stdout discovery + capture/file smoke |
| Desktop smoke | `npm run dev:electron`; main, tray, overlay, click, drag, Escape; compare Tauri fallback separately |
| Windows native | GitHub Actions Windows plus physical mixed-DPI run |
| Browser connector | load unpacked; click text/button/video; verify bounded payload and failure state |
| Agent sessions | mocked JSON-RPC/SSE fixtures, then opt-in live provider smoke |

## Honest current boundary

The repository now has the Electron client shell, Rust native sidecar, declarative plugin/Skill manager, direct API transports, native capture baseline, browser host code, file extraction, background upper-right results, and local system speech. Source/build success is separate from packaged runtime permission parity: the stable Tauri app remains installed independently until Electron capture, accessibility, notification, and shortcut behavior are proven on physical macOS and Windows. The project does not yet claim production-ready Windows packaging, installed browser Native Messaging manifests, exact macOS arbitrary-app text ranges, OCR, provider-specific file/audio uploads, or a completed Codex App Server/OpenCode session adapter. Codex Realtime audio is represented as an explicitly disabled experimental route until streaming playback is implemented.
