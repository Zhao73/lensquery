# LensQuery design system

<!-- impeccable:design-schema 1 -->

## Direction

LensQuery is a resident Windows/macOS Electron workbench. It refuses a marketing-like homepage and decorative dashboard. Its client follows the restrained information architecture of coding-agent applications: persistent navigation and local timelines on the left, one contextual top bar, and a focused conversation/composer canvas. The memorable interaction remains the system-wide question cursor that appears after one shortcut.

The 2026-08 annotation expansion keeps that world but makes the empty conversation state an operational console: intent, optional annotation, file entry, output contract, and direct question are visible without turning the window into a homepage.

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
- Sidebar: wordmark, new conversation, direct recognition action, search, recent local sessions, and bottom navigation for conversations, models, extensions, and settings.
- Top bar: 52px with the current surface name, resident status, current provider, and a direct recognition action.
- Conversation: source/title bar, centered message stream, persistent follow-up dock.
- New-conversation state uses one centered, spacious composer with optional instruction, intent, output contract, attachment, and send controls. It is not a homepage or upload landing page.
- Settings use ruled groups rather than decorative cards.
- Extensions use two quiet tabs (Plugins and Skills), a compact reviewed-source block, one install source row, a list with enable/audit/remove actions, and an explicit capability boundary. It is not an app-store gallery; the reviewed block is evidence-first rather than promotional.
- Providers use one search field and restrained category filters over a flat, scannable directory. Built-ins, local endpoints, and custom profiles share the same row grammar instead of separate dashboards.

## Components

- Controls use 7–12px corner radii according to size; no pills except tiny status semantics.
- Borders communicate containment; a soft shadow is used only for the floating follow-up composer and drawers.
- Session rows are flat and selected with a quiet blue field.
- Loading stays inline in the pending assistant message.
- Errors name the failed action and remain in the owning conversation or top status strip.
- Assistant prose uses semantic Markdown: restrained heading steps, real ordered lists, readable tables, dark code blocks, quotes, and links. User prose stays plain.
- Evidence details use quiet ruled rows for C2PA trust, AI source type, watermark declaration, EXIF fields, subtitle coverage, and detector boundaries. Direct evidence is never visually merged with model inference.
- Brand mark: a lens/speech ring with three annotation strokes and one cobalt focus point. The colored mark is used for the app and extension; the menu-bar/tray template uses the same geometry without a background tile.

## Capture overlay

- Fully transparent full-desktop layer with a small arrow-plus-question-mark cursor; the current application remains visually unchanged.
- The first click resolves and outlines the real object/file bounds; clicking that highlighted target again confirms it. Movement beyond eight logical pixels becomes a rectangular drag and submits on release.
- The selected region is a blue outline with a dimmed exterior and pixel dimensions.
- No toolbar, instruction plaque, client confirmation, or busy card appears over the desktop. The configured intent is applied in the background, and Escape always cancels.

## Background surfaces

- The main window starts hidden. Closing it hides, not quits.
- A left click on the resident icon starts smart selection immediately. The right-click menu contains only Start Recognition, Analyze Files, Timeline, Settings, and Quit; analysis modes and diagnostics live in the client/settings surface.
- The transparent selector never draws a fixed cursor-following frame. A first click highlights resolved text, image, PDF, file, or control bounds; a second click confirms it, while dragging selects a freeform region immediately.
- A monochrome template icon lives in the macOS menu bar and adapts to appearance; Windows uses the colored app mark in the system tray.
- Left click starts the default capture. Right click exposes only Start Recognition and Analyze Files, followed by Timeline, Settings, and Quit.
- The upper-right result card is concise and bounded; the full Markdown answer and selected evidence thumbnail remain in the local timeline.

## Motion

Motion communicates state only: three small thinking dots, shortcut scanner rotation, drawer entry from the right, and toggle travel. Reduced-motion mode collapses all of these.

## Accessibility and adaptation

- Visible two-pixel focus, semantic controls, full keyboard operation, Escape cancellation, forced-color support, and reduced-motion support.
- Under 760px the timeline becomes an overlay drawer, labels compact, evidence stacks, and the follow-up dock stays reachable.
- Color never carries the only state signal; every status also has text or an icon.
