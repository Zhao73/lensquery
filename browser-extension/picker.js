(() => {
  if (window.__lensQueryPicker?.active) {
    window.__lensQueryPicker.stop()
    return
  }

  const state = { active: true, highlighted: null }
  document.documentElement.classList.add('lensquery-picking')
  const badge = document.createElement('div')
  badge.id = 'lensquery-picker-badge'
  badge.textContent = '❓ 点击网页内容 · Esc 取消'
  document.documentElement.appendChild(badge)

  function highlight(element) {
    if (state.highlighted === element) return
    state.highlighted?.classList.remove('lensquery-target')
    state.highlighted = element
    element?.classList.add('lensquery-target')
  }

  function onMove(event) {
    highlight(document.elementFromPoint(event.clientX, event.clientY))
  }

  function onKey(event) {
    if (event.key === 'Escape') stop()
  }

  async function onClick(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = event.composedPath().find((item) => item instanceof Element)
    if (!element) return stop()
    const context = buildContext(element)
    stop()
    const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context })
    if (!response?.ok) showFailure(response?.error)
  }

  function stop() {
    state.active = false
    state.highlighted?.classList.remove('lensquery-target')
    badge.remove()
    document.documentElement.classList.remove('lensquery-picking')
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey, true)
    delete window.__lensQueryPicker
  }

  function buildContext(element) {
    const media = element.closest('video, audio')
    const nearby = element.closest('article, section, main, li, form, nav, header, footer') || element.parentElement
    const text = clean(element.innerText || element.textContent || element.getAttribute('alt') || element.getAttribute('title') || '')
    return {
      url: location.href,
      title: document.title,
      tagName: element.tagName,
      role: element.getAttribute('role') || implicitRole(element),
      text: text.slice(0, 4000),
      accessibleName: accessibleName(element).slice(0, 1000),
      selector: uniqueSelector(element),
      outerHtml: sanitizeHtml(element.outerHTML).slice(0, 12000),
      nearbyText: clean(nearby?.innerText || nearby?.textContent || '').slice(0, 8000),
      media: media ? {
        kind: media.tagName.toLowerCase(),
        currentTime: Number(media.currentTime || 0),
        duration: Number.isFinite(media.duration) ? Number(media.duration) : undefined,
        source: media.currentSrc || media.src || media.querySelector('source')?.src,
        paused: Boolean(media.paused),
      } : undefined,
    }
  }

  function clean(value) {
    return value.replace(/\s+/g, ' ').trim()
  }

  function sanitizeHtml(html) {
    return html
      .replace(/\s(?:value|data-token|data-secret|authorization)=("[^"]*"|'[^']*')/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>[removed]</script>')
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
    }
    return element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.labels?.[0]?.textContent || ''
  }

  function implicitRole(element) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : 'textbox'
    if (tag === 'video') return 'video'
    if (tag === 'img') return 'img'
    return undefined
  }

  function uniqueSelector(element) {
    if (element.id) return `#${CSS.escape(element.id)}`
    const parts = []
    let node = element
    while (node && node !== document.documentElement && parts.length < 6) {
      let part = node.tagName.toLowerCase()
      const stableClass = [...node.classList].find((name) => !/^(active|selected|hover|focus|css-|jsx-)/.test(name))
      if (stableClass) part += `.${CSS.escape(stableClass)}`
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  function showFailure(message) {
    const notice = document.createElement('div')
    notice.id = 'lensquery-picker-error'
    notice.textContent = `LensQuery 连接失败：${message || '请先启动桌面应用并安装 Native Messaging Host。'}`
    document.documentElement.appendChild(notice)
    setTimeout(() => notice.remove(), 6000)
  }

  window.__lensQueryPicker = { active: true, stop }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey, true)
})()
