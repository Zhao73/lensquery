import type { FileEvidence } from '../types/domain'

const mediaTypeFor = (file: File) => file.type || 'application/octet-stream'

const kindFor = (file: File): FileEvidence['kind'] => {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('text/') || /\.(md|txt|json|csv|log|xml|html|css|js|ts|tsx)$/i.test(file.name)) {
    return 'text'
  }
  return 'other'
}

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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

