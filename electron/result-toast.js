export const RESULT_TOAST_WIDTH = 392
export const RESULT_TOAST_HEIGHT = 156

export function truncateToastText(value, maxChars) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

export function resultToastPosition(monitorX, monitorY, monitorWidth, toastWidth, scaleFactor = 1) {
  const edge = Math.round(18 * scaleFactor)
  const menuClearance = Math.round(38 * scaleFactor)
  const right = monitorX + monitorWidth
  const x = Math.max(monitorX, right - toastWidth - edge)
  return { x, y: monitorY + menuClearance }
}

export function resultToastPayload(title, body) {
  const nextTitle = truncateToastText(title, 120)
  const nextBody = truncateToastText(body, 280)
  if (!nextTitle || !nextBody) return null
  return { title: nextTitle, body: nextBody }
}
