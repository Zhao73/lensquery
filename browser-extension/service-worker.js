import {
  contextRequestFor,
  PAGE_CONTEXT_MENU,
  PAGE_CONTEXT_MENU_ID,
  pageContextRequestFor,
  UNIVERSAL_CONTEXT_MENU,
  UNIVERSAL_CONTEXT_MENU_ID,
} from './context-menu.js'
import {
  normalizeAnalysisUrl,
  omniboxSuggestion,
} from './url-analysis.js'

const NATIVE_HOST = 'com.lensquery.desktop'
const MAX_SNAPSHOT_DATA_URL_LENGTH = 650_000

chrome.runtime.onInstalled.addListener(installContextMenus)
chrome.runtime.onStartup.addListener(installContextMenus)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === UNIVERSAL_CONTEXT_MENU_ID) void handleContextMenu(contextRequestFor(info), info, tab)
  if (info.menuItemId === PAGE_CONTEXT_MENU_ID) {
    if (tab?.id) void handleContextMenu(pageContextRequestFor(), info, tab)
    else void analyzeCurrentPage()
  }
})

chrome.action.onClicked.addListener((tab) => {
  void analyzeCurrentPage(tab).catch((error) => reportAnalysisError(error, tab))
})
chrome.commands.onCommand.addListener((command) => {
  if (command === 'ask-lensquery') void startPicker()
})

chrome.omnibox.setDefaultSuggestion({ description: '使用 What is it 分析当前网址' })
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  if (!text.trim()) {
    suggest([])
    return
  }
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    suggest([{ content: text, description: omniboxSuggestion(text, tab?.url) }])
  }).catch(() => suggest([{ content: text, description: omniboxSuggestion(text) }]))
})
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void analyzeOmniboxUrl(text, disposition).catch((error) => reportAnalysisError(error))
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'lensquery-context') return false
  submitContext(message.context, sender.tab, sender.frameId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }))
  return true
})

function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(UNIVERSAL_CONTEXT_MENU)
    chrome.contextMenus.create(PAGE_CONTEXT_MENU)
  })
}

async function analyzeCurrentPage(tab) {
  const activeTab = tab?.id ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!activeTab?.id) return
  await handleContextMenu(pageContextRequestFor(), { pageUrl: activeTab.url, frameId: 0 }, activeTab)
}

async function reportAnalysisError(error, tab) {
  const activeTab = tab?.id ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!activeTab?.id) return
  await showPageNotice(activeTab.id, 0, `What is it 网址分析失败：${String(error).slice(0, 180)}`, false)
}

async function analyzeOmniboxUrl(text, disposition) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const targetUrl = normalizeAnalysisUrl(text, activeTab?.url)
  if (!targetUrl) {
    if (activeTab?.id) await showPageNotice(activeTab.id, 0, '请输入完整网址，例如 https://example.com。', false)
    return
  }

  if (activeTab?.id && sameUrl(activeTab.url, targetUrl)) {
    await analyzeCurrentPage(activeTab)
    return
  }

  const targetTab = disposition === 'currentTab' && activeTab?.id
    ? await chrome.tabs.update(activeTab.id, { url: targetUrl })
    : await chrome.tabs.create({ url: targetUrl, active: disposition !== 'newBackgroundTab' })
  if (!targetTab?.id) return
  const loadedTab = await waitForTab(targetTab.id)
  await analyzeCurrentPage(loadedTab)
}

function sameUrl(left, right) {
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return left === right
  }
}

async function waitForTab(tabId, timeoutMs = 30_000) {
  const current = await chrome.tabs.get(tabId)
  if (current.status === 'complete') return current
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error('网页加载超时。'))
    }, timeoutMs)
    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve(tab)
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

async function startPicker(tab) {
  const activeTab = tab?.id ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!activeTab?.id || !isSupportedPage(activeTab.url)) return
  await injectPageContext(activeTab.id, 0)
  await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['picker.css'] })
  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['picker.js'] })
}

async function handleContextMenu(action, info, tab) {
  if (!tab?.id) return
  const frameId = Number.isInteger(info.frameId) ? info.frameId : 0
  try {
    let context
    if (isSupportedPage(info.frameUrl || info.pageUrl || tab.url)) {
      try {
        await injectPageContext(tab.id, frameId)
        const response = await chrome.tabs.sendMessage(
          tab.id,
          {
            type: 'lensquery-collect-page-context',
            request: {
              ...action,
            },
          },
          { frameId },
        )
        if (!response?.ok) throw new Error(response?.error || '页面上下文读取失败。')
        context = response.context
      } catch {
        context = fallbackContext(action.kind, info, tab)
      }
    } else {
      context = fallbackContext(action.kind, info, tab)
    }

    await submitContext(context, tab, frameId)
    await showPageNotice(tab.id, frameId, '已发送到 What is it，正在后台分析。', true)
  } catch (error) {
    await showPageNotice(tab.id, frameId, `What is it 连接失败：${String(error).slice(0, 180)}`, false)
  }
}

