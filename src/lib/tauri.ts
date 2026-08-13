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
} from '../types/domain'

export const isDesktopRuntime = () => '__TAURI_INTERNALS__' in window

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
    model: 'configured CLI model',
    ready: false,
    secretConfigured: true,
    capabilities: { vision: true, pdf: false, files: false, video: true, audioTranscription: false, streaming: false },
  },
  {
    id: 'claude-cli',
    name: 'Claude Code',
    kind: 'claude-cli',
    model: 'configured CLI model',
    ready: false,
    secretConfigured: true,
    capabilities: { vision: false, pdf: false, files: false, video: false, audioTranscription: false, streaming: false },
  },
]

export const defaultSettings: AppSettings = {
  shortcut: 'CommandOrControl+Shift+Space',
  language: 'zh-CN',
  saveHistory: true,
  retainImages: false,
  showPreview: true,
  defaultProviderId: 'openai',
}

export async function bootstrap(): Promise<BootstrapState> {
  if (isDesktopRuntime()) return invoke<BootstrapState>('bootstrap')
  return {
    platform: navigator.platform || 'browser preview',
    version: '0.1.0-preview',
    providers: demoProviders,
    settings: defaultSettings,
  }
}

export async function startCapture(mode: CaptureMode): Promise<CaptureResponse> {
  if (isDesktopRuntime()) return invoke<CaptureResponse>('start_capture', { mode })
  return {
    status: 'mocked',
    message:
      mode === 'region'
        ? '桌面框选需要在 Tauri 应用中运行。浏览器预览已保留完整流程。'
        : '桌面元素识别需要 Windows UI Automation。浏览器预览已保留完整流程。',
  }
}

export async function analyze(request: AnalysisRequest): Promise<AnalysisResult> {
  if (isDesktopRuntime()) return invoke<AnalysisResult>('analyze', { request })
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
  if (isDesktopRuntime()) return invoke<AppSettings>('save_settings', { settings })
  localStorage.setItem('lensquery.settings', JSON.stringify(settings))
  return settings
}

export async function saveProvider(profile: ProviderProfile): Promise<ProviderProfile> {
  if (isDesktopRuntime()) return invoke<ProviderProfile>('save_provider', { profile })
  return profile
}

export async function setProviderSecret(providerId: string, secret: string): Promise<boolean> {
  if (isDesktopRuntime()) return invoke<boolean>('set_provider_secret', { providerId, secret })
  return secret.trim().length > 0
}

export async function testProvider(profile: ProviderProfile): Promise<string> {
  if (isDesktopRuntime()) return invoke<string>('test_provider', { profile })
  await new Promise((resolve) => window.setTimeout(resolve, 500))
  return profile.kind.endsWith('cli')
    ? '桌面构建会检查可执行文件路径。'
    : '浏览器预览不会发送连接测试。'
}

export async function probeVideo(path: string): Promise<VideoMetadata> {
  if (isDesktopRuntime()) return invoke<VideoMetadata>('probe_video', { path })
  throw new Error('浏览器预览不能读取视频路径；桌面版将使用本地 FFprobe 检测。')
}

export async function prepareVideo(
  path: string,
  maxFrames = 12,
): Promise<VideoPreparation> {
  if (isDesktopRuntime()) return invoke<VideoPreparation>('prepare_video', { path, maxFrames })
  throw new Error('浏览器预览不会处理视频；桌面版将在本地抽取关键帧与音轨。')
}

export async function inspectEvidencePaths(paths: string[]): Promise<FileEvidence[]> {
  if (!isDesktopRuntime()) return []
  return invoke<FileEvidence[]>('inspect_files', { paths })
}

export async function pickEvidenceFiles(): Promise<FileEvidence[] | null> {
  if (!isDesktopRuntime()) return null
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
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(async ({ payload }) => {
    if (payload.type !== 'drop') return
    const files = await inspectEvidencePaths(payload.paths)
    onFiles(files)
  })
}
