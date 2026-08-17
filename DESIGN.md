# LensQuery design system

<!-- impeccable:design-schema 1 -->

## Direction

LensQuery is a resident Windows/macOS Electron workbench. It refuses a marketing-like homepage and decorative dashboard. Its client follows the restrained information architecture of coding-agent applications: persistent navigation and local timelines on the left, one contextual top bar, and a focused conversation/composer canvas. The memorable interaction remains the system-wide question cursor that appears after one shortcut.

The 2026-08 automatic-analysis revision removes the prompt console from recognition. The empty conversation state offers only direct screen selection and file selection. LensQuery first identifies the exact subject and semantic subtype, then creates a content-specific internal task: tutorials preserve steps and troubleshooting; entertainment covers progression, jokes, reactions, and highlights; gameplay follows decisions and outcomes; commentary separates facts, claims, and forecasts. The client never asks the user to choose this route.

## Scene and color

The user works all day beside browsers, Explorer, customer tools, and coding agents under ordinary office light. The default surface is therefore light, neutral, and native-feeling, with automatic dark mode following the operating system.

- Canvas: cool near-white / near-black in dark mode.
- Surface: white / charcoal.
- Dividers: thin neutral gray.
- Accent: one cobalt blue, reserved for the shortcut action, current selection, focus, and primary send.
- Semantic colors: green for ready, red for errors, amber for warnings. None are decorative.

Canonical tokens live in `src/index.css`.

## Typography

- Use Segoe UI Variable, Segoe UI, Microsoft YaHei UI, then system sans.
- UI hierarchy is compact: 10–12px metadata, 13–14px controls/body, 19–26px page/empty-state titles.
- Cascadia Mono is limited to actual shortcuts, selectors, model IDs, and measurements.
- Conversation prose remains readable at roughly 65–75 characters per line.

## Layout

- Main window: 268px persistent sidebar plus a flexible workbench canvas. Below 820px the sidebar becomes a temporary drawer.
- Sidebar: wordmark, new conversation, direct recognition action, search, recent local sessions, and bottom navigation for conversations, models, extensions, and settings. Following the Codex history pattern, a session row reveals a three-dot action on hover, selection, or keyboard focus; right-click opens the same menu. Single-session deletion and the recent-section clear-all action always name the local impact and require confirmation.
- Top bar: 52px with the current surface name, resident status, current provider, and a direct recognition action.
- Conversation: source/title bar, centered message stream, persistent follow-up dock.
- The follow-up dock exposes one quiet `provider · model` control. Its trigger shows the estimated context as `12k / 1m`. The anchored menu contains provider, editable model ID, reasoning effort, and Auto · 200k / Compact · 32k / 1m / Evidence-only windows; it does not navigate away from the conversation.
- Video sessions place an expanded local/web player at the top of the message stream, before evidence and the report, so playback is immediately available without displacing the conversation context.
- Automatic video reports use topic-derived headings and a genre-specific coverage contract. Even the concise preference may shorten the opening orientation but never collapse the supplied video into a few generic sentences; short and medium videos cover each meaningful segment, while long videos cover every supplied transcript chapter.
- New-conversation state uses a restrained two-action launcher for screen selection and file selection. It contains no question field, annotation, intent selector, or output-format selector. Follow-up text remains available only after the first automatic result.
- Settings use ruled groups rather than decorative cards.
- Extensions use two quiet tabs (Plugins and Skills), a compact reviewed-source block, one install source row, a list with enable/audit/remove actions, and an explicit capability boundary. It is not an app-store gallery; the reviewed block is evidence-first rather than promotional.
- Providers use one search field and restrained category filters over a flat, scannable directory. Built-ins, local endpoints, and custom profiles share the same row grammar instead of separate dashboards.
- Each provider row uses the real vendor/product mark, an inline exact-model selector, a quiet default-reasoning selector where the adapter actually forwards it, a small evidence-based discovery status, and one refresh action. Unsupported adapters show “model decides” instead of an active but ineffective effort control. Missing or partial catalogs remain visibly distinct from verified model lists; generic terminal/sparkle tiles are not used as provider identities.

## Components

