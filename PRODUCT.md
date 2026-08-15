# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Delegated by the user: Electron with a React/TypeScript renderer and a Rust native sidecar. Windows 10/11 and macOS are distributable targets, with deeper per-platform accessibility adapters implemented independently. The previous Tauri shell stays available only as a migration fallback until packaged Electron capture parity is verified.

## Users

- Primary: customer-support, operations, sales, and technical workers who need to understand something visible on screen and answer quickly.
- Secondary: developers and power users who want to route local visual or file context into Codex, Claude Code, or a configurable model API.

## Product Purpose

Let a user press one shortcut, confirm an on-screen object with two clicks or drag a region, and receive a concise, grounded explanation without manually taking screenshots, switching apps, or assembling context.

Success means the user can press one shortcut, click once to highlight the real object and again to confirm it, or drag a region, then have analysis begin in the background without first opening a homepage. A quiet local timeline preserves the selected image, answer, and follow-up conversation.

## Positioning

The product treats the desktop itself as the input surface. One capture action packages pixels, accessible UI metadata, selected-file context, and an optional user question into a provider-independent analysis request.

## Operating Context

- Lives in the Windows system tray or macOS menu bar, starts hidden, and starts capture from a configurable global shortcut.
- Left-clicking the resident icon starts smart selection without opening the client; the right-click menu stays limited to start, file import, timeline, settings, and quit.
- Supports two-click object confirmation and drag-to-capture over the current desktop. No synthetic box follows the pointer: the first click resolves and highlights the real accessible element or file bounds, and the second click confirms it.
- Accepts screenshots, images, videos, PDFs, and other local files via picker, drag-and-drop, or shell integration.
- Creates a local conversation immediately, shows an optional upper-right result card, and preserves the selected evidence image, copy, read-aloud, retry, and follow-up actions in the timeline; the optional preview applies to manual imports rather than the shortcut path.
- Routes requests to direct model APIs or installed local agent CLIs when available.
- Lets each conversation switch its ready provider and model, reasoning effort, and bounded history scope from the follow-up composer. These settings apply to the next turn and do not rewrite prior answers.
- Installs, enables, disables, audits, and removes local LensQuery plugins and Codex-compatible Skills from a dedicated capability surface rather than a store-style homepage.

## Capabilities and Constraints

- Windows 10/11 is the first full native-accessibility target; macOS shares the background, region-capture, file, result-card, speech, and conversation baseline while its arbitrary-app text-range adapter remains a platform milestone.
- Direct providers: OpenAI Responses API, Anthropic Messages API, and OpenAI-compatible endpoints.
- Local-agent adapters: Codex CLI, Claude Code, OpenCode, and Grok headless modes, with explicit executable detection, bounded probes, and no implicit command-execution permission.
- Customer-response language can follow the detected language in the customer's text/evidence or use a configured fallback; reply style and custom guidance remain user-controlled.
- API secrets must use the operating-system credential vault; configuration files store only non-secret metadata.
- Screen and file content stays local until the explicit shortcut plus second confirming click or drag release. Manual imports can use an optional second confirmation. History is local and can be disabled or cleared.
- On macOS the stable signed Electron app owns screen pixels; the short-lived Rust helper receives monitor geometry for Accessibility lookup and therefore does not create a new screen-recording TCC identity on each click. A packaged helper signature remains stable across signed local upgrades.
- Browser-page understanding uses a companion extension with one universal right-click action across selected text, images, video/audio, links, editable areas, controls, and page background, plus the two-click DOM picker. It supplies a bounded target crop, DOM element, URL/title, accessible name, nearby text, annotation, video/audio state, visible captions, and page-exposed transcript segments. Deeper DevTools/CDP inspection is a separate explicit action.
- The macOS package embeds a Finder Sync extension. Its direct **使用 LensQuery 识别** menu accepts selected files, folders, or the current Finder container, passes only absolute existing paths through the registered `lensquery://analyze` route, and begins the same background conversation without first showing the client.
- Desktop element identification uses Windows UI Automation when available and pixel-region fallback otherwise.
- PDF analysis uses local bounded text extraction for machine-readable files, with native model file input where supported. OCR/page-image rendering for scanned PDFs remains a distinct fallback milestone.
- Image provenance is local-first: LensQuery separates visible watermarks, C2PA/EXIF metadata, and visual inference. It validates embedded C2PA integrity and signer trust against a release-pinned official trust-list snapshot. A watermark action in a manifest is a declaration; provider-specific invisible watermark detection remains separately labeled.
- Video analysis is provider-independent: LensQuery locally probes the file, samples bounded time-coded frames, extracts a compact mono audio track, and prefers bounded same-name VTT/SRT subtitles. If subtitles are absent and local Whisper is available, it produces a labeled time-coded transcript. Videos of at least 20 minutes are organized into at most 12 chronological evidence chapters that the final answer must cover. The browser connector first uses page-published YouTube caption tracks; for an explicitly selected captionless YouTube video, the desktop sidecar may use bounded local yt-dlp + Whisper preparation rather than inventing speech.
- No invented live model availability: users enter model IDs and endpoints, with tested presets supplied as editable defaults.
- Extension packages are local-first and declarative: enabled Markdown instructions may shape analysis, while arbitrary JavaScript/Shell execution and self-declared external permissions are outside the first release boundary.

## Brand Commitments

- Working name: LensQuery. The brand mark combines a reading lens, three annotation strokes, and a cobalt focus point; tray/menu-bar variants preserve the silhouette in monochrome.
- Open-source GitHub repository with an OSI-compatible license.
- Product voice is concise, calm, and explicit about what data will leave the computer.
- The supplied menu-bar screenshot is interaction inspiration: a quiet resident tool invoked from the status area, not a visual asset to copy.

## Evidence on Hand

- User-supplied reference image: `/var/folders/5h/_fph5b9d3wzfbcfxj31pxt0w0000gn/T/codex-clipboard-0a2a0bf2-1e2e-41b7-9241-f84a8364bf69.png`.
- No customer logos, performance benchmarks, testimonials, pricing, or production telemetry are available and none may be fabricated.

## Product Principles

1. One shortcut or tray-icon click, one target-confirmation pair or one drag, is the direct default path; optional preview is reserved for manual imports.
2. Keep provider choice portable and model IDs editable.
3. Prefer native desktop affordances and a short path from shortcut to copied answer.
4. Separate captured evidence, inferred context, model output, and external actions.
5. Fail transparently with recoverable errors and preserve local privacy by default.

## Accessibility & Inclusion

- Full keyboard operation, visible focus, screen-reader labels, reduced-motion support, and high-contrast compatibility are required.
- The capture overlay must support Escape to cancel and keyboard adjustment of a selected region.
- English and Simplified Chinese ship in the first interface copy set.
