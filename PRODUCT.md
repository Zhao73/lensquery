# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Delegated by the user: Tauri 2 with a Rust core and React/TypeScript UI. The first distributable target is Windows 10/11, while the architecture keeps macOS support possible.

## Users

- Primary: customer-support, operations, sales, and technical workers who need to understand something visible on screen and answer quickly.
- Secondary: developers and power users who want to route local visual or file context into Codex, Claude Code, or a configurable model API.

## Product Purpose

Let a user press one shortcut, point at an on-screen object or drag a region, and receive a concise, grounded explanation without manually taking screenshots, switching apps, or assembling context.

Success means the user can capture a screen region or choose a local image, PDF, or ordinary file; preview exactly what will be sent; select a model; ask a question; and copy a useful answer within seconds.

## Positioning

The product treats the desktop itself as the input surface. One capture action packages pixels, accessible UI metadata, selected-file context, and an optional user question into a provider-independent analysis request.

## Operating Context

- Lives in the Windows system tray and starts capture from a configurable global shortcut.
- Supports click-to-inspect and drag-to-capture interactions over the current desktop.
- Accepts screenshots, images, videos, PDFs, and other local files via picker, drag-and-drop, or shell integration.
- Shows the outbound context before submission and returns a compact answer overlay with copy and follow-up actions.
- Routes requests to direct model APIs or installed local agent CLIs when available.

## Capabilities and Constraints

- Windows 10/11 is the first supported release target.
- Direct providers: OpenAI Responses API, Anthropic Messages API, and OpenAI-compatible endpoints.
- Local-agent adapters: Codex CLI and Claude Code print mode, with explicit executable detection and no implicit command-execution permission.
- API secrets must use the operating-system credential vault; configuration files store only non-secret metadata.
- Screen and file content stays local until the user confirms a request. History is local and can be disabled or cleared.
- Browser-page understanding in the first release combines the selected screenshot, window title/process, and accessible text when available. A companion browser extension for DOM and URL capture is a later milestone.
- Desktop element identification uses Windows UI Automation when available and pixel-region fallback otherwise.
- PDF analysis uses native model file input when supported and local text/page-image extraction otherwise.
- Video analysis is provider-independent: LensQuery locally probes the file, samples bounded time-coded frames, extracts a compact mono audio track when present, optionally transcribes it, and sends only previewed derivative evidence rather than assuming a model accepts raw video.
- No invented live model availability: users enter model IDs and endpoints, with tested presets supplied as editable defaults.

## Brand Commitments

- Working name: LensQuery.
- Open-source GitHub repository with an OSI-compatible license.
- Product voice is concise, calm, and explicit about what data will leave the computer.
- The supplied menu-bar screenshot is interaction inspiration: a quiet resident tool invoked from the status area, not a visual asset to copy.

## Evidence on Hand

- User-supplied reference image: `/var/folders/5h/_fph5b9d3wzfbcfxj31pxt0w0000gn/T/codex-clipboard-0a2a0bf2-1e2e-41b7-9241-f84a8364bf69.png`.
- No customer logos, performance benchmarks, testimonials, pricing, or production telemetry are available and none may be fabricated.

## Product Principles

1. Capture first, but transmit only after a visible preview and user action.
2. Keep provider choice portable and model IDs editable.
3. Prefer native desktop affordances and a short path from shortcut to copied answer.
4. Separate captured evidence, inferred context, model output, and external actions.
5. Fail transparently with recoverable errors and preserve local privacy by default.

## Accessibility & Inclusion

- Full keyboard operation, visible focus, screen-reader labels, reduced-motion support, and high-contrast compatibility are required.
- The capture overlay must support Escape to cancel and keyboard adjustment of a selected region.
- English and Simplified Chinese ship in the first interface copy set.
