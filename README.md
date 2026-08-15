<p align="center"><img src="assets/brand/lensquery-wordmark.svg" alt="LensQuery" width="260"></p>

Press one shortcut, point at anything on screen, and ask an AI agent about it.

LensQuery is an open-source resident utility for Windows and macOS. Press a global shortcut, click once to highlight an interface element/file and again to confirm it, or hold-drag a region; LensQuery then starts analysis in the background through Codex, Claude Code, OpenCode, Grok, or a configured API. Its normal window is a quiet local conversation timeline for evidence, previous queries, and follow-ups.

> Current status: the repository now has an Electron workbench modeled on quiet coding-agent clients, while the existing Rust implementation runs as a bounded native sidecar for accessibility, PDF/text/video preparation, local Whisper transcription, long-video chaptering, local C2PA/EXIF provenance inspection, CLI discovery, and local-agent calls. Electron owns the window, tray, shortcut, macOS pixel capture, notifications, encrypted settings, direct API transports, and plugin/Skill manager. The previously installed Tauri application remains a side-by-side fallback until packaged Electron capture permissions pass the full physical macOS/Windows matrix. Physical Windows mixed-DPI testing, richer arbitrary-app macOS text ranges, automatic browser-host packaging, Codex App Server/OpenCode session adapters, hosted/provider-native audio transcription, Realtime audio playback, and OCR remain implementation gates.

## Intended workflow

1. Leave LensQuery running in the system tray/menu bar. A left click on its icon or `Ctrl+Shift+Space` (`Command+Shift+Space` on macOS) starts smart selection immediately; neither action opens the client window.
2. The current desktop stays visible and the pointer changes to a small question mark.
3. Click once to resolve and highlight the real object/file bounds, then click the highlighted target again to confirm it. Dragging a rectangle submits the region on release. LensQuery hides the picker, captures bounded context, and starts the selected agent in the background. There is no client confirmation page in the shortcut path.
4. By default the answer appears in a compact card at the upper-right without opening the client. Choose upper-right card, window, or both in Settings.
5. Open the conversation timeline to copy, hear, retry, or continue the same query.

Right-clicking the tray/menu-bar icon stays intentionally short: Start Recognition, Analyze Files, Conversation Timeline, Settings, and Quit. Text scope, default intent, model routing, permissions, and result diagnostics live in the client settings instead of crowding the resident menu.

There is no upload-style homepage. Point at a Desktop/Finder/Explorer file and click it in the selector; the file target highlights before selection and then enters the same background conversation flow. The packaged macOS client also installs a Finder Sync action named **使用 LensQuery 识别** directly into file, folder, and Finder-background context menus. Drag/drop remains a secondary path.

## Local CLI discovery and reply language

- On startup, the desktop runtime scans `PATH` and common per-user install directories for `codex`, `claude`, `opencode`/`opencode2`, and `grok`.
- Version probes run in parallel with a two-second timeout. A slow version command is reported separately and never blocks the whole app indefinitely; authentication is verified only by the first real request.
- The model page shows the resolved executable path and version, supports a manual rescan, and lets the user choose any discovered CLI as the default route.
- CLI calls are built from fixed argument arrays rather than shell strings. Codex uses a read-only sandbox; Claude Code receives no built-in or MCP tools; Grok receives an empty tool allowlist; OpenCode receives only explicitly selected attachments with every tool permission denied. Grok's current adapter is text-only until its structured local-media input is verified end to end.
- Codex analysis runs in a private LensQuery state/SQLite directory so the resident client neither scans nor writes the user's Codex conversation history. Existing Codex configuration and authentication are linked by reference into that state, parent thread/session variables are removed, and timeout cleanup terminates the full CLI process tree.
- Settings can automatically infer the customer's language from the question and visible evidence, or force a fallback reply language. Reply style and a bounded custom instruction are included in every local CLI request.
- Simplified Chinese and English interface copy are included for the main navigation and complete settings screen. The setting is persisted locally by the desktop runtime.
- Six analysis intents are available: identify, explain, how-to, deep-dive, customer reply, and code analysis. Output can be adaptive, summary, steps, full report, customer-ready, or explicit Markdown.
- Every conversation has an inline runtime menu in the follow-up composer. It can switch the ready provider, override the model ID, choose automatic/low/medium/high/extra-high reasoning, and use automatic, compact, full-session, or evidence-only history without changing already completed answers.

## What it is designed to analyze

