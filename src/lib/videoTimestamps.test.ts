import { describe, expect, it } from 'vitest'
import { parseVideoTimestamp, parseVideoTimestampHref, videoTimestampHref } from './videoTimestamps'

describe('video timestamp helpers', () => {
  it('parses minute and hour timecodes', () => {
    expect(parseVideoTimestamp('4:20')).toBe(260)
    expect(parseVideoTimestamp('01:04:20')).toBe(3_860)
    expect(parseVideoTimestamp('4:7')).toBeUndefined()
  })

  it('round-trips internal seek links', () => {
    expect(videoTimestampHref(260.9)).toBe('#video-t=260')
    expect(parseVideoTimestampHref('#video-t=260')).toBe(260)
    expect(parseVideoTimestampHref('https://example.com')).toBeUndefined()
  })
})