- Controls use 7–12px corner radii according to size; no pills except tiny status semantics.
- Borders communicate containment; a soft shadow is used only for the floating follow-up composer and drawers.
- Session rows are flat and selected with a quiet blue field. Destructive history controls stay in the contextual three-dot menu rather than occupying a permanent row or title-bar trash icon.
- Loading stays inline in the pending assistant message.
- While a request is running, the composer send control changes in place to a Codex-style stop control; activating it or pressing Escape cancels the same task. The interface does not add a second competing cancel action beside the loading text.
- Errors name the failed action and remain in the owning conversation or top status strip.
- Assistant prose uses semantic Markdown: restrained heading steps, real ordered lists, readable tables, dark code blocks, quotes, and links. User prose stays plain.
- The same ruled evidence area shows the pinned global watermark-directory count, media-compatible algorithm count, declared soft-binding algorithms, EU/China technical marking layers, and the undisclosed-signal scan status. It does not add a dashboard card or convert a candidate anomaly into an origin badge.
- AI-origin, watermark, and prompt-recovery prose is conditional rather than a mandatory appendix. It appears only when image/video evidence contains a relevant credential, declaration, embedded prompt or candidate signal; when the model observes a concrete material anomaly; or when the user explicitly asks. Ordinary media omits the section completely. Text, code, PDF text, and browser text selections never show an AI-authorship verdict or provenance badge.
- Evidence details use quiet ruled rows for C2PA trust, exact AI source type, GB 45438-2025/TC260 `AIGC` declaration, watermark declaration, exact embedded prompt records, EXIF/container fields, hidden-content findings, forensic derivatives, subtitle coverage, and detector boundaries. Signed credentials, unsigned declarations, official-verifier results, and model inference always remain visibly separate; suspected prompt injection uses a restrained danger-tint row rather than a promotional card. The passive origin state and prompt-reconstruction action appear only after AI-origin relevance is established; ordinary photo/video sessions lead directly with content actions.
- Brand mark: a lens/speech ring with three annotation strokes and one cobalt focus point. The colored mark is used for the app and extension; the menu-bar/tray template uses the same geometry without a background tile.
- Session video player: retain native media controls in the 16:9 stage. Its titled header stays sticky inside the player, with discoverable named system-player and collapse/expand controls; collapsing pauses local playback and expanding returns the player to view. A local source also offers the system player as the fallback when embedded playback fails.
- Video keyframes are uniformly sampled, timestamped jump targets. Keep them in a horizontally scrolling strip for narrow windows; each named target seeks (and resumes where supported), while a clear playback-error message keeps the recovery action available.
- Every valid timecode in an assistant video summary is an inline playback control. Selecting `04:20` expands the session player, seeks to 260 seconds, starts local playback or reloads the YouTube embed at that point, and brings the player into view. Chapter headings and ranges use their starting time as the primary jump target.

## Capture overlay

- Fully transparent full-desktop layer with a small arrow-plus-question-mark cursor; the current application remains visually unchanged.
- The first click briefly removes the transparent LensQuery layer from native hit-testing, resolves the underlying image/object/file bounds, then outlines only that target; the capture layer itself and its contextual fallback crop are never presented as the clicked object. Clicking the highlighted target again confirms it. Movement beyond eight logical pixels becomes a rectangular drag and submits on release.
- On macOS, exact object hit-testing requests Accessibility once with a persisted cooldown. Without that permission the picker explains the missing requirement and stays unarmed instead of drawing an invented context rectangle.
- The selected region is a blue outline with a very light interior and pixel dimensions. The exterior remains visually unchanged so the user never loses the surrounding desktop context.
- No toolbar, prompt field, instruction plaque, client confirmation, or busy card appears over the desktop. The unified automatic task is generated from the selected evidence in the background, and Escape always cancels.

## Background surfaces

- The main window starts hidden. Closing it hides, not quits.
- A left click on the resident icon starts smart selection immediately. The right-click menu contains only Start Recognition, Analyze Files, Timeline, Settings, and Quit; diagnostics live in settings, while analysis depth and structure are automatic.
- The transparent selector never draws a fixed cursor-following frame. A first click highlights resolved text, image, PDF, file, or control bounds; a second click confirms it, while dragging selects a freeform region immediately.
- A monochrome template icon lives in the macOS menu bar and adapts to appearance; Windows uses the colored app mark in the system tray.
- Left click starts the default capture. Right click exposes only Start Recognition and Analyze Files, followed by Timeline, Settings, and Quit.
- The upper-right result card is concise and bounded; the full Markdown answer and selected evidence thumbnail remain in the local timeline.
- Finder and browser context menus each expose one direct, verb-led item: **使用 LensQuery 识别**. Do not split target types into a long submenu; the selected object determines whether LensQuery collects text, media, link, DOM, file, folder, or container evidence.

## Motion

Motion communicates state only: three small thinking dots, shortcut scanner rotation, drawer entry from the right, and toggle travel. Reduced-motion mode collapses all of these.

## Accessibility and adaptation

- Visible two-pixel focus, semantic controls, full keyboard operation, Escape cancellation, forced-color support, and reduced-motion support.
- Under 760px the timeline becomes an overlay drawer, labels compact, evidence stacks, and the follow-up dock stays reachable.
- Color never carries the only state signal; every status also has text or an icon.
