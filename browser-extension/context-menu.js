export const UNIVERSAL_CONTEXT_MENU_ID = 'lensquery-analyze'
export const PAGE_CONTEXT_MENU_ID = 'lensquery-analyze-current-url'

export const UNIVERSAL_CONTEXT_MENU = {
  id: UNIVERSAL_CONTEXT_MENU_ID,
  title: '使用 What is it 识别',
  contexts: ['all'],
}

export const PAGE_CONTEXT_MENU = {
  id: PAGE_CONTEXT_MENU_ID,
  title: '使用 What is it 分析当前网址',
  contexts: ['page', 'action'],
}

export function contextKindFor(info = {}) {
  if (String(info.selectionText || '').trim()) return 'selection'
  if (info.mediaType === 'image') return 'image'
  if (info.mediaType === 'video') return 'video'
  if (info.mediaType === 'audio') return 'audio'
  if (info.linkUrl) return 'link'
  if (info.editable) return 'editable'
  return 'object'
}

export function contextRequestFor(info = {}) {
  return {
    kind: contextKindFor(info),
    selectionText: info.selectionText,
    srcUrl: info.srcUrl,
    linkUrl: info.linkUrl,
  }
}

export function pageContextRequestFor() {
  return { kind: 'page' }
}
