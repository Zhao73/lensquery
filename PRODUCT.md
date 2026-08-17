# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Delegated by the user: Electron with a React/TypeScript renderer and a Rust native sidecar. Windows 10/11 and macOS are distributable targets, with deeper per-platform accessibility adapters implemented independently. Electron is the single installed desktop client; the previous Tauri bundle is no longer installed.

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
- Supports two-click object confirmation and drag-to-capture over the current desktop. No synthetic box follows the pointer: the first click hit-tests behind LensQuery and highlights only the real accessible image, element, or file bounds, and the second click confirms it. Only actual pointer movement beyond the drag threshold may create an arbitrary region.
- On macOS, single-object selection requires the one-time Accessibility permission. LensQuery requests it at most once per cooldown period and never substitutes a large contextual crop for an unresolvable click.
- Accepts screenshots, images, videos, PDFs, and other local files via picker, drag-and-drop, or shell integration.
- Creates a local conversation immediately, shows an optional upper-right result card, and preserves the selected evidence image, copy, read-aloud, retry, and follow-up actions in the timeline. Screen, browser, Finder, and manually selected files all enter the same direct automatic-analysis path without a prompt or preview step.
- Routes requests to direct model APIs or installed local agent CLIs when available.
- Lets each conversation switch its ready provider and model, reasoning effort, and bounded history scope from the follow-up composer. These settings apply to the next turn and do not rewrite prior answers.
- Installs, enables, disables, audits, and removes local LensQuery plugins and Codex-compatible Skills from a dedicated capability surface rather than a store-style homepage.

## Capabilities and Constraints

- Windows 10/11 is the first full native-accessibility target; macOS shares the background, region-capture, file, result-card, speech, and conversation baseline while its arbitrary-app text-range adapter remains a platform milestone.
- Direct providers: OpenAI Responses API, Anthropic Messages API, and OpenAI-compatible endpoints.
- Local-agent adapters: Codex CLI, Claude Code, OpenCode, and Grok headless modes, with explicit executable detection, bounded probes, and no implicit command-execution permission.
- Installed agents expose only model evidence their local runtime can support: Codex cached visible models, Claude's configured model and CLI-declared aliases, OpenCode/Grok model commands, and loopback Ollama/LM Studio model endpoints. Users can persist an exact provider model while retaining manual model-ID entry. Codex CLI and native OpenAI requests can also persist a default reasoning effort; unsupported adapters visibly defer to the model rather than silently dropping a chosen value.
- Customer-response language can follow the detected language in the customer's text/evidence or use a configured fallback; reply style and custom guidance remain user-controlled.
- API secrets must use the operating-system credential vault; configuration files store only non-secret metadata.
- Screen and file content stays local until the explicit shortcut plus second confirming click, drag release, browser/Finder right-click, or file-picker selection. That selection is the submission gesture. History is local and can be disabled or cleared.
- On macOS the stable signed Electron app owns screen pixels; the short-lived Rust helper receives monitor geometry for Accessibility lookup and therefore does not create a new screen-recording TCC identity on each click. A packaged helper signature remains stable across signed local upgrades.
- Browser-page understanding uses a companion extension with one universal right-click action across selected text, images, video/audio, links, editable areas, controls, and page background, plus the two-click DOM picker. It supplies a bounded target crop, DOM element, URL/title, accessible name, nearby text, video/audio state, visible captions, page-exposed transcript segments, and bounded frontend-construction evidence: script/style URLs without queries, technology markers with confidence, structure/accessibility counts, responsive CSS and selected computed styles. The same automatic task classifies this evidence and chooses the response structure. It never equates rendered evidence with server source, original component files, build configuration, or proven hosting. Deeper DevTools/CDP inspection is a separate explicit action.
- The macOS package embeds a Finder Sync extension. Its direct **使用 LensQuery 识别** menu accepts selected files, folders, or the current Finder container, passes only absolute existing paths through the registered `lensquery://analyze` route, and begins the same background conversation without first showing the client.
- Desktop element identification uses Windows UI Automation when available and pixel-region fallback otherwise.
- PDF analysis uses local bounded text extraction for machine-readable files, with native model file input where supported. OCR/page-image rendering for scanned PDFs remains a distinct fallback milestone.
- Media provenance is local-first and automatic after target confirmation/import: LensQuery separates trusted C2PA/official watermark verification, supporting metadata, forensic pixel derivatives, and visual inference. It validates embedded C2PA asset binding and signer trust against a release-pinned official trust-list snapshot, and parses GB 45438-2025/TC260 `AIGC` JSON/XMP metadata from supported image/video files. TC260 `Label=1` produces an unsigned `declared-ai` state; `Label=2/3` remain supporting evidence, and none are promoted to `verified-ai` without an integrity mechanism. Missing credentials never mean human-made; a watermark action in a manifest is only a declaration until an issuer verifier confirms the signal. Media skips the optional client preview because the desktop target confirmation already established intent.
- Prompt recovery has three explicit states: `verified-exact` only for a complete trusted C2PA prompt ingredient, `embedded-unverified` for exact text recovered from unsigned/untrusted file metadata, and `absent` when the finished asset contains no original prompt string. The last state permits a reproducible reconstruction, never an “original prompt” claim.
- Global watermark coverage uses a release-pinned C2PA soft-binding registry, local standard parsers, optional decoder plug-ins, user-approved provider resolvers, and a separate blind-signal candidate layer. Registry awareness, algorithm declaration, decoder success, and unattributed anomalies are four different states; only decoder success or trusted direct provenance may verify origin.
- AI-origin and watermark analysis applies only to image and video evidence. Plain text, extracted PDF text, code, and browser text selections are analyzed for meaning, structure, context, and hidden prompt-injection-like content, but LensQuery does not add an AI-authorship verdict or AI-origin badge to them.
- Explicit browser analysis audits accessible hidden/low-contrast DOM text and labels instruction-like strings as untrusted prompt injection. Images receive bounded luminance, local-difference, and Alpha-channel views; exact same-value flattened pixels and unavailable proprietary detectors remain explicitly uncovered.
- Video analysis is provider-independent: LensQuery locally probes the file, samples bounded time-coded frames, extracts a compact mono audio track, and prefers bounded same-name VTT/SRT subtitles. If subtitles are absent and local Whisper is available, it produces a labeled time-coded transcript. Videos of at least 20 minutes are organized into at most 12 chronological evidence chapters that the final answer must cover. The browser connector first uses page-published caption/transcript evidence; for an explicitly selected captionless public HTTPS video, the desktop sidecar may use bounded local yt-dlp + Whisper preparation rather than inventing speech. Extractor-supported sites and direct media are in scope; DRM, authenticated, live/indefinite and unsupported blob-only streams remain out of evidence coverage.
- Video summaries are navigation surfaces as well as reports: plain or model-authored playback timecodes become accessible inline controls. Selecting a chapter or moment time expands the video, seeks to that exact point, starts playback where the platform permits, and keeps the original conversation available for follow-up.
- No invented live model availability: users enter model IDs and endpoints, with tested presets supplied as editable defaults.
- Extension packages are local-first and declarative: enabled Markdown instructions may shape analysis, while arbitrary JavaScript/Shell execution and self-declared external permissions are outside the first release boundary.

