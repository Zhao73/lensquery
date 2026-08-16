import {
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  FilmStrip,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../lib/files'
import { resolveSessionVideo, sampleVideoFrames, youtubeEmbedUrl } from '../lib/media'
import { localFileUrl, openLocalPath } from '../lib/tauri'
import type { QuerySession } from '../types/domain'

export interface VideoSeekRequest {
  sessionId: string
  seconds: number
  nonce: number
}

export function SessionVideoPlayer({ session, seekRequest }: { session: QuerySession; seekRequest?: VideoSeekRequest }) {
  const source = useMemo(() => resolveSessionVideo(session), [session])
  const rootRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [reportedDuration, setReportedDuration] = useState(source?.durationSeconds ?? 0)
  const [playbackError, setPlaybackError] = useState('')
  const [youtubeStart, setYoutubeStart] = useState(0)
  const [youtubeAutoplay, setYoutubeAutoplay] = useState(false)

  const revealPlayer = useCallback(() => {
    setCollapsed(false)
    window.requestAnimationFrame(() => {
      const root = rootRef.current
      const scroller = root?.closest<HTMLElement>('.message-stream')
      if (!root) return
      if (scroller) scroller.style.scrollBehavior = 'auto'
      root.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      window.requestAnimationFrame(() => {
        if (scroller) scroller.style.removeProperty('scroll-behavior')
      })
    })
  }, [])

  const seekTo = useCallback((timestampSeconds: number) => {
    if (!source) return
    const knownDuration = reportedDuration || source.durationSeconds
    const maximum = knownDuration > 0 ? Math.max(0, knownDuration - 0.1) : timestampSeconds
    const target = Math.min(Math.max(0, timestampSeconds), maximum)
    if (source.kind === 'youtube') {
      setYoutubeAutoplay(true)
      setYoutubeStart(target)
      setCurrentTime(target)
      return
    }
    const video = videoRef.current
    if (!video) return
    video.currentTime = target
    setCurrentTime(target)
    void video.play().catch(() => undefined)
  }, [reportedDuration, source])

  useEffect(() => {
    if (!seekRequest || seekRequest.sessionId !== session.id || !source) return
    revealPlayer()
    seekTo(seekRequest.seconds)
  }, [revealPlayer, seekRequest, seekTo, session.id, source])

  if (!source) return null

  const localSourceUrl = source.localPath ? localFileUrl(source.localPath) : ''
  const videoUrl = localSourceUrl || source.url || ''
  const timelineFrames = sampleVideoFrames(source.frames)
  const posterUrl = localFileUrl(source.frames[0]?.path) || source.frames[0]?.previewUrl
  const duration = reportedDuration || source.durationSeconds
  const embedUrl = source.kind === 'youtube' ? youtubeEmbedUrl(source.url, youtubeStart, youtubeAutoplay) : undefined

  const toggleCollapsed = () => {
    if (!collapsed) videoRef.current?.pause()
    setCollapsed((value) => !value)
    if (collapsed) {
      window.requestAnimationFrame(() => {
        const root = rootRef.current
        const scroller = root?.closest<HTMLElement>('.message-stream')
        if (!root) return
        if (scroller) scroller.style.scrollBehavior = 'auto'
        root.scrollIntoView?.({ behavior: 'auto', block: 'start' })
        window.requestAnimationFrame(() => {
          if (scroller) scroller.style.removeProperty('scroll-behavior')
        })
      })
    }
  }

  return (
    <section ref={rootRef} className={`session-video-player${collapsed ? ' collapsed' : ''}`} aria-label="会话视频播放器">
      <header className="video-player-header">
        <div className="video-player-title">
          <FilmStrip size={17} weight="duotone" />
          <span><strong>{source.label}</strong><small>{source.localPath ? '本地播放' : '网页播放'}{duration > 0 ? ` · ${formatDuration(duration)}` : ''}</small></span>
        </div>
        <div className="video-player-actions">
          {!collapsed && duration > 0 && <time>{formatDuration(currentTime)} / {formatDuration(duration)}</time>}
          {source.localPath && (
            <button type="button" onClick={() => void openLocalPath(source.localPath ?? '')} aria-label="使用系统播放器打开">
              <ArrowSquareOut size={15} /><span>系统播放器</span>
            </button>
          )}
          <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? '展开视频' : '收起视频'}>
            {collapsed ? <><CaretDown size={15} /><span>展开</span></> : <><CaretUp size={15} /><span>收起</span></>}
          </button>
        </div>
      </header>

      {source.kind === 'youtube' ? (
        !collapsed && embedUrl && (
          <div className="video-stage">
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={source.label}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )
      ) : (
        <div className="video-player-body" hidden={collapsed}>
          <div className="video-stage">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                poster={posterUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const actualDuration = event.currentTarget.duration
                  if (Number.isFinite(actualDuration)) setReportedDuration(actualDuration)
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onError={() => setPlaybackError('内置播放器未能读取这个视频。文件可能已移动，或视频编码不受 Chromium 支持。')}
              />
            )}
            {(!videoUrl || playbackError) && (
              <div className="video-playback-error" role="alert">
                <WarningCircle size={22} />
                <span><strong>暂时没有可播放的画面</strong><small>{playbackError || '这次网页分析没有保存本地视频文件。'}</small></span>
                {source.localPath && <button type="button" onClick={() => void openLocalPath(source.localPath ?? '')}>用系统播放器打开</button>}
              </div>
            )}
          </div>
          {timelineFrames.length > 1 && (
            <div className="video-timeline" aria-label="关键画面时间点">
              {timelineFrames.map((frame) => {
                const thumbnail = localFileUrl(frame.path) || frame.previewUrl
                const active = Math.abs(currentTime - frame.timestampSeconds) < Math.max(8, source.durationSeconds / 100)
                return (
                  <button
                    type="button"
                    key={`${frame.path}-${frame.timestampSeconds}`}
                    className={active ? 'active' : undefined}
                    onClick={() => seekTo(frame.timestampSeconds)}
                    aria-label={`跳转到 ${formatDuration(frame.timestampSeconds)}`}
                  >
                    {thumbnail && <img src={thumbnail} alt="" />}
                    <time>{formatDuration(frame.timestampSeconds)}</time>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
