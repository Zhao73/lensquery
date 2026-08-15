// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=lensquery-test"}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'browser-extension/page-context.js'), 'utf8')

function loadCollector() {
  window.chrome = {
    runtime: {
      onMessage: { addListener: vi.fn() },
    },
  }
  globalThis.chrome = window.chrome
  window.eval(source)
  return window.__lensQueryPageContext
}

describe('LensQuery browser page context', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>Example</title></head><body></body>'
    delete window.__lensQueryPageContext
    window.getSelection()?.removeAllRanges()
    globalThis.fetch = vi.fn()
  })

  it('keeps selected text together with its surrounding page context', () => {
    document.body.innerHTML = '<main><p>Before context <mark>selected customer sentence</mark> after context</p></main>'
    const mark = document.querySelector('mark')
    const range = document.createRange()
    range.selectNodeContents(mark)
    window.getSelection().addRange(range)
    const collector = loadCollector()
    const target = collector.findTarget({ kind: 'selection' })
    const context = collector.buildContext(target, {
      kind: 'selection',
      contextMenuKind: 'selection',
      selectionText: 'selected customer sentence',
    })

    expect(context.selectedText).toBe('selected customer sentence')
    expect(context.nearbyText).toContain('Before context')
    expect(context.nearbyText).toContain('after context')
    expect(context.contextMenuKind).toBe('selection')
  })

  it('finds the requested image and returns visual crop metadata', () => {
    document.body.innerHTML = '<article><figure><img id="hero" src="https://example.test/hero.png" alt="Product diagram"><figcaption>Architecture overview</figcaption></figure></article>'
    const image = document.querySelector('img')
    image.getBoundingClientRect = () => ({ left: 12, top: 24, right: 332, bottom: 204, width: 320, height: 180 })
    const collector = loadCollector()
    const target = collector.findTarget({ kind: 'image', srcUrl: image.src })
    const context = collector.buildContext(target, { kind: 'image', contextMenuKind: 'image' })

    expect(target).toBe(image)
    expect(context.accessibleName).toBe('Product diagram')
    expect(context.nearbyText).toContain('Architecture overview')
    expect(context.__snapshot.rect).toEqual({ x: 12, y: 24, width: 320, height: 180 })
  })

  it('includes current video state without inventing a transcript', () => {
    document.body.innerHTML = '<main><video id="lesson" src="https://example.test/lesson.mp4"></video><p>Lesson description</p></main>'
    const video = document.querySelector('video')
    Object.defineProperties(video, {
      currentTime: { value: 42, configurable: true },
      duration: { value: 180, configurable: true },
      paused: { value: true, configurable: true },
    })
    const collector = loadCollector()
    const context = collector.buildContext(video, { kind: 'video', contextMenuKind: 'video' })

    expect(context.media).toMatchObject({ kind: 'video', currentTime: 42, duration: 180, paused: true })
    expect(context.transcript).toBeUndefined()
  })

  it('fetches a time-coded YouTube transcript from the page caption track', async () => {
    document.head.innerHTML = `<title>NASA short</title><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=lensquery-test","languageCode":"en","name":{"simpleText":"English"}}]}}};</script>`
    document.body.innerHTML = '<main><video id="lesson" src="https://example.test/lesson.mp4"></video></main>'
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { tStartMs: 891, segs: [{ utf8: 'We have one of the most challenging assignments.' }] },
          { tStartMs: 27_463, segs: [{ utf8: 'One small step for man.' }] },
        ],
      }),
    })

    const collector = loadCollector()
    const video = document.querySelector('video')
    const context = collector.buildContext(video, { kind: 'video', contextMenuKind: 'video' })
    const enriched = await collector.enrichContext(context)

    expect(enriched.transcript).toContain('[00:00] We have one of the most challenging assignments.')
    expect(enriched.transcript).toContain('[00:27] One small step for man.')
    expect(enriched.transcriptLanguage).toBe('en')
    expect(enriched.transcriptCueCount).toBe(2)
    expect(enriched.transcriptTruncated).toBe(false)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('fmt=json3'),
      { credentials: 'include' },
    )
  })
})
