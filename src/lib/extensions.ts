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

export async function installExtensionSource(kind: ExtensionKind, source: string): Promise<ExtensionPackage> {
  if (!isElectronRuntime()) throw new Error('插件与 Skill 安装器需要 Electron 客户端。')
  return invokeElectron<ExtensionPackage>('extensions:installSource', { kind, source })
}

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
