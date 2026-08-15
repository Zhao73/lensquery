const MAX_EXTERNAL_PATHS = 32

export function isLensQueryDeepLink(value) {
  return /^lensquery:\/\//i.test(String(value || ''))
}

export function pathsFromDeepLink(value) {
  if (!isLensQueryDeepLink(value)) return []
  try {
    const url = new URL(value)
    if (url.protocol !== 'lensquery:' || url.hostname !== 'analyze') return []
    return [...new Set(url.searchParams.getAll('path').map((item) => item.trim()).filter(Boolean))]
      .slice(0, MAX_EXTERNAL_PATHS)
  } catch {
    return []
  }
}