- Anything visible on screen: controls, icons, error dialogs, charts, screenshots, and surrounding application context.
- Website elements through the companion extension: two-click confirmed text, controls, images, video/audio state, visible captions, page-published YouTube caption tracks, already-open generic transcript segments, bounded nearby DOM, URL, and title.
- Images, videos, PDFs, text, code, logs, and other bounded local files. Text and machine-readable PDFs are extracted locally before the model request.
- Visual answers describe the subject, visible text, composition, style, lighting, and surrounding context. Image inspection separates visible pixel labels, locally parsed provenance, and visual inference. The Rust sidecar validates embedded C2PA structure, asset binding, signature, and a release-pinned official trust-list snapshot, then reads common EXIF fields. A trusted `trainedAlgorithmicMedia` claim is direct machine-readable AI-origin evidence; EXIF camera fields are supporting metadata, not proof that an image is human-made.
- Visible AI disclosures are read by the selected vision model. A C2PA `c2pa.watermarked.*` action is reported as an embedded-watermark declaration, not as an independent SynthID pixel-level detection. Issuer-specific invisible watermark verification remains a separate provider/API capability.
- Videos are probed and sampled locally as part of file submission. Vision routes receive ordered timestamped frames and return a quick summary, important moments, and learning takeaways. LensQuery first uses bounded same-name `.vtt`/`.srt` subtitles; when they are absent and a local `whisper` CLI is available, it transcribes the extracted mono audio with time codes. Videos at least 20 minutes long are split into at most 12 chronological evidence chapters, and the final prompt must cover every supplied chapter rather than summarizing only the opening.
- Video conversations keep the playable source above the report. The installed client uses native media controls, can collapse the player, opens the source in the system player, and turns evenly sampled evidence frames into time-jump buttons. Prepared YouTube media plays from the local cached file; an unprepared YouTube page uses a privacy-enhanced embed fallback.
- A right-clicked YouTube video uses the page-published caption track when available. If the page has no transcript, the desktop runtime accepts only the explicit HTTPS YouTube URL, uses local `yt-dlp` with playlist and size/duration bounds, then runs the same frame/audio/Whisper pipeline. Repeated analysis stays inside the resulting conversation evidence instead of downloading again.
- Fast customer-answer tasks through the built-in “Customer reply” prompt template.

## Architecture

- Electron main/preload process for the coding-agent-style client, tray, global shortcut, secure settings, notifications, and extension management
- React 19 + TypeScript + Zustand renderer with context isolation and a narrow IPC allowlist
- Rust native core exposed as a one-request/one-response sidecar for accessibility, files/media, CLI discovery, analysis, and the legacy Tauri capture path
- Existing Tauri 2 shell retained temporarily as a migration fallback, using the same React UI and Rust modules
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

Requirements: Node.js 22+, Rust 1.88 or newer, and platform build tools.

### Electron client on macOS

Build, sign, install, and launch the Electron client beside the existing stable app:

```bash
npm run install:electron:macos
```

The preview is installed at `/Applications/LensQuery Electron Preview.app`; the installer does not replace `/Applications/LensQuery.app`. Electron includes a Chromium runtime, so its bundle is materially larger than the Tauri fallback. That is the intentional cost of using one Codex-like renderer and main-process API surface across macOS and Windows.

For development:

```bash
npm ci
npm run build:sidecar
npm run dev:electron
```

Closing the client window returns it to the menu bar. A left click on the menu-bar item starts recognition; Timeline, Plugins & Skills, and Settings remain available from its short right-click menu.

The first actual capture on macOS requires **Privacy & Security → Screen & System Audio Recording → LensQuery**. The signed Electron process owns pixel capture, while its packaged helper has a stable certificate-backed identifier; the first shortcut can ask once, and later shortcuts do not launch a new helper identity or keep reopening the request. Enable the switch, fully quit LensQuery, and reopen it. If LensQuery is absent from the list, press `+` and choose `/Applications/LensQuery Electron Preview.app`. Accessibility permission is separate and supplies exact object/file bounds and exposed text.

### Legacy Tauri fallback on macOS

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) and use the fallback installer only when comparing native-capture behavior:

### Install on macOS

The first Rust release build needs at least 12 GiB of free space. This command builds the `.app` and `.dmg`, installs LensQuery into `/Applications`, signs it with the first available Apple Development identity (falling back to a local ad-hoc signature), and launches the menu-bar app. A stable Apple Development signature prevents macOS from treating every local update as a different screen-capture app:

```bash
npm run install:macos
```

LensQuery starts hidden in the menu bar. Press `Command+Shift+Space` to activate the question cursor. The generated DMG remains under `src-tauri/target/release/bundle/dmg/`.

The Tauri fallback uses its own `/Applications/LensQuery.app` permission identity. Its first shortcut asks once; enable that separate switch only when testing the fallback, then fully quit and reopen it.

`npm run tauri dev` is the development runner; it compiles and launches a debug build but does **not** install an application into `/Applications`.

### Tauri development

```bash
npm ci
npm run tauri dev
```

