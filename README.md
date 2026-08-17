# <img src="assets/brand/lensquery-mark.svg" alt="" width="28" height="28"> LensQuery

Press one shortcut. Point at anything on screen. Ask the local agent about it.

LensQuery is a resident Windows / macOS workbench. It stays in the menu bar, keeps the current desktop visible, and sends the confirmed object, file, or region to Codex, Claude Code, OpenCode, Grok, or a configured API. The client itself is only a quiet local timeline.

<p align="center">
  <img src=".impeccable/screenshots/annotation-conversation-desktop-final.png" alt="LensQuery conversation timeline" width="920">
</p>

| Capture | Analyze | Stay out of the way |
| --- | --- | --- |
| `⌘ ⇧ Space` or a left click on the menu-bar icon | Two-click object confirm, or hold-drag a region | Results appear in the upper-right card; the client stays closed |
| Finder / Chrome / Edge right-click | Local files, PDFs, images, videos, and page context | Follow-ups live in the same local session |
| Current-page analysis from the extension icon or `lq` | Automatic task from the selected evidence | Compact, 200k, or 1m context is visible before the next turn |

## Install on this Mac

```bash
git clone https://github.com/Zhao73/lensquery.git
cd lensquery
npm run install:electron:macos
```

The installer builds, signs, and launches `/Applications/LensQuery.app`. After it finishes:

1. Keep LensQuery in the menu bar.
2. Press `Command + Shift + Space`.
3. Click once to highlight the real object, click again to confirm, or drag a region.
4. Open `chrome://extensions`, load `/Applications/LensQuery.app/Contents/Resources/browser-extension`, then reload it once.

The first macOS capture asks for **Screen Recording**. Object highlighting also needs **Accessibility**.

## How it works

```text
shortcut / tray / Finder / Chrome
        │
        ▼
confirmed object, file, or URL
        │
        ▼
bounded local evidence
pixels · text · captions · file extract · provenance
        │
        ▼
Codex / Claude Code / OpenCode / Grok / API
        │
        ▼
upper-right card + local timeline
```

- The shortcut never opens a homepage or prompt composer.
- Recognition chooses the analysis structure from the selected evidence.
- Each conversation can switch provider, model, reasoning, and context window without rewriting finished answers.
- Context is shown like Claude Code / Codex: `12k / 1m`, `Compact · 32k`, `Auto · 200k`, or `Evidence only`.

<p align="center">
  <img src=".impeccable/screenshots/shortcut-timeline-desktop-fixed.png" alt="LensQuery shortcut timeline" width="720">
</p>

## What it can read

- Screen controls, icons, dialogs, charts, and surrounding application text
- Finder files and folders through **使用 LensQuery 识别**
- Chrome / Edge pages: selected text, images, video, links, the current URL, and bounded frontend evidence
- Local images, videos, PDFs, and text, including long-video chapters and playable timestamps
- Image / video provenance when a signed credential or official declaration is actually present

It does not invent missing speech, pretend pixels are a verified watermark decoder, or treat unsigned metadata as proof.

## Project layout

```text
src/                  React workbench
electron/             tray, shortcut, settings, notifications
src-tauri/            Rust sidecar for files, capture helpers, CLI adapters
browser-extension/    Chrome / Edge connector
native/macos/         Finder Sync action
```

## Development

```bash
npm ci
npm run check
npm run dev:electron
```

Source checks are not the same as a live capture. Screen recording, Accessibility, mixed-DPI Windows selection, and packaged browser/Finder actions still need a real machine.

## Docs

- [Product](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation](docs/IMPLEMENTATION_PLAN.md)
- [Right-click acceptance](docs/RIGHT_CLICK_ACCEPTANCE.md)
- [Media acceptance](docs/MEDIA_ACCEPTANCE.md)

## License

[MIT](LICENSE)
