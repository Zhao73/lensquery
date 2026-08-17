(() => {
  if (window.__lensQueryCustomContextMenu) return

  const HOST_ID = 'lensquery-web-context-action'
  const MENU_WIDTH = 236
  const MENU_HEIGHT = 44
  const VIEWPORT_MARGIN = 8
  const POINTER_GAP = 10
  const CUSTOM_MENU_SELECTORS = [
    '[role="menu"]',
    '[class*="context-menu" i]',
    '[class*="contextmenu" i]',
    '[class*="context_menu" i]',
  ].join(',')
  const chinese = /^zh(?:-|$)/i.test(navigator.language || '')
  const copy = chinese ? {
    action: '使用 What is it 识别',
    loading: '正在发送到 What is it…',
    success: '已发送，正在后台分析',
    failure: 'What is it 连接失败 · 点击重试',
  } : {
    action: 'Analyze with What is it',
    loading: 'Sending to What is it…',
    success: 'Sent for background analysis',
    failure: 'What is it connection failed · Retry',
  }

  const state = {
    active: true,
    host: null,
    button: null,
    label: null,
    target: null,
    point: null,
    busy: false,
    removeTimer: 0,
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function elementFromEvent(event) {
    return event.composedPath().find((item) => item instanceof Element)
      || document.elementFromPoint(event.clientX, event.clientY)
      || document.body
      || document.documentElement
  }

  function rectContainsPoint(rect, point, padding = 0) {
    return rect.width > 0
      && rect.height > 0
      && point.x >= rect.left - padding
      && point.x <= rect.right + padding
      && point.y >= rect.top - padding
      && point.y <= rect.bottom + padding
  }

  function selectionAtPoint(point) {
    const selection = window.getSelection()
    const text = clean(selection?.toString())
    if (!text || !selection?.rangeCount) return ''
    try {
      const range = selection.getRangeAt(0)
      const rects = [...range.getClientRects()]
      if (rects.some((rect) => rectContainsPoint(rect, point, 3))) return text.slice(0, 16_000)
    } catch {
      // Selection geometry can be unavailable in unusual editors.
    }
    return ''
  }

  function visibleMediaAtPoint(point) {
    const elements = [...document.querySelectorAll('video, audio')]
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const media = elements[index]
      const style = getComputedStyle(media)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) continue
      if (rectContainsPoint(media.getBoundingClientRect(), point)) return media
    }
    return null
  }

  function classifyTarget(rawTarget, point) {
    const selectionText = selectionAtPoint(point)
    if (selectionText) return { element: rawTarget, kind: 'selection', selectionText }

    const directMedia = rawTarget.closest?.('video, audio') || visibleMediaAtPoint(point)
    if (directMedia) {
      return {
        element: directMedia,
        kind: directMedia.tagName?.toLowerCase() === 'audio' ? 'audio' : 'video',
        selectionText: '',
      }
    }

    const image = rawTarget.closest?.('img, picture, canvas, svg')
    if (image) return { element: image, kind: 'image', selectionText: '' }

    const link = rawTarget.closest?.('a[href]')
    if (link) return { element: link, kind: 'link', selectionText: '' }

    const editable = rawTarget.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    if (editable) return { element: editable, kind: 'editable', selectionText: '' }

    return { element: rawTarget, kind: 'object', selectionText: '' }
  }

  function visibleCustomMenu(point) {
    let candidates = []
    try {
      candidates = [...document.querySelectorAll(CUSTOM_MENU_SELECTORS)]
    } catch {
      return null
    }
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index]
      if (candidate.id === HOST_ID || candidate.closest?.(`#${HOST_ID}`)) continue
      const style = getComputedStyle(candidate)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) continue
      const rect = candidate.getBoundingClientRect()
      if (rect.width < 90 || rect.height < 24) continue
      if (rectContainsPoint(rect, point, 80)) return rect
    }
    return null
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
  }

  function menuPosition(point) {
    const customMenu = visibleCustomMenu(point)
    let left
    let top
    if (customMenu) {
      left = customMenu.left
      top = customMenu.top - MENU_HEIGHT - 6
      if (top < VIEWPORT_MARGIN) top = customMenu.bottom + 6
    } else {
      left = point.x + POINTER_GAP
      top = point.y - MENU_HEIGHT - POINTER_GAP
      if (left + MENU_WIDTH > innerWidth - VIEWPORT_MARGIN) left = point.x - MENU_WIDTH - POINTER_GAP
      if (top < VIEWPORT_MARGIN) top = point.y + POINTER_GAP
    }
    return {
      left: clamp(left, VIEWPORT_MARGIN, innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
      top: clamp(top, VIEWPORT_MARGIN, innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
    }
  }

  function styleHost(host, position) {
    const properties = {
      position: 'fixed',
      inset: 'auto',
      left: `${Math.round(position.left)}px`,
      top: `${Math.round(position.top)}px`,
      width: `${MENU_WIDTH}px`,
      height: `${MENU_HEIGHT}px`,
      margin: '0',
      padding: '0',
      border: '0',
      overflow: 'visible',
      background: 'transparent',
      color: 'inherit',
      zIndex: '2147483647',
    }
    for (const [name, value] of Object.entries(properties)) host.style.setProperty(name, value, 'important')
  }

  function createSurface() {
    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('popover', 'manual')
    host.setAttribute('data-lensquery-owned', 'true')
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host { all: initial; color-scheme: light dark; }
      button {
        box-sizing: border-box;
        width: ${MENU_WIDTH}px;
        min-height: ${MENU_HEIGHT}px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 13px;
        border: 1px solid rgba(18, 24, 34, .15);
        border-radius: 9px;
        background: #ffffff;
        color: #17191d;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
        font: 600 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
        text-align: start;
        cursor: pointer;
        user-select: none;
        -webkit-font-smoothing: antialiased;
      }
      button:hover { background: #f2f5fa; }
      button:focus-visible { outline: 2px solid #2367d1; outline-offset: 2px; }
      button[aria-busy="true"] { cursor: wait; }
      button[data-state="success"] { color: #17663b; }
      button[data-state="error"] { color: #a12626; }
      img { width: 20px; height: 20px; flex: 0 0 auto; }
      span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (prefers-color-scheme: dark) {
        button {
          border-color: rgba(255, 255, 255, .14);
          background: #25282e;
          color: #f6f7f9;
          box-shadow: 0 12px 34px rgba(0, 0, 0, .42);
        }
        button:hover { background: #30343b; }
        button[data-state="success"] { color: #78d39e; }
        button[data-state="error"] { color: #ff9898; }
      }
      @media (forced-colors: active) {
        button { border: 1px solid ButtonText; background: Canvas; color: CanvasText; }
        button:focus-visible { outline: 2px solid Highlight; }
      }
    `
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', copy.action)
    button.setAttribute('aria-busy', 'false')
    const icon = document.createElement('img')
    icon.src = chrome.runtime.getURL('icons/32.png')
    icon.alt = ''
    const label = document.createElement('span')
    label.textContent = copy.action
    button.append(icon, label)
    shadow.append(style, button)
    return { host, button, label }
  }

  function clearRemoveTimer() {
    if (!state.removeTimer) return
    clearTimeout(state.removeTimer)
    state.removeTimer = 0
  }

  function closeMenu() {
    clearRemoveTimer()
    if (typeof state.host?.hidePopover === 'function') {
      try {
        state.host.hidePopover()
      } catch {
        // Removing the host is sufficient when the popover has already closed.
      }
    }
    state.host?.remove()
    state.host = null
    state.button = null
    state.label = null
    state.target = null
    state.point = null
    state.busy = false
  }

  function showMenu(rawTarget, point) {
    closeMenu()
    const target = classifyTarget(rawTarget, point)
    const surface = createSurface()
    const position = menuPosition(point)
    styleHost(surface.host, position)
    state.host = surface.host
    state.button = surface.button
    state.label = surface.label
    state.target = target
    state.point = point
    document.documentElement.appendChild(surface.host)
    try {
      surface.host.showPopover()
    } catch {
      surface.host.removeAttribute('popover')
    }
    surface.button.addEventListener('pointerdown', onAction, true)
  }

  function updateSurface(text, status) {
    if (!state.button || !state.label) return
    state.label.textContent = text
    state.button.dataset.state = status || ''
    state.button.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false')
  }

  async function submitTarget() {
    if (state.busy || !state.target) return
    state.busy = true
    updateSurface(copy.loading, 'loading')
    try {
      const contextApi = window.__lensQueryPageContext
      if (!contextApi) throw new Error('Page context collector is unavailable.')
      const context = contextApi.buildContext(state.target.element, {
        kind: state.target.kind,
        contextMenuKind: state.target.kind,
        selectionText: state.target.selectionText,
      })
      context.selectionMode = state.target.kind === 'selection' ? 'selection' : 'object'
      context.selectedText = state.target.selectionText || context.selectedText
      context.browserTrigger = 'custom-context-menu'
      const enriched = await contextApi.enrichContext(context)
      const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context: enriched })
      if (!response?.ok) throw new Error(response?.error || 'What is it desktop did not accept the context.')
      updateSurface(copy.success, 'success')
      state.removeTimer = window.setTimeout(closeMenu, 1_400)
    } catch (error) {
      state.busy = false
      updateSurface(copy.failure, 'error')
      state.button.title = String(error).slice(0, 240)
      state.removeTimer = window.setTimeout(closeMenu, 6_000)
    }
  }

  function onAction(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void submitTarget()
  }

  function onContextMenu(event) {
    if (!state.active || state.host?.contains?.(event.target)) return
    const target = elementFromEvent(event)
    const point = { x: event.clientX, y: event.clientY }
    window.setTimeout(() => {
      if (!state.active || !event.defaultPrevented) return
      showMenu(target, point)
    }, 0)
  }

  function onPointerDown(event) {
    if (!state.host || state.host === event.target || state.host.contains(event.target)) return
    closeMenu()
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') closeMenu()
  }

  function stop() {
    state.active = false
    closeMenu()
    window.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', closeMenu, true)
    window.removeEventListener('resize', closeMenu, true)
    document.removeEventListener('scroll', closeMenu, true)
    delete window.__lensQueryCustomContextMenu
  }

  window.__lensQueryCustomContextMenu = { active: true, close: closeMenu, stop }
  window.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', closeMenu, true)
  window.addEventListener('resize', closeMenu, true)
  document.addEventListener('scroll', closeMenu, true)
})()
