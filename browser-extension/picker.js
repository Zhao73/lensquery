(() => {
  if (window.__lensQueryPicker?.active) {
    window.__lensQueryPicker.stop()
    return
  }

  const state = { active: true, highlighted: null, locked: null }
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
    if (state.locked) return
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
    if (state.locked !== element) {
      state.locked = element
      highlight(element)
      badge.textContent = '已高亮目标 · 再点一次识别 · ⌥ 点击可设置范围'
      return
    }
    const context = buildContext(element)
    if (event.altKey) {
      showComposer(context, event.clientX, event.clientY)
      return
    }
    context.selectionMode = window.getSelection()?.toString().trim() ? 'selection' : 'object'
    context.selectedText = textForScope(element, context.selectionMode)
    context.analysisMode = undefined
    context.outputFormat = undefined
    delete context.__element
    stop()
    const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context })
    if (!response?.ok) showFailure(response?.error)
  }

  function showComposer(context, x, y) {
    state.active = false
    state.highlighted?.classList.remove('lensquery-target')
    badge.remove()
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('click', onClick, true)
    const composer = document.createElement('form')
    composer.id = 'lensquery-annotation-composer'
    composer.innerHTML = `
      <div class="lensquery-composer-head"><strong>注释并询问</strong><button type="button" data-close aria-label="关闭">×</button></div>
      <label>文字范围<select name="scope">
        <option value="selection">已选择文字</option>
        <option value="word">当前单词</option>
        <option value="paragraph">当前段落</option>
        <option value="page">全文</option>
        <option value="object">当前对象</option>
      </select></label>
      <label>分析方式<select name="analysis">
        <option value="explain">解释内容</option>
        <option value="how-to">使用方法</option>
        <option value="deep-dive">深入原理</option>
        <option value="customer-reply">生成客户回复</option>
        <option value="code">分析代码</option>
      </select></label>
      <label>简单注释<textarea name="annotation" maxlength="1000" placeholder="例如：只解释红色报错，给出修复步骤"></textarea></label>
      <div class="lensquery-composer-actions"><button type="button" data-close>取消</button><button type="submit">发送给 LensQuery</button></div>`
    composer.style.left = `${Math.min(x, innerWidth - 360)}px`
    composer.style.top = `${Math.min(y, innerHeight - 350)}px`
    document.documentElement.appendChild(composer)
    composer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', stop))
    composer.addEventListener('submit', async (event) => {
      event.preventDefault()
      const data = new FormData(composer)
      const scope = String(data.get('scope') || 'selection')
      context.selectionMode = scope
      context.selectedText = textForScope(context.__element, scope)
      context.annotation = String(data.get('annotation') || '').trim()
      context.analysisMode = String(data.get('analysis') || 'explain')
      context.outputFormat = context.analysisMode === 'customer-reply' ? 'customer-reply' : 'adaptive'
      delete context.__element
      stop()
      const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context })
      if (!response?.ok) showFailure(response?.error)
    })
    composer.querySelector('textarea')?.focus()
  }

  function textForScope(element, scope) {
    const nativeSelection = clean(window.getSelection()?.toString() || '')
    if (scope === 'selection' && nativeSelection) return nativeSelection.slice(0, 16000)
    if (scope === 'word') return wordAtCurrentSelection(element).slice(0, 1000)
    if (scope === 'paragraph') {
      const paragraph = element.closest('p, li, dd, dt, blockquote, pre, h1, h2, h3, h4, h5, h6') || element
      return clean(paragraph.innerText || paragraph.textContent || '').slice(0, 16000)
    }
    if (scope === 'page') return clean(document.body?.innerText || '').slice(0, 32000)
    return clean(element.innerText || element.textContent || element.getAttribute('alt') || '').slice(0, 16000)
  }

  function wordAtCurrentSelection(element) {
    const selection = window.getSelection()
    const node = selection?.anchorNode || element.firstChild
    const value = node?.textContent || element.textContent || ''
    const offset = Math.min(selection?.anchorOffset || 0, value.length)
    const before = value.slice(0, offset).match(/[\p{L}\p{N}_'-]+$/u)?.[0] || ''
    const after = value.slice(offset).match(/^[\p{L}\p{N}_'-]+/u)?.[0] || ''
    return before + after || clean(value).split(/\s+/)[0] || ''
  }

  function stop() {
    state.active = false
    state.highlighted?.classList.remove('lensquery-target')
    state.locked = null
    badge.remove()
    document.documentElement.classList.remove('lensquery-picking')
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey, true)
    document.getElementById('lensquery-annotation-composer')?.remove()
    delete window.__lensQueryPicker
  }

  function buildContext(element) {
    const media = element.closest('video, audio')
      || element.closest('.html5-video-player, [data-media-player]')?.querySelector('video, audio')
    const nearby = element.closest('article, section, main, li, form, nav, header, footer') || element.parentElement
    const text = clean(element.innerText || element.textContent || element.getAttribute('alt') || element.getAttribute('title') || '')
    const mediaText = media ? collectMediaText(media) : {}
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
      __element: element,
      selectionMode: window.getSelection()?.toString().trim() ? 'selection' : 'object',
      selectedText: clean(window.getSelection()?.toString() || '').slice(0, 16000),
      captions: mediaText.captions,
      transcript: mediaText.transcript,
      media: media ? {
        kind: media.tagName.toLowerCase(),
        currentTime: Number(media.currentTime || 0),
        duration: Number.isFinite(media.duration) ? Number(media.duration) : undefined,
        source: media.currentSrc || media.src || media.querySelector('source')?.src,
        paused: Boolean(media.paused),
      } : undefined,
    }
  }

  function collectMediaText(media) {
    const cueLines = []
    try {
      for (const track of media.textTracks || []) {
        for (const cue of track.activeCues || []) {
          const value = clean(cue.text || '')
          if (value && !cueLines.includes(value)) cueLines.push(value)
        }
      }
    } catch {
      // Some players expose only rendered caption nodes.
    }
    document.querySelectorAll('.ytp-caption-segment, [class*="caption"] [class*="text"]')
      .forEach((node) => {
        const value = clean(node.textContent || '')
        if (value && !cueLines.includes(value)) cueLines.push(value)
      })

    const transcriptLines = []
    document.querySelectorAll('ytd-transcript-segment-renderer, [data-transcript-segment], [class*="transcript-segment"]')
      .forEach((node) => {
        const timestamp = clean(node.querySelector('[class*="timestamp"], .segment-timestamp')?.textContent || '')
        const line = clean(node.querySelector('[class*="segment-text"], yt-formatted-string')?.textContent || node.textContent || '')
        const value = clean(`${timestamp} ${line}`)
        if (value && !transcriptLines.includes(value)) transcriptLines.push(value)
      })

    return {
      captions: cueLines.join(' ').slice(0, 16000) || undefined,
      transcript: transcriptLines.join('\n').slice(0, 120000) || undefined,
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
