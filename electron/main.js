import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from 'electron'

import {
  accessibilityPermissionMessage,
  shouldRequestAccessibilityPermission,
} from './accessibility-permission.js'
import { createExtensionManager } from './extension-manager.js'
import { inspectBehindCaptureOverlay } from './capture-overlay.js'
import { isLensQueryDeepLink, pathsFromDeepLink } from './deep-link.js'
import {
  RESULT_TOAST_HEIGHT,
  RESULT_TOAST_WIDTH,
  resultToastPayload,
  resultToastPosition,
} from './result-toast.js'
import {
  isDirectProvider,
  listDirectProviderModels,
  normalizeProviderBaseUrl,
  runDirectProvider,
} from './direct-provider.js'
import {
  evaluateScreenPermission,
  screenPermissionMessage,
  shouldRequestScreenPermission,
} from './screen-permission.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devUrl = process.env.LENSQUERY_DEV_URL
const isDevelopment = Boolean(devUrl)
app.setName(isDevelopment ? 'LensQuery Development' : 'LensQuery')
const stateFileName = 'desktop-state.json'
const eventQueueDirectory = path.join(os.tmpdir(), 'lensquery-native-messaging')

const defaultSettings = {
  shortcut: 'CommandOrControl+Shift+Space',
  language: 'zh-CN',
  responseLanguage: 'zh-CN',
  detectCustomerLanguage: true,
  replyStyle: 'customer-ready',
  customReplyInstruction: '',
  saveHistory: true,
  retainImages: false,
  showPreview: false,
  defaultProviderId: 'codex-cli',
  defaultAnalysisMode: 'explain',
  defaultOutputFormat: 'adaptive',
  launchAtStartup: true,
  notificationsEnabled: true,
  notificationPreview: true,
  resultPresentation: 'notification',
  voiceMode: 'system',
  autoPlayVoice: false,
}

function normalizeSettings(settings = {}) {
  return {
    ...defaultSettings,
    ...settings,
    // Initial recognition always follows the single automatic-analysis contract.
    // Keep these legacy keys stable for persisted-state compatibility only.
    showPreview: false,
    defaultAnalysisMode: 'explain',
    defaultOutputFormat: 'adaptive',
    customReplyInstruction: '',
  }
}

const defaultProviders = [
  provider('codex-cli', 'Codex CLI', 'codex-cli', 'default', true, true, { category: 'agent' }),
  provider('claude-cli', 'Claude Code', 'claude-cli', 'default', true, false, { category: 'agent' }),
  provider('opencode-cli', 'OpenCode', 'opencode-cli', 'default', true, true, { category: 'agent' }),
  provider('grok-cli', 'Grok CLI', 'grok-cli', 'grok-build', true, false, { category: 'agent' }),
  provider('openai', 'OpenAI', 'openai', 'gpt-5', false, true, { baseUrl: 'https://api.openai.com/v1' }),
  provider('anthropic', 'Anthropic', 'anthropic', 'claude-sonnet-4-5', false, true, { baseUrl: 'https://api.anthropic.com' }),
  provider('gemini', 'Google Gemini', 'compatible', 'gemini-2.5-flash', false, true, { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }),
  provider('xai', 'xAI', 'compatible', 'grok-4-1-fast-reasoning', false, true, { baseUrl: 'https://api.x.ai/v1' }),
  provider('deepseek', 'DeepSeek', 'compatible', 'deepseek-chat', false, false, { baseUrl: 'https://api.deepseek.com' }),
  provider('openrouter', 'OpenRouter', 'compatible', 'openai/gpt-5', false, true, { baseUrl: 'https://openrouter.ai/api/v1' }),
  provider('groq-cloud', 'Groq Cloud', 'compatible', 'openai/gpt-oss-120b', false, true, { baseUrl: 'https://api.groq.com/openai/v1' }),
  provider('mistral', 'Mistral AI', 'compatible', 'mistral-small-latest', false, true, { baseUrl: 'https://api.mistral.ai/v1' }),
  provider('together', 'Together AI', 'compatible', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', false, true, { baseUrl: 'https://api.together.xyz/v1' }),
  provider('fireworks', 'Fireworks AI', 'compatible', 'accounts/fireworks/models/qwen3-235b-a22b', false, true, { baseUrl: 'https://api.fireworks.ai/inference/v1' }),
  provider('siliconflow', 'SiliconFlow', 'compatible', 'Qwen/Qwen3-235B-A22B-Instruct-2507', false, true, { baseUrl: 'https://api.siliconflow.cn/v1' }),
  provider('ollama', 'Ollama', 'compatible', 'qwen3-vl:8b', false, true, { baseUrl: 'http://localhost:11434/v1', category: 'local', apiKeyRequired: false }),
  provider('lm-studio', 'LM Studio', 'compatible', 'local-model', false, true, { baseUrl: 'http://localhost:1234/v1', category: 'local', apiKeyRequired: false }),
]

let mainWindow
let captureWindow
let resultToastWindow
let resultToastReady = false
let pendingResultToast
let tray
let speakingProcess
let state
let extensionManager
let queueTimer
let saveStateQueue = Promise.resolve()
let rendererIsReady = false
let processingExternalPaths = false
let launchHidden = process.argv.some(isLensQueryDeepLink)
const pendingDeepLinks = process.argv.filter(isLensQueryDeepLink)
let screenPermissionRequestedThisRun = false
let screenPermissionNoticeShown = false
let screenPermissionStatusAtLaunch = process.platform === 'darwin' ? 'unknown' : 'granted'
let screenPermissionUnavailableThisRun = process.platform === 'darwin'
let screenPermissionWatchTimer
let screenPermissionRelaunching = false
let accessibilityPermissionRequestedThisRun = false
let accessibilityPermissionNoticeShown = false
const activeAnalyses = new Map()

function debugRuntime(event, details = {}) {
  if (process.env.LENSQUERY_DEBUG !== '1') return
  process.stdout.write(`[LensQuery] ${event} ${JSON.stringify(details)}\n`)
}

function normalizedAnalysisId(value) {
  const id = String(value || '').trim()
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null
}

function cancelLatestActiveAnalysis() {
  const latest = [...activeAnalyses.entries()].at(-1)
  if (!latest) return false
  const [analysisId, controller] = latest
  debugRuntime('analysis-cancel-keyboard', { analysisId, activeCount: activeAnalyses.size })
  controller.abort()
  mainWindow?.webContents.send('lensquery://analysis-cancelled', { analysisId })
  return true
}

function provider(id, name, kind, model, cli, vision, options = {}) {
  return {
    id,
    name,
    kind,
    model,
    reasoningEffort: options.reasoningEffort || 'auto',
    baseUrl: options.baseUrl,
    category: options.category || (cli ? 'agent' : 'cloud'),
    builtIn: true,
    apiKeyRequired: options.apiKeyRequired !== false,
    ready: false,
    secretConfigured: false,
    models: [{ id: model, name: model, source: 'configured' }],
    modelDiscovery: {
      status: 'unavailable',
      source: cli ? '本机 CLI' : '提供商配置',
      message: cli ? '安装并重新扫描后读取模型。' : '连接并测试后读取模型目录。',
    },
    capabilities: { vision, pdf: vision, files: vision, video: vision, audioTranscription: false, streaming: false },
    cli: cli ? { command: kind.replace('-cli', ''), status: 'missing', autoDetected: true } : undefined,
  }
}

function normalizeProviderModels(values, currentModel) {
  const output = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value?.id || '').trim().slice(0, 240)
    if (!id || /[\0\r\n]/.test(id) || seen.has(id)) continue
    seen.add(id)
    const source = ['cli', 'cache', 'api', 'configured', 'alias'].includes(value?.source) ? value.source : 'configured'
    output.push({ id, name: String(value?.name || id).trim().slice(0, 160) || id, source })
    if (output.length >= 600) break
  }
  const current = String(currentModel || '').trim()
  if (current && !seen.has(current)) output.unshift({ id: current, name: current, source: 'configured' })
  return output
}

