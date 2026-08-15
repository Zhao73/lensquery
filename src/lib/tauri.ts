import { invoke } from '@tauri-apps/api/core'
import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
  BootstrapState,
  CaptureMode,
  CaptureResponse,
  ProviderProfile,
  FileEvidence,
  VideoMetadata,
  VideoPreparation,
  BrowserContext,
  CaptureEvidence,
  CaptureTarget,
  CaptureSelection,
  Bounds,
} from '../types/domain'

interface LensQueryDesktopBridge {
  platform: string
  invoke<T>(channel: string, payload?: Record<string, unknown>): Promise<T>
  on<T>(channel: string, handler: (payload: T) => void): () => void
  getPathForFile(file: globalThis.File): string
}

declare global {
  interface Window {
    lensQueryDesktop?: LensQueryDesktopBridge
  }
}

export const isElectronRuntime = () => Boolean(window.lensQueryDesktop)
export const isTauriRuntime = () => '__TAURI_INTERNALS__' in window
export const isDesktopRuntime = () => isTauriRuntime() || isElectronRuntime()

export async function invokeElectron<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.lensQueryDesktop
  if (!bridge) throw new Error('Electron desktop bridge is not available.')
  return bridge.invoke<T>(channel, payload)
}

const demoProviders: ProviderProfile[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    model: 'gpt-5',
    ready: false,
    secretConfigured: false,
    capabilities: { vision: true, pdf: true, files: true, video: true, audioTranscription: true, streaming: true },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    model: 'claude-sonnet-4-5',
    ready: false,
    secretConfigured: false,
    capabilities: { vision: true, pdf: true, files: true, video: true, audioTranscription: false, streaming: true },
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    kind: 'codex-cli',
    model: 'default',
    ready: false,
    secretConfigured: true,
    capabilities: { vision: true, pdf: false, files: false, video: true, audioTranscription: false, streaming: false },
    cli: { command: 'codex', status: 'missing', autoDetected: true },
  },
  {
    id: 'claude-cli',
    name: 'Claude Code',
    kind: 'claude-cli',
    model: 'default',
    ready: false,
    secretConfigured: true,
    capabilities: { vision: false, pdf: false, files: false, video: false, audioTranscription: false, streaming: false },
    cli: { command: 'claude', status: 'missing', autoDetected: true },
  },
  {
    id: 'opencode-cli',
    name: 'OpenCode',
    kind: 'opencode-cli',
    model: 'default',
    ready: false,
    secretConfigured: false,
    capabilities: { vision: true, pdf: true, files: true, video: true, audioTranscription: false, streaming: false },
    cli: { command: 'opencode', status: 'missing', autoDetected: true },
  },
  {
    id: 'grok-cli',
    name: 'Grok CLI',
    kind: 'grok-cli',
    model: 'grok-build',
    ready: false,
    secretConfigured: false,
    capabilities: { vision: false, pdf: false, files: false, video: false, audioTranscription: false, streaming: false },
    cli: { command: 'grok', status: 'missing', autoDetected: true },
  },
]

export const defaultSettings: AppSettings = {
  shortcut: 'CommandOrControl+Shift+Space',
  language: 'zh-CN',
  responseLanguage: 'zh-CN',
  detectCustomerLanguage: true,
  replyStyle: 'customer-ready',
  customReplyInstruction: '',
  saveHistory: true,
  retainImages: false,
  showPreview: false,
  defaultProviderId: 'openai',
  defaultAnalysisMode: 'explain',
  defaultOutputFormat: 'adaptive',
  launchAtStartup: true,
  notificationsEnabled: true,
  notificationPreview: true,
  resultPresentation: 'notification',
  voiceMode: 'system',
  autoPlayVoice: false,
}

