import type { QuerySession, VideoFrame } from '../types/domain'

export interface SessionVideoSource {
  kind: 'html5' | 'youtube'
  label: string
  localPath?: string
  mediaType?: string
  url?: string
  durationSeconds: number
  frames: VideoFrame[]
}

export function sampleVideoFrames(frames: VideoFrame[], maximum = 7): VideoFrame[] {
  if (maximum <= 0 || frames.length === 0) return []
  if (frames.length <= maximum) return frames
  if (maximum === 1) return [frames[0]]

  const sampled = new Map<number, VideoFrame>()
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index * (frames.length - 1)) / (maximum - 1))
    sampled.set(sourceIndex, frames[sourceIndex])
  }
  return [...sampled.values()]
}

export function youtubeEmbedUrl(rawUrl?: string, startSeconds = 0): string | undefined {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let videoId = ''
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] ?? ''
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? ''
      else videoId = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? ''
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return undefined
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`)
    embed.searchParams.set('rel', '0')
    if (startSeconds > 0) embed.searchParams.set('start', String(Math.floor(startSeconds)))
    return embed.href
  } catch {
    return undefined
  }
}

export function resolveSessionVideo(session: QuerySession): SessionVideoSource | undefined {
  const file = session.files.find(({ kind }) => kind === 'video')
  if (file) {
    return {
      kind: 'html5',
      label: file.name,
      localPath: file.videoPreparation?.sourcePath || file.path,
      mediaType: file.mediaType,
      durationSeconds: file.videoPreparation?.originalDurationSeconds ?? file.video?.durationSeconds ?? 0,
      frames: file.videoPreparation?.frames ?? [],
    }
  }

  const browser = session.browserContext
  if (browser?.media?.kind !== 'video') return undefined
  const remoteSource = browser.media.source
  if (remoteSource && /^https?:\/\//i.test(remoteSource) && !youtubeEmbedUrl(browser.url)) {
    return {
      kind: 'html5',
      label: browser.title || '网页视频',
      url: remoteSource,
      durationSeconds: browser.media.duration ?? 0,
      frames: [],
    }
  }
  if (youtubeEmbedUrl(browser.url)) {
    return {
      kind: 'youtube',
      label: browser.title || 'YouTube 视频',
      url: browser.url,
      durationSeconds: browser.media.duration ?? 0,
      frames: [],
    }
  }
  return undefined
}
