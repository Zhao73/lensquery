# LensQuery design system

<!-- impeccable:design-schema 1 -->

## Direction

LensQuery is a resident Windows workbench. It refuses a marketing-like homepage and decorative dashboard. The durable surface is a quiet conversation timeline; the memorable interaction is the system-wide question cursor that appears after one shortcut.

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

- Main window: 292px searchable timeline plus a flexible conversation canvas.
- Top bar: 50px with sidebar toggle, product name, resident status, and three plain navigation targets.
- Conversation: source/title bar, centered message stream, persistent follow-up dock.
- Empty state teaches the one-shortcut interaction; it is not a homepage or upload landing page.
- Settings use ruled groups rather than decorative cards.

## Components

- Controls use 7–12px corner radii according to size; no pills except tiny status semantics.
- Borders communicate containment; a soft shadow is used only for the floating follow-up composer and drawers.
- Session rows are flat and selected with a quiet blue field.
- Loading stays inline in the pending assistant message.
- Errors name the failed action and remain in the owning conversation or top status strip.

## Capture overlay

- Transparent full-desktop layer with a custom blue question-mark cursor.
- Click reads an object; movement beyond eight logical pixels becomes a rectangular drag.
- The selected region is a blue outline with a dimmed exterior and pixel dimensions.
- One compact instruction plaque appears at the top. Escape always cancels.

## Motion

Motion communicates state only: three small thinking dots, shortcut scanner rotation, drawer entry from the right, and toggle travel. Reduced-motion mode collapses all of these.

## Accessibility and adaptation

- Visible two-pixel focus, semantic controls, full keyboard operation, Escape cancellation, forced-color support, and reduced-motion support.
- Under 760px the timeline becomes an overlay drawer, labels compact, evidence stacks, and the follow-up dock stays reachable.
- Color never carries the only state signal; every status also has text or an icon.