function statePath() {
  return path.join(app.getPath('userData'), stateFileName)
}

async function loadState() {
  const persisted = await readJson(statePath(), {})
  const secrets = persisted.secrets || {}
  const providers = mergeProviders(defaultProviders, persisted.providers || []).map((profile) => {
    const normalized = { ...profile, models: normalizeProviderModels(profile.models, profile.model) }
    if (!isDirectProvider(normalized)) return normalized
    const secretConfigured = Boolean(secrets[profile.id])
    return {
      ...normalized,
      category: normalized.category || 'cloud',
      apiKeyRequired: normalized.apiKeyRequired !== false,
      secretConfigured,
      ready: normalized.apiKeyRequired === false || secretConfigured,
    }
  })
  return {
    settings: normalizeSettings(persisted.settings),
    providers,
    secrets,
    permissionPrompts: {
      screenCaptureRequestedAt: Number(persisted.permissionPrompts?.screenCaptureRequestedAt) || 0,
      accessibilityRequestedAt: Number(persisted.permissionPrompts?.accessibilityRequestedAt) || 0,
    },
  }
}

async function saveState() {
  const snapshot = structuredClone(state)
  saveStateQueue = saveStateQueue.then(() => writeJsonAtomic(statePath(), snapshot))
  await saveStateQueue
}

function mergeProviders(base, configured) {
  const result = new Map(base.map((item) => [item.id, item]))
  for (const item of configured) {
    const defined = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined))
    result.set(item.id, { ...(result.get(item.id) || {}), ...defined })
  }
  return [...result.values()]
}

function rendererUrl(windowName = 'main') {
  if (devUrl) return `${devUrl}${windowName === 'main' ? '' : `?window=${windowName}`}`
  const file = path.join(__dirname, '..', 'dist', 'index.html')
  const url = pathToFileURL(file)
  if (windowName !== 'main') url.searchParams.set('window', windowName)
  return url.href
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'LensQuery',
    width: 1240,
    height: 820,
    minWidth: 820,
    minHeight: 620,
    show: false,
    backgroundColor: '#151617',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: process.platform === 'win32' ? { color: '#151617', symbolColor: '#d6d7d9', height: 44 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      app.dock?.hide()
    }
  })
  mainWindow.on('ready-to-show', () => {
    if (process.argv.includes('--background') || launchHidden) app.dock?.hide()
    else mainWindow.show()
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape' || input.isAutoRepeat) return
    if (!cancelLatestActiveAnalysis()) return
    event.preventDefault()
  })
  await mainWindow.loadURL(rendererUrl())
  if (isDevelopment && process.env.LENSQUERY_OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
}

