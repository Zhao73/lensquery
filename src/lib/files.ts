import type { BrowserContext, FileEvidence } from '../types/domain'

const mediaTypeFor = (file: File) => file.type || 'application/octet-stream'

const kindFor = (file: File): FileEvidence['kind'] => {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi|wmv|mpeg|mpg)$/i.test(file.name)) return 'video'
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('text/') || /\.(md|txt|json|csv|log|xml|html|css|js|ts|tsx)$/i.test(file.name)) {
    return 'text'
  }
  return 'other'
}

export const evidenceAccept = [
  'image/*',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  '.m4v',
  '.avi',
  '.wmv',
  '.mpeg',
  '.mpg',
  '.pdf',
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.log',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
].join(',')

export function normalizeBrowserFiles(files: FileList | File[]): FileEvidence[] {
  return Array.from(files).map((file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    path: (file as File & { path?: string }).path ?? file.name,
    mediaType: mediaTypeFor(file),
    size: file.size,
    kind: kindFor(file),
  }))
}

export function containsAutoAnalyzedMedia(files: FileEvidence[], browserContext?: BrowserContext): boolean {
  return files.some(({ kind }) => kind === 'image' || kind === 'video')
    || ['image', 'video'].includes(browserContext?.contextMenuKind ?? '')
    || browserContext?.media?.kind === 'video'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '时长待检测'
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
