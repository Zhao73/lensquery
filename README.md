# LensQuery

Ask AI about anything visible on your desktop or inside a local file.

LensQuery is a Windows-first open-source desktop utility. Press a global shortcut, click an interface element or drag a screen region, review the context that will leave your computer, then ask OpenAI, Anthropic, an OpenAI-compatible endpoint, Codex CLI, or Claude Code for an explanation.

> Current status: the repository contains the product specification, the complete desktop interface shell, typed frontend/Rust contracts, file-drop workflow, provider configuration UI, operating-system credential-vault storage, browser-safe mock adapter, and bounded read-only CLI adapters. Native Windows screen capture, UI Automation, and direct API transport remain roadmap work and are never presented as complete.

## Intended workflow

1. Press `Ctrl+Shift+Space` from any Windows application.
2. Drag a rectangle or click a UI element.
3. Add an optional image, PDF, or local file.
4. Inspect the outbound-data preview.
5. Choose a configured model and ask a question.
6. Copy the compact result or continue in the full window.

## What it is designed to analyze

- Anything visible on screen: controls, icons, error dialogs, charts, screenshots, and surrounding application context.
- Website evidence visible in a browser. The first release uses pixels, window metadata, and accessible text; exact URL/DOM capture is planned as an explicit-permission browser companion.
- Images, PDFs, text, code, logs, and other bounded local files.
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
- Codex and Claude Code adapters use non-interactive, bounded invocations and do not grant shell/file-write tools for ordinary analysis.
- Screenshot retention is off by default in the product contract.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in a private GitHub Security Advisory; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
