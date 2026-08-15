export type CaptureMode = 'region' | 'element'

export type AnalysisMode = 'identify' | 'explain' | 'how-to' | 'deep-dive' | 'customer-reply' | 'code'
export type OutputFormat = 'adaptive' | 'summary' | 'steps' | 'report' | 'customer-reply' | 'markdown'
export type TextScope = 'object' | 'selection' | 'word' | 'paragraph' | 'page' | 'screen'
export type ExtensionKind = 'plugin' | 'skill'

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'compatible'
  | 'codex-cli'
  | 'claude-cli'
  | 'opencode-cli'
  | 'grok-cli'

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
  sourcePath?: string
  textScope?: TextScope
  annotation?: string
  analysisMode?: AnalysisMode
  outputFormat?: OutputFormat
}

export interface CaptureTarget {
  bounds: Bounds
  label: string
  kind: 'pdf' | 'image' | 'video' | 'file' | 'element' | 'screen-context'
  sourcePath?: string
  accessibleText?: string
  fallback: boolean
}

export interface BrowserContext {
  url: string
  title: string
  tagName: string
  role?: string
  text?: string
  accessibleName?: string
  selector?: string
  outerHtml?: string
  nearbyText?: string
  selectionMode?: TextScope
  selectedText?: string
  captions?: string
  transcript?: string
  transcriptLanguage?: string
  transcriptCueCount?: number
  transcriptTruncated?: boolean
  contextMenuKind?: 'selection' | 'image' | 'video' | 'audio' | 'link' | 'editable' | 'object' | 'page'
  snapshotPath?: string
  snapshotPreviewUrl?: string
  snapshotBounds?: Bounds
  annotation?: string
  analysisMode?: AnalysisMode
  outputFormat?: OutputFormat
  media?: {
    kind: 'video' | 'audio'
    currentTime: number
    duration?: number
    source?: string
    paused: boolean
  }
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
  extractedText?: string
  pageCount?: number
  extractionStatus?: 'not-needed' | 'ready' | 'partial' | 'unsupported' | 'error'
  provenance?: ImageProvenance
}

export interface ImageProvenance {
  c2pa?: C2paEvidence
  metadata: MetadataEvidence[]
  aiSignals: string[]
  cameraMetadataPresent: boolean
  detectorCoverage: string
}

export interface C2paEvidence {
  embedded: boolean
  validationState: 'trusted' | 'valid' | 'invalid'
  signerTrusted: boolean
  issuer?: string
  commonName?: string
  claimGenerator?: string
  signedAt?: string
  actions: string[]
  digitalSourceTypes: string[]
  softwareAgents: string[]
  aiGeneratedDeclared: boolean
  embeddedWatermarkDeclared: boolean
  validationWarnings: string[]
}

export interface MetadataEvidence {
  label: string
  value: string
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
  transcript?: string
  transcriptSource?: string
  transcriptLanguage?: string
  transcriptKind?: 'sidecar-subtitle' | 'local-whisper'
  transcriptionStatus?: string
}

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  model: string
  baseUrl?: string
  category?: 'agent' | 'cloud' | 'local' | 'custom'
  builtIn?: boolean
  apiKeyRequired?: boolean
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
  cli?: {
    command: string
    executablePath?: string
    version?: string
    status: 'missing' | 'ready' | 'version-timeout'
    autoDetected: boolean
  }
}

export interface ProviderRemovalResult {
  providers: ProviderProfile[]
  settings: AppSettings
}

export interface AnalysisRequest {
  question: string
  promptId: string
  providerId: string
  captures: CaptureEvidence[]
  files: FileEvidence[]
  browserContext?: BrowserContext
  conversation?: ConversationMessage[]
  analysisMode?: AnalysisMode
  outputFormat?: OutputFormat
  annotation?: string
  extensionInstructions?: string
}

export interface ExtensionPackage {
  key: string
  id: string
  kind: ExtensionKind
  name: string
  description: string
  version: string
  author?: string
  origin: 'lensquery' | 'codex' | 'agents' | 'installed' | string
  managed: boolean
  enabled: boolean
  installPath: string
  instructionPath?: string
  permissions: string[]
  compatibility: string[]
}

export interface AnalysisResult {
  id: string
  answer: string
  model: string
  provider: string
  createdAt: string
  durationMs: number
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'complete' | 'error'

export interface ConversationMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status: MessageStatus
}

export interface QuerySession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  providerId: string
  sourceLabel: string
  sourceKind: 'screen' | 'element' | 'browser' | 'file' | 'text'
  captures: CaptureEvidence[]
  files: FileEvidence[]
  browserContext?: BrowserContext
  messages: ConversationMessage[]
  analysisMode: AnalysisMode
  outputFormat: OutputFormat
  annotation?: string
}

export interface CaptureSelection {
  mode: CaptureMode
  bounds: Bounds
  textScope?: TextScope
  annotation?: string
  analysisMode?: AnalysisMode
  outputFormat?: OutputFormat
}

export interface AppSettings {
  shortcut: string
  language: 'zh-CN' | 'en'
  responseLanguage: 'zh-CN' | 'en' | 'ja-JP' | 'ko-KR' | 'es-ES' | 'fr-FR' | 'de-DE'
  detectCustomerLanguage: boolean
  replyStyle: 'concise' | 'customer-ready' | 'detailed'
  customReplyInstruction: string
  saveHistory: boolean
  retainImages: boolean
  showPreview: boolean
  defaultProviderId: string
  defaultAnalysisMode: AnalysisMode
  defaultOutputFormat: OutputFormat
  launchAtStartup: boolean
  notificationsEnabled: boolean
  notificationPreview: boolean
  resultPresentation: 'notification' | 'window' | 'both'
  voiceMode: 'off' | 'system' | 'codex-realtime'
  autoPlayVoice: boolean
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
