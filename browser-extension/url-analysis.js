export const OMNIBOX_KEYWORD = 'lq'

export function isAnalyzableUrl(value) {
  return /^(?:https?|file):/i.test(String(value || ''))
}

export function normalizeAnalysisUrl(input, currentUrl = '') {
  const value = String(input || '').trim() || String(currentUrl || '').trim()
  if (!value) return undefined

  const localhost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const hostname = /^(?:www\.)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?::\d+)?(?:[/?#]|$)/i.test(value)
  const explicitScheme = /^(?:https?|file):/i.test(value)
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !explicitScheme && !localhost && !hostname) return undefined
  const candidate = explicitScheme ? value : localhost ? `http://${value}` : hostname ? `https://${value}` : ''
  if (!candidate) return undefined

  try {
    const url = new URL(candidate)
    return isAnalyzableUrl(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

export function omniboxSuggestion(input, currentUrl = '') {
  const normalized = normalizeAnalysisUrl(input, currentUrl)
  if (normalized) return `使用 What is it 分析：${normalized}`
  return '输入完整网址，或留空分析当前页面'
}
