import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  contextKindFor,
  contextRequestFor,
  PAGE_CONTEXT_MENU,
  pageContextRequestFor,
  UNIVERSAL_CONTEXT_MENU,
} from './context-menu.js'

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'browser-extension/manifest.json'), 'utf8'))

describe('LensQuery universal browser context menu', () => {
  it('is visible for every Chrome context', () => {
    expect(UNIVERSAL_CONTEXT_MENU).toMatchObject({
      title: '使用 LensQuery 识别',
      contexts: ['all'],
    })
  })

  it('offers direct current-URL analysis on page and extension-action menus', () => {
    expect(PAGE_CONTEXT_MENU).toMatchObject({
      title: '使用 LensQuery 分析当前网址',
      contexts: ['page', 'action'],
    })
    expect(pageContextRequestFor()).toEqual({ kind: 'page' })
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

  it('loads a fallback action on pages that replace the native Chrome menu', () => {
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(['http://*/*', 'https://*/*']))
    expect(manifest.content_scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true,
        js: ['page-context.js', 'custom-context-menu.js'],
      }),
    ]))
  })

  it('registers the lq omnibox keyword and direct-page toolbar action', () => {
    expect(manifest.omnibox).toEqual({ keyword: 'lq' })
    expect(manifest.action.default_title).toBe('使用 LensQuery 分析当前网址')
  })
})
