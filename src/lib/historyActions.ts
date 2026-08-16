export type HistoryDeleteTarget =
  | { kind: 'session'; id: string; title: string }
  | { kind: 'all'; count: number }

export interface HistoryMenuState {
  target: HistoryDeleteTarget
  origin: string
  left: number
  top: number
}

const MENU_WIDTH = 188
const MENU_HEIGHT = 42
const VIEWPORT_MARGIN = 8

export function fitHistoryMenuPosition(
  x: number,
  y: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
) {
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, x - MENU_WIDTH),
    Math.max(VIEWPORT_MARGIN, viewportWidth - MENU_WIDTH - VIEWPORT_MARGIN),
  )
  const below = y + MENU_HEIGHT + VIEWPORT_MARGIN <= viewportHeight
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, below ? y : y - MENU_HEIGHT),
    Math.max(VIEWPORT_MARGIN, viewportHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
  )
  return { left, top }
}
