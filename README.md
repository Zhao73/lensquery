# LensQuery

Press one shortcut, point at anything on screen, and ask an AI agent about it.

LensQuery is a Windows-first open-source resident utility. Press a global shortcut, click an interface element or hold-drag a region, and LensQuery starts analysis in the background through Codex, Claude Code, OpenCode, Grok, or a configured API. The only normal window is a plain local conversation timeline for previous queries and follow-ups.

> Current status: the repository now contains the resident tray/shortcut shell, separate ❓ capture overlay, XCap region capture, Windows UI Automation element lookup, local timeline/follow-up UI, automatic CLI discovery, bounded CLI adapters, and an MV3 browser element picker. Physical Windows mixed-DPI testing, browser Native Messaging installer wiring, Codex App Server/OpenCode session adapters, and direct API transport remain implementation gates.

## Intended workflow

1. Press `Ctrl+Shift+Space` from any Windows application.
2. Drag a rectangle or click a UI element.
3. LensQuery hides the picker, captures pixels plus available element context, and starts the configured agent in the background.
4. The conversation window opens with the answer.
5. Continue asking questions in that same local conversation.

There is no upload-style homepage. Files enter through the native picker, drag/drop, and later Explorer shell integration, then use the same conversation flow.

## Local CLI discovery and reply language

- On startup, the desktop runtime scans `PATH` and common per-user install directories for `codex`, `claude`, `opencode`/`opencode2`, and `grok`.
- Version probes run in parallel with a two-second timeout. A slow version command is reported separately and never blocks the whole app indefinitely; authentication is verified only by the first real request.
- The model page shows the resolved executable path and version, supports a manual rescan, and lets the user choose any discovered CLI as the default route.
- CLI calls are built from fixed argument arrays rather than shell strings. Codex uses a read-only sandbox; Claude Code receives no built-in or MCP tools; Grok receives an empty tool allowlist; OpenCode receives only explicitly selected attachments with every tool permission denied. Grok's current adapter is text-only until its structured local-media input is verified end to end.
- Settings can automatically infer the customer's language from the question and visible evidence, or force a fallback reply language. Reply style and a bounded custom instruction are included in every local CLI request.
- Simplified Chinese and English interface copy are included for the main navigation and complete settings screen. The setting is persisted locally through the Tauri store.

## What it is designed to analyze

- Anything visible on screen: controls, icons, error dialogs, charts, screenshots, and surrounding application context.
- Website elements through the companion extension: clicked text, controls, images, video/audio state, bounded nearby DOM, URL, and title.
- Images, videos, PDFs, text, code, logs, and other bounded local files.
- Videos are probed and sampled locally. Vision routes receive ordered timestamped frames, while compatible transcription routes can also receive an extracted audio transcript.
- Fast customer-answer tasks through the built-in “Customer reply” prompt template.

## Architecture

- [Tauri 2](https://v2.tauri.app/) desktop shell
- Rust native core and narrow Tauri command boundary
- React 19 + TypeScript + Zustand webview
- Official Tauri global-shortcut, dialog, store, filesystem, clipboard, and opener plugins
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

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system and Rust stable, then:

```bash
npm ci
npm run tauri dev
```

Native runtime behavior is first targeted at Windows 10/11. macOS can exercise the shared capture baseline; Windows UI Automation and mixed-DPI behavior still require Windows runtime evidence.

## Browser connector

Load [`browser-extension`](browser-extension) as an unpacked Chrome/Edge extension for the page picker. The picker is implemented; delivery into the desktop app also requires the `com.lensquery.desktop` Native Messaging host manifest that will be generated by the Windows installer. See [the connector README](browser-extension/README.md).

Video preparation currently requires `ffmpeg` and `ffprobe` on `PATH`. The interface reports a direct recovery message when they are missing; a verified bundled sidecar is planned before the signed 1.0 installer.

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
