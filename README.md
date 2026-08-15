<p align="center"><img src="assets/brand/lensquery-wordmark.svg" alt="LensQuery" width="260"></p>

Press one shortcut, point at anything on screen, and ask an AI agent about it.

LensQuery is an open-source resident utility for Windows and macOS. Press a global shortcut, click once to highlight an interface element/file and again to confirm it, or hold-drag a region; LensQuery then starts analysis in the background through Codex, Claude Code, OpenCode, Grok, or a configured API. Its normal window is a quiet local conversation timeline for evidence, previous queries, and follow-ups.

> Current status: the repository contains the background tray/shortcut shell, a transparent question-cursor capture overlay, XCap region capture, Windows UI Automation lookup, macOS Accessibility element bounds/text and Finder-file lookup, local timeline/follow-up UI, Markdown answers, a permission-independent top-right result card and speech, auto-start preference, automatic CLI discovery, bounded CLI adapters, local PDF/text extraction, automatic video preparation, and an MV3 browser picker with native right-click actions plus manual Native Messaging installers. Physical Windows mixed-DPI testing, richer arbitrary-app macOS text ranges, automatic browser-host packaging, Codex App Server/OpenCode session adapters, Realtime audio playback, OCR, and direct API transport remain implementation gates.

## Intended workflow

1. Leave LensQuery running in the system tray/menu bar. A left click on its icon or `Ctrl+Shift+Space` (`Command+Shift+Space` on macOS) starts smart selection immediately; neither action opens the client window.
2. The current desktop stays visible and the pointer changes to a small question mark.
3. Click once to resolve and highlight the real object/file bounds, then click the highlighted target again to confirm it. Dragging a rectangle submits the region on release. LensQuery hides the picker, captures bounded context, and starts the selected agent in the background. There is no client confirmation page in the shortcut path.
4. By default the answer appears in a compact card at the upper-right without opening the client. Choose upper-right card, window, or both in Settings.
5. Open the conversation timeline to copy, hear, retry, or continue the same query.

Right-clicking the tray/menu-bar icon stays intentionally short: Start Recognition, Analyze Files, Conversation Timeline, Settings, and Quit. Text scope, default intent, model routing, permissions, and result diagnostics live in the client settings instead of crowding the resident menu.

There is no upload-style homepage. Point at a Desktop/Finder/Explorer file and click it in the selector; the file target highlights before selection and then enters the same background conversation flow. Drag/drop and later Explorer shell integration remain secondary paths.

## Local CLI discovery and reply language

- On startup, the desktop runtime scans `PATH` and common per-user install directories for `codex`, `claude`, `opencode`/`opencode2`, and `grok`.
- Version probes run in parallel with a two-second timeout. A slow version command is reported separately and never blocks the whole app indefinitely; authentication is verified only by the first real request.
- The model page shows the resolved executable path and version, supports a manual rescan, and lets the user choose any discovered CLI as the default route.
- CLI calls are built from fixed argument arrays rather than shell strings. Codex uses a read-only sandbox; Claude Code receives no built-in or MCP tools; Grok receives an empty tool allowlist; OpenCode receives only explicitly selected attachments with every tool permission denied. Grok's current adapter is text-only until its structured local-media input is verified end to end.
- Settings can automatically infer the customer's language from the question and visible evidence, or force a fallback reply language. Reply style and a bounded custom instruction are included in every local CLI request.
- Simplified Chinese and English interface copy are included for the main navigation and complete settings screen. The setting is persisted locally through the Tauri store.
- Six analysis intents are available: identify, explain, how-to, deep-dive, customer reply, and code analysis. Output can be adaptive, summary, steps, full report, customer-ready, or explicit Markdown.

## What it is designed to analyze

- Anything visible on screen: controls, icons, error dialogs, charts, screenshots, and surrounding application context.
- Website elements through the companion extension: two-click confirmed text, controls, images, video/audio state, visible captions, page-exposed transcript segments, bounded nearby DOM, URL, and title.
- Images, videos, PDFs, text, code, logs, and other bounded local files. Text and machine-readable PDFs are extracted locally before the model request.
- Visual answers describe the subject, visible text, composition, style, lighting, and surrounding context. When an image appears AI-generated, the answer labels that as an inference and adds a reusable reconstruction prompt rather than claiming to recover the exact original prompt.
- Videos are probed and sampled locally as part of file submission. Vision routes receive ordered timestamped frames and return a quick introduction, summary, interesting moments, and learning takeaways. An audio derivative is prepared; full transcription remains provider-dependent, while YouTube/page captions and exposed transcript segments are used directly when available.
- Fast customer-answer tasks through the built-in “Customer reply” prompt template.

## Architecture