async function createCaptureWindow() {
  const displays = screen.getAllDisplays()
  const left = Math.min(...displays.map((display) => display.bounds.x))
  const top = Math.min(...displays.map((display) => display.bounds.y))
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
  captureWindow = new BrowserWindow({
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  captureWindow.on('closed', () => { captureWindow = undefined })
  await captureWindow.loadURL(rendererUrl('capture'))
}

async function createResultToastWindow() {
  resultToastWindow = new BrowserWindow({
    width: RESULT_TOAST_WIDTH,
    height: RESULT_TOAST_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  resultToastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  resultToastWindow.on('closed', () => { resultToastWindow = undefined })
  resultToastWindow.webContents.on('did-finish-load', () => {
    resultToastReady = true
    if (pendingResultToast) {
      const queued = pendingResultToast
      pendingResultToast = undefined
      showResultToast(queued.title, queued.body)
    }
  })
  await resultToastWindow.loadURL(rendererUrl('result-toast'))
}

function positionResultToastWindow() {
  if (!resultToastWindow || resultToastWindow.isDestroyed()) return
  const display = screen.getPrimaryDisplay()
  const bounds = display.workArea || display.bounds
  const { x, y } = resultToastPosition(bounds.x, bounds.y, bounds.width, RESULT_TOAST_WIDTH, display.scaleFactor || 1)
  resultToastWindow.setPosition(x, y)
}

function showResultToast(title, body) {
  const payload = resultToastPayload(title, body)
  if (!payload || !resultToastWindow || resultToastWindow.isDestroyed()) return false
  positionResultToastWindow()
  resultToastWindow.setAlwaysOnTop(true, 'status')
  if (!resultToastReady) {
    pendingResultToast = payload
  } else {
    resultToastWindow.webContents.send('lensquery://result-toast', payload)
  }
  resultToastWindow.showInactive()
  return true
}

function hideResultToast() {
  if (!resultToastWindow || resultToastWindow.isDestroyed()) return
  pendingResultToast = undefined
  resultToastWindow.hide()
}

function createTray() {
  const iconPath = isDevelopment
    ? path.join(app.getAppPath(), 'src-tauri', 'icons', process.platform === 'darwin' ? 'tray-template-44.png' : 'icon.png')
    : path.join(process.resourcesPath, 'icons', process.platform === 'darwin' ? 'tray-template-44.png' : 'icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('LensQuery')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '开始识别', click: () => void startCapture('element') },
    { label: '分析文件…', click: () => sendEvent('lensquery://pick-files') },
    { type: 'separator' },
    { label: '会话时间线', click: () => navigate('timeline') },
    { label: '插件与 Skills', click: () => navigate('extensions') },
    { label: '设置', click: () => navigate('settings') },
    { type: 'separator' },
    { label: '退出 LensQuery', click: () => { app.isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => void startCapture('element'))
}

function showMain() {
  if (!mainWindow) return
  app.dock?.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function navigate(view) {
  showMain()
  sendEvent('lensquery://navigate', view)
}

function sendEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send(channel, payload)
  if (resultToastWindow && !resultToastWindow.isDestroyed()) resultToastWindow.webContents.send(channel, payload)
}

function enqueueDeepLink(value) {
  if (!pathsFromDeepLink(value).length) return false
  launchHidden = true
  pendingDeepLinks.push(value)
  if (rendererIsReady) void flushDeepLinks()
  return true
}

async function flushDeepLinks() {
  if (!rendererIsReady || processingExternalPaths || pendingDeepLinks.length === 0) return
  processingExternalPaths = true
  try {
    while (pendingDeepLinks.length) {
      const values = pendingDeepLinks.splice(0, pendingDeepLinks.length)
      const paths = [...new Set(values.flatMap(pathsFromDeepLink))]
        .filter((sourcePath) => path.isAbsolute(sourcePath) && existsSync(sourcePath))
        .slice(0, 32)
      if (!paths.length) throw new Error('右键选中的文件或文件夹已被移动。')
      const files = await invokeSidecar('inspectFiles', { paths })
      sendEvent('lensquery://evidence-ready', {
        files,
      })
      debugRuntime('finder-context-received', { count: files.length, paths })
    }
  } catch (error) {
    sendEvent('lensquery://capture-error', String(error))
    showNotification('LensQuery 右键识别失败', String(error).slice(0, 240))
  } finally {
    processingExternalPaths = false
  }
}

async function startCapture(mode = 'element') {
  const permission = await ensureScreenCapturePermission()
  if (!permission.granted) {
    sendEvent('lensquery://capture-error', permission.message)
    if (!screenPermissionNoticeShown) {
      screenPermissionNoticeShown = true
      showNotification('LensQuery 需要一次录屏授权', permission.message)
    }
    return { status: 'unavailable', message: permission.message }
  }
  if (mode !== 'region') {
    const accessibility = await ensureAccessibilityPermission()
    if (!accessibility.granted) {
      sendEvent('lensquery://capture-error', accessibility.message)
      if (!accessibilityPermissionNoticeShown) {
        accessibilityPermissionNoticeShown = true
        showNotification('LensQuery 需要一次辅助功能授权', accessibility.message)
      }
      return { status: 'unavailable', message: accessibility.message }
    }
  }
  if (!captureWindow || captureWindow.isDestroyed()) await createCaptureWindow()
  const displays = screen.getAllDisplays()
  const left = Math.min(...displays.map((display) => display.bounds.x))
  const top = Math.min(...displays.map((display) => display.bounds.y))
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
  captureWindow.setBounds({ x: left, y: top, width: right - left, height: bottom - top })
  sendEvent('lensquery://capture-intent', {
    textScope: mode === 'region' ? 'screen' : 'object',
    selectionMode: mode === 'region' ? 'region' : 'auto',
  })
  sendEvent('lensquery://capture-requested')
  captureWindow.show()
  captureWindow.focus()
  debugRuntime('capture-started', { mode, bounds: captureWindow.getBounds() })
  return {
    status: 'started',
    message: '询问模式已开启：单击选择对象；按住鼠标并拖动选择大范围区域，松开后提交。',
  }
}

async function completeCapture(selection) {
  captureWindow?.hide()
  await new Promise((resolve) => setTimeout(resolve, 130))
  try {
    if (process.platform === 'darwin') {
      const permission = currentScreenCapturePermission()
      if (!permission.granted) {
        if (permission.restartRequired) startScreenPermissionWatcher()
        throw new Error(permission.message)
      }
    }
    const response = process.platform === 'darwin'
      ? await completeCaptureWithElectron(selection)
      : await invokeSidecar('completeCapture', { selection })
    const sourcePath = response.evidence?.sourcePath
    const files = sourcePath ? await invokeSidecar('inspectFiles', { paths: [sourcePath] }).catch(() => []) : []
    sendEvent('lensquery://evidence-ready', {
      capture: response.evidence,
      files,
    })
    return response
  } catch (error) {
    sendEvent('lensquery://capture-error', String(error))
    throw error
  }
}

async function ensureScreenCapturePermission() {
  const current = currentScreenCapturePermission()
  if (current.granted || process.platform !== 'darwin') return current

  // The native request is attributed to this signed Electron bundle. Persist a
  // cooldown as well as the per-process flag so repeated app launches cannot
  // trap the user in the same system alert when the wrong LensQuery row was
  // enabled. A settings action remains available throughout the cooldown.
  if (shouldRequestScreenPermission({
    platform: process.platform,
    status: current.status,
    requestedThisRun: screenPermissionRequestedThisRun,
    lastRequestedAt: state.permissionPrompts.screenCaptureRequestedAt,
  })) {
    screenPermissionRequestedThisRun = true
    state.permissionPrompts.screenCaptureRequestedAt = Date.now()
    await saveState()
    startScreenPermissionWatcher()
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 2, height: 2 },
      fetchWindowIcons: false,
    }).catch(() => [])
  }
  const updated = currentScreenCapturePermission()
  if (updated.restartRequired || screenPermissionRequestedThisRun) startScreenPermissionWatcher()
  return updated
}

async function ensureAccessibilityPermission() {
  if (process.platform !== 'darwin') return { granted: true, message: '' }
  const trusted = systemPreferences.isTrustedAccessibilityClient(false)
  if (trusted) return { granted: true, message: '' }

  if (shouldRequestAccessibilityPermission({
    platform: process.platform,
    trusted,
    requestedThisRun: accessibilityPermissionRequestedThisRun,
    lastRequestedAt: state.permissionPrompts.accessibilityRequestedAt,
  })) {
    accessibilityPermissionRequestedThisRun = true
    state.permissionPrompts.accessibilityRequestedAt = Date.now()
    await saveState()
    systemPreferences.isTrustedAccessibilityClient(true)
  }

  return {
    granted: false,
    message: accessibilityPermissionMessage({
      applicationName: app.getName(),
      applicationPath: applicationBundlePath(),
    }),
  }
}

function applicationBundlePath() {
  const executable = app.getPath('exe')
  if (process.platform !== 'darwin') return executable
  const marker = '.app/Contents/MacOS/'
  const markerIndex = executable.indexOf(marker)
  return markerIndex >= 0 ? executable.slice(0, markerIndex + 4) : executable
}

function currentScreenCapturePermission() {
  const status = process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('screen')
    : 'granted'
  if (process.platform === 'darwin' && status !== 'granted') screenPermissionUnavailableThisRun = true
  const decision = evaluateScreenPermission({
    platform: process.platform,
    status,
    launchStatus: screenPermissionUnavailableThisRun ? 'not-determined' : screenPermissionStatusAtLaunch,
  })
  return {
    ...decision,
    message: decision.granted ? '' : screenPermissionMessage({
      decision,
      applicationName: app.getName(),
      applicationPath: applicationBundlePath(),
    }),
  }
}

function screenPermissionStatusPayload() {
  const screenPermission = currentScreenCapturePermission()
  return {
    screenCapture: screenPermission.granted,
    screenCaptureStatus: screenPermission.status,
    screenCaptureRestartRequired: screenPermission.restartRequired,
    accessibility: process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false),
    applicationName: app.getName(),
    applicationPath: applicationBundlePath(),
  }
}

function startScreenPermissionWatcher() {
  if (process.platform !== 'darwin' || screenPermissionWatchTimer || screenPermissionRelaunching) return
  const expiresAt = Date.now() + 5 * 60 * 1_000
  screenPermissionWatchTimer = setInterval(() => {
    if (Date.now() >= expiresAt) {
      clearInterval(screenPermissionWatchTimer)
      screenPermissionWatchTimer = undefined
      return
    }
    const permission = currentScreenCapturePermission()
    if (!permission.restartRequired) return
    clearInterval(screenPermissionWatchTimer)
    screenPermissionWatchTimer = undefined
    screenPermissionRelaunching = true
    debugRuntime('screen-permission-granted-relaunching', { status: permission.status })
    app.relaunch({ args: ['--background', '--screen-permission-restarted'] })
    app.isQuitting = true
    app.quit()
  }, 700)
}

function displayForBounds(bounds) {
  return screen.getDisplayNearestPoint({
    x: Math.round(Number(bounds?.x || 0) + Number(bounds?.width || 1) / 2),
    y: Math.round(Number(bounds?.y || 0) + Number(bounds?.height || 1) / 2),
  })
}

async function inspectCaptureTargetWithDisplay(point, textScope) {
  const display = displayForBounds(point)
  return invokeSidecar('inspectCaptureTarget', {
    point,
    textScope,
    monitorBounds: display.bounds,
  })
}

async function inspectCaptureTargetForPreview(point, textScope) {
  return inspectBehindCaptureOverlay({
    captureWindow,
    inspect: () => inspectCaptureTargetWithDisplay(point, textScope),
  })
}

async function completeCaptureWithElectron(selection) {
  const target = selection.mode === 'element'
    ? await inspectCaptureTargetWithDisplay(selection.bounds, selection.textScope).catch(() => undefined)
    : undefined
  const requestedBounds = target?.bounds?.width >= 2 && target?.bounds?.height >= 2
    ? target.bounds
    : selection.bounds
  const display = displayForBounds(requestedBounds)
  const pixelWidth = Math.max(1, Math.round(display.bounds.width * display.scaleFactor))
  const pixelHeight = Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight },
    fetchWindowIcons: false,
  })
  const source = sources.find((item) => String(item.display_id) === String(display.id))
    ?? sources.find((item) => {
      const size = item.thumbnail.getSize()
      return Math.abs(size.width / Math.max(1, size.height) - pixelWidth / pixelHeight) < 0.02
    })
    ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('屏幕画面尚未授权给 LensQuery，请开启录屏权限后重新打开应用。')
  }

  const sourceSize = source.thumbnail.getSize()
  const scaleX = sourceSize.width / Math.max(1, display.bounds.width)
  const scaleY = sourceSize.height / Math.max(1, display.bounds.height)
  const localX = Math.max(0, Math.min(sourceSize.width - 1, Math.round((requestedBounds.x - display.bounds.x) * scaleX)))
  const localY = Math.max(0, Math.min(sourceSize.height - 1, Math.round((requestedBounds.y - display.bounds.y) * scaleY)))
  const cropWidth = Math.max(1, Math.min(sourceSize.width - localX, Math.round(Math.max(1, requestedBounds.width) * scaleX)))
  const cropHeight = Math.max(1, Math.min(sourceSize.height - localY, Math.round(Math.max(1, requestedBounds.height) * scaleY)))
  const image = source.thumbnail.crop({ x: localX, y: localY, width: cropWidth, height: cropHeight })
  const outputDirectory = path.join(os.tmpdir(), 'lensquery-captures')
  await fs.mkdir(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, `${randomUUID()}.png`)
  await fs.writeFile(outputPath, image.toPNG())

  return {
    status: 'started',
    message: '所选内容已读取，正在后台分析。',
    evidence: {
      id: randomUUID(),
      kind: selection.mode,
      previewUrl: pathToFileURL(outputPath).href,
      bounds: {
        x: requestedBounds.x,
        y: requestedBounds.y,
        width: Math.max(1, requestedBounds.width),
        height: Math.max(1, requestedBounds.height),
      },
      windowTitle: target?.label,
      accessibleText: target?.accessibleText,
      sourcePath: target?.sourcePath,
      textScope: selection.textScope,
    },
  }
}

