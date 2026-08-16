import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

function chromeEvent() {
  return {
    listener: undefined,
    addListener: vi.fn(function addListener(listener) {
      this.listener = listener
    }),
    removeListener: vi.fn(),
  }
}

const activeTab = {
  id: 41,
  active: true,
  windowId: 8,
  status: 'complete',
  url: 'https://example.test/current',
  title: 'Current fixture',
}

let chromeMock

describe('LensQuery extension URL entry wiring', () => {
  beforeAll(async () => {
    chromeMock = {
      runtime: {
        onInstalled: chromeEvent(),
        onStartup: chromeEvent(),
        onMessage: chromeEvent(),
        sendNativeMessage: vi.fn((_host, _message, callback) => callback({ ok: true })),
        lastError: null,
      },
      contextMenus: {
        onClicked: chromeEvent(),
        removeAll: vi.fn((callback) => callback()),
        create: vi.fn(),
      },
      action: {
        onClicked: chromeEvent(),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
        setBadgeText: vi.fn(async () => undefined),
      },
      commands: { onCommand: chromeEvent() },
      omnibox: {
        onInputChanged: chromeEvent(),
        onInputEntered: chromeEvent(),
        setDefaultSuggestion: vi.fn(),
      },
      tabs: {
        query: vi.fn(async () => [activeTab]),
        sendMessage: vi.fn(async (_tabId, message) => ({
          ok: true,
          context: {
            url: activeTab.url,
            title: activeTab.title,
            tagName: 'BODY',
            contextMenuKind: message.request.kind,
            selectionMode: message.request.kind === 'page' ? 'page' : 'object',
          },
        })),
        captureVisibleTab: vi.fn(),
        update: vi.fn(async (_tabId, update) => ({ ...activeTab, url: update.url })),
        create: vi.fn(async ({ url, active }) => ({ ...activeTab, id: 42, url, active })),
        get: vi.fn(async () => activeTab),
        onUpdated: chromeEvent(),
      },
      scripting: {
        executeScript: vi.fn(async () => undefined),
        insertCSS: vi.fn(async () => undefined),
      },
    }
    globalThis.chrome = chromeMock
    vi.resetModules()
    await import('./service-worker.js')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs both target recognition and current-URL menus', () => {
    chromeMock.runtime.onInstalled.listener()

    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'lensquery-analyze',
      contexts: ['all'],
    }))
    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'lensquery-analyze-current-url',
      contexts: ['page', 'action'],
    }))
  })

  it('analyzes the complete current page when the toolbar icon is clicked', async () => {
    chromeMock.action.onClicked.listener(activeTab)

    await vi.waitFor(() => {
      expect(chromeMock.runtime.sendNativeMessage).toHaveBeenCalledWith(
        'com.lensquery.desktop',
        {
          type: 'browser-context',
          context: expect.objectContaining({
            url: activeTab.url,
            tagName: 'BODY',
            contextMenuKind: 'page',
            selectionMode: 'page',
          }),
        },
        expect.any(Function),
      )
    })
  })

  it('registers a direct current-page omnibox route', async () => {
    expect(chromeMock.omnibox.onInputEntered.listener).toEqual(expect.any(Function))
    chromeMock.omnibox.onInputEntered.listener('', 'currentTab')
    await vi.waitFor(() => {
      expect(chromeMock.runtime.sendNativeMessage).toHaveBeenCalled()
    })
    expect(chromeMock.tabs.update).not.toHaveBeenCalled()
    expect(chromeMock.tabs.create).not.toHaveBeenCalled()
  })
})
