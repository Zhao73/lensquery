(() => {
  const MAX_TRANSCRIPT_CHARS = 240_000
  const MAX_HIDDEN_CONTENT_ITEMS = 64
  const MAX_HIDDEN_CONTENT_CHARS = 24_000
  const MAX_SCANNED_ELEMENTS = 6_000

  if (window.__lensQueryPageContext) return

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function directText(element) {
    if (!element?.childNodes) return ''
    return clean([...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' '))
  }

  function instructionLikeText(value) {
    const text = clean(value)
    return [
      /\b(ignore|disregard|override|forget)\b.{0,100}\b(previous|prior|system|developer|instruction|rules?)\b/i,
      /\bdo\s+not\s+(tell|reveal|mention|disclose)\b/i,
      /\b(agree|side)\s+with\s+(me|my|the user)\b/i,
      /\bsystem\s+prompt\b/i,
      /(忽略|无视|覆盖|忘记).{0,40}(之前|以上|系统|开发者|指令|规则)/,
      /(不要|不得).{0,20}(说出|透露|提及|告诉)/,
      /(赞同|同意).{0,12}(我|用户).{0,12}(意见|观点)/,
      /系统提示词|开发者指令/,
      /(以前|上記).{0,20}(指示|命令).{0,12}無視/,
      /(言わない|公開しない).{0,20}(指示|内容)/,
    ].some((pattern) => pattern.test(text))
  }

  function redactSecretLikeText(value) {
    return String(value || '')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED API KEY]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
      .replace(/\b(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^\s"'<>]{6,}/gi, '$1=[REDACTED]')
  }

  function colorTuple(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i)
    if (!match) return undefined
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return undefined
    return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1]
  }

  function relativeLuminance(color) {
    const channels = color.slice(0, 3).map((value) => {
      const channel = Math.max(0, Math.min(255, value)) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }

  function contrastRatio(left, right) {
    const first = relativeLuminance(left)
    const second = relativeLuminance(right)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }

  function effectiveBackground(element) {
    let node = element
    while (node instanceof Element) {
      const color = colorTuple(getComputedStyle(node).backgroundColor)
      if (color && color[3] >= 0.95) return color
      node = node.parentElement
    }
    return [255, 255, 255, 1]
  }

  function hiddenReason(element) {
    let node = element
    let effectiveOpacity = 1
    while (node instanceof Element) {
      const style = getComputedStyle(node)
      if (node.hasAttribute('hidden')) return 'html-hidden'
      if (node.getAttribute('aria-hidden') === 'true') return 'aria-hidden'
      if (style.display === 'none') return 'display-none'
      if (['hidden', 'collapse'].includes(style.visibility)) return 'visibility-hidden'
      const opacity = Number.parseFloat(style.opacity || '1')
      if (Number.isFinite(opacity)) effectiveOpacity *= Math.max(0, Math.min(1, opacity))
      if (effectiveOpacity <= 0.05) return 'transparent'
      if (style.contentVisibility === 'hidden') return 'visibility-hidden'
      node = node.parentElement
    }

    const style = getComputedStyle(element)
    const foreground = colorTuple(style.color)
    if (foreground && foreground[3] * effectiveOpacity <= 0.05) return 'transparent'
    const fontSize = Number.parseFloat(style.fontSize || '16')
    if (Number.isFinite(fontSize) && fontSize <= 1) return 'tiny-text'
    const clip = `${style.clip || ''} ${style.clipPath || ''}`.toLowerCase()
    if (clip.includes('rect(0') || clip.includes('inset(50%') || clip.includes('inset(100%')) return 'clipped'
    if (['absolute', 'fixed'].includes(style.position)) {
      const rect = element.getBoundingClientRect?.()
      if (rect && (rect.right < -1 || rect.bottom < -1 || rect.left > innerWidth + 1 || rect.top > innerHeight + 1)) return 'offscreen'
    }
    if (foreground) {
      const background = effectiveBackground(element)
      const alpha = Math.max(0, Math.min(1, foreground[3] * effectiveOpacity))
      const rendered = [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        1,
      ]
      if (contrastRatio(rendered, background) <= 1.25) return 'low-contrast'
    }
    return undefined
  }

  function collectHiddenContent() {
    const root = document.body || document.documentElement
    if (!root) return { items: [], scan: { scannedElements: 0, truncated: false, coverage: '页面无可扫描 DOM。' } }
    const candidates = []
    const stack = [root]
    while (stack.length && candidates.length < MAX_SCANNED_ELEMENTS) {
      const element = stack.pop()
      if (!(element instanceof Element)) continue
      candidates.push(element)
      const children = [...element.children]
      if (element.shadowRoot) children.push(...element.shadowRoot.children)
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index])
    }
    const findings = []
    const seen = new Set()
    let characters = 0
    let scannedElements = 0
    let truncated = stack.length > 0
    for (const element of candidates) {
      scannedElements += 1
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT|OPTION)$/i.test(element.tagName || '')) continue
      const text = directText(element)
      if (!text) continue
      const reason = hiddenReason(element)
      if (!reason) continue
      const normalized = redactSecretLikeText(text.slice(0, 2_000))
      const key = `${reason}:${normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      const finding = {
        text: normalized,
        reason,
        selector: uniqueSelector(element),
        instructionLike: instructionLikeText(normalized),
      }
      if (findings.length >= MAX_HIDDEN_CONTENT_ITEMS || characters + normalized.length > MAX_HIDDEN_CONTENT_CHARS) {
        truncated = true
        if (!finding.instructionLike) continue
        for (let index = findings.length - 1; index >= 0 && (findings.length >= MAX_HIDDEN_CONTENT_ITEMS || characters + normalized.length > MAX_HIDDEN_CONTENT_CHARS); index -= 1) {
          if (findings[index].instructionLike) continue
          characters -= findings[index].text.length
          findings.splice(index, 1)
        }
        if (findings.length >= MAX_HIDDEN_CONTENT_ITEMS || characters + normalized.length > MAX_HIDDEN_CONTENT_CHARS) continue
      }
      findings.push(finding)
      characters += normalized.length
    }
    findings.sort((left, right) => Number(right.instructionLike) - Number(left.instructionLike))
    return {
      items: findings,
      scan: {
        scannedElements,
        truncated,
        coverage: '扫描当前页面可访问 DOM 和 open Shadow DOM 的 hidden/aria-hidden、display、visibility、opacity、极小字号、裁剪、离屏定位和文字/背景对比度，并遮罩令牌、密码和 API Key 样式的值。不包括跨域 iframe、closed Shadow DOM、Canvas 内部对象或已从像素中完全消失的内容。',
      },
    }
  }

  function absoluteUrl(value) {
    if (!value) return ''
    try {
      return new URL(value, location.href).href
    } catch {
      return String(value)
    }
  }

  function safeResourceUrl(value) {
    if (!value) return ''
    try {
      const url = new URL(value, location.href)
      if (!['http:', 'https:'].includes(url.protocol)) return ''
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return url.href.slice(0, 2_048)
    } catch {
      return ''
    }
  }

  function collectSiteAnalysis(selected) {
    const scripts = [...document.scripts]
      .map((node) => safeResourceUrl(node.src))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 32)
    const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')]
      .map((node) => safeResourceUrl(node.href))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 32)
    const generator = clean(document.querySelector('meta[name="generator" i]')?.content || '').slice(0, 240)
    const viewport = clean(document.querySelector('meta[name="viewport" i]')?.content || '').slice(0, 500)
    const resourceText = `${scripts.join(' ')} ${stylesheets.join(' ')}`.toLowerCase()
    const technologies = []
    const addTechnology = (name, category, confidence, evidence) => {
      const values = evidence.map(clean).filter(Boolean).slice(0, 6)
      if (!values.length || technologies.some((item) => item.name === name)) return
      technologies.push({ name, category, confidence, evidence: values })
    }

    if (document.querySelector('#__next, script#__NEXT_DATA__') || resourceText.includes('/_next/')) addTechnology('Next.js', 'framework', 'high', ['发现 #__next / __NEXT_DATA__ 或 /_next/ 资源'])
    if (document.querySelector('#__nuxt, [data-n-head]') || resourceText.includes('/_nuxt/')) addTechnology('Nuxt', 'framework', 'high', ['发现 #__nuxt、data-n-head 或 /_nuxt/ 资源'])
    if (document.querySelector('[ng-version]')) addTechnology('Angular', 'framework', 'high', [`ng-version=${document.querySelector('[ng-version]')?.getAttribute('ng-version') || 'present'}`])
    if (document.querySelector('[data-v-app], [data-vue-meta]') || /(?:^|[/.-])vue(?:[.-]|$)/.test(resourceText)) addTechnology('Vue', 'framework', document.querySelector('[data-v-app], [data-vue-meta]') ? 'high' : 'medium', ['发现 Vue DOM 标记或明确命名资源'])
    if (document.querySelector('[data-reactroot], [data-reactid]') || /(?:^|[/.-])react(?:[.-]|$)/.test(resourceText)) addTechnology('React', 'framework', document.querySelector('[data-reactroot], [data-reactid]') ? 'high' : 'medium', ['发现 React DOM 标记或明确命名资源'])
    if (document.querySelector('[data-sveltekit-preload-data], [data-svelte-h]') || resourceText.includes('/_app/immutable/')) addTechnology('SvelteKit / Svelte', 'framework', 'high', ['发现 SvelteKit / Svelte 标记或 _app/immutable 资源'])
    if (document.querySelector('astro-island, astro-slot') || resourceText.includes('/_astro/')) addTechnology('Astro', 'framework', 'high', ['发现 Astro island 或 /_astro/ 资源'])
    if (resourceText.includes('/@vite/client') || resourceText.includes('/@vite/') || document.querySelector('script[type="module"][src*="vite"]')) addTechnology('Vite', 'build', 'high', ['发现 @vite 客户端路径或明确命名的 Vite 模块资源'])
    if (resourceText.includes('/wp-content/') || /wordpress/i.test(generator)) addTechnology('WordPress', 'platform', 'high', ['发现 wp-content 资源或 WordPress generator'])
    if (resourceText.includes('cdn.shopify.com') || /shopify/i.test(generator) || globalThis.Shopify) addTechnology('Shopify', 'platform', 'high', ['发现 Shopify CDN、generator 或页面运行时'])
    if (document.querySelector('[data-wf-page], [data-wf-site]') || /webflow/i.test(generator)) addTechnology('Webflow', 'platform', 'high', ['发现 Webflow data-wf 标记或 generator'])
    if (/bootstrap(?:\.min)?\.(?:css|js)/.test(resourceText)) addTechnology('Bootstrap', 'ui', 'high', ['发现明确命名的 Bootstrap CSS / JavaScript'])
    if (/tailwind(?:\.min)?\.(?:css|js)/.test(resourceText)) addTechnology('Tailwind CSS', 'ui', 'medium', ['发现明确命名的 Tailwind 资源；未据类名猜测'])
    if (document.querySelector('style[data-emotion], [class*="Mui"]')) addTechnology('Emotion / Material UI', 'ui', 'medium', ['发现 data-emotion 或 Mui 类名'])
    if (/googletagmanager\.com|google-analytics\.com/.test(resourceText)) addTechnology('Google Analytics / Tag Manager', 'analytics', 'high', ['发现 Google Analytics / Tag Manager 资源'])
    if (/plausible\.io\/js/.test(resourceText)) addTechnology('Plausible Analytics', 'analytics', 'high', ['发现 plausible.io 脚本'])
    if (resourceText.includes('/cdn-cgi/')) addTechnology('Cloudflare edge features', 'delivery', 'medium', ['发现 /cdn-cgi/ 资源；仅证明使用 Cloudflare 功能，不证明完整托管平台'])

    const mediaQueries = []
    for (const sheet of [...document.styleSheets].slice(0, 64)) {
      try {
        for (const rule of [...(sheet.cssRules || [])].slice(0, 2_000)) {
          const condition = clean(rule.conditionText || '')
          if (condition && !mediaQueries.includes(condition)) mediaQueries.push(condition.slice(0, 500))
          if (mediaQueries.length >= 24) break
        }
      } catch {
        // Cross-origin stylesheets do not expose cssRules.
      }
      if (mediaQueries.length >= 24) break
    }

    const sampledElements = [...document.querySelectorAll('body *')].slice(0, 2_000)
    let gridElements = 0
    let flexElements = 0
    for (const element of sampledElements) {
      const display = getComputedStyle(element).display
      if (display.includes('grid')) gridElements += 1
      if (display.includes('flex')) flexElements += 1
    }
    const selectedStyle = selected instanceof Element ? getComputedStyle(selected) : undefined
    const selectedElementStyles = selectedStyle ? {
      display: selectedStyle.display,
      position: selectedStyle.position,
      width: selectedStyle.width,
      height: selectedStyle.height,
      color: selectedStyle.color,
      backgroundColor: selectedStyle.backgroundColor,
      fontFamily: selectedStyle.fontFamily.slice(0, 500),
      fontSize: selectedStyle.fontSize,
      fontWeight: selectedStyle.fontWeight,
      lineHeight: selectedStyle.lineHeight,
      padding: selectedStyle.padding,
      margin: selectedStyle.margin,
      gap: selectedStyle.gap,
      gridTemplateColumns: selectedStyle.gridTemplateColumns.slice(0, 500),
      flexDirection: selectedStyle.flexDirection,
    } : undefined

    let transferBytes
    try {
      const entries = globalThis.performance?.getEntriesByType?.('resource') || []
      const total = entries.reduce((sum, entry) => sum + (Number(entry.transferSize) || 0), 0)
      if (total > 0) transferBytes = total
    } catch {
      // Resource Timing can be unavailable or privacy-restricted.
    }

    const allImages = [...document.images]
    const allButtons = [...document.querySelectorAll('button, [role="button"]')]
    const allInputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
    return {
      technologies: technologies.slice(0, 32),
      scripts,
      stylesheets,
      meta: {
        language: clean(document.documentElement.lang || '').slice(0, 80) || undefined,
        doctype: document.doctype?.name ? `<!DOCTYPE ${document.doctype.name}>` : undefined,
        generator: generator || undefined,
        viewport: viewport || undefined,
      },
      structure: {
        headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        landmarks: document.querySelectorAll('main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"]').length,
        links: document.querySelectorAll('a[href]').length,
        buttons: allButtons.length,
        images: allImages.length,
        forms: document.forms.length,
      },
      accessibility: {
        imagesWithoutAlt: allImages.filter((image) => !image.hasAttribute('alt')).length,
        buttonsWithoutName: allButtons.filter((button) => !clean(accessibleName(button) || button.textContent)).length,
        inputsWithoutLabel: allInputs.filter((input) => !clean(accessibleName(input) || input.getAttribute('placeholder'))).length,
      },
      responsive: {
        viewportConfigured: Boolean(viewport),
        mediaQueries,
        gridElements,
        flexElements,
        sampledElements: sampledElements.length,
      },
      selectedElementStyles,
      resources: {
        scripts: document.scripts.length,
        stylesheets: document.querySelectorAll('link[rel~="stylesheet"][href], style').length,
        images: allImages.length,
        fonts: document.fonts?.size || 0,
        transferBytes,
      },
      coverage: '基于当前已渲染 DOM、可见资源 URL、同源可读 CSS 规则、Resource Timing 与选中元素计算样式。技术栈条目保留证据和置信度；不包括服务端源码、构建配置、跨域 CSS 内容、closed Shadow DOM 或未加载路由。',
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

  function deepestHoveredElement() {
    try {
      return [...document.querySelectorAll(':hover')].at(-1) || null
    } catch {
      return null
    }
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
    if (request.kind === 'audio') {
      return hoveredElement('audio')
        || [...document.querySelectorAll('audio')].find((audio) => sameSource(audio, request.srcUrl))
        || document.querySelector('audio')
        || document.body
    }
    if (request.kind === 'link') {
      const expected = absoluteUrl(request.linkUrl)
      return hoveredElement('a[href]')
        || [...document.querySelectorAll('a[href]')].find((link) => absoluteUrl(link.href) === expected)
        || document.body
    }
    if (request.kind === 'editable') {
      const active = document.activeElement
      return hoveredElement('input, textarea, [contenteditable="true"]')
        || (active?.matches?.('input, textarea, [contenteditable="true"]') ? active : null)
        || document.body
    }
    return deepestHoveredElement()
      || document.querySelector('main, article, [role="main"]')
      || document.body
      || document.documentElement
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

    const transcript = boundedTranscript(transcriptLines)
    return {
      captions: cueLines.join(' ').slice(0, 16_000) || undefined,
      transcript: transcript.text,
      transcriptCueCount: transcript.cueCount || undefined,
      transcriptTruncated: transcript.truncated || undefined,
    }
  }

  function boundedTranscript(lines) {
    const joined = lines.join('\n')
    return {
      text: joined.slice(0, MAX_TRANSCRIPT_CHARS) || undefined,
      cueCount: lines.length,
      truncated: joined.length > MAX_TRANSCRIPT_CHARS,
    }
  }

  function extractJsonArray(source, marker) {
    const markerIndex = source.indexOf(marker)
    if (markerIndex < 0) return undefined
    const start = source.indexOf('[', markerIndex + marker.length)
    if (start < 0) return undefined
    let depth = 0
    let quote = false
    let escaped = false
    for (let index = start; index < source.length; index += 1) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quote = false
        continue
      }
      if (character === '"') {
        quote = true
        continue
      }
      if (character === '[') depth += 1
      if (character === ']') {
        depth -= 1
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1))
          } catch {
            return undefined
          }
        }
      }
    }
    return undefined
  }

  function youtubeCaptionTracks() {
    if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return []
    for (const script of document.scripts) {
      const source = script.textContent || ''
      if (!source.includes('captionTracks')) continue
      const tracks = extractJsonArray(source, '"captionTracks":')
      if (Array.isArray(tracks) && tracks.length) return tracks
    }
    return []
  }

  function chooseCaptionTrack(tracks) {
    const language = clean(navigator.language || 'en').toLowerCase()
    const baseLanguage = language.split('-')[0]
    const score = (track) => {
      const code = clean(track.languageCode || '').toLowerCase()
      if (code === language && track.kind !== 'asr') return 0
      if (code === baseLanguage && track.kind !== 'asr') return 1
      if (code === language) return 2
      if (code === baseLanguage) return 3
      if (code.startsWith('en') && track.kind !== 'asr') return 4
      if (code.startsWith('en')) return 5
      return track.kind === 'asr' ? 7 : 6
    }
    return [...tracks].sort((left, right) => score(left) - score(right))[0]
  }

  function formatTranscriptTime(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1_000))
    const hours = Math.floor(seconds / 3_600)
    const minutes = Math.floor((seconds % 3_600) / 60)
    const remainder = seconds % 60
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  }

  function transcriptFromJson3(payload) {
    const lines = []
    for (const event of payload?.events || []) {
      const text = clean((event.segs || []).map((segment) => segment.utf8 || '').join(''))
      if (!text || text === '\n') continue
      const value = `[${formatTranscriptTime(event.tStartMs)}] ${text}`
      if (lines.at(-1) !== value) lines.push(value)
    }
    return boundedTranscript(lines)
  }

  async function fetchYouTubeTranscript() {
    const track = chooseCaptionTrack(youtubeCaptionTracks())
    if (!track?.baseUrl) return undefined
    try {
      const url = new URL(track.baseUrl, location.href)
      url.searchParams.set('fmt', 'json3')
      const response = await fetch(url.href, { credentials: 'include' })
      if (!response.ok) return undefined
      const transcript = transcriptFromJson3(await response.json())
      if (!transcript.text) return undefined
      return {
        transcript: transcript.text,
        transcriptCueCount: transcript.cueCount,
        transcriptTruncated: transcript.truncated,
        captionLanguage: clean(track.languageCode || track.name?.simpleText || '') || undefined,
      }
    } catch {
      return undefined
    }
  }

  async function enrichContext(context) {
    if (context.media?.kind !== 'video' || context.transcript) return context
    const youtube = await fetchYouTubeTranscript()
    if (!youtube?.transcript) return context
    return {
      ...context,
      transcript: youtube.transcript,
      transcriptCueCount: youtube.transcriptCueCount,
      transcriptTruncated: youtube.transcriptTruncated,
      transcriptLanguage: youtube.captionLanguage,
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
    const hidden = collectHiddenContent()
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
      transcriptCueCount: mediaText.transcriptCueCount,
      transcriptTruncated: mediaText.transcriptTruncated,
      contextMenuKind: options.contextMenuKind,
      analysisMode: options.analysisMode,
      outputFormat: media ? 'summary' : 'adaptive',
      hiddenContent: hidden.items,
      hiddenContentScan: hidden.scan,
      siteAnalysis: collectSiteAnalysis(element),
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

  const api = { buildContext, collectSiteAnalysis, enrichContext, findTarget, textForScope }
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
      void enrichContext(context)
        .then((enriched) => sendResponse({ ok: true, context: enriched }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }))
    } catch (error) {
      sendResponse({ ok: false, error: String(error) })
    }
    return true
  })
})()