function registerShortcut(shortcut = state.settings.shortcut) {
  globalShortcut.unregisterAll()
  const registered = globalShortcut.register(shortcut, () => void startCapture('element'))
  debugRuntime('shortcut-registration', { shortcut, registered })
  if (!registered) return false
  return true
}

function resolveSidecar() {
  const names = process.platform === 'win32'
    ? ['lensquery-core.exe', 'lensquery.exe']
    : ['lensquery-core', 'lensquery']
  const roots = isDevelopment
    ? [path.join(app.getAppPath(), 'src-tauri', 'target', 'release')]
    : [path.join(process.resourcesPath, 'sidecar')]
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name)
      try {
        if (fsSyncExists(candidate)) return candidate
      } catch {
        // Continue to the next packaged candidate.
      }
    }
  }
  throw new Error('未找到 LensQuery Rust sidecar，请先运行 npm run build:sidecar。')
}

async function invokeSidecar(method, payload = {}, options = {}) {
  const executable = resolveSidecar()
  const request = JSON.stringify({ method, payload })
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--electron-sidecar'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const signal = options.signal
    const timeoutMs = method === 'analyze'
      ? 300_000
      : method === 'prepareVideo' || method === 'prepareYouTubeVideo' || method === 'prepareWebVideo'
        ? 7_300_000
        : 45_000
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => {
      debugRuntime('sidecar-abort', { method, pid: child.pid })
      killChildTree(child)
      finish(reject, new Error('分析已取消。'))
    }
    const timeout = setTimeout(() => {
      killChildTree(child)
      finish(reject, new Error(`LensQuery sidecar ${method} 超时。`))
    }, timeoutMs)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.length > 64 * 1024 * 1024) killChildTree(child)
    })
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 8_000) })
    child.on('error', (error) => finish(reject, error))
    child.on('exit', (code) => {
      if (settled) return
      if (code !== 0 && !stdout) return finish(reject, new Error(stderr.trim() || `LensQuery sidecar exit ${code}`))
      try {
        const response = JSON.parse(stdout)
        if (!response.ok) finish(reject, new Error(response.error || 'LensQuery sidecar 返回错误。'))
        else finish(resolve, response.result)
      } catch (error) {
        finish(reject, new Error(`LensQuery sidecar 返回格式错误: ${error}; ${stderr.slice(0, 500)}`))
      }
    })
    child.stdin.end(request)
  })
}

function killChildTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.unref()
    return
  }
  const descendants = descendantProcessIds(child.pid)
  debugRuntime('process-tree-kill', { pid: child.pid, descendants })
  for (const pid of descendants.reverse()) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try { process.kill(pid, 'SIGKILL') } catch { /* Process already exited. */ }
    }
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function descendantProcessIds(rootPid) {
  if (!rootPid || process.platform === 'win32') return []
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
  if (result.status !== 0) return []
  const children = new Map()
  for (const line of result.stdout.split('\n')) {
    const [pidValue, parentValue] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pidValue) || !Number.isInteger(parentValue)) continue
    const values = children.get(parentValue) || []
    values.push(pidValue)
    children.set(parentValue, values)
  }
  const descendants = []
  const queue = [...(children.get(rootPid) || [])]
  while (queue.length) {
    const pid = queue.shift()
    descendants.push(pid)
    queue.push(...(children.get(pid) || []))
  }
  return descendants
}

async function discoverProviders() {
  const providers = await invokeSidecar('discoverCliProviders', { providers: state.providers })
  // Rust only understands provider transport fields. Preserve Electron-only
  // catalog metadata such as category, builtIn, and apiKeyRequired.
  state.providers = mergeProviders(state.providers, providers)
  const localProviders = state.providers.filter((profile) => profile.category === 'local' && isDirectProvider(profile))
  await Promise.all(localProviders.map(async (profile) => {
    try {
      const models = await listDirectProviderModels(profile, decryptProviderSecret(profile.id), { timeoutMs: 3_500 })
      const current = models.some(({ id }) => id === profile.model)
        ? models
        : [{ id: profile.model, name: profile.model, source: 'configured' }, ...models]
      Object.assign(profile, {
        models: current,
        modelDiscovery: {
          status: models.length ? 'ready' : 'unavailable',
          source: `${profile.name} /models`,
          message: models.length ? `已读取 ${models.length} 个本地模型。` : '端点已连接，但没有返回模型。',
          checkedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
      profile.modelDiscovery = {
        status: 'unavailable',
        source: `${profile.name} /models`,
        message: String(error?.message || error),
        checkedAt: new Date().toISOString(),
      }
    }
  }))
  await saveState()
  return state.providers
}

function registerIpc() {
  handle('bootstrap', async () => ({
    platform: `electron-${process.platform}`,
    version: app.getVersion(),
    providers: await discoverProviders(),
    settings: state.settings,
  }))
  handle('rendererReady', async () => {
    rendererIsReady = true
    void flushDeepLinks()
    return true
  })
  handle('discoverCliProviders', discoverProviders)
  handle('startCapture', ({ mode }) => startCapture(mode))
  handle('completeCapture', ({ selection }) => completeCapture(selection))
  handle('inspectCaptureTarget', ({ point, textScope }) => inspectCaptureTargetForPreview(point, textScope))
  handle('cancelCapture', async () => { captureWindow?.hide() })
  handle('showMainWindow', async () => showMain())
  handle('permissionStatus', async () => screenPermissionStatusPayload())
  handle('openPermissionSettings', ({ permission }) => openPermissionSettings(permission))
  handle('showNotification', ({ title, body }) => showNotification(title, body))
  handle('hideResultToast', async () => { hideResultToast() })
  handle('openResultFromToast', async () => {
    hideResultToast()
    showMain()
  })
  handle('speakText', ({ text }) => speakText(text))
  handle('stopSpeaking', async () => stopSpeaking())
  handle('saveSettings', async ({ settings }) => {
    const previousSettings = state.settings
    const nextSettings = normalizeSettings(settings)
    if (!registerShortcut(nextSettings.shortcut)) {
      registerShortcut(previousSettings.shortcut)
      throw new Error(`全局快捷键 ${nextSettings.shortcut} 被其他应用占用。`)
    }
    state.settings = nextSettings
    if (!isDevelopment) app.setLoginItemSettings({ openAtLogin: state.settings.launchAtStartup, args: ['--background'] })
    await saveState()
    return state.settings
  })
  handle('saveProvider', async ({ profile }) => {
    const saved = sanitizeProvider(profile)
    state.providers = mergeProviders(state.providers, [saved])
    await saveState()
    return saved
  })
  handle('removeProvider', async ({ providerId }) => {
    const profile = state.providers.find((item) => item.id === providerId)
    if (!profile) throw new Error('没有找到该提供商。')
    if (profile.builtIn !== false) throw new Error('内置提供商可以重新配置，不会从目录中删除。')
    state.providers = state.providers.filter((item) => item.id !== providerId)
    delete state.secrets[providerId]
    if (state.settings.defaultProviderId === providerId) {
      state.settings.defaultProviderId = state.providers.find((item) => item.ready)?.id || 'codex-cli'
    }
    await saveState()
    return { providers: state.providers, settings: state.settings }
  })
  handle('setProviderSecret', async ({ providerId, secret }) => {
    const profile = state.providers.find((item) => item.id === providerId)
    if (!profile) throw new Error('没有找到该提供商。')
    if (!secret?.trim()) {
      delete state.secrets[providerId]
      profile.secretConfigured = false
      profile.ready = profile.apiKeyRequired === false
      await saveState()
      return false
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用。')
    state.secrets[providerId] = safeStorage.encryptString(secret.trim()).toString('base64')
    profile.secretConfigured = true
    profile.ready = true
    await saveState()
    return true
  })
  handle('testProvider', ({ profile }) => testProvider(profile))
  handle('discoverProviderModels', ({ providerId }) => discoverProviderModels(providerId))
  handle('analyze', async ({ request }) => {
    const analysisId = normalizedAnalysisId(request.analysisId) || randomUUID()
    const controller = new AbortController()
    activeAnalyses.get(analysisId)?.abort()
    activeAnalyses.set(analysisId, controller)
    const profile = state.providers.find((item) => item.id === request.providerId)
    try {
      if (!profile) throw new Error('没有找到所选模型通道。')
      const runtimeProfile = {
        ...profile,
        model: normalizeRuntimeModel(request.model, profile.model),
      }
      const extensionInstructions = await extensionManager.collectInstructions()
      if (controller.signal.aborted) throw new Error('分析已取消。')
      const enrichedRequest = { ...request, analysisId, extensionInstructions }
      if (isDirectProvider(runtimeProfile)) {
        const result = await runDirectProvider({
          profile: runtimeProfile,
          secret: decryptProviderSecret(runtimeProfile.id),
          request: enrichedRequest,
          settings: state.settings,
          signal: controller.signal,
        })
        return result
      }
      const result = await invokeSidecar('analyze', {
        request: enrichedRequest,
        profile: runtimeProfile,
        settings: state.settings,
      }, { signal: controller.signal })
      return result
    } finally {
      if (activeAnalyses.get(analysisId) === controller) activeAnalyses.delete(analysisId)
    }
  })
  handle('cancelAnalysis', async ({ analysisId }) => {
    const id = normalizedAnalysisId(analysisId)
    if (!id) throw new Error('取消分析需要有效的任务 ID。')
    const controller = activeAnalyses.get(id)
    debugRuntime('analysis-cancel-ipc', { analysisId: id, found: Boolean(controller), activeCount: activeAnalyses.size })
    if (!controller) return false
    controller.abort()
    return true
  })
  handle('probeVideo', ({ path: sourcePath }) => invokeSidecar('probeVideo', { path: sourcePath }))
  handle('prepareVideo', ({ path: sourcePath, maxFrames }) => invokeSidecar('prepareVideo', { path: sourcePath, maxFrames }))
  handle('prepareYouTubeVideo', ({ url, maxFrames }) => invokeSidecar('prepareYouTubeVideo', { url, maxFrames }))
  handle('prepareWebVideo', ({ url, sourceUrl, maxFrames }) => invokeSidecar('prepareWebVideo', { url, sourceUrl, maxFrames }))
  handle('openLocalPath', async ({ path: sourcePath }) => {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !existsSync(sourcePath)) {
      throw new Error('视频文件已被移动或删除。')
    }
    const message = await shell.openPath(sourcePath)
    if (message) throw new Error(message)
    return true
  })
  handle('inspectFiles', ({ paths }) => invokeSidecar('inspectFiles', { paths }))
  handle('pickEvidenceFiles', pickEvidenceFiles)
  handle('extensions:list', () => extensionManager.list())
  handle('extensions:installFolder', async ({ kind }) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const installed = await extensionManager.install({ kind, source: result.filePaths[0] })
    sendEvent('lensquery://extensions-changed')
    return installed
  })
  handle('extensions:installSource', async ({ kind, source, enabled }) => {
    const installed = await extensionManager.install({ kind, source, enabled: enabled !== false })
    sendEvent('lensquery://extensions-changed')
    return installed
  })
  handle('extensions:setEnabled', async ({ key, enabled }) => {
    const updated = await extensionManager.setEnabled(key, enabled)
    sendEvent('lensquery://extensions-changed')
    return updated
  })
  handle('extensions:remove', async ({ key }) => {
    const target = await extensionManager.remove(key)
    await shell.trashItem(target.installPath)
    sendEvent('lensquery://extensions-changed')
    return true
  })
  handle('extensions:openFolder', async ({ filePath }) => shell.openPath(filePath))
}

function normalizeRuntimeModel(value, fallback) {
  const model = String(value || fallback || 'default').trim()
  if (!model || model.length > 160 || /[\0\r\n]/.test(model)) {
    throw new Error('模型 ID 应为 1–160 个字符的单行文本。')
  }
  return model
}

function handle(channel, handler) {
  ipcMain.handle(`lensquery:${channel}`, (_event, payload = {}) => Promise.resolve(handler(payload)))
}

async function pickEvidenceFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '支持的证据', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg', 'pdf', 'txt', 'md', 'json', 'csv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled) return []
  return invokeSidecar('inspectFiles', { paths: result.filePaths })
}

