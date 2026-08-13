# LensQuery

Ask AI about anything visible on your desktop or inside a local file.

LensQuery is a Windows-first open-source desktop utility. Press a global shortcut, click an interface element or drag a screen region, review the context that will leave your computer, then ask OpenAI, Anthropic, an OpenAI-compatible endpoint, Codex CLI, Claude Code, OpenCode, or Grok CLI for an explanation. Local videos use a quick-analysis pipeline that extracts timestamped frames and an optional compact audio track before model routing.

> Current status: the repository contains the product specification, the complete desktop interface shell, typed frontend/Rust contracts, file-drop workflow, provider configuration UI, operating-system credential-vault storage, browser-safe mock adapter, and bounded read-only CLI adapters. Native Windows screen capture, UI Automation, and direct API transport remain roadmap work and are never presented as complete.

## Intended workflow

1. Press `Ctrl+Shift+Space` from any Windows application.
2. Drag a rectangle or click a UI element.
3. Add an optional image, video, PDF, or local file.
4. Inspect the outbound-data preview.
5. Choose a configured model and ask a question.
6. Copy the compact result or continue in the full window.

## Local CLI discovery and reply language

- On startup, the desktop runtime scans `PATH` and common per-user install directories for `codex`, `claude`, `opencode`/`opencode2`, and `grok`.
- Version probes run in parallel with a two-second timeout. A slow version command is reported separately and never blocks the whole app indefinitely; authentication is verified only by the first real request.
- The model page shows the resolved executable path and version, supports a manual rescan, and lets the user choose any discovered CLI as the default route.
- CLI calls are built from fixed argument arrays rather than shell strings. Codex uses a read-only sandbox; Claude Code receives no built-in or MCP tools; Grok receives an empty tool allowlist; OpenCode receives only explicitly selected attachments with every tool permission denied. Grok's current adapter is text-only until its structured local-media input is verified end to end.
- Settings can automatically infer the customer's language from the question and visible evidence, or force a fallback reply language. Reply style and a bounded custom instruction are included in every local CLI request.
- Simplified Chinese and English interface copy are included for the main navigation and complete settings screen. The setting is persisted locally through the Tauri store.

## What it is designed to analyze

- Anything visible on screen: controls, icons, error dialogs, charts, screenshots, and surrounding application context.
- Website evidence visible in a browser. The first release uses pixels, window metadata, and accessible text; exact URL/DOM capture is planned as an explicit-permission browser companion.
- Images, videos, PDFs, text, code, logs, and other bounded local files.
- Videos are probed and sampled locally. Vision routes receive ordered timestamped frames, while compatible transcription routes can also receive an extracted audio transcript.
- Fast customer-answer tasks through the built-in “Customer reply” prompt template.

## Architecture

- [Tauri 2](https://v2.tauri.app/) desktop shell
- Rust native core and narrow Tauri command boundary
- React 19 + TypeScript + Zustand webview
- Official Tauri global-shortcut, dialog, store, filesystem, clipboard, and opener plugins
- Provider-independent request/result contracts
- Windows-native capture and UI Automation kept behind platform modules

See [the architecture](docs/ARCHITECTURE.md), [product specification](docs/PRODUCT_SPEC.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), and [roadmap](docs/ROADMAP.md).

## Run the interface preview

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
```

The browser preview exercises the full interface and local file workflow. It deliberately uses a mock analysis adapter and does not capture the desktop or send content to a model.

## Run the desktop app

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system and Rust stable, then:

```bash
npm ci
npm run tauri dev
```

Native runtime behavior is first targeted at Windows 10/11. macOS and Linux currently serve as development hosts for shared UI and contracts.

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
