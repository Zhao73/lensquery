(() => {
  if (window.__lensQueryPicker?.active) {
    window.__lensQueryPicker.stop()
    return
  }

  const contextApi = window.__lensQueryPageContext
  if (!contextApi) {
    showFailure('网页上下文采集器没有初始化，请刷新页面后重试。')
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
    const selected = window.getSelection()?.toString().trim()
    const kind = selected
      ? 'selection'
      : element.closest('video, audio, .html5-video-player, [data-media-player]')
        ? 'video'
        : element.closest('img, picture') ? 'image' : 'object'
    const context = contextApi.buildContext(element, { kind })
    context.__element = element
    if (event.altKey) {
      showComposer(context, event.clientX, event.clientY)
      return
    }
    context.selectionMode = window.getSelection()?.toString().trim() ? 'selection' : 'object'
    context.selectedText = contextApi.textForScope(element, context.selectionMode)
    context.analysisMode = undefined
    context.outputFormat = undefined
    delete context.__element
    stop()
    const enriched = await contextApi.enrichContext(context)
    const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context: enriched })
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
      context.selectedText = contextApi.textForScope(context.__element, scope)
      context.annotation = String(data.get('annotation') || '').trim()
      context.analysisMode = String(data.get('analysis') || 'explain')
      context.outputFormat = context.analysisMode === 'customer-reply' ? 'customer-reply' : 'adaptive'
      delete context.__element
      stop()
      const enriched = await contextApi.enrichContext(context)
      const response = await chrome.runtime.sendMessage({ type: 'lensquery-context', context: enriched })
      if (!response?.ok) showFailure(response?.error)
    })
    composer.querySelector('textarea')?.focus()
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