- [Tauri 2](https://v2.tauri.app/) desktop shell
- Rust native core and narrow Tauri command boundary
- React 19 + TypeScript + Zustand webview
- Official Tauri global-shortcut, autostart, dialog, store, filesystem, clipboard, and opener plugins
- Provider-independent request/result contracts
- XCap screen-region capture and Windows UI Automation behind platform modules
- Codex App Server as the primary planned session runtime; OpenCode Server/SDK and ACP as additional protocol adapters

See [the architecture](docs/ARCHITECTURE.md), [product specification](docs/PRODUCT_SPEC.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), and [roadmap](docs/ROADMAP.md).

## Run the interface preview

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
```

The browser preview exercises the timeline, settings, and local file workflow. It deliberately uses a mock analysis adapter and does not capture the desktop or send content to a model.

## Run the desktop app

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system and Rust stable.

### Install on macOS

The first Rust release build needs at least 12 GiB of free space. This command builds the `.app` and `.dmg`, installs LensQuery into `/Applications`, signs it with the first available Apple Development identity (falling back to a local ad-hoc signature), and launches the menu-bar app. A stable Apple Development signature prevents macOS from treating every local update as a different screen-capture app:

```bash
npm run install:macos
```

LensQuery starts hidden in the menu bar. Press `Command+Shift+Space` to activate the question cursor. The generated DMG remains under `src-tauri/target/release/bundle/dmg/`.

The first actual capture on macOS requires **Privacy & Security → Screen & System Audio Recording → LensQuery**. The first shortcut asks once; repeated shortcuts do not keep reopening the system request. Enable the switch, fully quit LensQuery, and reopen it. If LensQuery is absent from the list, press `+` and choose `/Applications/LensQuery.app`. Accessibility permission is separately required for exact element bounds/text and real PDF/image/video/file detection; both permission pages are linked from LensQuery Settings.

`npm run tauri dev` is the development runner; it compiles and launches a debug build but does **not** install an application into `/Applications`.

### Development

```bash
npm ci
npm run tauri dev
```

Windows 10/11 and macOS share the tray, shortcut, region capture, file, top-right result card, speech, and conversation baseline. Windows additionally reads element/word/paragraph/document ranges through UI Automation. macOS reads exposed Accessibility element bounds/text and promotes confirmed Finder/Desktop icons plus document surfaces in Preview/PDF readers to real local-file evidence; exact arbitrary-app character-range geometry remains follow-up work.

## Browser connector

Load [`browser-extension`](browser-extension) as an unpacked Chrome/Edge extension. It adds direct right-click analysis for selected text, images, videos, and page background, plus the existing two-click DOM picker. LensQuery receives bounded nearby text, DOM/accessibility metadata, page URL/title, available captions/transcript, and a compressed target crop for visual grounding. Install the `com.lensquery.desktop` Native Messaging host with the included macOS or Windows helper after copying the extension ID; see [the connector README](browser-extension/README.md).

Video preparation currently requires `ffmpeg` and `ffprobe` on `PATH`. The interface reports a direct recovery message when they are missing; a verified bundled sidecar is planned before the signed 1.0 installer. Scanned/image-only PDFs also need the planned OCR fallback.

## Background, results, and voice

- The main window starts hidden; closing it returns LensQuery to the tray/menu bar instead of quitting.
- Left-click the icon for Quick Ask. Right-click offers Start Recognition, Analyze Files, Timeline, Settings, and Quit; intent, model, permissions, and diagnostics stay in the client.
- On notched Macs, the first run seeds the LensQuery item into the visible right-side safe area. Hold Command and drag it to choose another position; macOS remembers that choice.
- Login auto-start and the result preview are user-configurable. The upper-right card is rendered by LensQuery itself, so it works without macOS or Windows notification permission. Use “Test upper-right result” in Settings to verify it at any time.
- macOS `say`, Windows SAPI, and the browser Speech Synthesis fallback provide working local read-aloud. Codex App Server 0.146.1 exposes experimental Realtime audio methods, but an authenticated smoke test reported that an ordinary local thread does not support realtime conversation. The option is therefore disabled in Settings instead of pretending to be available; protocol/session eligibility and PCM playback remain separate gates.

## Verification

```bash
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Source checks and builds are separate from Windows runtime verification. Capture, global shortcuts, tray behavior, mixed-DPI selection, UI Automation, and packaging require real Windows evidence.

## Provider safety

- Direct API requests are intentionally gated until the outbound preview and provider transports are wired end to end; credentials already use the operating-system vault.
- The UI never stores a raw API key in JSON or browser local storage.
- Codex, Claude Code, OpenCode, and Grok adapters use non-interactive, bounded invocations and do not grant command/file-write tools for ordinary analysis.
- Screenshot retention is off by default in the product contract.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in a private GitHub Security Advisory; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
