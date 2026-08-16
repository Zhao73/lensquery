/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoTimestampMarkdown } from './VideoTimestampMarkdown'

describe('VideoTimestampMarkdown', () => {
  afterEach(cleanup)

  it('turns report timecodes into accessible video seek controls', () => {
    const onSeek = vi.fn()
    render(
      <VideoTimestampMarkdown
        content={'## 第二章\n重点片段 4:20–05:10，结论见 [06:00](#video-t=360)。'}
        durationSeconds={600}
        onSeek={onSeek}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '从视频 4:20 开始播放' }))
    fireEvent.click(screen.getByRole('button', { name: '从视频 6:00 开始播放' }))

    expect(onSeek).toHaveBeenNthCalledWith(1, 260)
    expect(onSeek).toHaveBeenNthCalledWith(2, 360)
    expect(screen.getByRole('button', { name: '从视频 5:10 开始播放' })).not.toBeNull()
  })

  it('does not convert clock context, out-of-range values, code, or non-video prose', () => {
    const { rerender } = render(
      <VideoTimestampMarkdown
        content={'主播说现在是晚上8:10，`4:20` 是代码，12:00 超出视频。'}
        durationSeconds={600}
        onSeek={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)

    rerender(<VideoTimestampMarkdown content={'普通文本中的 4:20 不是视频跳转。'} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
