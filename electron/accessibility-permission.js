export const ACCESSIBILITY_PERMISSION_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1_000

export function shouldRequestAccessibilityPermission({
  platform = process.platform,
  trusted,
  requestedThisRun,
  lastRequestedAt,
  now = Date.now(),
  cooldownMs = ACCESSIBILITY_PERMISSION_REQUEST_COOLDOWN_MS,
}) {
  if (platform !== 'darwin' || trusted || requestedThisRun) return false
  const previous = Number(lastRequestedAt)
  return !Number.isFinite(previous) || previous <= 0 || now - previous >= cooldownMs
}

export function accessibilityPermissionMessage({ applicationName, applicationPath }) {
  const name = String(applicationName || 'LensQuery')
  const location = String(applicationPath || '/Applications/LensQuery.app')
  return `单击精确选中图片、文件和界面对象需要一次“辅助功能”授权。请在系统设置中打开“${name}”（${location}）；未授权时 LensQuery 不会把单击误当成区域框选。`
}
