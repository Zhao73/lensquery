const { contextBridge, ipcRenderer, webUtils } = require('electron')

function localFileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  const encodeSegments = (value) => value
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  if (normalized.startsWith('//')) return `file://${encodeSegments(normalized.slice(2))}`
  return `file://${normalized.startsWith('/') ? '' : '/'}${encodeSegments(normalized)}`
}

const invokeChannels = new Set([
  'bootstrap',
  'rendererReady',
  'discoverCliProviders',
  'startCapture',
  'completeCapture',
  'inspectCaptureTarget',
  'cancelCapture',
  'showMainWindow',
  'permissionStatus',
  'openPermissionSettings',
  'showNotification',
  'hideResultToast',
  'openResultFromToast',
  'speakText',
  'stopSpeaking',
  'saveSettings',
  'saveProvider',
  'removeProvider',
  'setProviderSecret',
  'testProvider',
  'analyze',
  'probeVideo',
  'prepareVideo',
  'prepareYouTubeVideo',
  'openLocalPath',
  'inspectFiles',
  'pickEvidenceFiles',
  'extensions:list',
  'extensions:installFolder',
  'extensions:installSource',
  'extensions:setEnabled',
  'extensions:remove',
  'extensions:openFolder',
])

const eventChannels = new Set([
  'lensquery://capture-requested',
  'lensquery://capture-error',
  'lensquery://capture-intent',
  'lensquery://evidence-ready',
  'lensquery://navigate',
  'lensquery://pick-files',
  'lensquery://result-toast',
  'lensquery://extensions-changed',
])

contextBridge.exposeInMainWorld('lensQueryDesktop', {
  platform: process.platform,
  invoke(channel, payload) {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`Unsupported IPC channel: ${channel}`))
    return ipcRenderer.invoke(`lensquery:${channel}`, payload)
  },
  on(channel, handler) {
    if (!eventChannels.has(channel)) throw new Error(`Unsupported event channel: ${channel}`)
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  toFileUrl(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) return ''
    return localFileUrl(filePath)
  },
})
