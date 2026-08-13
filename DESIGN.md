# LensQuery design system

<!-- impeccable:design-schema 1 -->

## Direction

LensQuery is a fixed-region desktop instrument derived from Japanese sixteen-color computer interfaces. It refuses generic dashboard cards: the screen is partitioned into a capture field, evidence bay, command log, and model channel. One-pixel seams and named operational regions make the route from evidence to answer visible.

## Color

The canonical palette lives as sixteen CSS tokens in `src/index.css`, from `--space` through `--paper`. Cream is the principal foreground, indigo is structural chrome, magenta is the action state, cyan is verification, and yellow is privacy/attention. New colors should be composed from these roles rather than introducing an unrelated accent.

## Typography

- UI and longer Chinese copy use the platform workhorse stack: Segoe UI Variable, Yu Gothic UI, then system sans.
- Machine captions, shortcut keys, versions, and measurements use Cascadia Mono or the platform monospace fallback.
- Display text is heavy, compact, and never exceeds two lines in the first viewport.
- Operational text should remain at least 11px; primary labels are 12–14px.

## Geometry and material

- Rectangular controls with zero radius.
- One-pixel cream or indigo seams communicate actual regions.
- Inset light/dark edges create pressed computer controls.
- Dither is reserved for image/capture fields where tone or selection has a semantic role.
- Cards are not general-purpose containers; use regions, caption bars, lists, and negative space.

## Layout

Desktop uses a 48px title strip, 78px navigation rail, dominant capture region, narrow right evidence/model channel, and lower MESSAGE.LOG command region. Mobile reorders the command composer directly after capture; evidence and provider detail follow, with the four-action navigation fixed at the bottom.

## Components and states

- Primary action: magenta field, cream seam, inset highlights.
- Secondary action: steel field with the same physical response.
- Selected navigation/prompt: inverted or magenta state with a visible pointer.
- Loading: preserve the final region and use a stepped cursor/rotation, never a blocking modal spinner.
- Empty: show how to add evidence without implying an upload occurred.
- Error: inline in the owning region, naming both problem and recovery.
- Unready provider: honest “未配置” capability states and an enabled “先配置模型” action.

## Accessibility

All workflows remain keyboard-operable, focus uses a two-pixel cyan outline, reduced motion collapses animations, forced-color mode removes visual scenery, and color is never the only state signal. The fixed mobile rail requires matching bottom safe-area padding.

## Motion

Motion imitates cell and palette changes: stepped reticle pulse, blinking answer cursor, and bounded loading rotation. Avoid generic entrance animations and continuous ambient movement.

## Responsive rules

- Under 980px, side channels stack and desktop border seams simplify.
- Under 700px, the side rail becomes a bottom rail, the capture stage compresses, command moves ahead of evidence, and empty evidence becomes a compact add-content region.
- The interface must have no horizontal overflow at 390px.