async function injectPageContext(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ['page-context.js'],
  })
}

async function submitContext(rawContext, tab, frameId = 0) {
  const context = { ...rawContext }
  const snapshot = context.__snapshot
  delete context.__snapshot
  if (snapshot?.rect) context.snapshotBounds = snapshot.rect
  if (snapshot && tab?.active && frameId === 0) {
    context.snapshotDataUrl = await captureTargetSnapshot(tab, snapshot)
  }
  await sendToDesktop(context)
}

async function captureTargetSnapshot(tab, target) {
  if (!tab.windowId || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return undefined
  try {
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 88 })
    const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob())
    const viewportWidth = Math.max(1, Number(target.viewportWidth) || bitmap.width)
    const viewportHeight = Math.max(1, Number(target.viewportHeight) || bitmap.height)
    const scaleX = bitmap.width / viewportWidth
    const scaleY = bitmap.height / viewportHeight
    const padding = target.rect.width >= viewportWidth - 2 && target.rect.height >= viewportHeight - 2 ? 0 : 14
    const sourceX = Math.max(0, Math.floor((target.rect.x - padding) * scaleX))
    const sourceY = Math.max(0, Math.floor((target.rect.y - padding) * scaleY))
    const sourceRight = Math.min(bitmap.width, Math.ceil((target.rect.x + target.rect.width + padding) * scaleX))
    const sourceBottom = Math.min(bitmap.height, Math.ceil((target.rect.y + target.rect.height + padding) * scaleY))
    const sourceWidth = Math.max(1, sourceRight - sourceX)
    const sourceHeight = Math.max(1, sourceBottom - sourceY)

    for (const maxEdge of [1_280, 960, 720]) {
      const outputScale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * outputScale))
      const height = Math.max(1, Math.round(sourceHeight * outputScale))
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d').drawImage(
        bitmap,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      )
      for (const quality of [0.82, 0.68, 0.54, 0.42]) {
        const dataUrl = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
        if (dataUrl.length <= MAX_SNAPSHOT_DATA_URL_LENGTH) {
          bitmap.close()
          return dataUrl
        }
      }
    }
    bitmap.close()
  } catch {
    // DOM context is still useful when the page blocks visible-tab capture.
  }
  return undefined
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

function fallbackContext(kind, info, tab) {
  const selectedText = String(info.selectionText || '').trim().slice(0, 16_000) || undefined
  const source = info.srcUrl || info.linkUrl
  const mediaKind = kind === 'video' || kind === 'audio' ? kind : undefined
  return {
    url: info.pageUrl || tab.url || '',
    title: tab.title || '网页',
    tagName: kind === 'image'
      ? 'IMG'
      : kind === 'video'
        ? 'VIDEO'
        : kind === 'audio'
          ? 'AUDIO'
          : kind === 'link'
            ? 'A'
            : kind === 'editable'
              ? 'INPUT'
              : kind === 'selection'
                ? 'SELECTION'
                : 'BODY',
    role: kind,
    text: selectedText,
    accessibleName: source,
    nearbyText: selectedText,
    selectionMode: kind === 'selection' ? 'selection' : kind === 'page' ? 'page' : 'object',
    selectedText,
    contextMenuKind: kind,
    media: mediaKind ? {
      kind: mediaKind,
      currentTime: 0,
      source: info.srcUrl,
      paused: true,
    } : undefined,
  }
}

function isSupportedPage(url) {
  return /^https?:|^file:/i.test(String(url || ''))
}

async function showPageNotice(tabId, frameId, message, success) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      args: [message, success],
      func: (text, ok) => {
        document.getElementById('lensquery-context-notice')?.remove()
        const notice = document.createElement('div')
        notice.id = 'lensquery-context-notice'
        notice.textContent = text
        Object.assign(notice.style, {
          position: 'fixed',
          zIndex: '2147483647',
          top: '18px',
          right: '18px',
          maxWidth: '360px',
          padding: '11px 13px',
          border: `1px solid ${ok ? 'rgba(93, 185, 122, .58)' : 'rgba(224, 92, 92, .62)'}`,
          borderRadius: '8px',
          color: '#f6f7f9',
          background: 'rgba(27, 31, 38, .96)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, .24)',
          font: '13px/1.45 system-ui, sans-serif',
        })
        document.documentElement.appendChild(notice)
        setTimeout(() => notice.remove(), 4_500)
      },
    })
  } catch {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: success ? '#2f8f57' : '#b94343' }).catch(() => undefined)
    await chrome.action.setBadgeText({ tabId, text: success ? '✓' : '!' }).catch(() => undefined)
  }
}

async function sendToDesktop(context) {
  await new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'browser-context', context }, (reply) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else if (!reply?.ok) reject(new Error(reply?.error || 'What is it desktop did not accept the context.'))
      else resolve(reply)
    })
  })
}
