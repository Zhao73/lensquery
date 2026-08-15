export const SCREEN_PERMISSION_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1_000

const macStatuses = new Set(['not-determined', 'granted', 'denied', 'restricted', 'unknown'])

export function normalizeScreenPermissionStatus(status, platform = process.platform) {
  if (platform !== 'darwin') return 'granted'
  return macStatuses.has(status) ? status : 'unknown'
}

export function evaluateScreenPermission({ platform = process.platform, status, launchStatus }) {
  const current = normalizeScreenPermissionStatus(status, platform)
  const initial = normalizeScreenPermissionStatus(launchStatus, platform)
  const restartRequired = platform === 'darwin' && current === 'granted' && initial !== 'granted'
  return {
    status: current,
    granted: current === 'granted' && !restartRequired,
    restartRequired,
  }
}

export function shouldRequestScreenPermission({
  platform = process.platform,
  status,
  requestedThisRun,
  lastRequestedAt,
  now = Date.now(),
  cooldownMs = SCREEN_PERMISSION_REQUEST_COOLDOWN_MS,
}) {
  if (platform !== 'darwin' || normalizeScreenPermissionStatus(status, platform) !== 'not-determined') return false
  if (requestedThisRun) return false
  const previous = Number(lastRequestedAt)
  return !Number.isFinite(previous) || previous <= 0 || now - previous >= cooldownMs
}

export function screenPermissionMessage({ decision, applicationName, applicationPath }) {
  const name = String(applicationName || 'LensQuery Electron Preview')
  const location = String(applicationPath || '/Applications/LensQuery Electron Preview.app')
  if (decision.restartRequired) {
    return `录屏权限已打开，${name} 正在自动重启以使权限生效。本次不会继续请求屏幕。`
  }
  if (decision.status === 'not-determined') {
    return `请只授权“${name}”，完整路径是 ${location}。若列表中还有旧版 LensQuery，不要选旧版。打开开关后应用会自动重启。`
  }
  if (decision.status === 'denied') {
    return `录屏权限已被关闭。请在“录屏与系统录音”中打开“${name}”（${location}），随后应用会自动重启。`
  }
  if (decision.status === 'restricted') {
    return '录屏权限被系统管理策略限制，请检查“隐私与安全性”或设备管理配置。'
  }
  return `当前没有可用的录屏权限。请在系统设置中确认“${name}”（${location}）后重试。`
}
