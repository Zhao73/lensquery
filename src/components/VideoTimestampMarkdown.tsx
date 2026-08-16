import { Play } from '@phosphor-icons/react'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { formatDuration } from '../lib/files'
import { parseVideoTimestampHref, remarkVideoTimestamps } from '../lib/videoTimestamps'

export function VideoTimestampMarkdown({
  content,
  durationSeconds,
  onSeek,
}: {
  content: string
  durationSeconds?: number
  onSeek?: (seconds: number) => void
}) {
  const remarkPlugins = useMemo<PluggableList>(
    () => onSeek ? [remarkGfm, [remarkVideoTimestamps, { durationSeconds }]] : [remarkGfm],
    [durationSeconds, onSeek],
  )

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={{
        a: ({ href, children, node: _node, ...props }) => {
          const seconds = parseVideoTimestampHref(href)
          if (seconds !== undefined && onSeek) {
            return (
              <button
                type="button"
                className="video-timestamp-link"
                onClick={() => onSeek(seconds)}
                aria-label={`从视频 ${formatDuration(seconds)} 开始播放`}
                title="跳转到该时间点"
              >
                <Play size={10} weight="fill" aria-hidden="true" />
                {children}
              </button>
            )
          }
          return <a href={href} {...props}>{children}</a>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