## Brand Commitments

- Public product name: What is it. The installed app binary remains LensQuery so existing macOS permissions and the menu-bar identity stay stable.
- The brand mark combines a reading lens, three annotation strokes, and a cobalt focus point; tray/menu-bar variants preserve the silhouette in monochrome.
- Open-source GitHub repository: https://github.com/Zhao73/what-is-it
- Product voice is concise, calm, and explicit about what data will leave the computer.
- The supplied menu-bar screenshot is interaction inspiration: a quiet resident tool invoked from the status area, not a visual asset to copy.

## Evidence on Hand

- User-supplied reference image: `/var/folders/5h/_fph5b9d3wzfbcfxj31pxt0w0000gn/T/codex-clipboard-0a2a0bf2-1e2e-41b7-9241-f84a8364bf69.png`.
- No customer logos, performance benchmarks, testimonials, pricing, or production telemetry are available and none may be fabricated.

## Product Principles

1. One shortcut or tray-icon click, one target-confirmation pair, one drag, or one file selection is the complete submission path; prompt and preview detours are absent.
2. Keep provider choice portable and model IDs editable.
3. Prefer native desktop affordances and a short path from shortcut to copied answer.
4. Separate captured evidence, inferred context, model output, and external actions.
5. Fail transparently with recoverable errors and preserve local privacy by default.

## Accessibility & Inclusion

- Full keyboard operation, visible focus, screen-reader labels, reduced-motion support, and high-contrast compatibility are required.
- The capture overlay must support Escape to cancel and keyboard adjustment of a selected region.
- English and Simplified Chinese ship in the first interface copy set.
