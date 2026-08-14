# LensQuery implementation plan

## Release definition

The release is successful when a Windows user can leave LensQuery in the tray, press one shortcut from another application, click an object or drag a region, receive an automatic answer, and continue that answer in a local conversation timeline.

## Milestones and current state

### M0 — Repository and contracts: complete

- Tauri 2, Rust, React, TypeScript, Vite, tests, CI, MIT license.
- Provider-independent capture, browser context, file, video, request, result, and session contracts.
- Local discovery for Codex, Claude Code, OpenCode, and Grok executables.

### M1 — Resident shortcut shell: implemented, runtime verification pending

- Hidden-at-login resident process with a template menu-bar/tray mark.
- Left-click Quick Ask plus right-click Identify, Explain, How-to, Deep Dive, File, Timeline, Models, Settings, and Quit.
- Main-window close hides to tray.
- Configurable global shortcut registration in Rust.
- Separate transparent all-monitor capture overlay.
- Transparent desktop, small question-mark cursor, click versus drag threshold, Escape cancellation, and configured analysis intent.
- Native notifications, notification/window/both result presentation, autostart preference, and system speech.

macOS compilation is verified locally. Windows behavior must still be exercised on physical Windows 10/11, especially mixed-DPI coordinates and tray lifecycle.

### M2 — Native capture: implemented baseline, Windows QA pending

- XCap region capture to a temporary PNG.
- Windows UI Automation `ElementFromPoint` lookup for name, role, class, AutomationId, and bounding rectangle.
- Pixel fallback when UI Automation exposes nothing useful.
- Automatic confirmed evidence event into the background conversation pipeline without a client confirmation page.

Remaining: multi-monitor mixed-DPI test matrix, protected/elevated-surface errors, capture-retention cleanup, and optional frozen-snapshot rendering so dynamic content does not move while dragging.

### M3 — Conversation workbench: implemented

- No upload/dashboard homepage.
- Searchable local timeline, source metadata, answer states, semantic Markdown, copy/read-aloud/retry, deletion, and clear history.
- Same-session follow-up with transcript context.
- Six analysis modes, six output contracts, and optional annotations.
- Plain Windows/macOS/Codex-like workbench styling with system typography and one action color.

Remaining: replace transcript replay with native thread IDs when Codex App Server/OpenCode adapters land; add token streaming and cancellation.

### M4 — Agent runtime adapters: next

1. Implement a long-lived `codex app-server --stdio` JSON-RPC client.
2. Generate schemas from the installed Codex version at build/test time.
3. Map LensQuery session IDs to Codex thread IDs; use `thread/start`, `thread/resume`, `turn/start`, item deltas, and `turn/completed`.
4. Add OpenCode Server/SDK adapter with session and SSE mapping.
5. Add ACP adapter for compatible agents.
6. Retain bounded headless CLI invocation as the compatibility fallback.

Acceptance: follow-ups append to the original agent session without replaying the entire transcript, partial output streams into the timeline, and approvals remain visible/user-controlled.

### M5 — Browser connector: picker and native host implemented, installer packaging next

- MV3 extension manifest.
- Shortcut/action starts an in-page pointer picker.
- Click extraction for selection/word/paragraph/page/object text, button/link roles, images, video/audio state, selector, nearby text, sanitized outer HTML, URL, title, intent, and annotation.
- `activeTab` limits access to explicit user invocation.
- Bounded framed Native Messaging host and resident queue handoff.

Remaining: generate Chrome/Edge host manifests during install, inject verified extension IDs, resolve global-vs-extension shortcut precedence per browser, and add optional explicit DevTools/CDP deep-source mode.

### M6 — Files, PDF, and video baseline implemented

- Native file picker/drop already enters the conversation pipeline.
- Text and machine-readable PDFs are extracted locally with bounded content and page metadata.
- Video selection automatically runs FFprobe/FFmpeg and prepares bounded timestamped frames plus an audio derivative.

Remaining: OCR/page rendering for scanned PDFs, audio transcription routing, Explorer/Finder shell integration, outbound derivative preview, a bundled FFmpeg sidecar, and cleanup policies.

### M7 — Distribution

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
| Desktop smoke | `npm run tauri dev`; main, tray, overlay, click, drag, Escape |
| Windows native | GitHub Actions Windows plus physical mixed-DPI run |
| Browser connector | load unpacked; click text/button/video; verify bounded payload and failure state |
| Agent sessions | mocked JSON-RPC/SSE fixtures, then opt-in live provider smoke |

## Honest current boundary

The repository now has the intended interaction shell, native capture baseline, browser host code, file extraction, background notifications, and local system speech. It does not yet claim production-ready Windows/macOS packaging, installed browser Native Messaging manifests, exact macOS arbitrary-app text ranges, OCR, direct API transport, or a completed Codex App Server/OpenCode session adapter. Codex Realtime audio is represented as an explicitly disabled experimental route until streaming playback is implemented. Those are implementation gates, not completed features.