export async function bootstrap(): Promise<BootstrapState> {
  if (isElectronRuntime()) return invokeElectron<BootstrapState>('bootstrap')
  if (isTauriRuntime()) {
    const state = await invoke<BootstrapState>('bootstrap')
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load('settings.json', { autoSave: false })
    const persisted = await store.get<Partial<AppSettings>>('settings')
    const persistedProviders = await store.get<ProviderProfile[]>('providers')
    if (persistedProviders?.length) {
      await Promise.all(persistedProviders.map((profile) => invoke('save_provider', { profile })))
      state.providers = await invoke<ProviderProfile[]>('discover_cli_providers')
    }
    if (persisted) {
      state.settings = { ...state.settings, ...persisted }
      await invoke('save_settings', { settings: state.settings })
    }
    return state
  }
  const persisted = readBrowserSettings()
  const persistedProviders = readBrowserProviders()
  return {
    platform: navigator.platform || 'browser preview',
    version: '0.1.0-preview',
    providers: mergeProviders(demoProviders, persistedProviders),
    settings: { ...defaultSettings, ...persisted },
  }
}

function readBrowserSettings(): Partial<AppSettings> {
  try {
    return JSON.parse(localStorage.getItem('lensquery.settings') ?? '{}') as Partial<AppSettings>
  } catch {
    return {}
  }
}

function readBrowserProviders(): ProviderProfile[] {
  try {
    return JSON.parse(localStorage.getItem('lensquery.providers') ?? '[]') as ProviderProfile[]
  } catch {
    return []
  }
}

function mergeProviders(base: ProviderProfile[], configured: ProviderProfile[]) {
  const profiles = new Map(base.map((profile) => [profile.id, profile]))
  for (const profile of configured) profiles.set(profile.id, profile)
  return [...profiles.values()]
}

export async function discoverCliProviders(): Promise<ProviderProfile[]> {
  if (isElectronRuntime()) return invokeElectron<ProviderProfile[]>('discoverCliProviders')
  if (isTauriRuntime()) return invoke<ProviderProfile[]>('discover_cli_providers')
  await new Promise((resolve) => window.setTimeout(resolve, 450))
  return demoProviders
}

export async function startCapture(mode: CaptureMode): Promise<CaptureResponse> {
  if (isElectronRuntime()) return invokeElectron<CaptureResponse>('startCapture', { mode })
  if (isTauriRuntime()) return invoke<CaptureResponse>('start_capture', { mode })
  return {
    status: 'mocked',
    message:
      mode === 'region'
        ? '桌面框选需要在 Tauri 应用中运行。浏览器预览已保留完整流程。'
        : '桌面元素识别需要 Windows UI Automation。浏览器预览已保留完整流程。',
  }
}

export async function completeCapture(selection: CaptureSelection): Promise<CaptureResponse> {
  if (isElectronRuntime()) return invokeElectron<CaptureResponse>('completeCapture', { selection })
  if (isTauriRuntime()) return invoke<CaptureResponse>('complete_capture', { selection })
  throw new Error('桌面取景层只在 Tauri 应用中运行。')
}

export async function inspectCaptureTarget(
  point: Bounds,
  textScope?: string,
): Promise<CaptureTarget> {
  if (isElectronRuntime()) return invokeElectron<CaptureTarget>('inspectCaptureTarget', { point, textScope })
  if (isTauriRuntime()) return invoke<CaptureTarget>('inspect_capture_target', { point, textScope })
  return {
    bounds: { x: point.x - 160, y: point.y - 100, width: 320, height: 200 },
    label: '屏幕上下文',
    kind: 'screen-context',
    fallback: true,
  }
}

export async function cancelCapture(): Promise<void> {
  if (!isDesktopRuntime()) return
  if (isElectronRuntime()) await invokeElectron('cancelCapture')
  else await invoke('cancel_capture')
}

export async function showMainWindow(): Promise<void> {
  if (!isDesktopRuntime()) return
  if (isElectronRuntime()) await invokeElectron('showMainWindow')
  else await invoke('show_main')
}

export interface DesktopPermissionStatus {
  screenCapture: boolean
  accessibility: boolean
}

export async function getPermissionStatus(): Promise<DesktopPermissionStatus> {
  if (!isDesktopRuntime()) return { screenCapture: true, accessibility: true }
  if (isElectronRuntime()) return invokeElectron<DesktopPermissionStatus>('permissionStatus')
  return invoke<DesktopPermissionStatus>('permission_status')
}

export async function openPermissionSettings(permission: 'screen' | 'accessibility'): Promise<void> {
  if (!isDesktopRuntime()) return
  if (isElectronRuntime()) await invokeElectron('openPermissionSettings', { permission })
  else await invoke('open_permission_settings', { permission })
}