async function testProvider(profile) {
  if (isDirectProvider(profile)) {
    const configured = state.providers.find((item) => item.id === profile.id) || sanitizeProvider(profile)
    const refreshed = await discoverProviderModels(configured.id)
    return `${refreshed.name} 连接正常 · 可见 ${refreshed.models?.filter(({ source }) => source !== 'configured').length || 0} 个模型`
  }
  const refreshed = await discoverProviders()
  const found = refreshed.find((item) => item.id === profile.id)
  if (!found?.ready) throw new Error(`没有找到 ${profile.name} 可执行文件。`)
  return `${found.name} 已就绪${found.cli?.version ? ` · ${found.cli.version}` : ''}`
}

async function discoverProviderModels(providerId) {
  const profile = state.providers.find((item) => item.id === providerId)
  if (!profile) throw new Error('没有找到该提供商。')
  if (!isDirectProvider(profile)) {
    const refreshed = await discoverProviders()
    const found = refreshed.find((item) => item.id === providerId)
    if (!found) throw new Error('重新扫描后没有找到该提供商。')
    return found
  }
  const models = await listDirectProviderModels(profile, decryptProviderSecret(providerId))
  profile.models = models.some(({ id }) => id === profile.model)
    ? models
    : [{ id: profile.model, name: profile.model, source: 'configured' }, ...models]
  profile.modelDiscovery = {
    status: models.length ? 'ready' : 'unavailable',
    source: `${profile.name} /models`,
    message: models.length ? `已读取 ${models.length} 个模型。` : '端点没有返回模型。',
    checkedAt: new Date().toISOString(),
  }
  await saveState()
  return profile
}

