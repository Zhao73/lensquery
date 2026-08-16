/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuerySession } from '../types/domain'
import { SessionVideoPlayer } from './SessionVideoPlayer'

function sessionFixture(): QuerySession {
  return {
    id: 'session-video',
    title: 'fixture.mp4',
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    providerId: 'codex-cli',
    sourceLabel: 'fixture.mp4',
    sourceKind: 'file',
    captures: [],
    files: [{
      id: 'video',
      name: 'fixture.mp4',
      path: '/tmp/fixture.mp4',
      mediaType: 'video/mp4',
      size: 100,
      kind: 'video',
      videoPreparation: {
        id: 'prepared',
        sourcePath: '/tmp/fixture.mp4',
        outputDirectory: '/tmp/frames',
        frames: [
          { path: '/tmp/frame-0.jpg', timestampSeconds: 0 },
          { path: '/tmp/frame-60.jpg', timestampSeconds: 60 },
        ],
        sampleIntervalSeconds: 60,
        originalDurationSeconds: 120,
        strategy: 'uniform-keyframes-v1',
      },
    }],
    messages: [],
    analysisMode: 'explain',
    outputFormat: 'report',
  }
}

describe('SessionVideoPlayer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'lensQueryDesktop', {
      configurable: true,
      value: {
        platform: 'darwin',
        invoke: vi.fn(),
        on: vi.fn(),
        getPathForFile: vi.fn(),
        toFileUrl: (filePath: string) => `file://${filePath}`,
      },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the analyzed video above the conversation and supports collapse', () => {
    const { container } = render(<SessionVideoPlayer session={sessionFixture()} />)
    const video = container.querySelector('video')

    expect(screen.getByText('fixture.mp4')).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('file:///tmp/fixture.mp4')
    fireEvent.click(screen.getByRole('button', { name: '收起视频' }))
    expect(container.querySelector('.video-player-body')?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展开视频' }))
    expect(container.querySelector('.video-player-body')?.hasAttribute('hidden')).toBe(false)
  })

  it('seeks and starts playback from a sampled key frame', () => {
    const { container } = render(<SessionVideoPlayer session={sessionFixture()} />)
    const video = container.querySelector('video') as HTMLVideoElement

    fireEvent.click(screen.getByRole('button', { name: '跳转到 1:00' }))
    expect(video.currentTime).toBe(60)
    expect(video.play).toHaveBeenCalled()
  })

  it('opens the player and seeks when a report timestamp is selected', () => {
    const session = sessionFixture()
    const { container, rerender } = render(<SessionVideoPlayer session={session} />)
    const video = container.querySelector('video') as HTMLVideoElement

    fireEvent.click(screen.getByRole('button', { name: '收起视频' }))
    rerender(<SessionVideoPlayer session={session} seekRequest={{ sessionId: session.id, seconds: 80, nonce: 1 }} />)

    expect(container.querySelector('.video-player-body')?.hasAttribute('hidden')).toBe(false)
    expect(video.currentTime).toBe(80)
    expect(video.play).toHaveBeenCalled()
  })
})