export async function showSystemNotification(title: string, body: string): Promise<boolean> {
  if (!isDesktopRuntime()) return false
  if (isElectronRuntime()) return invokeElectron<boolean>('showNotification', { title, body })
  return invoke<boolean>('show_notification', { title, body })
}

export interface ResultToastPayload {
  title: string
  body: string
}

export async function hideResultToast(): Promise<void> {
  if (!isDesktopRuntime()) return
  if (isElectronRuntime()) await invokeElectron('hideResultToast')
  else await invoke('hide_result_toast')
}

export async function openResultFromToast(): Promise<void> {
  if (!isDesktopRuntime()) return
  if (isElectronRuntime()) await invokeElectron('openResultFromToast')
  else await invoke('open_result_from_toast')
}

export async function listenForResultToast(
  handler: (payload: ResultToastPayload) => void,
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on<ResultToastPayload>('lensquery://result-toast', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen<ResultToastPayload>('lensquery://result-toast', ({ payload }) => handler(payload))
}

export async function speakText(text: string): Promise<string> {
  if (!isDesktopRuntime()) {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    window.speechSynthesis.speak(utterance)
    return 'browser-system-voice'
  }
  if (isElectronRuntime()) return invokeElectron<string>('speakText', { text })
  return invoke<string>('speak_text', { text })
}

export async function stopSpeaking(): Promise<void> {
  if (!isDesktopRuntime()) {
    window.speechSynthesis.cancel()
    return
  }
  if (isElectronRuntime()) await invokeElectron('stopSpeaking')
  else await invoke('stop_speaking')
}

export interface QueryEvidenceEvent {
  capture?: CaptureEvidence
  files?: FileEvidence[]
  browserContext?: BrowserContext
  analysisMode?: AnalysisRequest['analysisMode']
  outputFormat?: AnalysisRequest['outputFormat']
  annotation?: string
}

export async function listenForCaptureRequests(handler: () => void): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on('lensquery://capture-requested', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen('lensquery://capture-requested', handler)
}

export async function listenForCaptureErrors(handler: (message: string) => void): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on<string>('lensquery://capture-error', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen<string>('lensquery://capture-error', ({ payload }) => handler(payload))
}

export async function listenForQueryEvidence(
  handler: (payload: QueryEvidenceEvent) => void,
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on<QueryEvidenceEvent>('lensquery://evidence-ready', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen<QueryEvidenceEvent>('lensquery://evidence-ready', ({ payload }) => handler(payload))
}

export async function listenForCaptureIntent(
  handler: (payload: {
    analysisMode?: AnalysisRequest['analysisMode']
    outputFormat?: AnalysisRequest['outputFormat']
    textScope?: string
    selectionMode?: 'auto' | 'region' | 'element'
  }) => void,
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on('lensquery://capture-intent', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen('lensquery://capture-intent', ({ payload }) => handler(payload as Parameters<typeof handler>[0]))
}

export async function listenForNavigation(handler: (view: 'timeline' | 'providers' | 'extensions' | 'settings') => void): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on('lensquery://navigate', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen<'timeline' | 'providers' | 'extensions' | 'settings'>('lensquery://navigate', ({ payload }) => handler(payload))
}

export async function listenForFilePickRequest(handler: () => void): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) return window.lensQueryDesktop!.on('lensquery://pick-files', handler)
  const { listen } = await import('@tauri-apps/api/event')
  return listen('lensquery://pick-files', handler)
}

export async function analyze(request: AnalysisRequest): Promise<AnalysisResult> {
  if (isElectronRuntime()) return invokeElectron<AnalysisResult>('analyze', { request })
  if (isTauriRuntime()) return invoke<AnalysisResult>('analyze', { request })
  await new Promise((resolve) => window.setTimeout(resolve, 900))
  const source = request.files[0]?.name ?? request.captures[0]?.windowTitle ?? '当前选择'
  return {
    id: crypto.randomUUID(),
    provider: '本地预览',
    model: 'mock-adapter',
    createdAt: new Date().toISOString(),
    durationMs: 900,
    answer: `已收到“${source}”的分析请求。\n\n这是浏览器开发预览，因此没有把内容发送到外部模型。安装桌面构建并配置提供商后，这里会显示基于截图、可访问性上下文与文件内容的真实回答。`,
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (isElectronRuntime()) return invokeElectron<AppSettings>('saveSettings', { settings })
  if (isTauriRuntime()) {
    const saved = await invoke<AppSettings>('save_settings', { settings })
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load('settings.json', { autoSave: false })
    await store.set('settings', saved)
    await store.save()
    return saved
  }
  localStorage.setItem('lensquery.settings', JSON.stringify(settings))
  return settings
}

export async function saveProvider(profile: ProviderProfile): Promise<ProviderProfile> {
  if (isElectronRuntime()) return invokeElectron<ProviderProfile>('saveProvider', { profile })
  if (isTauriRuntime()) {
    const saved = await invoke<ProviderProfile>('save_provider', { profile })
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load('settings.json', { autoSave: false })
    const providers = mergeProviders(await store.get<ProviderProfile[]>('providers') ?? [], [saved])
    await store.set('providers', providers)
    await store.save()
    return saved
  }
  localStorage.setItem('lensquery.providers', JSON.stringify(mergeProviders(readBrowserProviders(), [profile])))
  return profile
}

export async function setProviderSecret(providerId: string, secret: string): Promise<boolean> {
  if (isElectronRuntime()) return invokeElectron<boolean>('setProviderSecret', { providerId, secret })
  if (isTauriRuntime()) return invoke<boolean>('set_provider_secret', { providerId, secret })
  return secret.trim().length > 0
}

export async function testProvider(profile: ProviderProfile): Promise<string> {
  if (isElectronRuntime()) return invokeElectron<string>('testProvider', { profile })
  if (isTauriRuntime()) return invoke<string>('test_provider', { profile })
  await new Promise((resolve) => window.setTimeout(resolve, 500))
  return profile.kind.endsWith('cli')
    ? '桌面构建会检查可执行文件路径。'
    : '浏览器预览不会发送连接测试。'
}

export async function probeVideo(path: string): Promise<VideoMetadata> {
  if (isElectronRuntime()) return invokeElectron<VideoMetadata>('probeVideo', { path })
  if (isTauriRuntime()) return invoke<VideoMetadata>('probe_video', { path })
  throw new Error('浏览器预览不能读取视频路径；桌面版将使用本地 FFprobe 检测。')
}

export async function prepareVideo(
  path: string,
  maxFrames = 12,
): Promise<VideoPreparation> {
  if (isElectronRuntime()) return invokeElectron<VideoPreparation>('prepareVideo', { path, maxFrames })
  if (isTauriRuntime()) return invoke<VideoPreparation>('prepare_video', { path, maxFrames })
  throw new Error('浏览器预览不会处理视频；桌面版将在本地抽取关键帧与音轨。')
}

export async function inspectEvidencePaths(paths: string[]): Promise<FileEvidence[]> {
  if (!isDesktopRuntime()) return []
  if (isElectronRuntime()) return invokeElectron<FileEvidence[]>('inspectFiles', { paths })
  return invoke<FileEvidence[]>('inspect_files', { paths })
}

export async function pickEvidenceFiles(): Promise<FileEvidence[] | null> {
  if (!isDesktopRuntime()) return null
  if (isElectronRuntime()) return invokeElectron<FileEvidence[]>('pickEvidenceFiles')
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: '支持的证据', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg', 'pdf', 'txt', 'md', 'json', 'csv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx'] },
      { name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (!selected) return []
  return inspectEvidencePaths(Array.isArray(selected) ? selected : [selected])
}

export async function listenForEvidenceDrops(
  onFiles: (files: FileEvidence[]) => void,
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  if (isElectronRuntime()) {
    const prevent = (event: DragEvent) => event.preventDefault()
    const drop = async (event: DragEvent) => {
      event.preventDefault()
      const paths = [...(event.dataTransfer?.files ?? [])]
        .map((file) => window.lensQueryDesktop?.getPathForFile(file))
        .filter((value): value is string => Boolean(value))
      if (paths.length) onFiles(await inspectEvidencePaths(paths))
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(async ({ payload }) => {
    if (payload.type !== 'drop') return
    const files = await inspectEvidencePaths(payload.paths)
    onFiles(files)
  })
}
