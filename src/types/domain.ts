export type CaptureMode = 'region' | 'element'

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'compatible'
  | 'codex-cli'
  | 'claude-cli'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureEvidence {
  id: string
  kind: CaptureMode
  previewUrl: string
  bounds: Bounds
  windowTitle?: string
  processName?: string
  accessibleText?: string
}

export interface FileEvidence {
  id: string
  name: string
  path: string
  mediaType: string
  size: number
  kind: 'image' | 'video' | 'pdf' | 'text' | 'other'
  video?: VideoMetadata
  videoPreparation?: VideoPreparation
  processingError?: string
  processingStatus?: 'idle' | 'preparing' | 'ready' | 'error'
}

export interface VideoMetadata {
  durationSeconds: number
  width?: number
  height?: number
  frameRate?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio: boolean
  rotation?: number
}

export interface VideoFrame {
  path: string
  previewUrl?: string
  timestampSeconds: number
}

export interface VideoPreparation {
  id: string
  sourcePath: string
  outputDirectory: string
  frames: VideoFrame[]
  audioPath?: string
  sampleIntervalSeconds: number
  originalDurationSeconds: number
  strategy: 'uniform-keyframes-v1'
}

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  model: string
  baseUrl?: string
  ready: boolean
  secretConfigured: boolean
  capabilities?: {
    vision: boolean
    pdf: boolean
    files: boolean
    video: boolean
    audioTranscription: boolean
    streaming: boolean
  }
}

export interface AnalysisRequest {
  question: string
  promptId: string
  providerId: string
  captures: CaptureEvidence[]
  files: FileEvidence[]
}

export interface AnalysisResult {
  id: string
  answer: string
  model: string
  provider: string
  createdAt: string
  durationMs: number
}

export interface AppSettings {
  shortcut: string
  language: 'zh-CN' | 'en'
  saveHistory: boolean
  retainImages: boolean
  showPreview: boolean
  defaultProviderId: string
}

export interface BootstrapState {
  platform: string
  version: string
  providers: ProviderProfile[]
  settings: AppSettings
}

export interface CaptureResponse {
  status: 'started' | 'mocked' | 'unavailable'
  message: string
  evidence?: CaptureEvidence
}