function decryptProviderSecret(providerId) {
  const encrypted = state.secrets[providerId]
  if (!encrypted) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用。')
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    throw new Error('无法解密该提供商的 API Key，请重新保存。')
  }
}

function sanitizeProvider(input) {
  if (!input || typeof input !== 'object') throw new Error('提供商配置格式错误。')
  const id = String(input.id || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) throw new Error('提供商 ID 只能包含小写字母、数字、点、下划线和连字符。')
  const existing = state.providers.find((item) => item.id === id)
  const builtIn = defaultProviders.some((item) => item.id === id) || existing?.builtIn === true
  const kind = builtIn && existing ? existing.kind : String(input.kind || 'compatible')
  if (!['openai', 'anthropic', 'compatible', 'codex-cli', 'claude-cli', 'opencode-cli', 'grok-cli'].includes(kind)) {
    throw new Error('不支持该提供商协议。')
  }
  const name = String(input.name || '').trim().slice(0, 120)
  const model = String(input.model || '').trim().slice(0, 240)
  if (!name || !model) throw new Error('提供商名称和模型 ID 不能为空。')
  const requestedReasoningEffort = String(input.reasoningEffort || 'auto')
  const reasoningEffort = (kind === 'openai' || kind === 'codex-cli')
    && ['auto', 'low', 'medium', 'high', 'xhigh'].includes(requestedReasoningEffort)
    ? requestedReasoningEffort
    : 'auto'
  const direct = ['openai', 'anthropic', 'compatible'].includes(kind)
  const apiKeyRequired = direct ? input.apiKeyRequired !== false : false
  const secretConfigured = Boolean(state.secrets[id])
  return {
    ...(existing || {}),
    ...input,
    id,
    name,
    kind,
    model,
    reasoningEffort,
    models: normalizeProviderModels(input.models, model),
    baseUrl: direct ? normalizeProviderBaseUrl(input.baseUrl) : undefined,
    category: direct ? (input.category === 'local' ? 'local' : input.category === 'custom' ? 'custom' : 'cloud') : 'agent',
    builtIn,
    apiKeyRequired,
    secretConfigured,
    ready: direct ? !apiKeyRequired || secretConfigured : Boolean(input.ready),
  }
}

