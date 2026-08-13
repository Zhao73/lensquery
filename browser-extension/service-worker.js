const NATIVE_HOST = 'com.lensquery.desktop'

chrome.action.onClicked.addListener(startPicker)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'ask-lensquery') void startPicker()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'lensquery-context') return false
  sendToDesktop(message.context)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }))
  return true
})

async function startPicker(tab) {
  const activeTab = tab?.id ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!activeTab?.id || activeTab.url?.startsWith('chrome://')) return
  await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['picker.css'] })
  await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['picker.js'] })
}

async function sendToDesktop(context) {
  await new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'browser-context', context }, (reply) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else if (!reply?.ok) reject(new Error(reply?.error || 'LensQuery desktop did not accept the context.'))
      else resolve(reply)
    })
  })
}
