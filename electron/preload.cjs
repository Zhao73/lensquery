const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invokeChannels = new Set([
  'bootstrap',
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
})