async function openPermissionSettings(permission) {
  if (process.platform === 'darwin') {
    captureWindow?.hide()
    const pane = permission === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'
    if (permission !== 'accessibility') startScreenPermissionWatcher()
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
    return screenPermissionStatusPayload()
  }
  if (process.platform === 'win32') await shell.openExternal('ms-settings:privacy-screenshots')
  return screenPermissionStatusPayload()
}

function showNotification(title, body) {
  if (showResultToast(title, body)) return true
  if (!Notification.isSupported()) return false
  const notification = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 1_000), silent: false })
  notification.on('click', showMain)
  notification.show()
  return true
}

function speakText(text) {
  stopSpeaking()
  if (process.platform === 'darwin') {
    speakingProcess = spawn('/usr/bin/say', ['--', String(text).slice(0, 20_000)], { stdio: 'ignore' })
    return 'macos-say'
  }
  if (process.platform === 'win32') {
    const escaped = String(text).slice(0, 20_000).replaceAll("'", "''")
    speakingProcess = spawn('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')`], { stdio: 'ignore', windowsHide: true })
    return 'windows-sapi'
  }
  return 'renderer-speech'
}

function stopSpeaking() {
  speakingProcess?.kill('SIGTERM')
  speakingProcess = undefined
}

async function pollBrowserQueue() {
  await fs.mkdir(eventQueueDirectory, { recursive: true })
  const entries = (await fs.readdir(eventQueueDirectory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .slice(0, 16)
  for (const entry of entries) {
    const file = path.join(eventQueueDirectory, entry.name)
    const context = await readJson(file, null)
    await fs.rm(file, { force: true })
    if (!context) continue
    const capture = context.snapshotPreviewUrl && context.snapshotPath
      ? {
          id: randomUUID(),
          kind: 'element',
          previewUrl: context.snapshotPreviewUrl,
          bounds: context.snapshotBounds || { x: 0, y: 0, width: 1, height: 1 },
          windowTitle: context.title,
          processName: 'Browser',
          accessibleText: `网页右键目标: ${context.contextMenuKind || '当前对象'}`,
          textScope: context.contextMenuKind === 'selection' ? 'selection' : context.contextMenuKind === 'page' ? 'page' : 'object',
        }
      : undefined
    sendEvent('lensquery://evidence-ready', {
      capture,
      files: [],
      browserContext: context,
    })
  }
}

function fsSyncExists(file) {
  return existsSync(file)
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, file)
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  enqueueDeepLink(url)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLinks = commandLine.filter(isLensQueryDeepLink)
    if (deepLinks.length) {
      deepLinks.forEach(enqueueDeepLink)
      return
    }
    showMain()
  })
  app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient('lensquery')
    nativeTheme.themeSource = process.env.LENSQUERY_THEME === 'dark' ? 'dark' : process.env.LENSQUERY_THEME === 'light' ? 'light' : 'system'
    state = await loadState()
    if (!isDevelopment) {
      app.setLoginItemSettings({ openAtLogin: state.settings.launchAtStartup, args: ['--background'] })
    }
    screenPermissionStatusAtLaunch = process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('screen')
      : 'granted'
    screenPermissionUnavailableThisRun = process.platform === 'darwin' && screenPermissionStatusAtLaunch !== 'granted'
    extensionManager = createExtensionManager(app.getPath('userData'))
    registerIpc()
    await createMainWindow()
    await createCaptureWindow()
    await createResultToastWindow()
    createTray()
    registerShortcut(state.settings.shortcut)
    queueTimer = setInterval(() => void pollBrowserQueue(), 350)
    if (process.argv.includes('--screen-permission-restarted') && currentScreenCapturePermission().granted) {
      setTimeout(() => showNotification('LensQuery 录屏权限已生效', '快捷键可以直接选择屏幕对象或区域。'), 700)
    }
    if (process.env.LENSQUERY_CAPTURE_PATH) {
      const targetView = process.env.LENSQUERY_CAPTURE_VIEW
      setTimeout(async () => {
        if (targetView) sendEvent('lensquery://navigate', targetView)
        await new Promise((resolve) => setTimeout(resolve, 650))
        const image = await mainWindow.webContents.capturePage()
        await fs.writeFile(process.env.LENSQUERY_CAPTURE_PATH, image.toPNG())
        process.stdout.write(`LensQuery screenshot: ${process.env.LENSQUERY_CAPTURE_PATH}\n`)
      }, 1_200)
    }
  })
}

app.on('activate', showMain)
app.on('window-all-closed', () => undefined)
app.on('before-quit', () => {
  app.isQuitting = true
  for (const controller of activeAnalyses.values()) controller.abort()
  activeAnalyses.clear()
  clearInterval(queueTimer)
  clearInterval(screenPermissionWatchTimer)
  globalShortcut.unregisterAll()
  stopSpeaking()
})
