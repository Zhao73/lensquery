import { invoke } from '@tauri-apps/api/core'
import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
  BootstrapState,
  CaptureMode,
  CaptureResponse,
  ProviderProfile,
} from '../types/domain'

const isTauri = () => '__TAURI_INTERNALS__' in window

const demoProviders: ProviderProfile[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    model: 'gpt-5',
    ready: false,
    secretConfigured: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    model: 'claude-sonnet-4-5',
    ready: false,
    secretConfigured: false,
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    kind: 'codex-cli',
    model: 'configured CLI model',
    ready: false,
    secretConfigured: true,
  },
  {
    id: 'claude-cli',
    name: 'Claude Code',
    kind: 'claude-cli',
    model: 'configured CLI model',
    ready: false,
    secretConfigured: true,
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
  if (isTauri()) return invoke<BootstrapState>('bootstrap')
  return {
    platform: navigator.platform || 'browser preview',
    version: '0.1.0-preview',
    providers: demoProviders,
    settings: defaultSettings,
  }
}

export async function startCapture(mode: CaptureMode): Promise<CaptureResponse> {
  if (isTauri()) return invoke<CaptureResponse>('start_capture', { mode })
  return {
    status: 'mocked',
    message:
      mode === 'region'
        ? '桌面框选需要在 Tauri 应用中运行。浏览器预览已保留完整流程。'
        : '桌面元素识别需要 Windows UI Automation。浏览器预览已保留完整流程。',
  }
}

export async function analyze(request: AnalysisRequest): Promise<AnalysisResult> {
  if (isTauri()) return invoke<AnalysisResult>('analyze', { request })
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
  if (isTauri()) return invoke<AppSettings>('save_settings', { settings })
  localStorage.setItem('lensquery.settings', JSON.stringify(settings))
  return settings
}

export async function saveProvider(profile: ProviderProfile): Promise<ProviderProfile> {
  if (isTauri()) return invoke<ProviderProfile>('save_provider', { profile })
  return profile
}

export async function setProviderSecret(providerId: string, secret: string): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('set_provider_secret', { providerId, secret })
  return secret.trim().length > 0
}

export async function testProvider(profile: ProviderProfile): Promise<string> {
  if (isTauri()) return invoke<string>('test_provider', { profile })
  await new Promise((resolve) => window.setTimeout(resolve, 500))
  return profile.kind.endsWith('cli')
    ? '桌面构建会检查可执行文件路径。'
    : '浏览器预览不会发送连接测试。'
}

