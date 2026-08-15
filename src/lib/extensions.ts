import type { ExtensionKind, ExtensionPackage } from '../types/domain'
import { invokeElectron, isElectronRuntime } from './tauri'

export async function listExtensions(): Promise<ExtensionPackage[]> {
  if (!isElectronRuntime()) return []
  return invokeElectron<ExtensionPackage[]>('extensions:list')
}

export async function installExtensionFolder(kind: ExtensionKind): Promise<ExtensionPackage | null> {
  if (!isElectronRuntime()) throw new Error('插件与 Skill 安装器需要 Electron 客户端。')
  return invokeElectron<ExtensionPackage | null>('extensions:installFolder', { kind })
}

export async function installExtensionSource(kind: ExtensionKind, source: string, enabled = true): Promise<ExtensionPackage> {
  if (!isElectronRuntime()) throw new Error('插件与 Skill 安装器需要 Electron 客户端。')
  return invokeElectron<ExtensionPackage>('extensions:installSource', { kind, source, enabled })
}

export interface RecommendedSkill {
  id: string
  name: string
  description: string
  source: string
  repository: string
  license: string
  fit: 'native' | 'reference'
  defaultEnabled: boolean
}

export const recommendedSkills: RecommendedSkill[] = [
  {
    id: 'pdf',
    name: 'PDF',
    description: '官方 PDF 阅读、版式检查与输出验证工作流。包含外部工具指引，LensQuery 内默认关闭。',
    source: 'https://github.com/openai/skills/tree/main/skills/.curated/pdf',
    repository: 'openai/skills',
    license: 'Apache-2.0',
    fit: 'reference',
    defaultEnabled: false,
  },
  {
    id: 'transcribe',
    name: 'Audio Transcribe',
    description: '官方音频 / 视频转写与可选说话人分离流程。需要 OpenAI API 和配套脚本，默认关闭。',
    source: 'https://github.com/openai/skills/tree/main/skills/.curated/transcribe',
    repository: 'openai/skills',
    license: 'Apache-2.0',
    fit: 'reference',
    defaultEnabled: false,
  },
  {
    id: 'speech',
    name: 'Speech',
    description: '官方文本转语音、旁白和批量生成工作流。系统朗读仍由 LensQuery 原生功能承载。',
    source: 'https://github.com/openai/skills/tree/main/skills/.curated/speech',
    repository: 'openai/skills',
    license: 'Apache-2.0',
    fit: 'reference',
    defaultEnabled: false,
  },
]

export async function setExtensionEnabled(key: string, enabled: boolean): Promise<ExtensionPackage> {
  if (!isElectronRuntime()) throw new Error('插件与 Skill 管理需要 Electron 客户端。')
  return invokeElectron<ExtensionPackage>('extensions:setEnabled', { key, enabled })
}

export async function removeExtension(key: string): Promise<boolean> {
  if (!isElectronRuntime()) throw new Error('插件与 Skill 管理需要 Electron 客户端。')
  return invokeElectron<boolean>('extensions:remove', { key })
}

export async function openExtensionFolder(filePath: string): Promise<void> {
  if (!isElectronRuntime()) return
  await invokeElectron('extensions:openFolder', { filePath })
}

export async function listenForExtensionChanges(handler: () => void): Promise<() => void> {
  if (!isElectronRuntime()) return () => undefined
  return window.lensQueryDesktop!.on('lensquery://extensions-changed', handler)
}