Windows 10/11 and macOS share the tray, shortcut, region capture, file, top-right result card, speech, and conversation baseline. Windows additionally reads element/word/paragraph/document ranges through UI Automation. macOS reads exposed Accessibility element bounds/text and promotes confirmed Finder/Desktop icons plus document surfaces in Preview/PDF readers to real local-file evidence; exact arbitrary-app character-range geometry remains follow-up work.

## Plugins and Skills

Open **Extensions** in the Electron sidebar. Install a local folder or a Git repository, enable/disable each package, open its location, or move a managed package to the system Trash.

- A LensQuery plugin contains `lensquery.plugin.json` plus a Markdown instruction entry such as `PLUGIN.md`.
- A compatible Skill contains `SKILL.md`; managed Skills are installed in `~/.codex/skills`, and existing `~/.agents/skills` packages are discovered read-only.
- The reviewed GitHub catalog currently exposes the Apache-2.0 PDF and transcription workflows from `openai/skills`; script-bearing workflows install disabled and require an explicit user opt-in.
- GitHub `/tree/<ref>/<subdirectory>` URLs and `repository.git#subdirectory` sources install a single package from a monorepo without copying unrelated packages.
- Enabled Markdown instructions are added to the bounded analysis context. LensQuery does not execute plugin JavaScript, shell scripts, or self-declared permissions; current MCP/connector-heavy packages from `openai/plugins` are therefore not presented as working prompt-only extensions.
- Install validation rejects symbolic links and limits each package to 800 files / 32 MB. Prompt additions are separately bounded to 40,000 characters total.

See [the extension format and security model](docs/EXTENSIONS.md) and [`examples/extensions`](examples/extensions).

## Browser connector

Load [`browser-extension`](browser-extension) as an unpacked Chrome/Edge extension. Its single **使用 LensQuery 识别** command appears for every supported right-click context and routes selected text, images, video, audio, links, editable areas, controls, and page background into the matching bounded collector, plus the existing two-click DOM picker. LensQuery receives bounded nearby text, DOM/accessibility metadata, page URL/title, available captions/transcript, and a compressed target crop for visual grounding. On YouTube it first reads a caption-track URL already published in the page and locally assembles time-coded text. When no caption track exists, the desktop runtime can download only that explicitly selected YouTube video through local `yt-dlp` and transcribe its audio through local Whisper; it never invents missing speech. The extension ID is fixed at `filelbpgenppllkeeofajalcgbnifgmi`; the macOS Electron installer installs its `com.lensquery.desktop` Native Messaging host automatically. See [the connector README](browser-extension/README.md).

Video preparation detects `ffmpeg` and `ffprobe` on `PATH` or in common user install locations; `LENSQUERY_FFMPEG_BIN` and `LENSQUERY_FFPROBE_BIN` can point to explicit executables. Captionless audio transcription similarly detects `whisper` and defaults to the multilingual `base` model; `LENSQUERY_WHISPER_MODEL`, `LENSQUERY_WHISPER_DEVICE`, and `LENSQUERY_WHISPER_LANGUAGE` can tune it. Direct YouTube import detects `yt-dlp` or `LENSQUERY_YTDLP_BIN`, rejects non-YouTube/plain-HTTP URLs and playlists, limits a video to four hours and 1.5 GB, and keeps temporary media local. The interface reports a direct recovery message when a dependency is missing. Scanned/image-only PDFs still need the planned OCR fallback.

The reproducible ordinary-photo, OpenAI-generated image, visible/embedded-watermark, and NASA YouTube acceptance run is documented in [`docs/MEDIA_ACCEPTANCE.md`](docs/MEDIA_ACCEPTANCE.md). Long-form YouTube/Whisper coverage is documented in [`docs/LONG_VIDEO_ACCEPTANCE.md`](docs/LONG_VIDEO_ACCEPTANCE.md).

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

- Electron supports OpenAI Chat Completions, Anthropic Messages, and OpenAI-compatible endpoints. Built-in profiles cover OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter, Groq Cloud, Mistral, Together, Fireworks, SiliconFlow, Ollama, and LM Studio; users can add/remove arbitrary compatible profiles.
- Direct transports send the bounded question, extracted text, browser context, and at most eight individually bounded images after the existing confirmation path. Remote plaintext HTTP endpoints and URLs containing embedded credentials are rejected; HTTP is limited to loopback local-model servers.
- The UI never stores a raw API key in JSON or browser local storage.
- Codex, Claude Code, OpenCode, and Grok adapters use non-interactive, bounded invocations and do not grant command/file-write tools for ordinary analysis.
- The reproducible installed-client acceptance covers an ordinary camera photo, an OpenAI-generated image with visible/C2PA watermark evidence, and a 60-second NASA YouTube video; see [`docs/MEDIA_ACCEPTANCE.md`](docs/MEDIA_ACCEPTANCE.md).
- Screenshot retention is off by default in the product contract.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in a private GitHub Security Advisory; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
