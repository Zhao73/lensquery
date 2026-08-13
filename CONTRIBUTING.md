# Contributing

LensQuery is Windows-first but keeps platform-specific code behind narrow interfaces.

## Setup

1. Install Node.js 22+, Rust stable, and the Tauri 2 platform prerequisites.
2. Run `npm ci`.
3. Run the webview preview with `npm run dev`.
4. Run the desktop app with `npm run tauri dev`.

## Before opening a pull request

```bash
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Capture, UI Automation, global shortcut, tray, and installer changes need a real Windows check. A browser preview is not evidence that the native path works.

## Design and behavior

- Preserve the fixed-region instrument grammar recorded in `DESIGN.md`.
- Keep full keyboard operation and visible focus.
- Add loading, empty, error, cancellation, and retry states with new workflows.
- Clearly separate local capture, preview, external request, and returned model output.

## Privacy

Do not add automatic capture or upload. Any new outbound field must appear in the preview and be documented in `docs/PRODUCT_SPEC.md`.

