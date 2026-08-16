import { describe, expect, it } from 'vitest'
import type { QuerySession, VideoFrame } from '../types/domain'
import { resolveSessionVideo, sampleVideoFrames, youtubeEmbedUrl } from './media'

const frame = (timestampSeconds: number): VideoFrame => ({
  path: `/tmp/frame-${timestampSeconds}.jpg`,
  timestampSeconds,
})

describe('media helpers', () => {
  it('samples the complete video timeline while preserving both ends', () => {
    const frames = Array.from({ length: 24 }, (_, index) => frame(index * 100))
    const sampled = sampleVideoFrames(frames, 7)

    expect(sampled).toHaveLength(7)
    expect(sampled[0]?.timestampSeconds).toBe(0)
    expect(sampled.at(-1)?.timestampSeconds).toBe(2_300)
    expect(sampled.map(({ timestampSeconds }) => timestampSeconds))
      .toEqual([...sampled].sort((left, right) => left.timestampSeconds - right.timestampSeconds).map(({ timestampSeconds }) => timestampSeconds))
  })

  it('builds privacy-enhanced YouTube embeds with an optional start point', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=sPlBtKsmLK0', 123))
      .toBe('https://www.youtube-nocookie.com/embed/sPlBtKsmLK0?rel=0&start=123')
    expect(youtubeEmbedUrl('https://youtu.be/sPlBtKsmLK0'))
      .toBe('https://www.youtube-nocookie.com/embed/sPlBtKsmLK0?rel=0')
    expect(youtubeEmbedUrl('https://youtu.be/sPlBtKsmLK0', 260, true))
      .toBe('https://www.youtube-nocookie.com/embed/sPlBtKsmLK0?rel=0&start=260&autoplay=1')
    expect(youtubeEmbedUrl('https://example.com/video')).toBeUndefined()
  })

  it('prefers the prepared local source used by the analysis session', () => {
    const session = {
      files: [{
        id: 'video',
        name: 'long-video.mp4',
        path: '/tmp/original.mp4',
        mediaType: 'video/mp4',
        size: 100,
        kind: 'video',
        videoPreparation: {
          id: 'prepared',
          sourcePath: '/tmp/prepared.mp4',
          outputDirectory: '/tmp/frames',
          frames: [frame(0), frame(600)],
          sampleIntervalSeconds: 600,
          originalDurationSeconds: 2_400,
          strategy: 'uniform-keyframes-v1',
        },
      }],
    } as QuerySession

    expect(resolveSessionVideo(session)).toMatchObject({
      kind: 'html5',
      label: 'long-video.mp4',
      localPath: '/tmp/prepared.mp4',
      durationSeconds: 2_400,
    })
  })
})
