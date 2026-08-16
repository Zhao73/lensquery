// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.bilibili.com/video/BV1fixture"}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'browser-extension/custom-context-menu.js'), 'utf8')

function waitForMenu() {
  return new Promise((resolveMenu) => window.setTimeout(resolveMenu, 8))
}

function loadFallback() {
  window.eval(source)
  return window.__lensQueryCustomContextMenu
}

function fallbackHost() {
  return document.querySelector('#lensquery-web-context-action')
}

describe('LensQuery custom web context-menu fallback', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>Bilibili fixture</title></head><body></body>'
    delete window.__lensQueryCustomContextMenu
    window.getSelection()?.removeAllRanges()
    window.HTMLElement.prototype.showPopover = vi.fn()
    window.HTMLElement.prototype.hidePopover = vi.fn()
    window.chrome = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://lensquery/${path}`),
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    }
    globalThis.chrome = window.chrome
    window.__lensQueryPageContext = {
      buildContext: vi.fn((element, options) => ({
        tagName: element.tagName,
        contextMenuKind: options.kind,
        __snapshot: { rect: { x: 0, y: 0, width: 640, height: 360 } },
      })),
      enrichContext: vi.fn(async (context) => context),
    }
  })

  it('does not duplicate the native Chrome context menu', async () => {
    document.body.innerHTML = '<p id="text">Ordinary page text</p>'
    loadFallback()
    document.querySelector('#text').dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 90,
    }))
    await waitForMenu()

    expect(fallbackHost()).toBeNull()
  })

  it('adds LensQuery beside a Bilibili-style menu and submits the video automatically', async () => {
    document.body.innerHTML = `
      <div class="bpx-player-container">
        <video id="player"></video>
      </div>
      <div class="bpx-player-contextmenu" role="menu"></div>
    `
    const video = document.querySelector('#player')
    video.getBoundingClientRect = () => ({ left: 20, top: 20, right: 660, bottom: 380, width: 640, height: 360 })
    const siteMenu = document.querySelector('[role="menu"]')
    siteMenu.getBoundingClientRect = () => ({ left: 200, top: 160, right: 500, bottom: 420, width: 300, height: 260 })
    siteMenu.addEventListener('contextmenu', (event) => event.preventDefault())
    video.addEventListener('contextmenu', (event) => event.preventDefault())
    loadFallback()

    video.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 240,
      clientY: 200,
    }))
    await waitForMenu()

    const host = fallbackHost()
    expect(host).not.toBeNull()
    expect(host.style.top).toBe('110px')
    host.shadowRoot.querySelector('button').dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await waitForMenu()

    expect(window.__lensQueryPageContext.buildContext).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ kind: 'video', contextMenuKind: 'video' }),
    )
    expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'lensquery-context',
      context: expect.objectContaining({
        tagName: 'VIDEO',
        contextMenuKind: 'video',
        browserTrigger: 'custom-context-menu',
      }),
    })
  })

  it('supports arbitrary right-clickable controls and Escape cancellation', async () => {
    document.body.innerHTML = '<button id="custom">Open customer details</button>'
    const button = document.querySelector('#custom')
    button.addEventListener('contextmenu', (event) => event.preventDefault())
    loadFallback()

    button.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 70,
    }))
    await waitForMenu()
    expect(fallbackHost()).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(fallbackHost()).toBeNull()
  })

  it('remains visible when the Popover API is unavailable', async () => {
    document.body.innerHTML = '<canvas id="stage"></canvas>'
    window.HTMLElement.prototype.showPopover = vi.fn(() => { throw new Error('unsupported') })
    const stage = document.querySelector('#stage')
    stage.addEventListener('contextmenu', (event) => event.preventDefault())
    loadFallback()

    stage.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }))
    await waitForMenu()

    expect(fallbackHost()).not.toBeNull()
    expect(fallbackHost().hasAttribute('popover')).toBe(false)
  })
})
