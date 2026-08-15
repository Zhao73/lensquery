(() => {
  if (window.__lensQueryPageContext) return

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function absoluteUrl(value) {
    if (!value) return ''
    try {
      return new URL(value, location.href).href
    } catch {
      return String(value)
    }
  }

  function elementText(element) {
    return clean(
      element?.innerText
      || element?.textContent
      || element?.getAttribute?.('alt')
      || element?.getAttribute?.('title')
      || '',
    )
  }

  function selectedElement() {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return null
    const ancestor = selection.getRangeAt(0).commonAncestorContainer
    return ancestor instanceof Element ? ancestor : ancestor.parentElement
  }

  function hoveredElement(selector) {
    return [...document.querySelectorAll(selector)].find((element) => {
      try {
        return element.matches(':hover')
      } catch {
        return false
      }
    })
  }

  function sameSource(element, sourceUrl) {
    if (!sourceUrl) return false
    const expected = absoluteUrl(sourceUrl)
    const candidates = [
      element.currentSrc,
      element.src,
      element.getAttribute?.('src'),
      element.querySelector?.('source')?.src,
    ].filter(Boolean).map(absoluteUrl)
    return candidates.includes(expected)
  }

  function findTarget(request = {}) {
    if (request.kind === 'selection') return selectedElement() || document.querySelector('main, article') || document.body
    if (request.kind === 'image') {
      return hoveredElement('img')
        || [...document.images].find((image) => sameSource(image, request.srcUrl))
        || document.querySelector('img')
        || document.body
    }
    if (request.kind === 'video') {
      return hoveredElement('video')
        || [...document.querySelectorAll('video')].find((video) => sameSource(video, request.srcUrl))
        || document.querySelector('.html5-video-player video, [data-media-player] video, video')
        || document.body
    }
    return document.querySelector('main, article, [role="main"]') || document.body || document.documentElement
  }

  function textForScope(element, scope) {
    const nativeSelection = clean(window.getSelection()?.toString() || '')
    if (scope === 'selection' && nativeSelection) return nativeSelection.slice(0, 16_000)
    if (scope === 'word') return wordAtCurrentSelection(element).slice(0, 1_000)
    if (scope === 'paragraph') {
      const paragraph = element.closest?.('p, li, dd, dt, blockquote, pre, h1, h2, h3, h4, h5, h6') || element
      return elementText(paragraph).slice(0, 16_000)
    }
    if (scope === 'page') return clean(document.body?.innerText || document.body?.textContent || '').slice(0, 32_000)
    return elementText(element).slice(0, 16_000)
  }

  function wordAtCurrentSelection(element) {
    const selection = window.getSelection()
    const node = selection?.anchorNode || element?.firstChild
    const value = node?.textContent || element?.textContent || ''
    const offset = Math.min(selection?.anchorOffset || 0, value.length)
    const before = value.slice(0, offset).match(/[\p{L}\p{N}_'-]+$/u)?.[0] || ''
    const after = value.slice(offset).match(/^[\p{L}\p{N}_'-]+/u)?.[0] || ''
    return before + after || clean(value).split(/\s+/)[0] || ''
  }

  function contextualText(element, selectedText) {
    const local = element.closest?.('p, li, dd, dt, blockquote, pre, figure, article, section, main, [role="main"]') || element.parentElement || element
    const localText = elementText(local)
    const pageText = clean(document.body?.innerText || document.body?.textContent || '')
    const needle = clean(selectedText || elementText(element)).slice(0, 600)
    const index = needle ? pageText.indexOf(needle) : -1
    const pageExcerpt = index >= 0
      ? pageText.slice(Math.max(0, index - 3_000), Math.min(pageText.length, index + needle.length + 5_000))
      : pageText.slice(0, 8_000)
    return clean(`${localText}\n${pageExcerpt}`).slice(0, 12_000)
  }

  function sanitizeHtml(html) {
    return String(html || '')
      .replace(/\s(?:value|data-token|data-secret|authorization)=("[^"]*"|'[^']*')/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>[removed]</script>')
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute?.('aria-labelledby')
    if (labelledBy) {
      return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
    }
    return element.getAttribute?.('aria-label')
      || element.getAttribute?.('alt')
      || element.getAttribute?.('title')
      || element.labels?.[0]?.textContent
      || ''
  }

  function implicitRole(element) {
    const tag = element.tagName?.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : 'textbox'
    if (tag === 'video') return 'video'
    if (tag === 'audio') return 'audio'
    if (tag === 'img') return 'img'
    return undefined
  }

  function uniqueSelector(element) {
    if (!element?.tagName) return 'body'
    const escapeCss = (value) => globalThis.CSS?.escape?.(value) || String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    if (element.id) return `#${escapeCss(element.id)}`
    const parts = []
    let node = element
    while (node && node !== document.documentElement && parts.length < 6) {
      let part = node.tagName.toLowerCase()
      const stableClass = [...node.classList].find((name) => !/^(active|selected|hover|focus|css-|jsx-)/.test(name))
      if (stableClass) part += `.${escapeCss(stableClass)}`
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ') || 'body'
  }

  function mediaForElement(element) {
    return element.closest?.('video, audio')
      || element.closest?.('.html5-video-player, [data-media-player]')?.querySelector('video, audio')
      || (element.matches?.('video, audio') ? element : null)
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
      captions: cueLines.join(' ').slice(0, 16_000) || undefined,
      transcript: transcriptLines.join('\n').slice(0, 120_000) || undefined,
    }
  }

  function visibleRect(element, kind) {
    let rect
    if (kind === 'selection' && window.getSelection()?.rangeCount) {
      const range = window.getSelection().getRangeAt(0)
      rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    } else {
      rect = element.getBoundingClientRect?.()
    }
    if (!rect || rect.width < 1 || rect.height < 1 || kind === 'page') {
      rect = { left: 0, top: 0, width: innerWidth, height: innerHeight }
    }
    const left = Math.max(0, Math.min(innerWidth, rect.left))
    const top = Math.max(0, Math.min(innerHeight, rect.top))
    const right = Math.max(left + 1, Math.min(innerWidth, rect.right ?? rect.left + rect.width))
    const bottom = Math.max(top + 1, Math.min(innerHeight, rect.bottom ?? rect.top + rect.height))
    return {
      rect: { x: left, y: top, width: right - left, height: bottom - top },
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }
  }

  function buildContext(element, options = {}) {
    const kind = options.kind || 'object'
    const selectionMode = kind === 'selection' ? 'selection' : kind === 'page' ? 'page' : 'object'
    const nativeSelection = clean(options.selectionText || window.getSelection()?.toString() || '')
    const selectedText = selectionMode === 'selection'
      ? nativeSelection.slice(0, 16_000)
      : textForScope(element, selectionMode)
    const media = mediaForElement(element)
    const mediaText = media ? collectMediaText(media) : {}
    const text = elementText(element)
    return {
      url: location.href,
      title: document.title,
      tagName: element.tagName || 'BODY',
      role: element.getAttribute?.('role') || implicitRole(element),
      text: text.slice(0, 4_000),
      accessibleName: clean(accessibleName(element)).slice(0, 1_000),
      selector: uniqueSelector(element),
      outerHtml: sanitizeHtml(element.outerHTML).slice(0, 12_000),
      nearbyText: contextualText(element, selectedText),
      selectionMode,
      selectedText: selectedText || undefined,
      captions: mediaText.captions,
      transcript: mediaText.transcript,
      contextMenuKind: options.contextMenuKind,
      analysisMode: options.analysisMode,
      outputFormat: 'adaptive',
      media: media ? {
        kind: media.tagName.toLowerCase(),
        currentTime: Number(media.currentTime || 0),
        duration: Number.isFinite(media.duration) ? Number(media.duration) : undefined,
        source: media.currentSrc || media.src || media.querySelector('source')?.src,
        paused: Boolean(media.paused),
      } : undefined,
      __snapshot: visibleRect(media || element, kind),
    }
  }

  const api = { buildContext, findTarget, textForScope }
  window.__lensQueryPageContext = api

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'lensquery-collect-page-context') return false
    try {
      const target = findTarget(message.request)
      const context = buildContext(target, {
        kind: message.request?.kind,
        contextMenuKind: message.request?.kind,
        selectionText: message.request?.selectionText,
        analysisMode: message.request?.kind === 'image' ? 'identify' : 'explain',
      })
      sendResponse({ ok: true, context })
    } catch (error) {
      sendResponse({ ok: false, error: String(error) })
    }
    return false
  })
})()
