import { describe, expect, it } from 'vitest'

import {
  contextKindFor,
  contextRequestFor,
  UNIVERSAL_CONTEXT_MENU,
} from './context-menu.js'

describe('LensQuery universal browser context menu', () => {
  it('is visible for every Chrome context', () => {
    expect(UNIVERSAL_CONTEXT_MENU).toMatchObject({
      title: '使用 LensQuery 识别',
      contexts: ['all'],
    })
  })

  it.each([
    [{ selectionText: 'selected words' }, 'selection'],
    [{ mediaType: 'image', srcUrl: 'https://example.test/image.png' }, 'image'],
    [{ mediaType: 'video', srcUrl: 'https://example.test/video.mp4' }, 'video'],
    [{ mediaType: 'audio', srcUrl: 'https://example.test/audio.mp3' }, 'audio'],
    [{ linkUrl: 'https://example.test/details' }, 'link'],
    [{ editable: true }, 'editable'],
    [{ pageUrl: 'https://example.test' }, 'object'],
  ])('routes %o to %s analysis', (info, expected) => {
    expect(contextKindFor(info)).toBe(expected)
  })

  it('keeps the URLs needed to recover the exact target', () => {
    expect(contextRequestFor({
      mediaType: 'image',
      srcUrl: 'https://example.test/image.png',
      linkUrl: 'https://example.test/details',
    })).toEqual({
      kind: 'image',
      selectionText: undefined,
      srcUrl: 'https://example.test/image.png',
      linkUrl: 'https://example.test/details',
    })
  })
})
